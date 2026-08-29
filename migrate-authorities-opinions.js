import { mariadb, pg, closeAll } from './db.js';
import { uuidv7 } from './uuidv7.js';
import Ajv from 'ajv/dist/2019.js';
import { opinionAttributionSchema } from './payloadSchemas/opinionAttribution.schema.js';

const INSERT_BATCH_SIZE = 1000;
const LOG_SAMPLE_LIMIT = 20;

const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(opinionAttributionSchema);

// ---------- Pure transforms ----------

// Build the opinion `attribution` payload (inner object) from a resolved new
// authority. Shape follows payloadSchemas/opinionAttribution.schema.js:
// { citation, descriptors, publishedInReference } — authors only, no year.
export function buildAttribution(authEntry) {
  return {
    citation: authEntry.citation,
    descriptors: Array.isArray(authEntry.descriptors) ? authEntry.descriptors : [],
    publishedInReference: authEntry.publishedInReference,
  };
}

// authority.year is an optional string; scenario ④ carries the sentinel '0'.
// publication_year is an integer column, so parse it; '0'/absent/blank → null.
export function parsePublicationYear(year) {
  if (year === null || year === undefined || year === '' || year === '0') return null;
  const n = parseInt(year, 10);
  return Number.isNaN(n) || n === 0 ? null : n;
}

// ---------- Sample logger (bucketed to avoid log flooding) ----------
function makeSampleLogger(label) {
  let n = 0;
  return (msg) => {
    n++;
    if (n <= LOG_SAMPLE_LIMIT) {
      console.warn(`  [${label}] ${msg}`);
    } else if (n === LOG_SAMPLE_LIMIT + 1) {
      console.warn(`  [${label}] ... (further occurrences suppressed; final count at end of run)`);
    }
  };
}

// ---------- Main ----------
async function main() {
  const startTime = new Date();
  console.log(`[${startTime.toISOString()}] Starting authorities → name_opinions migration...`);

  // ---- 1.2 Resolve dictionary ids ----
  const { rows: reasonRows } = await pg.query(
    `SELECT id FROM dictionaries.namechange_reasons WHERE reason = 'original' AND edge_class = 'root'`,
  );
  if (reasonRows.length !== 1) {
    console.error(`  FATAL: expected exactly one namechange_reasons row for reason='original'/edge_class='root', got ${reasonRows.length}`);
    process.exit(1);
  }
  const originalReasonId = reasonRows[0].id;

  const { rows: rankRows } = await pg.query(
    `SELECT id, taxonomy_rank FROM dictionaries.taxonomy_ranks`,
  );
  const rankMap = new Map(rankRows.map((r) => [r.taxonomy_rank, r.id]));
  const unrankedId = rankMap.get('unranked');
  if (unrankedId === undefined) {
    console.error(`  FATAL: no taxonomy_ranks row for 'unranked'`);
    process.exit(1);
  }
  console.log(`  Dict ids: original reason=${originalReasonId}, unranked rank=${unrankedId}`);

  // ---- 1.3 Preload new authorities → resolution Map ----
  const { rows: authRows } = await pg.query(`
    SELECT id,
           reference_id,
           authority->'legacyIDs'->'oldpbdbIDs'      AS oldids,
           authority->>'citation'                    AS citation,
           authority->'descriptors'                  AS descriptors,
           (authority->>'publishedInReference')::boolean AS pir,
           authority->>'year'                        AS year
    FROM authorities
    WHERE succeeded_by_id IS NULL
  `);
  const authMap = new Map(); // taxon_no(str) → {authority_id, reference_id, citation, descriptors, publishedInReference, year}
  for (const a of authRows) {
    const entry = {
      authority_id: a.id,
      reference_id: a.reference_id,
      citation: a.citation,
      descriptors: a.descriptors || [],
      publishedInReference: a.pir,
      year: a.year,
    };
    for (const tid of a.oldids || []) {
      authMap.set(String(tid), entry);
    }
  }
  console.log(`  Loaded ${authRows.length} authorities (heads); ${authMap.size} taxon_no → authority entries`);

  // Counters
  let sourceRows = 0;
  let skipped = 0;
  let informalCount = 0;
  const logSkip = makeSampleLogger('orphan authority');

  // Accumulate all records in memory, validating attribution BEFORE any insert.
  const nameOpinions = [];      // one per resolvable source row

  // ---- 2.1 Stream from MariaDB ----
  const conn = await mariadb.getConnection();
  const stream = conn.connection.query(`
    SELECT taxon_no, taxon_name, taxon_rank, reference_no, authorizer_no, enterer_no
    FROM authorities
    ORDER BY taxon_no ASC
  `).stream();

  try {
    for await (const src of stream) {
      sourceRows++;
      if (sourceRows % 50000 === 0) {
        console.log(`  Processed ${sourceRows} source rows, ${nameOpinions.length} name_opinions, ${skipped} skipped so far...`);
      }

      // ---- 2.2 Resolve authority (skip-and-log if absent) ----
      const authEntry = authMap.get(String(src.taxon_no));
      if (!authEntry) {
        skipped++;
        logSkip(`taxon_no=${src.taxon_no} reference_no=${src.reference_no}`);
        continue;
      }

      // ---- 2.3 Resolve rank_id (informal → unranked; abort on unmapped) ----
      let rankId;
      if (src.taxon_rank === 'informal') {
        rankId = unrankedId;
      } else {
        rankId = rankMap.get(src.taxon_rank);
        if (rankId === undefined) {
          console.error(`\n  FATAL: unmapped taxon_rank='${src.taxon_rank}' for taxon_no=${src.taxon_no}`);
          conn.release();
          process.exit(1);
        }
      }

      // ---- 2.4 Resolve persons with 0-sentinel fallback ----
      let authNo = src.authorizer_no || 0;
      let entNo = src.enterer_no || 0;
      if (authNo === 0 && entNo !== 0) authNo = entNo;
      else if (entNo === 0 && authNo !== 0) entNo = authNo;
      else if (authNo === 0 && entNo === 0) { authNo = 1; entNo = 1; }

      // ---- 2.5 Build attribution + publication_year ----
      const attribution = buildAttribution(authEntry);
      const publicationYear = parsePublicationYear(authEntry.year);

      // ---- 2.6 Validate attribution before any insert ----
      if (!validate({ attribution })) {
        console.error(`\n  VALIDATION FAILED for taxon_no=${src.taxon_no}`);
        console.error('  errors:', JSON.stringify(validate.errors, null, 2));
        console.error('  attribution:', JSON.stringify(attribution, null, 2));
        conn.release();
        process.exit(1);
      }

      // ---- 2.7 Accumulate root name_opinion ----
      const permid = uuidv7();
      nameOpinions.push({
        permid,
        authorizerPersonId: authNo,
        entererPersonId: entNo,
        oldpbdbTaxonNo: src.taxon_no,
        subjectPermid: permid,       // root: subject is itself
        reasonId: originalReasonId,
        rankId,
        authorityId: authEntry.authority_id,
        referenceId: authEntry.reference_id,
        publicationYear,
        attribution,
        newName: src.taxon_name,
      });

      // ---- 2.8 Count informal-rank rows (rank-collapsed to 'unranked' above).
      // These migrate as ordinary root name_opinions only -- no validity_opinions
      // row (removed 2026-08-26; informality is captured by rank_id='unranked').
      if (src.taxon_rank === 'informal') {
        informalCount++;
      }
    }
  } finally {
    conn.release();
  }

  console.log('');
  console.log(`  Source rows read:        ${sourceRows}`);
  console.log(`  name_opinions to insert: ${nameOpinions.length}`);
  console.log(`  informal-rank rows (rank-collapsed to 'unranked'): ${informalCount}`);
  console.log(`  Skipped (orphan authority):   ${skipped}`);

  // ---- 3.3 Reconcile totals ----
  if (nameOpinions.length + skipped !== sourceRows) {
    console.error(`  FATAL: reconciliation failed! ${nameOpinions.length} inserted + ${skipped} skipped != ${sourceRows} source`);
    process.exit(1);
  }
  console.log(`  Reconciliation: ${nameOpinions.length} + ${skipped} == ${sourceRows} ✓`);

  // ---- 3.1 Transaction-wrapped bulk insert ----
  const pgClient = await pg.connect();
  let insertedNO = 0;
  try {
    await pgClient.query('BEGIN');

    // name_opinions (17 columns)
    for (let i = 0; i < nameOpinions.length; i += INSERT_BATCH_SIZE) {
      const batch = nameOpinions.slice(i, i + INSERT_BATCH_SIZE);
      const values = [];
      const params = [];
      let p = 1;
      for (const r of batch) {
        values.push(`($${p},$${p+1},$${p+2},$${p+3},$${p+4},$${p+5},$${p+6},$${p+7},$${p+8},$${p+9},$${p+10},$${p+11},$${p+12},$${p+13},$${p+14},$${p+15},$${p+16})`);
        params.push(
          r.permid,               // permid
          r.authorizerPersonId,   // authorizer_person_id
          r.entererPersonId,      // enterer_person_id
          r.oldpbdbTaxonNo,       // oldpbdb_taxon_no
          r.subjectPermid,        // subject_permid
          null,                   // target_permid (root)
          r.reasonId,             // reason_id
          'root',                 // edge_class
          null,                   // objective
          r.newName,              // new_name
          r.rankId,               // rank_id
          r.authorityId,          // authority_id
          r.referenceId,          // reference_id
          r.publicationYear,      // publication_year
          JSON.stringify(r.attribution), // attribution
          false,                  // evidence
          false,                  // removed
        );
        p += 17;
      }
      await pgClient.query(
        `INSERT INTO name_opinions
           (permid, authorizer_person_id, enterer_person_id, oldpbdb_taxon_no, subject_permid,
            target_permid, reason_id, edge_class, objective, new_name, rank_id, authority_id,
            reference_id, publication_year, attribution, evidence, removed)
         VALUES ${values.join(',')}`,
        params,
      );
      insertedNO += batch.length;
      if ((i / INSERT_BATCH_SIZE) % 50 === 0) {
        console.log(`  Inserted ${insertedNO}/${nameOpinions.length} name_opinions...`);
      }
    }

    await pgClient.query('COMMIT');
    console.log(`  Committed: ${insertedNO} name_opinions`);
  } catch (err) {
    await pgClient.query('ROLLBACK').catch(() => {});
    console.error('  Insert failed, transaction rolled back:', err.message);
    pgClient.release();
    process.exit(1);
  }
  pgClient.release();

  // ---- 3.2 Reset identity sequence ----
  await pg.query(`SELECT setval(pg_get_serial_sequence('name_opinions','id'), (SELECT MAX(id) FROM name_opinions))`);

  const { rows: noCnt } = await pg.query('SELECT COUNT(*)::int AS n FROM name_opinions');
  console.log(`  Final counts in PG: name_opinions=${noCnt[0].n}`);

  const elapsed = ((new Date() - startTime) / 1000).toFixed(1);
  console.log(`[${new Date().toISOString()}] authorities → name_opinions migration complete in ${elapsed}s`);
}

// Only run main() when invoked directly, so pure transforms can be imported for unit tests
const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((err) => {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  }).finally(() => closeAll());
}
