// Pair: status = 'belongs to', spelling_reason = 'original spelling' (743,712 rows).
//
// Primary disposition: every row is a containment assertion -> assignment_opinions
// (subject_permid = permid(child_spelling_no), containing_permid = permid(parent_spelling_no)).
// Field direction confirmed against the Classic UI and treated as already-verified
// (matches the pre-existing migrate-assignment-opinions.js).
//
// Secondary disposition (the mapping doc's §5.1 anomaly, resolved under the ledger
// model — no ranking, see the boundary note at the top of taxa-opinions-migration-
// mapping.md): 50 of these rows have child_spelling_no != child_no despite the
// 'original spelling' label. Each is migrated as its own name_opinions LINEAGE row
// unconditionally, in addition to its assignment row -- this is not a contest, every
// qualifying opinion gets its own ledger row. The reason token comes from the
// pre-computed mistagged-original-spelling.csv worklist (§5.1), not from the
// untrustworthy label:
//   - reranked / recombination / correction (27 rows): map directly to the matching
//     namechange_reasons lineage token.
//   - duplicate-or-homonym (22 rows): identical name + rank, different taxon_no --
//     e.g. a name re-anchored to a newer authority (common in botanical nomenclature)
//     with no textual change at all. Decided 2026-08-19: treated like any other
//     lineage claim, no special-casing; mapped to the generic 'assignment' token
//     since none of the more specific tokens (correction/reranked/recombination)
//     describe "same name, same rank, new authority."
//   - the 50th row (dangling child_spelling_no) is not in the worklist and is
//     already excluded by the standard child_spelling_unresolved skip below.
import { mariadb, pg, closeAll } from '../../../db.js';
import { uuidv7 } from '../../../uuidv7.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadNamePermidMap, loadReferenceIdMap, resolvePersons } from '../../lib/identity.js';
import { resolveSecondHand, assertValidAttribution } from '../../lib/attribution.js';
import { evidenceFromBasis } from '../../lib/evidence.js';

const INSERT_BATCH_SIZE = 1000;
const LOG_SAMPLE_LIMIT = 20;
const MISTAGGED_CSV = fileURLToPath(new URL('../../../mistagged-original-spelling.csv', import.meta.url));

const REASON_MAP = {
  reranked: 'reranked',
  recombination: 'recombination',
  correction: 'correction',
  'duplicate-or-homonym': 'assignment',
};

function loadMistaggedReasons() {
  const lines = readFileSync(MISTAGGED_CSV, 'utf8').trim().split('\n');
  const header = lines[0].split(',');
  const opinionIdx = header.indexOf('opinion_no');
  const reasonIdx = header.indexOf('inferred_reason');
  const map = new Map();
  for (const line of lines.slice(1)) {
    const cols = line.split(',');
    map.set(Number(cols[opinionIdx]), cols[reasonIdx]);
  }
  return map;
}

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
  console.log(`[${startTime.toISOString()}] Starting belongs-to/original-spelling migration...`);

  const mistagged = loadMistaggedReasons();
  console.log(`  Loaded ${mistagged.size} mistagged-original-spelling reason overrides (of 50 anomalous rows)`);

  const nameMap = await loadNamePermidMap(pg);
  console.log(`  Loaded ${nameMap.size} name identities (oldpbdb_taxon_no -> permid)`);
  const refMap = await loadReferenceIdMap(pg);
  console.log(`  Loaded ${refMap.size} reference ids (reference_no -> refs.id)`);

  const { rows: lineageReasonRows } = await pg.query(
    `SELECT reason, id FROM dictionaries.namechange_reasons WHERE edge_class = 'lineage'`,
  );
  const lineageReasonId = new Map(lineageReasonRows.map((r) => [r.reason, r.id]));
  for (const token of new Set(Object.values(REASON_MAP))) {
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

  const assignments = [];
  const lineageRows = [];

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
        console.log(`  Processed ${sourceRows} rows: ${assignments.length} assignments, ${lineageEmitted} lineage rows so far...`);
      }

      const firstHand = src.ref_has_opinion === 'YES';
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

      const evidence = evidenceFromBasis(src.basis);
      const { authorizerPersonId, entererPersonId } = resolvePersons(src);
      const { publicationYear, attribution } = resolveSecondHand(src, firstHand);
      assertValidAttribution(attribution, `opinion_no=${src.opinion_no}`);

      assignments.push({
        permid: uuidv7(),
        authorizerPersonId,
        entererPersonId,
        subjectPermid,
        containingPermid,
        referenceId,
        publicationYear,
        attribution,
        evidence,
      });

      // §5.1 backfill: emit the lineage claim this row's data shows, ledger-style
      // (no ranking, no dependency on any other opinion). Only fires on the 50
      // anomalous rows; every other row in this pair has child_spelling_no === child_no.
      const childNo = Number(src.child_no);
      if (child !== childNo) {
        const inferredReason = mistagged.get(Number(src.opinion_no));
        const targetPermid = inferredReason ? nameMap.get(childNo) : undefined;
        if (!inferredReason || !targetPermid) {
          lineageUnresolved++;
          logSkip(`opinion_no=${src.opinion_no} lineage_unresolved child_no=${src.child_no} inferredReason=${inferredReason ?? 'none'}`);
        } else {
          lineageEmitted++;
          lineageRows.push({
            permid: uuidv7(),
            authorizerPersonId,
            entererPersonId,
            subjectPermid,
            targetPermid,
            reasonId: lineageReasonId.get(REASON_MAP[inferredReason]),
            referenceId,
            publicationYear,
            attribution,
            evidence,
          });
        }
      }
    }
  } finally {
    conn.release();
  }

  const totalSkipped = Object.values(skip).reduce((a, b) => a + b, 0);
  console.log('');
  console.log(`  Source rows read:            ${sourceRows}`);
  console.log(`  assignment_opinions to insert: ${assignments.length}`);
  console.log(`  Skipped:                     ${totalSkipped}`);
  for (const [k, v] of Object.entries(skip)) console.log(`    ${k}: ${v}`);
  console.log(`  name_opinions (lineage) to insert: ${lineageEmitted}`);
  console.log(`  Lineage claims unresolved (expected 1 — the dangling row): ${lineageUnresolved}`);

  if (assignments.length + totalSkipped !== sourceRows) {
    console.error(`  FATAL: reconciliation failed! ${assignments.length} inserted + ${totalSkipped} skipped != ${sourceRows} source`);
    process.exit(1);
  }
  console.log(`  Reconciliation: ${assignments.length} + ${totalSkipped} == ${sourceRows} ✓`);

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
    console.log(`  Inserted ${insertedLineage} name_opinions (lineage backfill)`);

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
  console.log(`[${new Date().toISOString()}] belongs-to/original-spelling migration complete in ${elapsed}s`);
}

const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((err) => {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  }).finally(() => closeAll());
}
