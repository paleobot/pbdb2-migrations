// Pair: status = 'invalid subgroup of', spelling_reason = 'original spelling' (1,316 rows).
//
// Concept-class fold (§5.2, 2026-08-18): Classic's own getSeniorSynonym/
// getJuniorSynonyms treats invalid subgroup of the same as ordinary synonymy for
// computational purposes. Field mapping matches Pair 7/13's convention:
// subject_permid = permid(child_spelling_no), target_permid = permid(parent_spelling_no).
// objective = NULL (doesn't apply outside the synonym-of subjective/objective split).
// Single-output pair -- no assignment_opinions, no lineage (original spelling).
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
  console.log(`[${startTime.toISOString()}] Starting invalid-subgroup-of/original-spelling migration...`);

  const nameMap = await loadNamePermidMap(pg);
  console.log(`  Loaded ${nameMap.size} name identities (oldpbdb_taxon_no -> permid)`);
  const refMap = await loadReferenceIdMap(pg);
  console.log(`  Loaded ${refMap.size} reference ids (reference_no -> refs.id)`);

  const { rows: reasonRows } = await pg.query(
    `SELECT id FROM dictionaries.namechange_reasons WHERE reason = 'invalid subgroup' AND edge_class = 'concept'`,
  );
  if (reasonRows.length !== 1) {
    console.error(`  FATAL: expected exactly one namechange_reasons row for reason='invalid subgroup'/edge_class='concept', got ${reasonRows.length}`);
    process.exit(1);
  }
  const invalidSubgroupReasonId = reasonRows[0].id;

  let sourceRows = 0;
  const skip = { child_spelling_unresolved: 0, parent_spelling_zero: 0, parent_spelling_orphan: 0, self_reference: 0, orphan_reference: 0 };
  const logSkip = makeSampleLogger('skip');

  const concepts = [];

  const conn = await mariadb.getConnection();
  const stream = conn.connection.query(`
    SELECT opinion_no, child_no, child_spelling_no, parent_no, parent_spelling_no,
           basis, pubyr, ref_has_opinion, reference_no, authorizer_no, enterer_no,
           author1last, author2last, otherauthors
    FROM opinions
    WHERE status = 'invalid subgroup of' AND spelling_reason = 'original spelling'
    ORDER BY opinion_no ASC
  `).stream();

  try {
    for await (const src of stream) {
      sourceRows++;

      const child = Number(src.child_spelling_no);
      const parent = Number(src.parent_spelling_no);

      const subjectPermid = child ? nameMap.get(child) : undefined;
      if (!subjectPermid) { skip.child_spelling_unresolved++; logSkip(`opinion_no=${src.opinion_no} child_spelling_unresolved child=${src.child_spelling_no}`); continue; }

      if (!parent) { skip.parent_spelling_zero++; logSkip(`opinion_no=${src.opinion_no} parent_spelling_zero`); continue; }
      const targetPermid = nameMap.get(parent);
      if (!targetPermid) { skip.parent_spelling_orphan++; logSkip(`opinion_no=${src.opinion_no} parent_spelling_orphan parent=${src.parent_spelling_no}`); continue; }

      if (child === parent) { skip.self_reference++; logSkip(`opinion_no=${src.opinion_no} self_reference taxon=${src.child_spelling_no}`); continue; }

      const referenceId = src.reference_no ? refMap.get(Number(src.reference_no)) : undefined;
      if (!referenceId) { skip.orphan_reference++; logSkip(`opinion_no=${src.opinion_no} orphan_reference reference_no=${src.reference_no}`); continue; }

      const firstHand = src.ref_has_opinion === 'YES';
      const evidence = evidenceFromBasis(src.basis);
      const { authorizerPersonId, entererPersonId } = resolvePersons(src);
      const { publicationYear, attribution } = resolveSecondHand(src, firstHand);
      assertValidAttribution(attribution, `opinion_no=${src.opinion_no}`);

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

  const pgClient = await pg.connect();
  let inserted = 0;
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
      inserted += batch.length;
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

  await pg.query(`SELECT setval(pg_get_serial_sequence('name_opinions','id'), (SELECT MAX(id) FROM name_opinions))`);

  const elapsed = ((new Date() - startTime) / 1000).toFixed(1);
  console.log(`[${new Date().toISOString()}] invalid-subgroup-of/original-spelling migration complete in ${elapsed}s`);
}

const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((err) => {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  }).finally(() => closeAll());
}
