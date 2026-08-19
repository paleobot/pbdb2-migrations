// Pair: status = 'nomen oblitum', spelling_reason = 'original spelling' (66 rows).
//
// Resolves DESIGN.md Q4: this pair internally branches PER ROW on parent_no (not on
// spelling_reason, and not split into separate files/folders) -- the targeted/
// untargeted distinction is a data-level fact orthogonal to the pair-based split (§5.2):
//   targeted (parent_no != 0):   name_opinions CONCEPT fold, subject=child_spelling_no,
//                                 target=parent_spelling_no, reason='nomen oblitum'
//                                 (Classic's getSeniorSynonym folds this into the same
//                                 senior-synonym chase as ordinary synonymy).
//   untargeted (parent_no = 0):  validity_opinions testimony, subject=child_spelling_no,
//                                 status='nomen oblitum', no target, no derive() effect.
// Single-output pair (whichever branch fires) -- no lineage (original spelling).
import { mariadb, pg, closeAll } from '../../../db.js';
import { uuidv7 } from '../../../uuidv7.js';
import { loadNamePermidMap, loadReferenceIdMap, resolvePersons } from '../../lib/identity.js';
import { resolveSecondHand, assertValidAttribution } from '../../lib/attribution.js';
import { evidenceFromBasis } from '../../lib/evidence.js';

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
  console.log(`[${startTime.toISOString()}] Starting nomen-oblitum/original-spelling migration...`);

  const nameMap = await loadNamePermidMap(pg);
  console.log(`  Loaded ${nameMap.size} name identities (oldpbdb_taxon_no -> permid)`);
  const refMap = await loadReferenceIdMap(pg);
  console.log(`  Loaded ${refMap.size} reference ids (reference_no -> refs.id)`);

  const { rows: conceptReasonRows } = await pg.query(
    `SELECT id FROM dictionaries.namechange_reasons WHERE reason = 'nomen oblitum' AND edge_class = 'concept'`,
  );
  if (conceptReasonRows.length !== 1) {
    console.error(`  FATAL: expected exactly one namechange_reasons row for reason='nomen oblitum'/edge_class='concept', got ${conceptReasonRows.length}`);
    process.exit(1);
  }
  const nomenOblitumReasonId = conceptReasonRows[0].id;

  const { rows: statusRows } = await pg.query(
    `SELECT id FROM dictionaries.nomenclatural_statuses WHERE status = 'nomen oblitum'`,
  );
  if (statusRows.length !== 1) {
    console.error(`  FATAL: expected exactly one nomenclatural_statuses row for status='nomen oblitum', got ${statusRows.length}`);
    process.exit(1);
  }
  const nomenOblitumStatusId = statusRows[0].id;

  let sourceRows = 0;
  const conceptSkip = { child_spelling_unresolved: 0, parent_spelling_orphan: 0, self_reference: 0, orphan_reference: 0 };
  const validitySkip = { child_spelling_unresolved: 0, orphan_reference: 0 };
  const logSkip = makeSampleLogger('skip');

  const conceptRows = [];
  const validityRows = [];
  let targetedCount = 0;
  let untargetedCount = 0;

  const conn = await mariadb.getConnection();
  const stream = conn.connection.query(`
    SELECT opinion_no, child_no, child_spelling_no, parent_no, parent_spelling_no,
           basis, pubyr, ref_has_opinion, reference_no, authorizer_no, enterer_no,
           author1last, author2last, otherauthors
    FROM opinions
    WHERE status = 'nomen oblitum' AND spelling_reason = 'original spelling'
    ORDER BY opinion_no ASC
  `).stream();

  try {
    for await (const src of stream) {
      sourceRows++;

      const child = Number(src.child_spelling_no);
      const parent = Number(src.parent_spelling_no);
      const targeted = Number(src.parent_no) !== 0;

      const referenceId = src.reference_no ? refMap.get(Number(src.reference_no)) : undefined;

      if (targeted) {
        targetedCount++;
        const subjectPermid = child ? nameMap.get(child) : undefined;
        if (!subjectPermid) { conceptSkip.child_spelling_unresolved++; logSkip(`opinion_no=${src.opinion_no} child_spelling_unresolved child=${src.child_spelling_no}`); continue; }
        const targetPermid = parent ? nameMap.get(parent) : undefined;
        if (!targetPermid) { conceptSkip.parent_spelling_orphan++; logSkip(`opinion_no=${src.opinion_no} parent_spelling_orphan parent=${src.parent_spelling_no}`); continue; }
        if (child === parent) { conceptSkip.self_reference++; logSkip(`opinion_no=${src.opinion_no} self_reference taxon=${src.child_spelling_no}`); continue; }
        if (!referenceId) { conceptSkip.orphan_reference++; logSkip(`opinion_no=${src.opinion_no} orphan_reference reference_no=${src.reference_no}`); continue; }

        const firstHand = src.ref_has_opinion === 'YES';
        const evidence = evidenceFromBasis(src.basis);
        const { authorizerPersonId, entererPersonId } = resolvePersons(src);
        const { publicationYear, attribution } = resolveSecondHand(src, firstHand);
        assertValidAttribution(attribution, `opinion_no=${src.opinion_no}`);

        conceptRows.push({
          permid: uuidv7(), authorizerPersonId, entererPersonId,
          subjectPermid, targetPermid,
          referenceId, publicationYear, attribution, evidence,
        });
      } else {
        untargetedCount++;
        const subjectPermid = child ? nameMap.get(child) : undefined;
        if (!subjectPermid) { validitySkip.child_spelling_unresolved++; logSkip(`opinion_no=${src.opinion_no} child_spelling_unresolved child=${src.child_spelling_no}`); continue; }
        if (!referenceId) { validitySkip.orphan_reference++; logSkip(`opinion_no=${src.opinion_no} orphan_reference reference_no=${src.reference_no}`); continue; }

        const firstHand = src.ref_has_opinion === 'YES';
        const evidence = evidenceFromBasis(src.basis);
        const { authorizerPersonId, entererPersonId } = resolvePersons(src);
        const { publicationYear, attribution } = resolveSecondHand(src, firstHand);
        assertValidAttribution(attribution, `opinion_no=${src.opinion_no}`);

        validityRows.push({
          permid: uuidv7(), authorizerPersonId, entererPersonId,
          subjectPermid,
          referenceId, publicationYear, attribution, evidence,
        });
      }
    }
  } finally {
    conn.release();
  }

  const totalConceptSkipped = Object.values(conceptSkip).reduce((a, b) => a + b, 0);
  const totalValiditySkipped = Object.values(validitySkip).reduce((a, b) => a + b, 0);

  console.log('');
  console.log(`  Source rows read: ${sourceRows} (targeted=${targetedCount}, untargeted=${untargetedCount})`);
  console.log(`  concept edges to insert: ${conceptRows.length}, skipped: ${totalConceptSkipped}`);
  console.log(`  validity_opinions to insert: ${validityRows.length}, skipped: ${totalValiditySkipped}`);

  if (conceptRows.length + totalConceptSkipped !== targetedCount) {
    console.error(`  FATAL: concept reconciliation failed! ${conceptRows.length} + ${totalConceptSkipped} != ${targetedCount} targeted`);
    process.exit(1);
  }
  if (validityRows.length + totalValiditySkipped !== untargetedCount) {
    console.error(`  FATAL: validity reconciliation failed! ${validityRows.length} + ${totalValiditySkipped} != ${untargetedCount} untargeted`);
    process.exit(1);
  }
  console.log(`  Reconciliation (concept, targeted):     ${conceptRows.length} + ${totalConceptSkipped} == ${targetedCount} ✓`);
  console.log(`  Reconciliation (validity, untargeted):  ${validityRows.length} + ${totalValiditySkipped} == ${untargetedCount} ✓`);

  const pgClient = await pg.connect();
  let insertedConcept = 0;
  let insertedValidity = 0;
  try {
    await pgClient.query('BEGIN');

    for (let i = 0; i < conceptRows.length; i += INSERT_BATCH_SIZE) {
      const batch = conceptRows.slice(i, i + INSERT_BATCH_SIZE);
      const values = [];
      const params = [];
      let p = 1;
      for (const r of batch) {
        values.push(`($${p},$${p+1},$${p+2},$${p+3},$${p+4},$${p+5},$${p+6},$${p+7},$${p+8},$${p+9},$${p+10},$${p+11},$${p+12},$${p+13},$${p+14},$${p+15},$${p+16})`);
        params.push(
          r.permid, r.authorizerPersonId, r.entererPersonId, null, r.subjectPermid,
          r.targetPermid, nomenOblitumReasonId, 'concept', null, null, null, null,
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
      insertedConcept += batch.length;
    }
    console.log(`  Inserted ${insertedConcept} name_opinions (concept, targeted)`);

    for (let i = 0; i < validityRows.length; i += INSERT_BATCH_SIZE) {
      const batch = validityRows.slice(i, i + INSERT_BATCH_SIZE);
      const values = [];
      const params = [];
      let p = 1;
      for (const r of batch) {
        values.push(`($${p},$${p+1},$${p+2},$${p+3},$${p+4},$${p+5},$${p+6},$${p+7},$${p+8},$${p+9})`);
        params.push(
          r.permid, r.authorizerPersonId, r.entererPersonId, r.subjectPermid, nomenOblitumStatusId,
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
    console.log(`  Inserted ${insertedValidity} validity_opinions (untargeted)`);

    await pgClient.query('COMMIT');
    console.log('  Committed.');
  } catch (err) {
    await pgClient.query('ROLLBACK').catch(() => {});
    console.error('  Insert failed, transaction rolled back:', err.message);
    pgClient.release();
    process.exit(1);
  }
  pgClient.release();

  await pg.query(`SELECT setval(pg_get_serial_sequence('name_opinions','id'), (SELECT MAX(id) FROM name_opinions))`);
  await pg.query(`SELECT setval(pg_get_serial_sequence('validity_opinions','id'), (SELECT MAX(id) FROM validity_opinions))`);

  const elapsed = ((new Date() - startTime) / 1000).toFixed(1);
  console.log(`[${new Date().toISOString()}] nomen-oblitum/original-spelling migration complete in ${elapsed}s`);
}

const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((err) => {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  }).finally(() => closeAll());
}
