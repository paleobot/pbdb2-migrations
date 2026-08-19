// Pair: status = 'nomen dubium', spelling_reason = 'original spelling' (7,463 rows).
//
// validity_opinions testimony (§5.2): subject_permid = permid(child_spelling_no),
// nomenclatural_status_id = 'nomen dubium' (bars_candidacy=false, no derive() effect --
// doubt about a name's quality is not an act of invalidation). No target -- table has
// no target_permid column (§5.2, target dropped entirely). Single-output pair -- no
// assignment_opinions, no lineage (original spelling).
import { mariadb, pg, closeAll } from '../../../db.js';
import { uuidv7 } from '../../../uuidv7.js';
import { loadNamePermidMap, loadReferenceIdMap, resolvePersons } from '../../lib/identity.js';
import { resolveSecondHand, assertValidAttribution } from '../../lib/attribution.js';
import { evidenceFromBasis } from '../../lib/evidence.js';
import { createAnomalyLog } from '../../lib/anomaly-log.js';

const INSERT_BATCH_SIZE = 1000;
const LOG_SAMPLE_LIMIT = 20;

function makeSampleLogger(label) {
  let n = 0;
  return (msg) => {
    n++;
    if (n <= LOG_SAMPLE_LIMIT) console.warn(`  [${label}] ${msg}`);
    else if (n === LOG_SAMPLE_LIMIT + 1) console.warn(`  [${label}] ... (further occurrences suppressed)`);
  };
}

async function main() {
  const startTime = new Date();
  console.log(`[${startTime.toISOString()}] Starting nomen-dubium/original-spelling migration...`);

  const anomalyLog = createAnomalyLog(import.meta.url);

  const nameMap = await loadNamePermidMap(pg);
  console.log(`  Loaded ${nameMap.size} name identities (oldpbdb_taxon_no -> permid)`);
  const refMap = await loadReferenceIdMap(pg);
  console.log(`  Loaded ${refMap.size} reference ids (reference_no -> refs.id)`);

  const { rows: statusRows } = await pg.query(
    `SELECT id FROM dictionaries.nomenclatural_statuses WHERE status = 'nomen dubium'`,
  );
  if (statusRows.length !== 1) {
    console.error(`  FATAL: expected exactly one nomenclatural_statuses row for status='nomen dubium', got ${statusRows.length}`);
    process.exit(1);
  }
  const nomenDubiumStatusId = statusRows[0].id;

  let sourceRows = 0;
  const skip = { child_spelling_unresolved: 0, orphan_reference: 0 };
  const logSkip = makeSampleLogger('skip');

  const validityRows = [];

  const conn = await mariadb.getConnection();
  const stream = conn.connection.query(`
    SELECT opinion_no, child_no, child_spelling_no, parent_no, parent_spelling_no,
           basis, pubyr, ref_has_opinion, reference_no, authorizer_no, enterer_no,
           author1last, author2last, otherauthors
    FROM opinions
    WHERE status = 'nomen dubium' AND spelling_reason = 'original spelling'
    ORDER BY opinion_no ASC
  `).stream();

  try {
    for await (const src of stream) {
      sourceRows++;
      if (sourceRows % 5000 === 0) {
        console.log(`  Processed ${sourceRows} rows, ${validityRows.length} validity rows so far...`);
      }

      const child = Number(src.child_spelling_no);
      const subjectPermid = child ? nameMap.get(child) : undefined;
      if (!subjectPermid) {
        skip.child_spelling_unresolved++;
        logSkip(`opinion_no=${src.opinion_no} child_spelling_unresolved child=${src.child_spelling_no}`);
        anomalyLog.log(src.opinion_no, 'validity_opinions', 'skip', 'child_spelling_unresolved', `validity_opinions testimony skipped: child_spelling_no=${src.child_spelling_no} has no migrated permid`);
        continue;
      }

      const referenceId = src.reference_no ? refMap.get(Number(src.reference_no)) : undefined;
      if (!referenceId) {
        skip.orphan_reference++;
        logSkip(`opinion_no=${src.opinion_no} orphan_reference reference_no=${src.reference_no}`);
        anomalyLog.log(src.opinion_no, 'validity_opinions', 'skip', 'orphan_reference', `validity_opinions testimony skipped: reference_no=${src.reference_no} not found in migrated refs`);
        continue;
      }

      const firstHand = src.ref_has_opinion === 'YES';
      const evidence = evidenceFromBasis(src.basis);
      const { authorizerPersonId, entererPersonId } = resolvePersons(src);
      const { publicationYear, attribution } = resolveSecondHand(src, firstHand);
      assertValidAttribution(attribution, `opinion_no=${src.opinion_no}`);

      validityRows.push({
        permid: uuidv7(),
        authorizerPersonId,
        entererPersonId,
        subjectPermid,
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
  console.log(`  Source rows read:            ${sourceRows}`);
  console.log(`  validity_opinions to insert: ${validityRows.length}`);
  console.log(`  Skipped:                     ${totalSkipped}`);
  for (const [k, v] of Object.entries(skip)) console.log(`    ${k}: ${v}`);

  if (validityRows.length + totalSkipped !== sourceRows) {
    console.error(`  FATAL: reconciliation failed! ${validityRows.length} inserted + ${totalSkipped} skipped != ${sourceRows} source`);
    process.exit(1);
  }
  console.log(`  Reconciliation: ${validityRows.length} + ${totalSkipped} == ${sourceRows} ✓`);

  const anomalyCount = anomalyLog.flush();
  console.log(`  Wrote ${anomalyCount} anomaly rows to opinions/nomen-dubium/anomalies.csv`);

  const pgClient = await pg.connect();
  let inserted = 0;
  try {
    await pgClient.query('BEGIN');
    for (let i = 0; i < validityRows.length; i += INSERT_BATCH_SIZE) {
      const batch = validityRows.slice(i, i + INSERT_BATCH_SIZE);
      const values = [];
      const params = [];
      let p = 1;
      for (const r of batch) {
        values.push(`($${p},$${p+1},$${p+2},$${p+3},$${p+4},$${p+5},$${p+6},$${p+7},$${p+8},$${p+9})`);
        params.push(
          r.permid, r.authorizerPersonId, r.entererPersonId, r.subjectPermid, nomenDubiumStatusId,
          r.referenceId, r.publicationYear,
          r.attribution === null ? null : JSON.stringify(r.attribution), r.evidence, false,
        );
        p += 10;
      }
      await pgClient.query(
        `INSERT INTO validity_opinions
           (permid, authorizer_person_id, enterer_person_id, subject_permid, nomenclatural_status_id,
            reference_id, publication_year, attribution, evidence, removed)
         VALUES ${values.join(',')}`,
        params,
      );
      inserted += batch.length;
    }
    await pgClient.query('COMMIT');
    console.log(`  Committed: ${inserted} validity_opinions`);
  } catch (err) {
    await pgClient.query('ROLLBACK').catch(() => {});
    console.error('  Insert failed, transaction rolled back:', err.message);
    pgClient.release();
    process.exit(1);
  }
  pgClient.release();

  await pg.query(`SELECT setval(pg_get_serial_sequence('validity_opinions','id'), (SELECT MAX(id) FROM validity_opinions))`);

  const elapsed = ((new Date() - startTime) / 1000).toFixed(1);
  console.log(`[${new Date().toISOString()}] nomen-dubium/original-spelling migration complete in ${elapsed}s`);
}

const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((err) => {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  }).finally(() => closeAll());
}
