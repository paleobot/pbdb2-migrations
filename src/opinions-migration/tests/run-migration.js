// Test harness for migrate-opinions.js. Rebuilt from the design of
// migration_exploration/testing/seed-and-run-sample.js + run-full-migration.js,
// but targeting the real localhost `pg` (per .env) and driving the single
// migrate-opinions.js script rather than spawning 48 handlers.
//
// Two modes:
//   --sample [--size N]   fast: migrate up to N real opinions per (status,
//                         spelling_reason) pair, atop the already-migrated root
//                         name_opinions, into a freshly-cleared output slate.
//   --full                reset the opinion output tables + dictionaries from
//                         reset-opinions.sql, re-mint the root name_opinions from
//                         authorities, then migrate every opinion.
//
// After the run it asserts the reconciliation invariant and a battery of
// spec-derived structural scenarios (specs/opinions-migration/spec.md).
import { mariadb, pg, closeAll } from '../../lib/db.js';
import { main as migrateOpinions } from '../migrate-opinions.js';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, '..', '..', '..');
const RESET_SQL = join(REPO_ROOT, 'reset-opinions.sql');
const AUTHORITIES_OPINIONS = join(REPO_ROOT, 'migrate-authorities-opinions.js');

// The 10 statuses × their attested spelling_reasons, mirroring the exploration
// handler folders. Used to draw a stratified sample (a few opinions per pair).
const PAIRS = [
  ['belongs to', 'original spelling'], ['belongs to', 'correction'], ['belongs to', 'rank change'],
  ['belongs to', 'recombination'], ['belongs to', 'reassignment'], ['belongs to', 'misspelling'],
  ['subjective synonym of', 'original spelling'], ['subjective synonym of', 'correction'],
  ['subjective synonym of', 'rank change'], ['subjective synonym of', 'recombination'],
  ['subjective synonym of', 'reassignment'], ['subjective synonym of', 'misspelling'],
  ['objective synonym of', 'original spelling'], ['objective synonym of', 'recombination'],
  ['invalid subgroup of', 'original spelling'], ['invalid subgroup of', 'recombination'],
  ['replaced by', 'original spelling'], ['replaced by', 'recombination'],
  ['nomen dubium', 'original spelling'], ['nomen dubium', 'recombination'],
  ['nomen nudum', 'original spelling'], ['nomen vanum', 'original spelling'],
  ['nomen oblitum', 'original spelling'], ['nomen oblitum', 'recombination'],
  ['nomen oblitum', 'correction'], ['nomen oblitum', 'misspelling'],
  ['misspelling of', 'misspelling'],
];

function parseArgs(argv) {
  const args = { mode: 'sample', size: 3 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--full') args.mode = 'full';
    else if (argv[i] === '--sample') args.mode = 'sample';
    else if (argv[i] === '--size') args.size = parseInt(argv[++i], 10);
  }
  return args;
}

function run(cmd, cmdArgs, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, cmdArgs, { cwd, stdio: 'inherit' });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${cmdArgs.join(' ')} exited ${code}`))));
  });
}

async function assertRootsPresent() {
  const { rows } = await pg.query(`SELECT COUNT(*)::int AS n FROM name_opinions WHERE edge_class = 'root'`);
  if (rows[0].n === 0) {
    throw new Error("no root name_opinions present — run with --full first (or run migrate-authorities-opinions.js) to seed the dependency layer");
  }
  return rows[0].n;
}

// --sample: keep the root name_opinions, clear only the opinion-migration outputs
// so the sample lands on a clean slate and its reconciliation is unambiguous.
async function clearOutputsKeepingRoots() {
  console.log('  Clearing opinion-migration outputs (keeping root name_opinions)...');
  await pg.query(`DELETE FROM assignment_opinions`);
  await pg.query(`DELETE FROM validity_opinions`);
  await pg.query(`DELETE FROM name_opinions WHERE edge_class IN ('concept', 'name')`);
}

// --full: drop+recreate the opinion tables + dictionaries from the schema
// authority, then re-mint the root name_opinions from the already-migrated
// authorities before the opinions migration reads those permids.
async function resetAndReseedFull() {
  console.log(`  Applying ${RESET_SQL} ...`);
  await run('psql', [dbUrl(), '-v', 'ON_ERROR_STOP=1', '-f', RESET_SQL], REPO_ROOT);
  console.log(`  Re-minting root name_opinions from authorities (${AUTHORITIES_OPINIONS}) ...`);
  await run(process.execPath, [AUTHORITIES_OPINIONS], REPO_ROOT);
}

function dbUrl() {
  const { PG_USER, PG_PASSWORD, PG_HOST, PG_PORT, PG_DATABASE } = process.env;
  return `postgresql://${PG_USER}:${encodeURIComponent(PG_PASSWORD)}@${PG_HOST}:${PG_PORT || 5432}/${PG_DATABASE}`;
}

async function sampleOpinionNos(size) {
  const chosen = [];
  for (const [status, spellingReason] of PAIRS) {
    const [rows] = await mariadb.query(
      `SELECT opinion_no FROM opinions WHERE status = ? AND spelling_reason = ? ORDER BY RAND() LIMIT ?`,
      [status, spellingReason, size],
    );
    for (const r of rows) chosen.push(Number(r.opinion_no));
    if (rows.length === 0) console.warn(`  (no source rows for ${status} / ${spellingReason})`);
  }
  return chosen;
}

// ---------- Spec-derived scenario assertions (specs/opinions-migration/spec.md) ----------
async function verifyScenarios(summary) {
  const failures = [];
  const check = (name, cond, detail) => { if (!cond) failures.push(`${name}: ${detail}`); else console.log(`  ✓ ${name}`); };

  // Reconciliation invariant held (the core guarantee).
  check('reconciliation invariant held', summary.ok, 'run summary reports a MISMATCH');

  // Self-referential edges are never written (spec: "Self-referential edges are never written").
  const selfAssign = (await pg.query(`SELECT COUNT(*)::int AS n FROM assignment_opinions WHERE subject_permid = containing_permid`)).rows[0].n;
  const selfName = (await pg.query(`SELECT COUNT(*)::int AS n FROM name_opinions WHERE subject_permid = target_permid`)).rows[0].n;
  check('no self-referential assignment edges', selfAssign === 0, `${selfAssign} found`);
  check('no self-referential name_opinions edges', selfName === 0, `${selfName} found`);

  // Rootless assignment → NULL containing_permid, and that is the ONLY source of NULL
  // (unresolvable parents are skipped, never written as NULL). So the count of NULL
  // containing_permid rows equals the asserted_rootless warning count.
  const nullContaining = (await pg.query(`SELECT COUNT(*)::int AS n FROM assignment_opinions WHERE containing_permid IS NULL`)).rows[0].n;
  const assertedRootless = summary.anomalyBuckets.asserted_rootless || 0;
  check('rootless→NULL matches asserted_rootless warnings', nullContaining === assertedRootless,
    `${nullContaining} NULL-containing rows vs ${assertedRootless} asserted_rootless warnings`);

  // Concept/name edges always carry a target; validity rows a status (shape/NOT NULL
  // constraints guarantee this — assert anyway as a spec-scenario smoke check).
  const conceptNoTarget = (await pg.query(`SELECT COUNT(*)::int AS n FROM name_opinions WHERE edge_class IN ('concept','name') AND target_permid IS NULL`)).rows[0].n;
  check('every concept/name edge has a target', conceptNoTarget === 0, `${conceptNoTarget} without target`);

  // objective is set only for junior-synonym concept edges; NULL for every other reason.
  const objOnNonSynonym = (await pg.query(`
    SELECT COUNT(*)::int AS n FROM name_opinions no
    JOIN dictionaries.namechange_reasons r ON r.id = no.reason_id
    WHERE no.objective IS NOT NULL AND r.reason <> 'junior synonym'`)).rows[0].n;
  check('objective set only for junior synonym', objOnNonSynonym === 0, `${objOnNonSynonym} non-synonym edges carry objective`);

  // historical misspelling edges exist iff misspelling-of source rows were migrated;
  // and they are name-class (spec: misspelling of produces ONLY a name edge).
  const histMisspell = (await pg.query(`
    SELECT COUNT(*)::int AS n FROM name_opinions no
    JOIN dictionaries.namechange_reasons r ON r.id = no.reason_id
    WHERE r.reason = 'historical misspelling' AND no.edge_class = 'name'`)).rows[0].n;
  const histWritten = (summary.totals.historical_misspelling || {}).written || 0;
  check('historical-misspelling edges match summary', histMisspell === histWritten,
    `${histMisspell} in DB vs ${histWritten} written`);

  // Per-disposition written counts (from the run summary) match independent GROUP BY
  // counts of the DB rows, table by table.
  const dbAssign = (await pg.query(`SELECT COUNT(*)::int AS n FROM assignment_opinions`)).rows[0].n;
  const dbValidity = (await pg.query(`SELECT COUNT(*)::int AS n FROM validity_opinions`)).rows[0].n;
  const dbConcept = (await pg.query(`SELECT COUNT(*)::int AS n FROM name_opinions WHERE edge_class = 'concept'`)).rows[0].n;
  const dbName = (await pg.query(`SELECT COUNT(*)::int AS n FROM name_opinions WHERE edge_class = 'name'`)).rows[0].n;
  const t = summary.totals;
  const wAssign = (t.assignment || {}).written || 0;
  const wValidity = (t.validity || {}).written || 0;
  const wConcept = (t.concept || {}).written || 0;
  const wName = ((t.name || {}).written || 0) + ((t.historical_misspelling || {}).written || 0);
  check('assignment_opinions count matches summary', dbAssign === wAssign, `${dbAssign} vs ${wAssign}`);
  check('validity_opinions count matches summary', dbValidity === wValidity, `${dbValidity} vs ${wValidity}`);
  check('name_opinions concept count matches summary', dbConcept === wConcept, `${dbConcept} vs ${wConcept}`);
  check('name_opinions name count matches summary', dbName === wName, `${dbName} vs ${wName}`);

  // The retired 'lineage' edge_class is gone everywhere: no opinion row carries it, and
  // the dictionary admits exactly the three current classes (spec: taxa-opinions, "No
  // dictionary row carries the retired 'lineage' class" / "The retired 'lineage' token is
  // not accepted").
  const staleClass = (await pg.query(`SELECT COUNT(*)::int AS n FROM name_opinions WHERE edge_class = 'lineage'`)).rows[0].n;
  check("no name_opinions row carries the retired 'lineage' class", staleClass === 0, `${staleClass} rows still 'lineage'`);
  const dictClasses = (await pg.query(`SELECT edge_class, COUNT(*)::int AS n FROM dictionaries.namechange_reasons GROUP BY edge_class ORDER BY edge_class`)).rows;
  const classNames = dictClasses.map((r) => r.edge_class).join(',');
  check('namechange_reasons has exactly the three current edge_class values',
    classNames === 'concept,name,root', `got: ${classNames}`);
  const nameReasons = (dictClasses.find((r) => r.edge_class === 'name') || {}).n || 0;
  check('six namechange_reasons tokens are name-class', nameReasons === 6, `${nameReasons} name-class reasons`);

  if (failures.length) {
    console.error('\n  SCENARIO FAILURES:');
    for (const f of failures) console.error(`    ✗ ${f}`);
    throw new Error(`${failures.length} scenario assertion(s) failed`);
  }
  console.log('  All scenario assertions passed.');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`[${new Date().toISOString()}] opinions harness — mode=${args.mode}${args.mode === 'sample' ? ` size=${args.size}` : ''}`);

  let sampleWhere;
  if (args.mode === 'full') {
    await resetAndReseedFull();
  } else {
    await assertRootsPresent();
    await clearOutputsKeepingRoots();
    const opinionNos = await sampleOpinionNos(args.size);
    if (opinionNos.length === 0) throw new Error('sampled 0 opinions');
    console.log(`  Sampled ${opinionNos.length} opinions across ${PAIRS.length} pairs.`);
    sampleWhere = `opinion_no IN (${opinionNos.join(',')})`;
  }

  const summary = await migrateOpinions(sampleWhere ? { sampleWhere } : {});
  console.log('\n=== Verifying scenarios ===');
  await verifyScenarios(summary);
  console.log(`\n[${new Date().toISOString()}] harness passed (${args.mode}).`);
}

main()
  .catch((err) => {
    console.error('Harness failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => closeAll());
