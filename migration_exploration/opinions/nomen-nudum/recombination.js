// Pair: status = 'nomen nudum', spelling_reason = 'recombination' (91 rows).
//
// Per Q3's resolution: dual emission -- validity_opinions testimony (subject=
// child_spelling_no, status='nomen nudum', bars_candidacy=true, no target) +
// name_opinions lineage edge (subject=child_spelling_no, target=child_no,
// reason='recombination').
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
  console.log(`[${startTime.toISOString()}] Starting nomen-nudum/recombination migration...`);

  const anomalyLog = createAnomalyLog(import.meta.url);

  const nameMap = await loadNamePermidMap(pg);
  console.log(`  Loaded ${nameMap.size} name identities (oldpbdb_taxon_no -> permid)`);
  const refMap = await loadReferenceIdMap(pg);
  console.log(`  Loaded ${refMap.size} reference ids (reference_no -> refs.id)`);

  const { rows: statusRows } = await pg.query(
    `SELECT id FROM dictionaries.nomenclatural_statuses WHERE status = 'nomen nudum'`,
  );
  if (statusRows.length !== 1) {
    console.error(`  FATAL: expected exactly one nomenclatural_statuses row for status='nomen nudum', got ${statusRows.length}`);
    process.exit(1);
  }
  const nomenNudumStatusId = statusRows[0].id;

  const { rows: lineageReasonRows } = await pg.query(
    `SELECT id FROM dictionaries.namechange_reasons WHERE reason = 'recombination' AND edge_class = 'lineage'`,
  );
  if (lineageReasonRows.length !== 1) {
    console.error(`  FATAL: expected exactly one namechange_reasons row for reason='recombination'/edge_class='lineage', got ${lineageReasonRows.length}`);
    process.exit(1);
  }
  const recombinationReasonId = lineageReasonRows[0].id;

  let sourceRows = 0;
  let orphanReference = 0;
  let childSpellingUnresolved = 0;
  const lineageSkip = { child_no_unresolved: 0, self_reference: 0 };
  const logSkip = makeSampleLogger('skip');

  const validityRows = [];
  const lineageRows = [];

  const conn = await mariadb.getConnection();
  const stream = conn.connection.query(`
    SELECT opinion_no, child_no, child_spelling_no, parent_no, parent_spelling_no,
           basis, pubyr, ref_has_opinion, reference_no, authorizer_no, enterer_no,
           author1last, author2last, otherauthors
    FROM opinions
    WHERE status = 'nomen nudum' AND spelling_reason = 'recombination'
    ORDER BY opinion_no ASC
  `).stream();

  try {
    for await (const src of stream) {
      sourceRows++;

      const childSpelling = Number(src.child_spelling_no);
      const childNo = Number(src.child_no);

      const referenceId = src.reference_no ? refMap.get(Number(src.reference_no)) : undefined;
      if (!referenceId) {
        orphanReference++;
        logSkip(`opinion_no=${src.opinion_no} orphan_reference reference_no=${src.reference_no}`);
        anomalyLog.log(src.opinion_no, 'validity_opinions', 'skip', 'orphan_reference', `validity_opinions testimony skipped: reference_no=${src.reference_no} not found in migrated refs`);
        anomalyLog.log(src.opinion_no, 'name_opinions', 'skip', 'orphan_reference', `lineage (recombination) edge skipped: reference_no=${src.reference_no} not found in migrated refs`);
        continue;
      }

      const childSpellingPermid = childSpelling ? nameMap.get(childSpelling) : undefined;
      if (!childSpellingPermid) {
        childSpellingUnresolved++;
        logSkip(`opinion_no=${src.opinion_no} child_spelling_unresolved child=${src.child_spelling_no}`);
        anomalyLog.log(src.opinion_no, 'validity_opinions', 'skip', 'child_spelling_unresolved', `validity_opinions testimony skipped: child_spelling_no=${src.child_spelling_no} has no migrated permid`);
        anomalyLog.log(src.opinion_no, 'name_opinions', 'skip', 'child_spelling_unresolved', `lineage (recombination) edge skipped: child_spelling_no=${src.child_spelling_no} has no migrated permid`);
        continue;
      }

      const firstHand = src.ref_has_opinion === 'YES';
      const evidence = evidenceFromBasis(src.basis);
      const { authorizerPersonId, entererPersonId } = resolvePersons(src);
      const { publicationYear, attribution } = resolveSecondHand(src, firstHand);
      assertValidAttribution(attribution, `opinion_no=${src.opinion_no}`);

      validityRows.push({
        permid: uuidv7(), authorizerPersonId, entererPersonId,
        subjectPermid: childSpellingPermid,
        referenceId, publicationYear, attribution, evidence,
      });

      const childNoPermid = childNo ? nameMap.get(childNo) : undefined;
      if (!childNoPermid) {
        lineageSkip.child_no_unresolved++;
        logSkip(`opinion_no=${src.opinion_no} lineage_child_no_unresolved child_no=${src.child_no}`);
        anomalyLog.log(src.opinion_no, 'name_opinions', 'skip', 'child_no_unresolved', `lineage (recombination) edge skipped: child_no=${src.child_no} has no migrated permid`);
      } else if (childSpelling === childNo) {
        lineageSkip.self_reference++;
        logSkip(`opinion_no=${src.opinion_no} lineage_self_reference taxon=${src.child_spelling_no}`);
        anomalyLog.log(src.opinion_no, 'name_opinions', 'skip', 'self_reference', `lineage (recombination) edge skipped: child_spelling_no == child_no (${src.child_spelling_no}) despite spelling_reason='recombination' -- row carries no actual spelling deviation`);
      } else {
        lineageRows.push({
          permid: uuidv7(), authorizerPersonId, entererPersonId,
          subjectPermid: childSpellingPermid, targetPermid: childNoPermid,
          referenceId, publicationYear, attribution, evidence,
        });
      }
    }
  } finally {
    conn.release();
  }

  const totalValiditySkipped = orphanReference + childSpellingUnresolved;
  const totalLineageSkipped = orphanReference + childSpellingUnresolved + Object.values(lineageSkip).reduce((a, b) => a + b, 0);

  console.log('');
  console.log(`  Source rows read: ${sourceRows}`);
  console.log(`  validity_opinions to insert: ${validityRows.length}, skipped: ${totalValiditySkipped}`);
  console.log(`  lineage edges to insert: ${lineageRows.length}, skipped: ${totalLineageSkipped}`);

  if (validityRows.length + totalValiditySkipped !== sourceRows) {
    console.error(`  FATAL: validity reconciliation failed! ${validityRows.length} + ${totalValiditySkipped} != ${sourceRows}`);
    process.exit(1);
  }
  if (lineageRows.length + totalLineageSkipped !== sourceRows) {
    console.error(`  FATAL: lineage reconciliation failed! ${lineageRows.length} + ${totalLineageSkipped} != ${sourceRows}`);
    process.exit(1);
  }
  console.log(`  Reconciliation (validity): ${validityRows.length} + ${totalValiditySkipped} == ${sourceRows} ✓`);
  console.log(`  Reconciliation (lineage):  ${lineageRows.length} + ${totalLineageSkipped} == ${sourceRows} ✓`);

  const anomalyCount = anomalyLog.flush();
  console.log(`  Wrote ${anomalyCount} anomaly rows to opinions/nomen-nudum/anomalies.csv`);

  const pgClient = await pg.connect();
  let insertedValidity = 0;
  let insertedLineage = 0;
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
          r.permid, r.authorizerPersonId, r.entererPersonId, r.subjectPermid, nomenNudumStatusId,
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
      insertedValidity += batch.length;
    }
    console.log(`  Inserted ${insertedValidity} validity_opinions`);

    for (let i = 0; i < lineageRows.length; i += INSERT_BATCH_SIZE) {
      const batch = lineageRows.slice(i, i + INSERT_BATCH_SIZE);
      const values = [];
      const params = [];
      let p = 1;
      for (const r of batch) {
        values.push(`($${p},$${p+1},$${p+2},$${p+3},$${p+4},$${p+5},$${p+6},$${p+7},$${p+8},$${p+9},$${p+10},$${p+11},$${p+12},$${p+13},$${p+14},$${p+15},$${p+16})`);
        params.push(
          r.permid, r.authorizerPersonId, r.entererPersonId, null, r.subjectPermid,
          r.targetPermid, recombinationReasonId, 'lineage', null, null, null, null,
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
      insertedLineage += batch.length;
    }
    console.log(`  Inserted ${insertedLineage} name_opinions (lineage)`);

    await pgClient.query('COMMIT');
    console.log('  Committed.');
  } catch (err) {
    await pgClient.query('ROLLBACK').catch(() => {});
    console.error('  Insert failed, transaction rolled back:', err.message);
    pgClient.release();
    process.exit(1);
  }
  pgClient.release();

  await pg.query(`SELECT setval(pg_get_serial_sequence('validity_opinions','id'), (SELECT MAX(id) FROM validity_opinions))`);
  await pg.query(`SELECT setval(pg_get_serial_sequence('name_opinions','id'), (SELECT MAX(id) FROM name_opinions))`);

  const elapsed = ((new Date() - startTime) / 1000).toFixed(1);
  console.log(`[${new Date().toISOString()}] nomen-nudum/recombination migration complete in ${elapsed}s`);
}

const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((err) => {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  }).finally(() => closeAll());
}
