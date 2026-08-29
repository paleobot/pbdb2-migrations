// Pair: status = 'subjective synonym of', spelling_reason = 'original spelling' (47,687 rows).
//
// Field mapping confirmed against the Classic UI (2026-08-19), matches the pre-existing
// migrate-synonymy-opinions.js convention:
//   name_opinions: subject_permid = permid(child_spelling_no) [junior], target_permid = permid(parent_spelling_no) [senior]
//
// Primary disposition: one name_opinions CONCEPT-class edge per row (reason
// 'junior synonym', objective=false), no assignment_opinions row -- synonymy is not
// a spelling change or a containment assertion (§5/§9.2). Concept edges carry no
// identity (new_name/rank_id/authority_id all NULL, oldpbdb_taxon_no NULL).
//
// Mistagged-label backfill (2026-08-19, same §3 pattern as belongs-to/original-
// spelling's worklist and replaced-by/original-spelling's hardcoded fix): 2 rows are
// labeled 'original spelling' but child_spelling_no != child_no. Resolved
// independently of the concept edge's own outcome (the ledger model -- a row's
// emissions are resolved and skipped independently; a failure in one does not block
// the other), gated only on the true shared prerequisites (child_spelling_no and
// reference resolving):
//   - opinion_no 71324: child_no=138950 ("Dromomeryx (Subdromomeryx)", subgenus) vs
//     child_spelling_no=51866 ("Subdromomeryx", genus) -- a rank-change claim ->
//     'reranked' token.
//   - opinion_no 912640: child_no=53737 vs child_spelling_no=54919, both "Ericales"
//     order -- a duplicate-or-homonym claim -> generic 'assignment' token. This row's
//     concept edge is separately skipped (child_no == parent_no, a same-taxon self-
//     reference), but the lineage backfill still fires since it depends only on
//     child_spelling_no != child_no, not on the concept edge's own resolution.
import { mariadb, pg, closeAll } from '../../../db.js';
import { uuidv7 } from '../../../uuidv7.js';
import { loadNamePermidMap, loadReferenceIdMap, resolvePersons } from '../../lib/identity.js';
import { resolveSecondHand, assertValidAttribution } from '../../lib/attribution.js';
import { evidenceFromBasis } from '../../lib/evidence.js';
import { createAnomalyLog } from '../../lib/anomaly-log.js';

const MISTAGGED_LINEAGE_REASON = new Map([
  [71324, 'reranked'],
  [912640, 'assignment'],
]);

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
  console.log(`[${startTime.toISOString()}] Starting subjective-synonym-of/original-spelling migration...`);

  const anomalyLog = createAnomalyLog(import.meta.url);

  const nameMap = await loadNamePermidMap(pg);
  console.log(`  Loaded ${nameMap.size} name identities (oldpbdb_taxon_no -> permid)`);
  const refMap = await loadReferenceIdMap(pg);
  console.log(`  Loaded ${refMap.size} reference ids (reference_no -> refs.id)`);

  const { rows: reasonRows } = await pg.query(
    `SELECT id FROM dictionaries.namechange_reasons WHERE reason = 'junior synonym' AND edge_class = 'concept'`,
  );
  if (reasonRows.length !== 1) {
    console.error(`  FATAL: expected exactly one namechange_reasons row for reason='junior synonym'/edge_class='concept', got ${reasonRows.length}`);
    process.exit(1);
  }
  const juniorSynonymReasonId = reasonRows[0].id;

  const { rows: lineageReasonRows } = await pg.query(
    `SELECT reason, id FROM dictionaries.namechange_reasons WHERE edge_class = 'lineage'`,
  );
  const lineageReasonId = new Map(lineageReasonRows.map((r) => [r.reason, r.id]));
  for (const token of new Set(MISTAGGED_LINEAGE_REASON.values())) {
    if (!lineageReasonId.has(token)) {
      console.error(`  FATAL: no lineage namechange_reasons row for reason='${token}'`);
      process.exit(1);
    }
  }

  let sourceRows = 0;
  const skip = { child_spelling_unresolved: 0, parent_spelling_zero: 0, parent_spelling_orphan: 0, self_reference: 0, orphan_reference: 0 };
  const logSkip = makeSampleLogger('skip');
  let lineageEmitted = 0;
  let lineageUnresolved = 0;

  const concepts = [];
  const lineageRows = [];

  const conn = await mariadb.getConnection();
  const stream = conn.connection.query(`
    SELECT opinion_no, child_no, child_spelling_no, parent_no, parent_spelling_no,
           basis, pubyr, ref_has_opinion, reference_no, authorizer_no, enterer_no,
           author1last, author2last, otherauthors
    FROM opinions
    WHERE status = 'subjective synonym of' AND spelling_reason = 'original spelling'
    ORDER BY opinion_no ASC
  `).stream();

  try {
    for await (const src of stream) {
      sourceRows++;
      if (sourceRows % 10000 === 0) {
        console.log(`  Processed ${sourceRows} rows, ${concepts.length} concept edges so far...`);
      }

      const child = Number(src.child_spelling_no);
      const parent = Number(src.parent_spelling_no);
      const childNo = Number(src.child_no);

      // Shared prerequisites for BOTH the concept edge and the mistagged-label
      // backfill: child_spelling_no is the subject of both, and both need a reference.
      const subjectPermid = child ? nameMap.get(child) : undefined;
      if (!subjectPermid) {
        skip.child_spelling_unresolved++;
        logSkip(`opinion_no=${src.opinion_no} child_spelling_unresolved child=${src.child_spelling_no}`);
        anomalyLog.log(src.opinion_no, 'name_opinions', 'skip', 'child_spelling_unresolved', `concept (junior synonym) edge skipped: child_spelling_no=${src.child_spelling_no} has no migrated permid`);
        anomalyLog.log(src.opinion_no, 'name_opinions', 'skip', 'child_spelling_unresolved', `lineage backfill skipped: child_spelling_no=${src.child_spelling_no} has no migrated permid`);
        continue;
      }

      const referenceId = src.reference_no ? refMap.get(Number(src.reference_no)) : undefined;
      if (!referenceId) {
        skip.orphan_reference++;
        logSkip(`opinion_no=${src.opinion_no} orphan_reference reference_no=${src.reference_no}`);
        anomalyLog.log(src.opinion_no, 'name_opinions', 'skip', 'orphan_reference', `concept (junior synonym) edge skipped: reference_no=${src.reference_no} not found in migrated refs`);
        anomalyLog.log(src.opinion_no, 'name_opinions', 'skip', 'orphan_reference', `lineage backfill skipped: reference_no=${src.reference_no} not found in migrated refs`);
        continue;
      }

      const firstHand = src.ref_has_opinion === 'YES';
      const evidence = evidenceFromBasis(src.basis);
      const { authorizerPersonId, entererPersonId } = resolvePersons(src);
      const { publicationYear, attribution } = resolveSecondHand(src, firstHand);
      assertValidAttribution(attribution, `opinion_no=${src.opinion_no}`);

      // ---- concept edge: subject = child_spelling_no, target = parent_spelling_no ----
      if (!parent) {
        skip.parent_spelling_zero++;
        logSkip(`opinion_no=${src.opinion_no} parent_spelling_zero`);
        anomalyLog.log(src.opinion_no, 'name_opinions', 'skip', 'parent_spelling_zero', 'concept (junior synonym) edge skipped: parent_spelling_no is 0');
      } else {
        const targetPermid = nameMap.get(parent);
        if (!targetPermid) {
          skip.parent_spelling_orphan++;
          logSkip(`opinion_no=${src.opinion_no} parent_spelling_orphan parent=${src.parent_spelling_no}`);
          anomalyLog.log(src.opinion_no, 'name_opinions', 'skip', 'parent_spelling_orphan', `concept (junior synonym) edge skipped: parent_spelling_no=${src.parent_spelling_no} has no migrated permid`);
        } else if (child === parent) {
          skip.self_reference++;
          logSkip(`opinion_no=${src.opinion_no} self_reference taxon=${src.child_spelling_no}`);
          anomalyLog.log(src.opinion_no, 'name_opinions', 'skip', 'self_reference', `concept (junior synonym) edge skipped: child_spelling_no == parent_spelling_no (${src.child_spelling_no})${childNo === Number(src.parent_no) ? ` -- child_no == parent_no (${src.child_no}) too, a same-taxon self-reference opinion` : ''}`);
        } else {
          concepts.push({
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
      }

      // ---- mistagged-label backfill (independent of the concept edge's outcome) ----
      if (child !== childNo) {
        const inferredReason = MISTAGGED_LINEAGE_REASON.get(Number(src.opinion_no));
        const lineageTargetPermid = inferredReason ? nameMap.get(childNo) : undefined;
        if (!inferredReason || !lineageTargetPermid) {
          lineageUnresolved++;
          logSkip(`opinion_no=${src.opinion_no} lineage_unresolved child_no=${src.child_no} inferredReason=${inferredReason ?? 'none'}`);
          anomalyLog.log(src.opinion_no, 'name_opinions', 'skip', 'mislabeled_original_spelling', `child_spelling_no (${src.child_spelling_no}) != child_no (${src.child_no}) despite spelling_reason='original spelling', but no backfill entry/permid resolved -- lineage claim NOT migrated`);
        } else {
          lineageEmitted++;
          lineageRows.push({
            permid: uuidv7(),
            authorizerPersonId,
            entererPersonId,
            subjectPermid,
            targetPermid: lineageTargetPermid,
            reasonId: lineageReasonId.get(inferredReason),
            referenceId,
            publicationYear,
            attribution,
            evidence,
          });
          anomalyLog.log(src.opinion_no, 'name_opinions', 'warning', 'mislabeled_original_spelling', `child_spelling_no (${src.child_spelling_no}) != child_no (${src.child_no}) despite spelling_reason='original spelling' -- backfill emitted as lineage edge, reason='${inferredReason}'`);
        }
      }
    }
  } finally {
    conn.release();
  }

  const totalSkipped = Object.values(skip).reduce((a, b) => a + b, 0);
  console.log('');
  console.log(`  Source rows read:          ${sourceRows}`);
  console.log(`  name_opinions to insert:   ${concepts.length}`);
  console.log(`  Skipped:                   ${totalSkipped}`);
  for (const [k, v] of Object.entries(skip)) console.log(`    ${k}: ${v}`);

  if (concepts.length + totalSkipped !== sourceRows) {
    console.error(`  FATAL: reconciliation failed! ${concepts.length} inserted + ${totalSkipped} skipped != ${sourceRows} source`);
    process.exit(1);
  }
  console.log(`  Reconciliation: ${concepts.length} + ${totalSkipped} == ${sourceRows} ✓`);
  console.log(`  name_opinions (mistagged-label lineage backfill) to insert: ${lineageEmitted}`);
  console.log(`  Backfill lineage claims unresolved (expected 0): ${lineageUnresolved}`);

  const anomalyCount = anomalyLog.flush();
  console.log(`  Wrote ${anomalyCount} anomaly rows to opinions/subjective-synonym-of/anomalies.csv`);

  const pgClient = await pg.connect();
  let inserted = 0;
  let insertedLineage = 0;
  try {
    await pgClient.query('BEGIN');
    for (let i = 0; i < concepts.length; i += INSERT_BATCH_SIZE) {
      const batch = concepts.slice(i, i + INSERT_BATCH_SIZE);
      const values = [];
      const params = [];
      let p = 1;
      for (const r of batch) {
        values.push(`($${p},$${p+1},$${p+2},$${p+3},$${p+4},$${p+5},$${p+6},$${p+7},$${p+8},$${p+9},$${p+10},$${p+11},$${p+12},$${p+13},$${p+14},$${p+15},$${p+16})`);
        params.push(
          r.permid, r.authorizerPersonId, r.entererPersonId, null, r.subjectPermid,
          r.targetPermid, juniorSynonymReasonId, 'concept', false, null, null, null,
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

    await pgClient.query('COMMIT');
    console.log(`  Committed: ${inserted} name_opinions (concept), ${insertedLineage} name_opinions (lineage backfill)`);
  } catch (err) {
    await pgClient.query('ROLLBACK').catch(() => {});
    console.error('  Insert failed, transaction rolled back:', err.message);
    pgClient.release();
    process.exit(1);
  }
  pgClient.release();

  await pg.query(`SELECT setval(pg_get_serial_sequence('name_opinions','id'), (SELECT MAX(id) FROM name_opinions))`);

  const elapsed = ((new Date() - startTime) / 1000).toFixed(1);
  console.log(`[${new Date().toISOString()}] subjective-synonym-of/original-spelling migration complete in ${elapsed}s`);
}

const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((err) => {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  }).finally(() => closeAll());
}
