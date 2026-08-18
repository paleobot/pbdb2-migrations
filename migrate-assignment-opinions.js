import { mariadb, pg, closeAll } from './db.js';
import { uuidv7 } from './uuidv7.js';
import { writeFileSync } from 'node:fs';
import Ajv from 'ajv/dist/2019.js';
import { opinionAttributionSchema } from './payloadSchemas/opinionAttribution.schema.js';
import { buildCitationFromFields, buildDescriptorsFromFields } from './migrate-authorities.js';

const INSERT_BATCH_SIZE = 1000;
const LOG_SAMPLE_LIMIT = 20;
const UNKNOWN_AUTH_CSV = 'unknown-authority-assignment-opinions.csv';

const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(opinionAttributionSchema);

// ---------- Pure transforms ----------

// opinions.pubyr is an optional string; empty/blank/'0' → null. publication_year
// is an integer column and, per the second-hand rule, is populated only for
// second-hand opinions (ref_has_opinion IS NULL).
export function parseYear(year) {
  if (year === null || year === undefined || String(year).trim() === '' || year === '0') return null;
  const n = parseInt(year, 10);
  return Number.isNaN(n) || n === 0 ? null : n;
}

// Second-hand attribution (inner object) for opinionAttribution.schema.js:
// { citation, descriptors, publishedInReference }. Authors only, no year.
// Rows with no discernible authorship (blank author1last) use the established
// "authority unknown" sentinel (authorities scenario ④ convention).
export function buildOpinionAttribution(src) {
  const hasAuthor = (src.author1last || '').trim() !== '';
  if (!hasAuthor) {
    return { citation: 'authority unknown', descriptors: [], publishedInReference: false };
  }
  return {
    citation: buildCitationFromFields(src),
    descriptors: buildDescriptorsFromFields(src),
    publishedInReference: false,
  };
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
  console.log(`[${startTime.toISOString()}] Starting assignment_opinions migration...`);

  // ---- 1.2 Preload name-identity Map (oldpbdb_taxon_no → permid) ----
  // Safe to take permid: oldpbdb_taxon_no is carried only by root/original
  // name_opinions rows, where permid ≡ subject_permid (see the mapping doc's
  // "Original-only resolution assumption").
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

  // Counters
  let sourceRows = 0;
  const skip = { child_spelling_unresolved: 0, parent_spelling_zero: 0, parent_spelling_orphan: 0, self_reference: 0, orphan_reference: 0 };
  const logSkip = makeSampleLogger('skip');

  const assignments = [];       // one per retained (insertable) source row
  const unknownAuthRecords = [];// unknown-authorship rows for the review CSV

  // ---- 2.1 Stream the in-scope subset from MariaDB ----
  const conn = await mariadb.getConnection();
  const stream = conn.connection.query(`
    SELECT opinion_no, child_no, child_spelling_no, parent_no, parent_spelling_no,
           basis, pubyr, ref_has_opinion, reference_no, authorizer_no, enterer_no,
           author1last, author2last, otherauthors
    FROM opinions
    WHERE status = 'belongs to' AND spelling_reason = 'original spelling'
    ORDER BY opinion_no ASC
  `).stream();

  try {
    for await (const src of stream) {
      sourceRows++;
      if (sourceRows % 100000 === 0) {
        console.log(`  Processed ${sourceRows} in-scope rows, ${assignments.length} retained so far...`);
      }

      const firstHand = src.ref_has_opinion === 'YES';

      // Collect unknown-authorship records (second-hand, no author) for review,
      // independent of the skip decision below.
      if (!firstHand && (src.author1last || '').trim() === '') {
        unknownAuthRecords.push(src);
      }

      // ---- 3.1–3.4 Resolve edges and reference; skip-and-log on failure ----
      const child = Number(src.child_spelling_no);
      const parent = Number(src.parent_spelling_no);

      const subjectPermid = child ? nameMap.get(child) : undefined;
      if (!subjectPermid) { skip.child_spelling_unresolved++; logSkip(`opinion_no=${src.opinion_no} child_spelling_unresolved child=${src.child_spelling_no}`); continue; }

      if (!parent) { skip.parent_spelling_zero++; logSkip(`opinion_no=${src.opinion_no} parent_spelling_zero`); continue; }
      const containingPermid = nameMap.get(parent);
      if (!containingPermid) { skip.parent_spelling_orphan++; logSkip(`opinion_no=${src.opinion_no} parent_spelling_orphan parent=${src.parent_spelling_no}`); continue; }

      if (child === parent) { skip.self_reference++; logSkip(`opinion_no=${src.opinion_no} self_reference taxon=${src.child_spelling_no}`); continue; }

      const referenceId = src.reference_no ? refMap.get(Number(src.reference_no)) : undefined;
      if (!referenceId) { skip.orphan_reference++; logSkip(`opinion_no=${src.opinion_no} orphan_reference reference_no=${src.reference_no}`); continue; }

      // ---- 3.5 evidence / questioned / removed ----
      const evidence = src.basis === 'stated with evidence';

      // ---- 3.6 Persons with 0-sentinel fallback (never fires in scope) ----
      let authNo = src.authorizer_no || 0;
      let entNo = src.enterer_no || 0;
      if (authNo === 0 && entNo !== 0) authNo = entNo;
      else if (entNo === 0 && authNo !== 0) entNo = authNo;
      else if (authNo === 0 && entNo === 0) { authNo = 1; entNo = 1; }

      // ---- 3.7 Second-hand rule for publication_year + attribution ----
      let publicationYear = null;
      let attribution = null;
      if (!firstHand) {
        publicationYear = parseYear(src.pubyr);
        attribution = buildOpinionAttribution(src);
        // ---- 4.1 Validate attribution before any DB write ----
        if (!validate({ attribution })) {
          console.error(`\n  VALIDATION FAILED for opinion_no=${src.opinion_no}`);
          console.error('  errors:', JSON.stringify(validate.errors, null, 2));
          console.error('  attribution:', JSON.stringify(attribution, null, 2));
          conn.release();
          process.exit(1);
        }
      }

      // ---- 3.8 Accumulate the assignment_opinion ----
      assignments.push({
        permid: uuidv7(),
        authorizerPersonId: authNo,
        entererPersonId: entNo,
        subjectPermid,
        containingPermid,
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
  console.log(`  In-scope rows read:          ${sourceRows}`);
  console.log(`  assignment_opinions to insert: ${assignments.length}`);
  console.log(`  Skipped:                     ${totalSkipped}`);
  console.log(`    parent_spelling_zero:      ${skip.parent_spelling_zero}`);
  console.log(`    parent_spelling_orphan:    ${skip.parent_spelling_orphan}`);
  console.log(`    orphan_reference:          ${skip.orphan_reference}`);
  console.log(`    child_spelling_unresolved: ${skip.child_spelling_unresolved}`);
  console.log(`    self_reference:            ${skip.self_reference}`);

  // ---- 3.7b Write the unknown-authorship review CSV ----
  const csvCols = ['opinion_no', 'child_no', 'child_spelling_no', 'parent_no', 'parent_spelling_no',
    'ref_has_opinion', 'reference_no', 'author1last', 'author2last', 'otherauthors', 'pubyr', 'basis'];
  writeFileSync(UNKNOWN_AUTH_CSV, toCsv(csvCols, unknownAuthRecords));
  console.log(`  Wrote ${unknownAuthRecords.length} unknown-authorship records to ${UNKNOWN_AUTH_CSV}`);

  // ---- 5.1 Reconciliation invariant ----
  if (assignments.length + totalSkipped !== sourceRows) {
    console.error(`  FATAL: reconciliation failed! ${assignments.length} inserted + ${totalSkipped} skipped != ${sourceRows} in-scope`);
    process.exit(1);
  }
  console.log(`  Reconciliation: ${assignments.length} + ${totalSkipped} == ${sourceRows} ✓`);

  // ---- 4.2 Transaction-wrapped bulk insert (11 columns) ----
  const pgClient = await pg.connect();
  let inserted = 0;
  try {
    await pgClient.query('BEGIN');
    for (let i = 0; i < assignments.length; i += INSERT_BATCH_SIZE) {
      const batch = assignments.slice(i, i + INSERT_BATCH_SIZE);
      const values = [];
      const params = [];
      let p = 1;
      for (const r of batch) {
        values.push(`($${p},$${p+1},$${p+2},$${p+3},$${p+4},$${p+5},$${p+6},$${p+7},$${p+8},$${p+9},$${p+10})`);
        params.push(
          r.permid,                                                  // permid
          r.authorizerPersonId,                                      // authorizer_person_id
          r.entererPersonId,                                         // enterer_person_id
          r.subjectPermid,                                           // subject_permid
          r.containingPermid,                                        // containing_permid
          false,                                                     // questioned (no classic source)
          r.referenceId,                                             // reference_id
          r.publicationYear,                                         // publication_year
          r.attribution === null ? null : JSON.stringify(r.attribution), // attribution
          r.evidence,                                                // evidence
          false,                                                     // removed
        );
        p += 11;
      }
      await pgClient.query(
        `INSERT INTO assignment_opinions
           (permid, authorizer_person_id, enterer_person_id, subject_permid, containing_permid,
            questioned, reference_id, publication_year, attribution, evidence, removed)
         VALUES ${values.join(',')}`,
        params,
      );
      inserted += batch.length;
      if ((i / INSERT_BATCH_SIZE) % 50 === 0) {
        console.log(`  Inserted ${inserted}/${assignments.length} assignment_opinions...`);
      }
    }
    await pgClient.query('COMMIT');
    console.log(`  Committed: ${inserted} assignment_opinions`);
  } catch (err) {
    await pgClient.query('ROLLBACK').catch(() => {});
    console.error('  Insert failed, transaction rolled back:', err.message);
    pgClient.release();
    process.exit(1);
  }
  pgClient.release();

  // ---- 5.3 Reset identity sequence ----
  await pg.query(`SELECT setval(pg_get_serial_sequence('assignment_opinions','id'), (SELECT MAX(id) FROM assignment_opinions))`);

  const { rows: cnt } = await pg.query('SELECT COUNT(*)::int AS n FROM assignment_opinions');
  console.log(`  Final count in PG: assignment_opinions=${cnt[0].n}`);

  const elapsed = ((new Date() - startTime) / 1000).toFixed(1);
  console.log(`[${new Date().toISOString()}] assignment_opinions migration complete in ${elapsed}s`);
}

// Only run main() when invoked directly, so pure transforms can be imported for unit tests
const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((err) => {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  }).finally(() => closeAll());
}
