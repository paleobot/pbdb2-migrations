import { mariadb, pg, closeAll } from './db.js';
import { uuidv7 } from './uuidv7.js';
import { writeFileSync } from 'node:fs';
import Ajv from 'ajv/dist/2019.js';
import { opinionAttributionSchema } from './payloadSchemas/opinionAttribution.schema.js';
// Reuse the transforms established by the assignment slice rather than re-declaring
// a third copy: parseYear (pubyr string → int|null) and buildOpinionAttribution
// (authors-only inner object, with the "authority unknown" sentinel for blank authorship).
import { parseYear, buildOpinionAttribution } from './migrate-assignment-opinions.js';

const INSERT_BATCH_SIZE = 1000;
const LOG_SAMPLE_LIMIT = 20;
const FAILING_CSV = 'failing-synonymy-opinions.csv';

const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(opinionAttributionSchema);

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

// ---------- CSV helper ----------
function toCsv(cols, rows) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [cols.join(',')].concat(rows.map((r) => cols.map((k) => esc(r[k])).join(','))).join('\n') + '\n';
}

// ---------- Main ----------
async function main() {
  const startTime = new Date();
  console.log(`[${startTime.toISOString()}] Starting synonymy (concept) name_opinions migration...`);

  // ---- 1.4 Resolve the 'junior synonym' reason id (and assert edge_class='concept') ----
  const { rows: reasonRows } = await pg.query(
    `SELECT id FROM dictionaries.namechange_reasons WHERE reason = 'junior synonym' AND edge_class = 'concept'`,
  );
  if (reasonRows.length !== 1) {
    console.error(`  FATAL: expected exactly one namechange_reasons row for reason='junior synonym'/edge_class='concept', got ${reasonRows.length}`);
    process.exit(1);
  }
  const juniorSynonymReasonId = reasonRows[0].id;
  console.log(`  Dict ids: junior synonym reason=${juniorSynonymReasonId} (edge_class='concept')`);

  // ---- 1.2 Preload name-identity Map (oldpbdb_taxon_no → permid) ----
  // Safe to take permid: oldpbdb_taxon_no is carried only by root/original
  // name_opinions rows, where permid ≡ subject_permid (see the mapping doc's
  // "Original-only resolution assumption"). Concept rows this slice inserts set
  // oldpbdb_taxon_no = NULL, so they never enter this Map even on a re-run.
  const { rows: noRows } = await pg.query(`
    SELECT oldpbdb_taxon_no, permid
    FROM name_opinions
    WHERE succeeded_by_id IS NULL AND oldpbdb_taxon_no IS NOT NULL
  `);
  const nameMap = new Map();
  for (const r of noRows) nameMap.set(Number(r.oldpbdb_taxon_no), r.permid);
  console.log(`  Loaded ${nameMap.size} name identities (oldpbdb_taxon_no → permid)`);

  // ---- 1.3 Preload reference Map (reference_no → refs.id) ----
  const { rows: refRows } = await pg.query(`
    SELECT id, (reference->'legacyIDs'->>'oldpbdbID')::int AS rn
    FROM refs
    WHERE succeeded_by_id IS NULL
  `);
  const refMap = new Map();
  for (const r of refRows) if (r.rn !== null) refMap.set(r.rn, r.id);
  console.log(`  Loaded ${refMap.size} reference ids (reference_no → refs.id)`);

  // Counters (all five buckets, including the two expected to be 0 in scope)
  let sourceRows = 0;
  const skip = { child_spelling_unresolved: 0, parent_spelling_zero: 0, parent_spelling_orphan: 0, self_reference: 0, orphan_reference: 0 };
  const logSkip = makeSampleLogger('skip');

  const opinions = [];      // one per retained (insertable) source row
  const skippedRecords = []; // enumerated skips for failing-synonymy-opinions.csv

  // ---- 2.1 Stream the in-scope subset from MariaDB ----
  const conn = await mariadb.getConnection();
  const stream = conn.connection.query(`
    SELECT opinion_no, status, child_no, child_spelling_no, parent_no, parent_spelling_no,
           basis, pubyr, ref_has_opinion, reference_no, authorizer_no, enterer_no,
           author1last, author2last, otherauthors
    FROM opinions
    WHERE (status = 'subjective synonym of' OR status = 'objective synonym of')
      AND spelling_reason = 'original spelling'
    ORDER BY opinion_no ASC
  `).stream();

  try {
    for await (const src of stream) {
      sourceRows++;
      if (sourceRows % 10000 === 0) {
        console.log(`  Processed ${sourceRows} in-scope rows, ${opinions.length} retained so far...`);
      }

      const firstHand = src.ref_has_opinion === 'YES';

      // ---- 3.1–3.4 Resolve edges and reference; skip-and-log on failure ----
      const child = Number(src.child_spelling_no);
      const parent = Number(src.parent_spelling_no);

      const subjectPermid = child ? nameMap.get(child) : undefined;
      if (!subjectPermid) { skip.child_spelling_unresolved++; logSkip(`opinion_no=${src.opinion_no} child_spelling_unresolved child=${src.child_spelling_no}`); skippedRecords.push({ ...src, failure_reason: 'child_spelling_unresolved' }); continue; }

      if (!parent) { skip.parent_spelling_zero++; logSkip(`opinion_no=${src.opinion_no} parent_spelling_zero`); skippedRecords.push({ ...src, failure_reason: 'parent_spelling_zero' }); continue; }
      const targetPermid = nameMap.get(parent);
      if (!targetPermid) { skip.parent_spelling_orphan++; logSkip(`opinion_no=${src.opinion_no} parent_spelling_orphan parent=${src.parent_spelling_no}`); skippedRecords.push({ ...src, failure_reason: 'parent_spelling_orphan' }); continue; }

      if (child === parent) { skip.self_reference++; logSkip(`opinion_no=${src.opinion_no} self_reference taxon=${src.child_spelling_no}`); skippedRecords.push({ ...src, failure_reason: 'self_reference' }); continue; }

      const referenceId = src.reference_no ? refMap.get(Number(src.reference_no)) : undefined;
      if (!referenceId) { skip.orphan_reference++; logSkip(`opinion_no=${src.opinion_no} orphan_reference reference_no=${src.reference_no}`); skippedRecords.push({ ...src, failure_reason: 'orphan_reference' }); continue; }

      // ---- 3.6 objective (carries the subjective/objective split) + evidence ----
      const objective = src.status === 'objective synonym of';
      const evidence = src.basis === 'stated with evidence';

      // ---- 3.7 Persons with 0-sentinel fallback (never fires in scope) ----
      let authNo = src.authorizer_no || 0;
      let entNo = src.enterer_no || 0;
      if (authNo === 0 && entNo !== 0) authNo = entNo;
      else if (entNo === 0 && authNo !== 0) entNo = authNo;
      else if (authNo === 0 && entNo === 0) { authNo = 1; entNo = 1; }

      // ---- 3.8/3.9 Second-hand rule for publication_year + attribution ----
      let publicationYear = null;
      let attribution = null;
      if (!firstHand) {
        publicationYear = parseYear(src.pubyr);
        attribution = buildOpinionAttribution(src); // uses "authority unknown" sentinel when author1last blank
        // ---- 4.1 Validate attribution before any DB write ----
        if (!validate({ attribution })) {
          console.error(`\n  VALIDATION FAILED for opinion_no=${src.opinion_no}`);
          console.error('  errors:', JSON.stringify(validate.errors, null, 2));
          console.error('  attribution:', JSON.stringify(attribution, null, 2));
          conn.release();
          process.exit(1);
        }
      }

      // ---- 3.5/3.10 Accumulate the concept-shape name_opinion ----
      opinions.push({
        permid: uuidv7(),
        authorizerPersonId: authNo,
        entererPersonId: entNo,
        subjectPermid,
        targetPermid,
        objective,
        referenceId,
        publicationYear,
        attribution,
        evidence,
      });
    }
  } finally {
    conn.release();
  }

  const totalSkipped = Object.values(skip).reduce((a, b) => a + b, 0);
  console.log('');
  console.log(`  In-scope rows read:        ${sourceRows}`);
  console.log(`  name_opinions to insert:   ${opinions.length}`);
  console.log(`  Skipped:                   ${totalSkipped}`);
  console.log(`    child_spelling_unresolved: ${skip.child_spelling_unresolved}`);
  console.log(`    parent_spelling_zero:      ${skip.parent_spelling_zero}`);
  console.log(`    parent_spelling_orphan:    ${skip.parent_spelling_orphan}`);
  console.log(`    self_reference:            ${skip.self_reference}`);
  console.log(`    orphan_reference:          ${skip.orphan_reference}`);

  // ---- 5.3 Write the enumerated skips for review ----
  const csvCols = ['opinion_no', 'failure_reason', 'status', 'child_no', 'child_spelling_no',
    'parent_no', 'parent_spelling_no', 'reference_no', 'basis'];
  writeFileSync(FAILING_CSV, toCsv(csvCols, skippedRecords));
  console.log(`  Wrote ${skippedRecords.length} skipped records to ${FAILING_CSV}`);

  // ---- 5.1 Reconciliation invariant ----
  if (opinions.length + totalSkipped !== sourceRows) {
    console.error(`  FATAL: reconciliation failed! ${opinions.length} inserted + ${totalSkipped} skipped != ${sourceRows} in-scope`);
    process.exit(1);
  }
  console.log(`  Reconciliation: ${opinions.length} + ${totalSkipped} == ${sourceRows} ✓`);

  // ---- 4.2 Transaction-wrapped bulk insert (17 columns; concept shape) ----
  const pgClient = await pg.connect();
  let inserted = 0;
  try {
    await pgClient.query('BEGIN');
    for (let i = 0; i < opinions.length; i += INSERT_BATCH_SIZE) {
      const batch = opinions.slice(i, i + INSERT_BATCH_SIZE);
      const values = [];
      const params = [];
      let p = 1;
      for (const r of batch) {
        values.push(`($${p},$${p+1},$${p+2},$${p+3},$${p+4},$${p+5},$${p+6},$${p+7},$${p+8},$${p+9},$${p+10},$${p+11},$${p+12},$${p+13},$${p+14},$${p+15},$${p+16})`);
        params.push(
          r.permid,                                                  // permid
          r.authorizerPersonId,                                      // authorizer_person_id
          r.entererPersonId,                                         // enterer_person_id
          null,                                                      // oldpbdb_taxon_no (concept: none; keeps original-only invariant)
          r.subjectPermid,                                           // subject_permid (junior)
          r.targetPermid,                                            // target_permid (senior)
          juniorSynonymReasonId,                                     // reason_id
          'concept',                                                 // edge_class
          r.objective,                                               // objective
          null,                                                      // new_name (concept carries no identity)
          null,                                                      // rank_id  (concept carries no identity)
          null,                                                      // authority_id
          r.referenceId,                                             // reference_id
          r.publicationYear,                                         // publication_year
          r.attribution === null ? null : JSON.stringify(r.attribution), // attribution
          r.evidence,                                                // evidence
          false,                                                     // removed
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
      inserted += batch.length;
      if ((i / INSERT_BATCH_SIZE) % 50 === 0) {
        console.log(`  Inserted ${inserted}/${opinions.length} name_opinions (concept)...`);
      }
    }
    await pgClient.query('COMMIT');
    console.log(`  Committed: ${inserted} name_opinions (concept)`);
  } catch (err) {
    await pgClient.query('ROLLBACK').catch(() => {});
    console.error('  Insert failed, transaction rolled back:', err.message);
    pgClient.release();
    process.exit(1);
  }
  pgClient.release();

  // ---- 5.4 Reset identity sequence ----
  await pg.query(`SELECT setval(pg_get_serial_sequence('name_opinions','id'), (SELECT MAX(id) FROM name_opinions))`);

  const { rows: cnt } = await pg.query(`SELECT COUNT(*)::int AS n FROM name_opinions WHERE edge_class = 'concept'`);
  console.log(`  Final count in PG: name_opinions(edge_class='concept')=${cnt[0].n}`);

  const elapsed = ((new Date() - startTime) / 1000).toFixed(1);
  console.log(`[${new Date().toISOString()}] synonymy name_opinions migration complete in ${elapsed}s`);
}

// Only run main() when invoked directly, so pure transforms can be imported for unit tests
const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((err) => {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  }).finally(() => closeAll());
}
