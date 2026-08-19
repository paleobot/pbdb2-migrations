// Pair: status = 'belongs to', spelling_reason = 'reassignment' (312 rows).
//
// Field mapping confirmed against the Classic UI (2026-08-19, corrected 2026-08-19):
// child_spelling_no is ALWAYS the subject wherever it appears in a lineage insert --
// this pair's earlier version had it backwards (subject=child_no); corrected here.
//   name_opinions:       subject_permid = permid(child_spelling_no), target_permid = permid(child_no)
//   assignment_opinions: subject_permid = permid(child_spelling_no), containing_permid = permid(parent_spelling_no)
// child_spelling_no is therefore a SHARED prerequisite for both outputs (it is the
// subject of both), resolved once; only the "other end" (parent_spelling_no for
// assignment, child_no for lineage) differs per output.
//
// Every row emits BOTH a name_opinions lineage row (reason 'assignment', per the §6.1
// crosswalk for spelling_reason='reassignment') and an assignment_opinions containment
// row, unconditionally (ledger model -- no ranking; see the boundary note in
// taxa-opinions-migration-mapping.md). This is the last of the six 'belongs to'
// spelling_reason variants.
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
  console.log(`[${startTime.toISOString()}] Starting belongs-to/reassignment migration...`);

  const anomalyLog = createAnomalyLog(import.meta.url);

  const nameMap = await loadNamePermidMap(pg);
  console.log(`  Loaded ${nameMap.size} name identities (oldpbdb_taxon_no -> permid)`);
  const refMap = await loadReferenceIdMap(pg);
  console.log(`  Loaded ${refMap.size} reference ids (reference_no -> refs.id)`);

  const { rows: reasonRows } = await pg.query(
    `SELECT id FROM dictionaries.namechange_reasons WHERE reason = 'assignment' AND edge_class = 'lineage'`,
  );
  if (reasonRows.length !== 1) {
    console.error(`  FATAL: expected exactly one namechange_reasons row for reason='assignment'/edge_class='lineage', got ${reasonRows.length}`);
    process.exit(1);
  }
  const assignmentReasonId = reasonRows[0].id;

  let sourceRows = 0;
  let orphanReference = 0;
  let childSpellingUnresolved = 0;
  const assignSkip = { parent_spelling_zero: 0, parent_spelling_orphan: 0, self_reference: 0 };
  const lineageSkip = { child_no_unresolved: 0, self_reference: 0 };
  const logSkip = makeSampleLogger('skip');

  const assignments = [];
  const lineageRows = [];

  const conn = await mariadb.getConnection();
  const stream = conn.connection.query(`
    SELECT opinion_no, child_no, child_spelling_no, parent_no, parent_spelling_no,
           basis, pubyr, ref_has_opinion, reference_no, authorizer_no, enterer_no,
           author1last, author2last, otherauthors
    FROM opinions
    WHERE status = 'belongs to' AND spelling_reason = 'reassignment'
    ORDER BY opinion_no ASC
  `).stream();

  try {
    for await (const src of stream) {
      sourceRows++;

      const childSpelling = Number(src.child_spelling_no);
      const parentSpelling = Number(src.parent_spelling_no);
      const childNo = Number(src.child_no);

      const referenceId = src.reference_no ? refMap.get(Number(src.reference_no)) : undefined;
      if (!referenceId) {
        orphanReference++;
        logSkip(`opinion_no=${src.opinion_no} orphan_reference reference_no=${src.reference_no}`);
        anomalyLog.log(src.opinion_no, 'assignment_opinions', 'skip', 'orphan_reference', `assignment_opinions row skipped: reference_no=${src.reference_no} not found in migrated refs`);
        anomalyLog.log(src.opinion_no, 'name_opinions', 'skip', 'orphan_reference', `lineage (reassignment) edge skipped: reference_no=${src.reference_no} not found in migrated refs`);
        continue;
      }

      // Shared prerequisite: child_spelling_no is the subject of BOTH outputs.
      const childSpellingPermid = childSpelling ? nameMap.get(childSpelling) : undefined;
      if (!childSpellingPermid) {
        childSpellingUnresolved++;
        logSkip(`opinion_no=${src.opinion_no} child_spelling_unresolved child=${src.child_spelling_no}`);
        anomalyLog.log(src.opinion_no, 'assignment_opinions', 'skip', 'child_spelling_unresolved', `assignment_opinions row skipped: child_spelling_no=${src.child_spelling_no} has no migrated permid`);
        anomalyLog.log(src.opinion_no, 'name_opinions', 'skip', 'child_spelling_unresolved', `lineage (reassignment) edge skipped: child_spelling_no=${src.child_spelling_no} has no migrated permid`);
        continue;
      }

      const firstHand = src.ref_has_opinion === 'YES';
      const evidence = evidenceFromBasis(src.basis);
      const { authorizerPersonId, entererPersonId } = resolvePersons(src);
      const { publicationYear, attribution } = resolveSecondHand(src, firstHand);
      assertValidAttribution(attribution, `opinion_no=${src.opinion_no}`);

      // ---- assignment_opinions: subject = child_spelling_no, containing = parent_spelling_no ----
      if (!parentSpelling) {
        assignSkip.parent_spelling_zero++;
        logSkip(`opinion_no=${src.opinion_no} parent_spelling_zero`);
        anomalyLog.log(src.opinion_no, 'assignment_opinions', 'skip', 'parent_spelling_zero', 'assignment_opinions row skipped: parent_spelling_no is 0');
      } else {
        const containingPermid = nameMap.get(parentSpelling);
        if (!containingPermid) {
          assignSkip.parent_spelling_orphan++;
          logSkip(`opinion_no=${src.opinion_no} parent_spelling_orphan parent=${src.parent_spelling_no}`);
          anomalyLog.log(src.opinion_no, 'assignment_opinions', 'skip', 'parent_spelling_orphan', `assignment_opinions row skipped: parent_spelling_no=${src.parent_spelling_no} has no migrated permid`);
        } else if (childSpelling === parentSpelling) {
          assignSkip.self_reference++;
          logSkip(`opinion_no=${src.opinion_no} assign_self_reference taxon=${src.child_spelling_no}`);
          anomalyLog.log(src.opinion_no, 'assignment_opinions', 'skip', 'self_reference', `assignment_opinions row skipped: child_spelling_no == parent_spelling_no (${src.child_spelling_no})${childNo === Number(src.parent_no) ? ` -- child_no == parent_no (${src.child_no}) too, a same-taxon self-reference opinion` : ''}`);
        } else {
          assignments.push({
            permid: uuidv7(),
            authorizerPersonId,
            entererPersonId,
            subjectPermid: childSpellingPermid,
            containingPermid,
            referenceId,
            publicationYear,
            attribution,
            evidence,
          });
        }
      }

      // ---- name_opinions lineage: subject = child_spelling_no, target = child_no ----
      const childNoPermid = childNo ? nameMap.get(childNo) : undefined;
      if (!childNoPermid) {
        lineageSkip.child_no_unresolved++;
        logSkip(`opinion_no=${src.opinion_no} lineage_child_no_unresolved child_no=${src.child_no}`);
        anomalyLog.log(src.opinion_no, 'name_opinions', 'skip', 'child_no_unresolved', `lineage (reassignment) edge skipped: child_no=${src.child_no} has no migrated permid`);
      } else if (childSpelling === childNo) {
        lineageSkip.self_reference++;
        logSkip(`opinion_no=${src.opinion_no} lineage_self_reference taxon=${src.child_spelling_no}`);
        anomalyLog.log(src.opinion_no, 'name_opinions', 'skip', 'self_reference', `lineage (reassignment) edge skipped: child_spelling_no == child_no (${src.child_spelling_no}) despite spelling_reason='reassignment' -- row carries no actual spelling deviation`);
      } else {
        lineageRows.push({
          permid: uuidv7(),
          authorizerPersonId,
          entererPersonId,
          subjectPermid: childSpellingPermid,
          targetPermid: childNoPermid,
          reasonId: assignmentReasonId,
          referenceId,
          publicationYear,
          attribution,
          evidence,
        });
      }
    }
  } finally {
    conn.release();
  }

  const totalAssignSkipped = orphanReference + childSpellingUnresolved + Object.values(assignSkip).reduce((a, b) => a + b, 0);
  const totalLineageSkipped = orphanReference + childSpellingUnresolved + Object.values(lineageSkip).reduce((a, b) => a + b, 0);

  console.log('');
  console.log(`  Source rows read: ${sourceRows}`);
  console.log(`  orphan_reference (shared): ${orphanReference}, child_spelling_unresolved (shared): ${childSpellingUnresolved}`);
  console.log(`  assignment_opinions to insert: ${assignments.length}, skipped: ${totalAssignSkipped}`);
  for (const [k, v] of Object.entries(assignSkip)) console.log(`    ${k}: ${v}`);
  console.log(`  name_opinions (lineage) to insert: ${lineageRows.length}, skipped: ${totalLineageSkipped}`);
  for (const [k, v] of Object.entries(lineageSkip)) console.log(`    ${k}: ${v}`);

  if (assignments.length + totalAssignSkipped !== sourceRows) {
    console.error(`  FATAL: assignment reconciliation failed! ${assignments.length} + ${totalAssignSkipped} != ${sourceRows}`);
    process.exit(1);
  }
  if (lineageRows.length + totalLineageSkipped !== sourceRows) {
    console.error(`  FATAL: lineage reconciliation failed! ${lineageRows.length} + ${totalLineageSkipped} != ${sourceRows}`);
    process.exit(1);
  }
  console.log(`  Reconciliation (assignment): ${assignments.length} + ${totalAssignSkipped} == ${sourceRows} ✓`);
  console.log(`  Reconciliation (lineage):    ${lineageRows.length} + ${totalLineageSkipped} == ${sourceRows} ✓`);

  const anomalyCount = anomalyLog.flush();
  console.log(`  Wrote ${anomalyCount} anomaly rows to opinions/belongs-to/anomalies.csv`);

  const pgClient = await pg.connect();
  let insertedAssign = 0;
  let insertedLineage = 0;
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
          r.permid, r.authorizerPersonId, r.entererPersonId, r.subjectPermid, r.containingPermid,
          false, r.referenceId, r.publicationYear,
          r.attribution === null ? null : JSON.stringify(r.attribution), r.evidence, false,
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
      insertedAssign += batch.length;
    }
    console.log(`  Inserted ${insertedAssign} assignment_opinions`);

    for (let i = 0; i < lineageRows.length; i += INSERT_BATCH_SIZE) {
      const batch = lineageRows.slice(i, i + INSERT_BATCH_SIZE);
      const values = [];
      const params = [];
      let p = 1;
      for (const r of batch) {
        values.push(`($${p},$${p+1},$${p+2},$${p+3},$${p+4},$${p+5},$${p+6},$${p+7},$${p+8},$${p+9},$${p+10},$${p+11},$${p+12},$${p+13},$${p+14},$${p+15},$${p+16})`);
        params.push(
          r.permid, r.authorizerPersonId, r.entererPersonId, null, r.subjectPermid,
          r.targetPermid, r.reasonId, 'lineage', null, null, null, null,
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

  await pg.query(`SELECT setval(pg_get_serial_sequence('assignment_opinions','id'), (SELECT MAX(id) FROM assignment_opinions))`);
  await pg.query(`SELECT setval(pg_get_serial_sequence('name_opinions','id'), (SELECT MAX(id) FROM name_opinions))`);

  const elapsed = ((new Date() - startTime) / 1000).toFixed(1);
  console.log(`[${new Date().toISOString()}] belongs-to/reassignment migration complete in ${elapsed}s`);
}

const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((err) => {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  }).finally(() => closeAll());
}
