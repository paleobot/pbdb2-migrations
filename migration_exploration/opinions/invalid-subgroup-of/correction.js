// Pair: status = 'invalid subgroup of', spelling_reason = 'correction' (23 rows).
//
// Per Q3's resolution: dual emission -- concept edge (reason='invalid subgroup',
// objective=NULL, §5.2) + lineage edge (reason='correction'), both into name_opinions.
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
  console.log(`[${startTime.toISOString()}] Starting invalid-subgroup-of/correction migration...`);

  const nameMap = await loadNamePermidMap(pg);
  console.log(`  Loaded ${nameMap.size} name identities (oldpbdb_taxon_no -> permid)`);
  const refMap = await loadReferenceIdMap(pg);
  console.log(`  Loaded ${refMap.size} reference ids (reference_no -> refs.id)`);

  const { rows: conceptReasonRows } = await pg.query(
    `SELECT id FROM dictionaries.namechange_reasons WHERE reason = 'invalid subgroup' AND edge_class = 'concept'`,
  );
  if (conceptReasonRows.length !== 1) {
    console.error(`  FATAL: expected exactly one namechange_reasons row for reason='invalid subgroup'/edge_class='concept', got ${conceptReasonRows.length}`);
    process.exit(1);
  }
  const invalidSubgroupReasonId = conceptReasonRows[0].id;

  const { rows: lineageReasonRows } = await pg.query(
    `SELECT id FROM dictionaries.namechange_reasons WHERE reason = 'correction' AND edge_class = 'lineage'`,
  );
  if (lineageReasonRows.length !== 1) {
    console.error(`  FATAL: expected exactly one namechange_reasons row for reason='correction'/edge_class='lineage', got ${lineageReasonRows.length}`);
    process.exit(1);
  }
  const correctionReasonId = lineageReasonRows[0].id;

  let sourceRows = 0;
  let orphanReference = 0;
  let childSpellingUnresolved = 0;
  const conceptSkip = { parent_spelling_zero: 0, parent_spelling_orphan: 0, self_reference: 0 };
  const lineageSkip = { child_no_unresolved: 0, self_reference: 0 };
  const logSkip = makeSampleLogger('skip');

  const conceptRows = [];
  const lineageRows = [];

  const conn = await mariadb.getConnection();
  const stream = conn.connection.query(`
    SELECT opinion_no, child_no, child_spelling_no, parent_no, parent_spelling_no,
           basis, pubyr, ref_has_opinion, reference_no, authorizer_no, enterer_no,
           author1last, author2last, otherauthors
    FROM opinions
    WHERE status = 'invalid subgroup of' AND spelling_reason = 'correction'
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
        continue;
      }

      const childSpellingPermid = childSpelling ? nameMap.get(childSpelling) : undefined;
      if (!childSpellingPermid) {
        childSpellingUnresolved++;
        logSkip(`opinion_no=${src.opinion_no} child_spelling_unresolved child=${src.child_spelling_no}`);
        continue;
      }

      const firstHand = src.ref_has_opinion === 'YES';
      const evidence = evidenceFromBasis(src.basis);
      const { authorizerPersonId, entererPersonId } = resolvePersons(src);
      const { publicationYear, attribution } = resolveSecondHand(src, firstHand);
      assertValidAttribution(attribution, `opinion_no=${src.opinion_no}`);

      if (!parentSpelling) {
        conceptSkip.parent_spelling_zero++;
        logSkip(`opinion_no=${src.opinion_no} parent_spelling_zero`);
      } else {
        const targetPermid = nameMap.get(parentSpelling);
        if (!targetPermid) {
          conceptSkip.parent_spelling_orphan++;
          logSkip(`opinion_no=${src.opinion_no} parent_spelling_orphan parent=${src.parent_spelling_no}`);
        } else if (childSpelling === parentSpelling) {
          conceptSkip.self_reference++;
          logSkip(`opinion_no=${src.opinion_no} concept_self_reference taxon=${src.child_spelling_no}`);
        } else {
          conceptRows.push({
            permid: uuidv7(), authorizerPersonId, entererPersonId,
            subjectPermid: childSpellingPermid, targetPermid,
            referenceId, publicationYear, attribution, evidence,
          });
        }
      }

      const childNoPermid = childNo ? nameMap.get(childNo) : undefined;
      if (!childNoPermid) {
        lineageSkip.child_no_unresolved++;
        logSkip(`opinion_no=${src.opinion_no} lineage_child_no_unresolved child_no=${src.child_no}`);
      } else if (childSpelling === childNo) {
        lineageSkip.self_reference++;
        logSkip(`opinion_no=${src.opinion_no} lineage_self_reference taxon=${src.child_spelling_no}`);
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

  const totalConceptSkipped = orphanReference + childSpellingUnresolved + Object.values(conceptSkip).reduce((a, b) => a + b, 0);
  const totalLineageSkipped = orphanReference + childSpellingUnresolved + Object.values(lineageSkip).reduce((a, b) => a + b, 0);

  console.log('');
  console.log(`  Source rows read: ${sourceRows}`);
  console.log(`  concept edges to insert: ${conceptRows.length}, skipped: ${totalConceptSkipped}`);
  console.log(`  lineage edges to insert: ${lineageRows.length}, skipped: ${totalLineageSkipped}`);

  if (conceptRows.length + totalConceptSkipped !== sourceRows) {
    console.error(`  FATAL: concept reconciliation failed! ${conceptRows.length} + ${totalConceptSkipped} != ${sourceRows}`);
    process.exit(1);
  }
  if (lineageRows.length + totalLineageSkipped !== sourceRows) {
    console.error(`  FATAL: lineage reconciliation failed! ${lineageRows.length} + ${totalLineageSkipped} != ${sourceRows}`);
    process.exit(1);
  }
  console.log(`  Reconciliation (concept): ${conceptRows.length} + ${totalConceptSkipped} == ${sourceRows} ✓`);
  console.log(`  Reconciliation (lineage): ${lineageRows.length} + ${totalLineageSkipped} == ${sourceRows} ✓`);

  const pgClient = await pg.connect();
  let insertedConcept = 0;
  let insertedLineage = 0;
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
          r.targetPermid, invalidSubgroupReasonId, 'concept', null, null, null, null,
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
    console.log(`  Inserted ${insertedConcept} name_opinions (concept)`);

    for (let i = 0; i < lineageRows.length; i += INSERT_BATCH_SIZE) {
      const batch = lineageRows.slice(i, i + INSERT_BATCH_SIZE);
      const values = [];
      const params = [];
      let p = 1;
      for (const r of batch) {
        values.push(`($${p},$${p+1},$${p+2},$${p+3},$${p+4},$${p+5},$${p+6},$${p+7},$${p+8},$${p+9},$${p+10},$${p+11},$${p+12},$${p+13},$${p+14},$${p+15},$${p+16})`);
        params.push(
          r.permid, r.authorizerPersonId, r.entererPersonId, null, r.subjectPermid,
          r.targetPermid, correctionReasonId, 'lineage', null, null, null, null,
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

  await pg.query(`SELECT setval(pg_get_serial_sequence('name_opinions','id'), (SELECT MAX(id) FROM name_opinions))`);

  const elapsed = ((new Date() - startTime) / 1000).toFixed(1);
  console.log(`[${new Date().toISOString()}] invalid-subgroup-of/correction migration complete in ${elapsed}s`);
}

const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((err) => {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  }).finally(() => closeAll());
}
