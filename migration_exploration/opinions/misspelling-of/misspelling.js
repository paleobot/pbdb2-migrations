// Pair: status = 'misspelling of', spelling_reason = 'misspelling' (875 rows).
//
// The only spelling_reason value this status ever takes. Live-confirmed (2026-08-21):
// child_no = parent_no for all 875 rows -- but both are just same-name anchors (a
// misspelling isn't a distinct taxonomic concept), not the target. The actual target
// is parent_spelling_no -- the specific correct spelling this opinion asserts
// child_spelling_no is a misspelling of -- which differs from child_no in 104 of 875
// rows (see docs/taxa-opinions-migration-mapping.md §11):
//   name_opinions: subject_permid = permid(child_spelling_no), target_permid = permid(parent_spelling_no)
// reason = 'historical misspelling' -- the dedicated dictionary token (added
// 2026-08-19) for a formally published misspelling claim, distinct from the
// 'misspelling' token used when spelling_reason='misspelling' is noticed
// incidentally on some other status (see create_new.sql's namechange_reasons header
// and mapping doc §6.1). Single-output pair: no assignment_opinions row -- this
// status asserts a spelling relationship, not containment.
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
  console.log(`[${startTime.toISOString()}] Starting misspelling-of/misspelling migration...`);

  const anomalyLog = createAnomalyLog(import.meta.url);

  const nameMap = await loadNamePermidMap(pg);
  console.log(`  Loaded ${nameMap.size} name identities (oldpbdb_taxon_no -> permid)`);
  const refMap = await loadReferenceIdMap(pg);
  console.log(`  Loaded ${refMap.size} reference ids (reference_no -> refs.id)`);

  const { rows: reasonRows } = await pg.query(
    `SELECT id FROM dictionaries.namechange_reasons WHERE reason = 'historical misspelling' AND edge_class = 'name'`,
  );
  if (reasonRows.length !== 1) {
    console.error(`  FATAL: expected exactly one namechange_reasons row for reason='historical misspelling'/edge_class='name', got ${reasonRows.length}`);
    process.exit(1);
  }
  const historicalMisspellingReasonId = reasonRows[0].id;

  let sourceRows = 0;
  const skip = { child_spelling_unresolved: 0, parent_spelling_unresolved: 0, self_reference: 0, orphan_reference: 0 };
  const logSkip = makeSampleLogger('skip');

  const lineageRows = [];

  const conn = await mariadb.getConnection();
  const stream = conn.connection.query(`
    SELECT opinion_no, child_no, child_spelling_no, parent_no, parent_spelling_no,
           basis, pubyr, ref_has_opinion, reference_no, authorizer_no, enterer_no,
           author1last, author2last, otherauthors
    FROM opinions
    WHERE status = 'misspelling of' AND spelling_reason = 'misspelling'
    ORDER BY opinion_no ASC
  `).stream();

  try {
    for await (const src of stream) {
      sourceRows++;

      const childSpelling = Number(src.child_spelling_no);
      const parentSpelling = Number(src.parent_spelling_no);

      const subjectPermid = childSpelling ? nameMap.get(childSpelling) : undefined;
      if (!subjectPermid) {
        skip.child_spelling_unresolved++;
        logSkip(`opinion_no=${src.opinion_no} child_spelling_unresolved child=${src.child_spelling_no}`);
        anomalyLog.log(src.opinion_no, 'name_opinions', 'skip', 'child_spelling_unresolved', `lineage (historical misspelling) edge skipped: child_spelling_no=${src.child_spelling_no} has no migrated permid`);
        continue;
      }

      const targetPermid = parentSpelling ? nameMap.get(parentSpelling) : undefined;
      if (!targetPermid) {
        skip.parent_spelling_unresolved++;
        logSkip(`opinion_no=${src.opinion_no} parent_spelling_unresolved parent_spelling_no=${src.parent_spelling_no}`);
        anomalyLog.log(src.opinion_no, 'name_opinions', 'skip', 'parent_spelling_unresolved', `lineage (historical misspelling) edge skipped: parent_spelling_no=${src.parent_spelling_no} has no migrated permid`);
        continue;
      }

      if (childSpelling === parentSpelling) {
        skip.self_reference++;
        logSkip(`opinion_no=${src.opinion_no} self_reference taxon=${src.child_spelling_no}`);
        anomalyLog.log(src.opinion_no, 'name_opinions', 'skip', 'self_reference', `lineage (historical misspelling) edge skipped: child_spelling_no == parent_spelling_no (${src.child_spelling_no}) despite status='misspelling of' -- row asserts no actual spelling deviation`);
        continue;
      }

      const referenceId = src.reference_no ? refMap.get(Number(src.reference_no)) : undefined;
      if (!referenceId) {
        skip.orphan_reference++;
        logSkip(`opinion_no=${src.opinion_no} orphan_reference reference_no=${src.reference_no}`);
        anomalyLog.log(src.opinion_no, 'name_opinions', 'skip', 'orphan_reference', `lineage (historical misspelling) edge skipped: reference_no=${src.reference_no} not found in migrated refs`);
        continue;
      }

      const firstHand = src.ref_has_opinion === 'YES';
      const evidence = evidenceFromBasis(src.basis);
      const { authorizerPersonId, entererPersonId } = resolvePersons(src);
      const { publicationYear, attribution } = resolveSecondHand(src, firstHand);
      assertValidAttribution(attribution, `opinion_no=${src.opinion_no}`);

      lineageRows.push({
        permid: uuidv7(),
        authorizerPersonId,
        entererPersonId,
        subjectPermid,
        targetPermid,
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
  console.log(`  Source rows read:          ${sourceRows}`);
  console.log(`  name_opinions to insert:   ${lineageRows.length}`);
  console.log(`  Skipped:                   ${totalSkipped}`);
  for (const [k, v] of Object.entries(skip)) console.log(`    ${k}: ${v}`);

  if (lineageRows.length + totalSkipped !== sourceRows) {
    console.error(`  FATAL: reconciliation failed! ${lineageRows.length} inserted + ${totalSkipped} skipped != ${sourceRows} source`);
    process.exit(1);
  }
  console.log(`  Reconciliation: ${lineageRows.length} + ${totalSkipped} == ${sourceRows} ✓`);

  const anomalyCount = anomalyLog.flush();
  console.log(`  Wrote ${anomalyCount} anomaly rows to opinions/misspelling-of/anomalies.csv`);

  const pgClient = await pg.connect();
  let inserted = 0;
  try {
    await pgClient.query('BEGIN');
    for (let i = 0; i < lineageRows.length; i += INSERT_BATCH_SIZE) {
      const batch = lineageRows.slice(i, i + INSERT_BATCH_SIZE);
      const values = [];
      const params = [];
      let p = 1;
      for (const r of batch) {
        values.push(`($${p},$${p+1},$${p+2},$${p+3},$${p+4},$${p+5},$${p+6},$${p+7},$${p+8},$${p+9},$${p+10},$${p+11},$${p+12},$${p+13},$${p+14},$${p+15},$${p+16})`);
        params.push(
          r.permid, r.authorizerPersonId, r.entererPersonId, null, r.subjectPermid,
          r.targetPermid, historicalMisspellingReasonId, 'name', null, null, null, null,
          r.referenceId, r.publicationYear,
          r.attribution === null ? null : JSON.stringify(r.attribution), r.evidence, false,
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
    }
    await pgClient.query('COMMIT');
    console.log(`  Committed: ${inserted} name_opinions (historical misspelling)`);
  } catch (err) {
    await pgClient.query('ROLLBACK').catch(() => {});
    console.error('  Insert failed, transaction rolled back:', err.message);
    pgClient.release();
    process.exit(1);
  }
  pgClient.release();

  await pg.query(`SELECT setval(pg_get_serial_sequence('name_opinions','id'), (SELECT MAX(id) FROM name_opinions))`);

  const elapsed = ((new Date() - startTime) / 1000).toFixed(1);
  console.log(`[${new Date().toISOString()}] misspelling-of/misspelling migration complete in ${elapsed}s`);
}

const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((err) => {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  }).finally(() => closeAll());
}
