// Single, table-driven migration of the legacy `opinions` table into
// assignment_opinions / name_opinions / validity_opinions. Replaces the 48
// hand-written (status, spelling_reason) handlers under
// migration_exploration/opinions/ with one streamlined script whose structure
// mirrors payloadSchemas/mappings/opinions.md: three canonical dispositions
// (assignment / concept / validity), one universal spelling_reason → lineage
// crosswalk applied as an independent second (dual) emission, and the named
// exceptions (misspelling of; nomen oblitum's per-row branch; the mistagged
// original-spelling backfill).
//
// See openspec/changes/create-opinions-migration/ for the proposal, design, the
// opinions-migration capability spec (the behavioral contract), and tasks.
import { mariadb, pg, closeAll } from '../lib/db.js';
import { uuidv7 } from '../lib/uuidv7.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadNamePermidMap, loadReferenceIdMap, resolvePersons } from '../lib/identity.js';
import { resolveSecondHand, assertValidAttribution } from '../lib/attribution.js';
import { evidenceFromBasis } from '../lib/evidence.js';
import { createAnomalyLog } from '../lib/anomaly-log.js';

const INSERT_BATCH_SIZE = 1000;
const KEYSET_CHUNK = 20000;
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const MISTAGGED_CSV = join(SCRIPT_DIR, '..', '..', 'mistagged-original-spelling.csv');
const RUN_SUMMARY = join(SCRIPT_DIR, 'run-summary.txt');

// ---------- In-code rule tables (transcribed from opinions.md) ----------

// Concept disposition: status → { reason token, objective }. objective is set
// only for junior synonym (the sole carrier of the objective/subjective split);
// NULL for every other concept reason.
const CONCEPT = {
  'subjective synonym of': { reason: 'junior synonym', objective: false },
  'objective synonym of':  { reason: 'junior synonym', objective: true },
  'invalid subgroup of':   { reason: 'invalid subgroup', objective: null },
  'replaced by':           { reason: 'replaced by', objective: null },
};

// Validity disposition: status → nomenclatural_statuses.status. Untargeted; no target.
const VALIDITY = {
  'nomen dubium': 'nomen dubium',
  'nomen nudum':  'nomen nudum',
  'nomen vanum':  'nomen vanum',
};

// Universal lineage crosswalk: spelling_reason → lineage reason token. Applied as
// an independent second emission for EVERY status (except 'misspelling of', whose
// single output is its own historical-misspelling edge). 'original spelling' has
// no entry: it produces no lineage edge by default (see the mistagged exception).
const CROSSWALK = {
  'correction':    'correction',
  'rank change':   'reranked',
  'recombination': 'recombination',
  'misspelling':   'misspelling',
  'reassignment':  'assignment',
};

// Mistagged original-spelling worklist: the CSV's human `inferred_reason` label →
// a namechange_reasons lineage token.
const MISTAGGED_LABEL_TO_TOKEN = {
  'reranked':            'reranked',
  'recombination':       'recombination',
  'correction':          'correction',
  'duplicate-or-homonym': 'assignment',
};

// The three pairs (all with spelling_reason = 'original spelling') the mistagged
// backfill covers; every other status/original-spelling combination gets no
// lineage edge even when child_spelling_no != child_no.
const MISTAGGED_STATUSES = new Set(['belongs to', 'replaced by', 'subjective synonym of']);

// The full closed set of source statuses, for status-closure validation.
const KNOWN_STATUSES = new Set([
  'belongs to', 'misspelling of', 'nomen oblitum',
  ...Object.keys(CONCEPT), ...Object.keys(VALIDITY),
]);
const KNOWN_SPELLING_REASONS = new Set(['original spelling', ...Object.keys(CROSSWALK)]);

// ---------- Reconciliation bookkeeping ----------
// recon[pair][outputKey] = { attempted, written, skipped }. outputKey is one of
// assignment | concept | validity | historical_misspelling | lineage. A row can
// carry a primary output and, independently, a 'lineage' backfill — distinct keys.
const recon = new Map();
function rec(pair, key) {
  let m = recon.get(pair);
  if (!m) { m = new Map(); recon.set(pair, m); }
  let c = m.get(key);
  if (!c) { c = { attempted: 0, written: 0, skipped: 0 }; m.set(key, c); }
  return c;
}

function loadMistaggedTokens() {
  const lines = readFileSync(MISTAGGED_CSV, 'utf8').trim().split('\n');
  const header = lines[0].split(',');
  const opinionIdx = header.indexOf('opinion_no');
  const reasonIdx = header.indexOf('inferred_reason');
  const map = new Map();
  for (const line of lines.slice(1)) {
    const cols = line.split(',');
    const label = cols[reasonIdx];
    const token = MISTAGGED_LABEL_TO_TOKEN[label];
    if (!token) {
      throw new Error(`mistagged-original-spelling.csv: unknown inferred_reason '${label}' for opinion_no=${cols[opinionIdx]}`);
    }
    map.set(Number(cols[opinionIdx]), token);
  }
  // The two non-belongs-to pairs' overrides are hard-coded (already tokens).
  map.set(955925, 'assignment');  // replaced by / original spelling
  map.set(71324, 'reranked');     // subjective synonym of / original spelling
  map.set(912640, 'assignment');  // subjective synonym of / original spelling
  return map;
}

// ---------- Main ----------
async function main(opts = {}) {
  const startTime = new Date();
  const mode = opts.sampleWhere ? 'sample' : 'full';
  console.log(`[${startTime.toISOString()}] Starting opinions migration (${mode})...`);

  const anomalyLog = createAnomalyLog(import.meta.url);
  const mistaggedTokens = loadMistaggedTokens();
  console.log(`  Loaded ${mistaggedTokens.size} mistagged-original-spelling reason overrides`);

  const nameMap = await loadNamePermidMap(pg);
  console.log(`  Loaded ${nameMap.size} name identities (oldpbdb_taxon_no -> permid)`);
  const refMap = await loadReferenceIdMap(pg);
  console.log(`  Loaded ${refMap.size} reference ids (reference_no -> refs.id)`);

  // ---- Resolve dictionary ids up front; fail fast if any token is missing ----
  const { rows: reasonRows } = await pg.query(`SELECT id, reason, edge_class FROM dictionaries.namechange_reasons`);
  const reasonId = (reason, edgeClass) => {
    const hit = reasonRows.find((r) => r.reason === reason && r.edge_class === edgeClass);
    if (!hit) { console.error(`  FATAL: no namechange_reasons row for reason='${reason}'/edge_class='${edgeClass}'`); process.exit(1); }
    return hit.id;
  };
  const conceptReasonId = {};
  for (const s of Object.values(CONCEPT)) conceptReasonId[s.reason] = reasonId(s.reason, 'concept');
  const nomenOblitumConceptReasonId = reasonId('nomen oblitum', 'concept');
  const historicalMisspellingReasonId = reasonId('historical misspelling', 'lineage');
  const crosswalkReasonId = {};
  for (const token of new Set(Object.values(CROSSWALK))) crosswalkReasonId[token] = reasonId(token, 'lineage');
  for (const token of new Set(Object.values(MISTAGGED_LABEL_TO_TOKEN))) {
    if (!(token in crosswalkReasonId)) crosswalkReasonId[token] = reasonId(token, 'lineage');
  }

  const { rows: statusRows } = await pg.query(`SELECT id, status FROM dictionaries.nomenclatural_statuses`);
  const statusId = (status) => {
    const hit = statusRows.find((r) => r.status === status);
    if (!hit) { console.error(`  FATAL: no nomenclatural_statuses row for status='${status}'`); process.exit(1); }
    return hit.id;
  };
  const validityStatusId = {};
  for (const st of new Set([...Object.values(VALIDITY), 'nomen oblitum'])) validityStatusId[st] = statusId(st);

  // ---- Output accumulators (flushed per chunk to keep memory bounded) ----
  let assignments = [];
  let nameOpinions = [];
  let validities = [];

  let sourceRows = 0;
  const anomalyBuckets = {};   // issue → count, for the run summary
  const bumpBucket = (issue) => { anomalyBuckets[issue] = (anomalyBuckets[issue] || 0) + 1; };

  // Log a skip both to the anomaly ledger and the bucket tally.
  const logSkip = (opinionNo, table, issue, description) => {
    anomalyLog.log(opinionNo, table, 'skip', issue, description);
    bumpBucket(issue);
  };
  const logWarning = (opinionNo, table, issue, description) => {
    anomalyLog.log(opinionNo, table, 'warning', issue, description);
    bumpBucket(issue);
  };

  const pgClient = await pg.connect();
  await pgClient.query('BEGIN');

  try {
    let lastOpinionNo = 0;
    for (;;) {
      const where = opts.sampleWhere ? `AND (${opts.sampleWhere})` : '';
      const [rows] = await mariadb.query(
        `SELECT opinion_no, status, spelling_reason, child_no, child_spelling_no,
                parent_no, parent_spelling_no, basis, pubyr, ref_has_opinion,
                reference_no, authorizer_no, enterer_no, author1last, author2last, otherauthors
         FROM opinions
         WHERE opinion_no > ? ${where}
         ORDER BY opinion_no ASC
         LIMIT ?`,
        [lastOpinionNo, KEYSET_CHUNK],
      );
      if (rows.length === 0) break;
      lastOpinionNo = Number(rows[rows.length - 1].opinion_no);

      for (const src of rows) {
        sourceRows++;
        const status = src.status;
        const spellingReason = src.spelling_reason;
        const pair = `${status} / ${spellingReason}`;

        // ---- Status closure: no status/spelling_reason falls through ----
        if (!KNOWN_STATUSES.has(status)) {
          console.error(`\n  FATAL: unmapped status='${status}' (opinion_no=${src.opinion_no}) — status closure violated`);
          throw new Error('status closure violated');
        }
        if (!KNOWN_SPELLING_REASONS.has(spellingReason)) {
          console.error(`\n  FATAL: unmapped spelling_reason='${spellingReason}' (opinion_no=${src.opinion_no})`);
          throw new Error('spelling_reason closure violated');
        }

        const childSpelling = Number(src.child_spelling_no);
        const parentSpelling = Number(src.parent_spelling_no);
        const childNo = Number(src.child_no);

        // ---- Shared per-row context ----
        const firstHand = src.ref_has_opinion === 'YES';
        const evidence = evidenceFromBasis(src.basis);
        const { authorizerPersonId, entererPersonId } = resolvePersons(src);
        const { publicationYear, attribution } = resolveSecondHand(src, firstHand);
        assertValidAttribution(attribution, `opinion_no=${src.opinion_no}`);

        const childSpellingPermid = childSpelling ? nameMap.get(childSpelling) : undefined;
        const referenceId = src.reference_no ? refMap.get(Number(src.reference_no)) : undefined;
        const base = { authorizerPersonId, entererPersonId, publicationYear, attribution, evidence, referenceId };

        // Which outputs does this row attempt? (Used for reconciliation and to log
        // the shared-prerequisite skip against each of them.)
        const primaryKey =
          status === 'belongs to' ? 'assignment'
          : status === 'misspelling of' ? 'historical_misspelling'
          : status in CONCEPT ? 'concept'
          : status in VALIDITY ? 'validity'
          : status === 'nomen oblitum' ? (parentSpelling !== 0 ? 'concept' : 'validity')
          : null;
        const primaryTable =
          primaryKey === 'assignment' ? 'assignment_opinions'
          : primaryKey === 'validity' ? 'validity_opinions'
          : 'name_opinions';

        // Does this row attempt a universal/backfill lineage edge? (Never for
        // 'misspelling of', whose only output is the historical-misspelling edge.)
        let lineageAttempted = false;
        let lineageToken = null;
        if (status !== 'misspelling of') {
          if (spellingReason !== 'original spelling') {
            lineageAttempted = true;
            lineageToken = CROSSWALK[spellingReason];
          } else if (MISTAGGED_STATUSES.has(status) && childSpelling !== childNo) {
            // Mistagged original-spelling exception (only these three statuses).
            lineageAttempted = true;
            lineageToken = mistaggedTokens.get(Number(src.opinion_no)) || null; // null → skip-and-log below
          }
        }

        // Count attempts.
        rec(pair, primaryKey).attempted++;
        if (lineageAttempted) rec(pair, 'lineage').attempted++;

        // ---- Shared prerequisites: childSpelling permid + reference ----
        // A failure here skips every attempted output for the row, independently
        // logged, so per-output reconciliation still balances.
        if (!childSpellingPermid || !referenceId) {
          const issue = !childSpellingPermid ? 'child_spelling_unresolved' : 'orphan_reference';
          const detail = !childSpellingPermid
            ? `child_spelling_no=${src.child_spelling_no} has no migrated permid`
            : `reference_no=${src.reference_no} not found in migrated refs`;
          rec(pair, primaryKey).skipped++;
          logSkip(src.opinion_no, primaryTable, issue, `${primaryKey} output skipped: ${detail}`);
          if (lineageAttempted) {
            rec(pair, 'lineage').skipped++;
            logSkip(src.opinion_no, 'name_opinions', issue, `lineage backfill skipped: ${detail}`);
          }
          continue;
        }

        // ================= PRIMARY DISPOSITION =================
        if (primaryKey === 'assignment') {
          // belongs to: subject = child_spelling_no, containing = parent_spelling_no.
          // parent_spelling_no = 0 → asserted-rootless (containing_permid = NULL, warning).
          if (parentSpelling === 0) {
            rec(pair, 'assignment').written++;
            logWarning(src.opinion_no, 'assignment_opinions', 'asserted_rootless',
              'assignment_opinions row inserted with containing_permid = NULL: parent_spelling_no is 0 (Classic asserts no parent)');
            assignments.push({ permid: uuidv7(), ...base, subjectPermid: childSpellingPermid, containingPermid: null });
          } else {
            const containingPermid = nameMap.get(parentSpelling);
            if (!containingPermid) {
              rec(pair, 'assignment').skipped++;
              logSkip(src.opinion_no, 'assignment_opinions', 'parent_spelling_orphan',
                `assignment_opinions row skipped: parent_spelling_no=${src.parent_spelling_no} has no migrated permid`);
            } else if (childSpelling === parentSpelling) {
              rec(pair, 'assignment').skipped++;
              logSkip(src.opinion_no, 'assignment_opinions', 'self_reference',
                `assignment_opinions row skipped: child_spelling_no == parent_spelling_no (${src.child_spelling_no})`);
            } else {
              rec(pair, 'assignment').written++;
              assignments.push({ permid: uuidv7(), ...base, subjectPermid: childSpellingPermid, containingPermid });
            }
          }
        } else if (primaryKey === 'concept' && status !== 'nomen oblitum') {
          // Concept-4: subject = child_spelling_no, target = parent_spelling_no.
          const spec = CONCEPT[status];
          emitConcept(src, base, parentSpelling, childSpelling, childSpellingPermid, nameMap,
            conceptReasonId[spec.reason], spec.objective, `junior/${spec.reason}`,
            rec(pair, 'concept'), logSkip, nameOpinions);
        } else if (primaryKey === 'validity' && status !== 'nomen oblitum') {
          // Validity-3: subject = child_spelling_no, no target.
          rec(pair, 'validity').written++;
          validities.push({ permid: uuidv7(), ...base, subjectPermid: childSpellingPermid, statusId: validityStatusId[VALIDITY[status]] });
        } else if (status === 'nomen oblitum') {
          // Per-row branch: targeted → concept (reason 'nomen oblitum'); untargeted → validity.
          if (parentSpelling !== 0) {
            emitConcept(src, base, parentSpelling, childSpelling, childSpellingPermid, nameMap,
              nomenOblitumConceptReasonId, null, 'nomen oblitum',
              rec(pair, 'concept'), logSkip, nameOpinions);
          } else {
            rec(pair, 'validity').written++;
            validities.push({ permid: uuidv7(), ...base, subjectPermid: childSpellingPermid, statusId: validityStatusId['nomen oblitum'] });
          }
        } else if (primaryKey === 'historical_misspelling') {
          // misspelling of: lineage-only, reason 'historical misspelling', target = parent_spelling_no.
          const targetPermid = parentSpelling ? nameMap.get(parentSpelling) : undefined;
          if (!targetPermid) {
            rec(pair, 'historical_misspelling').skipped++;
            logSkip(src.opinion_no, 'name_opinions', 'parent_spelling_unresolved',
              `lineage (historical misspelling) edge skipped: parent_spelling_no=${src.parent_spelling_no} has no migrated permid`);
          } else if (childSpelling === parentSpelling) {
            rec(pair, 'historical_misspelling').skipped++;
            logSkip(src.opinion_no, 'name_opinions', 'self_reference',
              `lineage (historical misspelling) edge skipped: child_spelling_no == parent_spelling_no (${src.child_spelling_no}) — asserts no actual spelling deviation`);
          } else {
            rec(pair, 'historical_misspelling').written++;
            nameOpinions.push({ permid: uuidv7(), ...base, subjectPermid: childSpellingPermid, targetPermid, reasonId: historicalMisspellingReasonId, edgeClass: 'lineage', objective: null });
          }
        }

        // ================= UNIVERSAL / BACKFILL LINEAGE (independent) =================
        if (lineageAttempted) {
          const c = rec(pair, 'lineage');
          if (!lineageToken) {
            // Mistagged original-spelling row not present in the worklist.
            c.skipped++;
            logSkip(src.opinion_no, 'name_opinions', 'mislabeled_original_spelling',
              `child_spelling_no (${src.child_spelling_no}) != child_no (${src.child_no}) despite spelling_reason='original spelling', but absent from the mistagged worklist — lineage claim NOT migrated`);
          } else {
            const targetPermid = childNo ? nameMap.get(childNo) : undefined;
            if (!targetPermid) {
              c.skipped++;
              logSkip(src.opinion_no, 'name_opinions', 'child_no_unresolved',
                `lineage (${lineageToken}) edge skipped: child_no=${src.child_no} has no migrated permid`);
            } else if (childSpelling === childNo) {
              c.skipped++;
              logSkip(src.opinion_no, 'name_opinions', 'self_reference',
                `lineage (${lineageToken}) edge skipped: child_spelling_no == child_no (${src.child_spelling_no}) — no actual spelling deviation`);
            } else {
              c.written++;
              if (spellingReason === 'original spelling') {
                logWarning(src.opinion_no, 'name_opinions', 'mislabeled_original_spelling',
                  `child_spelling_no (${src.child_spelling_no}) != child_no (${src.child_no}) despite spelling_reason='original spelling' — worklist backfill emitted as lineage edge, reason='${lineageToken}'`);
              }
              nameOpinions.push({ permid: uuidv7(), ...base, subjectPermid: childSpellingPermid, targetPermid, reasonId: crosswalkReasonId[lineageToken], edgeClass: 'lineage', objective: null });
            }
          }
        }
      }

      // ---- Flush this chunk's outputs ----
      await insertAssignments(pgClient, assignments);
      await insertNameOpinions(pgClient, nameOpinions);
      await insertValidities(pgClient, validities);
      const flushed = assignments.length + nameOpinions.length + validities.length;
      assignments = []; nameOpinions = []; validities = [];
      if (flushed > 0) console.log(`  ...processed ${sourceRows} source rows so far (chunk flushed ${flushed} output rows)`);
    }

    // ---- Reconciliation: written + skipped == attempted, per (pair, output) ----
    const summary = buildSummary(startTime, sourceRows, anomalyBuckets);
    if (!summary.ok) {
      console.error('  FATAL: reconciliation failed — see run summary; rolling back.');
      anomalyLog.flush();
      writeFileSync(RUN_SUMMARY, summary.text);
      await pgClient.query('ROLLBACK');
      pgClient.release();
      return summary;
    }

    await pgClient.query('COMMIT');
    console.log('  Committed.');
    pgClient.release();

    // ---- Reset identity sequences ----
    await pg.query(`SELECT setval(pg_get_serial_sequence('assignment_opinions','id'), GREATEST((SELECT COALESCE(MAX(id),1) FROM assignment_opinions), 1))`);
    await pg.query(`SELECT setval(pg_get_serial_sequence('name_opinions','id'), GREATEST((SELECT COALESCE(MAX(id),1) FROM name_opinions), 1))`);
    await pg.query(`SELECT setval(pg_get_serial_sequence('validity_opinions','id'), GREATEST((SELECT COALESCE(MAX(id),1) FROM validity_opinions), 1))`);

    const anomalyCount = anomalyLog.flush();
    writeFileSync(RUN_SUMMARY, summary.text);
    console.log(summary.text);
    console.log(`  Wrote ${anomalyCount} anomaly rows to src/opinions-migration/anomalies.csv`);
    console.log(`  Wrote run summary to src/opinions-migration/run-summary.txt`);

    const elapsed = ((new Date() - startTime) / 1000).toFixed(1);
    console.log(`[${new Date().toISOString()}] opinions migration complete in ${elapsed}s`);
    return summary;
  } catch (err) {
    await pgClient.query('ROLLBACK').catch(() => {});
    pgClient.release();
    throw err;
  }
}

// Emit a concept-class name_opinions edge (shared by the concept-4 statuses and
// targeted nomen oblitum). parent_spelling_no = 0 is a skip: concept edges require
// a target (name_opinion_shape forbids a NULL target on concept edges).
function emitConcept(src, base, parentSpelling, childSpelling, subjectPermid, nameMap, reasonId, objective, label, c, logSkip, nameOpinions) {
  if (parentSpelling === 0) {
    c.skipped++;
    logSkip(src.opinion_no, 'name_opinions', 'parent_spelling_zero', `concept (${label}) edge skipped: parent_spelling_no is 0 (concept edges require a target)`);
    return;
  }
  const targetPermid = nameMap.get(parentSpelling);
  if (!targetPermid) {
    c.skipped++;
    logSkip(src.opinion_no, 'name_opinions', 'parent_spelling_orphan', `concept (${label}) edge skipped: parent_spelling_no=${src.parent_spelling_no} has no migrated permid`);
    return;
  }
  if (childSpelling === parentSpelling) {
    c.skipped++;
    logSkip(src.opinion_no, 'name_opinions', 'self_reference', `concept (${label}) edge skipped: child_spelling_no == parent_spelling_no (${src.child_spelling_no})`);
    return;
  }
  c.written++;
  nameOpinions.push({ permid: uuidv7(), ...base, subjectPermid, targetPermid, reasonId, edgeClass: 'concept', objective });
}

// ---------- Batched inserts ----------
async function insertAssignments(client, rows) {
  for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + INSERT_BATCH_SIZE);
    const values = []; const params = []; let p = 1;
    for (const r of batch) {
      values.push(`($${p},$${p+1},$${p+2},$${p+3},$${p+4},$${p+5},$${p+6},$${p+7},$${p+8},$${p+9},$${p+10})`);
      params.push(
        r.permid, r.authorizerPersonId, r.entererPersonId, r.subjectPermid, r.containingPermid,
        false, r.referenceId, r.publicationYear,
        r.attribution === null ? null : JSON.stringify(r.attribution), r.evidence, false,
      );
      p += 11;
    }
    await client.query(
      `INSERT INTO assignment_opinions
         (permid, authorizer_person_id, enterer_person_id, subject_permid, containing_permid,
          questioned, reference_id, publication_year, attribution, evidence, removed)
       VALUES ${values.join(',')}`,
      params,
    );
  }
}

async function insertNameOpinions(client, rows) {
  for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + INSERT_BATCH_SIZE);
    const values = []; const params = []; let p = 1;
    for (const r of batch) {
      values.push(`($${p},$${p+1},$${p+2},$${p+3},$${p+4},$${p+5},$${p+6},$${p+7},$${p+8},$${p+9},$${p+10},$${p+11},$${p+12},$${p+13},$${p+14},$${p+15},$${p+16})`);
      params.push(
        r.permid, r.authorizerPersonId, r.entererPersonId, null, r.subjectPermid,
        r.targetPermid, r.reasonId, r.edgeClass, r.objective, null, null, null,
        r.referenceId, r.publicationYear,
        r.attribution === null ? null : JSON.stringify(r.attribution), r.evidence, false,
      );
      p += 17;
    }
    await client.query(
      `INSERT INTO name_opinions
         (permid, authorizer_person_id, enterer_person_id, oldpbdb_taxon_no, subject_permid,
          target_permid, reason_id, edge_class, objective, new_name, rank_id, authority_id,
          reference_id, publication_year, attribution, evidence, removed)
       VALUES ${values.join(',')}`,
      params,
    );
  }
}

async function insertValidities(client, rows) {
  for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + INSERT_BATCH_SIZE);
    const values = []; const params = []; let p = 1;
    for (const r of batch) {
      values.push(`($${p},$${p+1},$${p+2},$${p+3},$${p+4},$${p+5},$${p+6},$${p+7},$${p+8},$${p+9})`);
      params.push(
        r.permid, r.authorizerPersonId, r.entererPersonId, r.subjectPermid, r.statusId,
        r.referenceId, r.publicationYear,
        r.attribution === null ? null : JSON.stringify(r.attribution), r.evidence, false,
      );
      p += 10;
    }
    await client.query(
      `INSERT INTO validity_opinions
         (permid, authorizer_person_id, enterer_person_id, subject_permid, nomenclatural_status_id,
          reference_id, publication_year, attribution, evidence, removed)
       VALUES ${values.join(',')}`,
      params,
    );
  }
}

// ---------- Run summary + reconciliation ----------
function buildSummary(startTime, sourceRows, anomalyBuckets) {
  const lines = [];
  lines.push(`opinions migration run summary — ${startTime.toISOString()}`);
  lines.push(`source rows read: ${sourceRows}`);
  lines.push('');
  lines.push('per-(pair, output) reconciliation (written + skipped == attempted):');

  let ok = true;
  const totals = {}; // outputKey → {attempted, written, skipped}
  for (const [pair, m] of [...recon.entries()].sort()) {
    for (const [key, c] of [...m.entries()].sort()) {
      const balanced = c.written + c.skipped === c.attempted;
      if (!balanced) ok = false;
      lines.push(`  ${pair} [${key}]: attempted=${c.attempted} written=${c.written} skipped=${c.skipped} ${balanced ? 'OK' : 'MISMATCH'}`);
      const t = totals[key] || (totals[key] = { attempted: 0, written: 0, skipped: 0 });
      t.attempted += c.attempted; t.written += c.written; t.skipped += c.skipped;
    }
  }

  lines.push('');
  lines.push('per-output totals:');
  for (const [key, t] of Object.entries(totals).sort()) {
    const balanced = t.written + t.skipped === t.attempted;
    if (!balanced) ok = false;
    lines.push(`  ${key}: attempted=${t.attempted} written=${t.written} skipped=${t.skipped} ${balanced ? 'OK' : 'MISMATCH'}`);
  }

  lines.push('');
  lines.push('anomaly buckets:');
  for (const [issue, n] of Object.entries(anomalyBuckets).sort()) lines.push(`  ${issue}: ${n}`);

  lines.push('');
  lines.push(`reconciliation invariant held: ${ok ? 'YES' : 'NO'}`);
  return { ok, text: lines.join('\n') + '\n', totals, sourceRows, anomalyBuckets };
}

// Only run main() when invoked directly, so the pure tables/helpers can be imported.
const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().then((summary) => {
    if (!summary || !summary.ok) process.exitCode = 1;
  }).catch((err) => {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  }).finally(() => closeAll());
}

export { main, CONCEPT, VALIDITY, CROSSWALK, MISTAGGED_LABEL_TO_TOKEN, MISTAGGED_STATUSES, KNOWN_STATUSES, loadMistaggedTokens };
