// Runs the nine migrations in a frozen order and asserts the database state that
// order exists to produce. The order is not a convenience: every step below reads
// from PostgreSQL what an earlier step wrote, and five of the nine duplicate their
// rows outright on a second run. See openspec/specs/migration-runner/spec.md.
//
//   node src/run-migrations.js [--createdb] [--from <step>] [--only <step>] [--list]
//
// Steps are spawned as child processes, never imported: five of the nine entry
// points call main() unconditionally at module load, so importing one to inspect it
// would run the migration as a side effect.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, '..');

// --- Environment groups -----------------------------------------------------

const ENV_GROUPS = {
  PG: ['PG_HOST', 'PG_USER', 'PG_PASSWORD', 'PG_DATABASE'],
  MARIADB: ['MARIADB_HOST', 'MARIADB_USER', 'MARIADB_PASSWORD', 'MARIADB_DATABASE'],
  PBOT: ['PBOT_TOKEN'],
};

// --- JSONB coverage expressions ---------------------------------------------
// The legacyIDs keys that link a migrated row back to its source system. Each is
// used both as a step's postcondition and as a later step's precondition.

const PBOT_ID = {
  persons: "person->'legacyIDs'->>'pbotID'",
  refs: "reference->'legacyIDs'->>'pbotID'",
};
const OLDPBDB_ID = {
  refs: "reference->'legacyIDs'->>'oldpbdbID'",
};

// --- Predicate vocabulary ---------------------------------------------------
// Each predicate is one COUNT(*) and reports its own observed value on failure.

const empty = (table) => ({
  describe: `${table} is empty`,
  sql: `SELECT COUNT(*)::int AS n FROM ${table}`,
  ok: (n) => n === 0,
  expected: 'a count of 0',
});

const nonEmpty = (table) => ({
  describe: `${table} is non-empty`,
  sql: `SELECT COUNT(*)::int AS n FROM ${table}`,
  ok: (n) => n > 0,
  expected: 'a count greater than 0',
});

const noneHave = (table, expr, label) => ({
  describe: `no ${table} row has ${label}`,
  sql: `SELECT COUNT(*)::int AS n FROM ${table} WHERE ${expr} IS NOT NULL`,
  ok: (n) => n === 0,
  expected: 'a count of 0',
});

const someHave = (table, expr, label) => ({
  describe: `at least one ${table} row has ${label}`,
  sql: `SELECT COUNT(*)::int AS n FROM ${table} WHERE ${expr} IS NOT NULL`,
  ok: (n) => n > 0,
  expected: 'a count greater than 0',
});

// --- The step table ---------------------------------------------------------
//
//   persons ──┬─▶ pbot-persons ──┐
//             │                  ├─▶ pbot-refs ──▶ pbot-schemas
//             └─▶ refs ──────────┤
//                                ├─▶ authorities ─▶ authorities-opinions ─▶ opinions
//                                └─▶ collections
//
// `firstWriterOf` is declared rather than derived positionally: persons, refs and
// name_opinions each have two writers, and deriving "first" from position would
// break the moment a step is inserted.

const STEPS = [
  {
    name: 'persons',
    script: 'src/persons-migration/migrate-persons.js',
    env: ['PG', 'MARIADB'],
    inputs: [],
    writes: ['persons'],
    firstWriterOf: ['persons'],
    preconditions: () => [empty('persons')],
  },
  {
    name: 'pbot-persons',
    script: 'src/pbot-persons-migration/migrate-pbot-persons.js',
    env: ['PG', 'PBOT'],
    inputs: [],
    writes: ['persons'],
    firstWriterOf: [],
    preconditions: () => [
      nonEmpty('persons'),
      noneHave('persons', PBOT_ID.persons, 'legacyIDs.pbotID'),
    ],
  },
  {
    name: 'refs',
    script: 'src/refs-migration/migrate-refs.js',
    env: ['PG', 'MARIADB'],
    inputs: [],
    writes: ['refs'],
    firstWriterOf: ['refs'],
    preconditions: () => [empty('refs'), nonEmpty('persons')],
  },
  {
    name: 'pbot-refs',
    script: 'src/pbot-refs-migration/migrate-pbot-refs.js',
    env: ['PG', 'PBOT'],
    inputs: [],
    writes: ['refs'],
    firstWriterOf: [],
    preconditions: () => [
      nonEmpty('refs'),
      noneHave('refs', PBOT_ID.refs, 'legacyIDs.pbotID'),
      someHave('persons', PBOT_ID.persons, 'legacyIDs.pbotID'),
    ],
  },
  {
    name: 'pbot-schemas',
    script: 'src/pbot-schemas-migration/migrate-pbot-schemas.js',
    env: ['PG', 'PBOT'],
    inputs: [],
    writes: ['schemas', 'characters', 'states', 'additional_schema_refs'],
    firstWriterOf: ['schemas', 'characters', 'states', 'additional_schema_refs'],
    // The pbotID-coverage predicates are borrowed from pbot-persons' and
    // pbot-refs' postconditions. They are the primary guard against this step's
    // documented failure: unresolved prerequisites are warned about, skipped, and
    // the process still exits 0.
    preconditions: () => [
      empty('schemas'),
      empty('characters'),
      empty('states'),
      someHave('persons', PBOT_ID.persons, 'legacyIDs.pbotID'),
      someHave('refs', PBOT_ID.refs, 'legacyIDs.pbotID'),
    ],
  },
  {
    name: 'authorities',
    script: 'migrate-authorities.js',
    env: ['PG', 'MARIADB'],
    inputs: [],
    writes: ['authorities'],
    firstWriterOf: ['authorities'],
    preconditions: () => [
      empty('authorities'),
      someHave('refs', OLDPBDB_ID.refs, 'legacyIDs.oldpbdbID'),
    ],
  },
  {
    name: 'authorities-opinions',
    script: 'migrate-authorities-opinions.js',
    env: ['PG', 'MARIADB'],
    inputs: [],
    writes: ['name_opinions'],
    firstWriterOf: ['name_opinions'],
    preconditions: () => [empty('name_opinions'), nonEmpty('authorities')],
  },
  {
    name: 'opinions',
    script: 'src/opinions-migration/migrate-opinions.js',
    env: ['PG', 'MARIADB'],
    inputs: ['mistagged-original-spelling.csv'],
    writes: ['assignment_opinions', 'name_opinions', 'validity_opinions'],
    firstWriterOf: ['assignment_opinions', 'validity_opinions'],
    // Inverted shape: this is name_opinions' second writer, so its prerequisite is
    // that the table is NON-empty, and its repeat-run guard is the two tables it
    // is the first writer of.
    preconditions: () => [
      empty('assignment_opinions'),
      empty('validity_opinions'),
      nonEmpty('name_opinions'),
      nonEmpty('refs'),
    ],
  },
  {
    name: 'collections',
    script: 'migrate-collections.js',
    env: ['PG', 'MARIADB'],
    inputs: [],
    writes: ['collections', 'additional_collection_refs'],
    firstWriterOf: ['collections', 'additional_collection_refs'],
    preconditions: () => [
      empty('collections'),
      empty('additional_collection_refs'),
      someHave('refs', OLDPBDB_ID.refs, 'legacyIDs.oldpbdbID'),
    ],
  },
];

const STEP_NAMES = STEPS.map((s) => s.name);

// Seeded by postgresql/create_new.sql. Every migration reads at least one of these,
// so an unseeded target fails partway through the pipeline rather than at the start.
const DICTIONARY_TABLES = [
  'genders', 'roles', 'interval_types', 'zone_types', 'taxonomy_ranks',
  'reference_types', 'book_types', 'parts_preserved', 'notable_features',
  'namechange_reasons', 'nomenclatural_statuses', 'admin0', 'admin1', 'maritime',
];

// --- Argument parsing -------------------------------------------------------

function fail(message) {
  console.error(`run-migrations: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { createdb: false, from: null, only: null, list: false };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--list') {
      opts.list = true;
    } else if (arg === '--createdb') {
      opts.createdb = true;
    } else if (arg === '--from' || arg === '--only') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) fail(`${arg} requires a step name`);
      opts[arg === '--from' ? 'from' : 'only'] = value;
      i++;
    } else if (arg.startsWith('--from=')) {
      opts.from = arg.slice('--from='.length);
    } else if (arg.startsWith('--only=')) {
      opts.only = arg.slice('--only='.length);
    } else {
      fail(`unrecognised argument '${arg}'. Valid flags: --createdb, --from <step>, --only <step>, --list`);
    }
  }
  return opts;
}

function validateArgs(opts) {
  if (opts.from && opts.only) {
    fail('--from and --only cannot be combined: --from runs a step through the end of the pipeline, --only runs exactly one step.');
  }

  for (const [flag, value] of [['--from', opts.from], ['--only', opts.only]]) {
    if (value && !STEP_NAMES.includes(value)) {
      fail(`${flag} '${value}' is not a step name. Valid steps, in run order:\n  ${STEP_NAMES.join('\n  ')}`);
    }
  }

  // --createdb yields an empty database; any selection past the first step asserts
  // that earlier steps have already run. The two cannot both be true.
  const selection = opts.from ? ['--from', opts.from] : opts.only ? ['--only', opts.only] : null;
  if (opts.createdb && selection && selection[1] !== 'persons') {
    fail(
      `--createdb cannot be combined with ${selection[0]} ${selection[1]}: --createdb initializes an empty ` +
      `database, while ${selection[0]} ${selection[1]} asserts that the preceding steps have already run.`
    );
  }
}

function selectSteps(opts) {
  if (opts.only) return STEPS.filter((s) => s.name === opts.only);
  if (opts.from) return STEPS.slice(STEP_NAMES.indexOf(opts.from));
  return STEPS;
}

// --- Predicate evaluation ---------------------------------------------------

class CheckFailure extends Error {}

async function evaluate(pg, predicate) {
  let rows;
  try {
    ({ rows } = await pg.query(predicate.sql));
  } catch (err) {
    if (err.code === '42P01') {
      throw new CheckFailure(
        `${predicate.describe} — could not be checked: ${err.message}. ` +
        `Has the schema been created? Use --createdb against an empty database.`
      );
    }
    throw err;
  }
  const observed = rows[0].n;
  if (!predicate.ok(observed)) {
    throw new CheckFailure(
      `${predicate.describe} — required ${predicate.expected}, observed ${observed}`
    );
  }
  return observed;
}

async function evaluateAll(pg, predicates, heading) {
  const failures = [];
  for (const predicate of predicates) {
    try {
      await evaluate(pg, predicate);
    } catch (err) {
      if (!(err instanceof CheckFailure)) throw err;
      failures.push(err.message);
    }
  }
  if (failures.length > 0) {
    throw new CheckFailure(`${heading}\n  ${failures.join('\n  ')}`);
  }
}

// --- pbot-schemas output verification ---------------------------------------
// That script warns, increments a skip counter, and still exits 0 when an enterer or
// primary reference cannot be resolved. Its final summary block is therefore parsed
// and a non-zero skip counter is treated as a failure. This is a backstop: the
// primary guard is the pbotID-coverage precondition borrowed from pbot-refs.

const PBOT_SUMMARY_LINES = [
  { kind: 'Schemas', re: /^\s*Schemas:\s+fetched=(\d+), inserted=(\d+), skipped=(\d+)/m, fields: ['fetched', 'inserted', 'skipped'] },
  { kind: 'Characters', re: /^\s*Characters:\s+fetched=(\d+), inserted=(\d+), orphans=(\d+), skipped=(\d+)/m, fields: ['fetched', 'inserted', 'orphans', 'skipped'] },
  { kind: 'States', re: /^\s*States:\s+fetched=(\d+), inserted=(\d+), orphans=(\d+), skipped=(\d+)/m, fields: ['fetched', 'inserted', 'orphans', 'skipped'] },
];

export function parsePbotSchemasSummary(stdout) {
  const parsed = {};
  const unmatched = [];
  for (const { kind, re, fields } of PBOT_SUMMARY_LINES) {
    const m = stdout.match(re);
    if (!m) { unmatched.push(kind); continue; }
    parsed[kind] = Object.fromEntries(fields.map((f, i) => [f, Number(m[i + 1])]));
  }
  // An unparseable summary is an unverified step, never an implied zero.
  if (unmatched.length > 0) {
    return { ok: false, parsed, reason: `summary block not found for: ${unmatched.join(', ')}` };
  }
  const skipped = Object.entries(parsed).filter(([, v]) => v.skipped > 0);
  if (skipped.length > 0) {
    return {
      ok: false,
      parsed,
      reason: `skipped rows reported: ${skipped.map(([k, v]) => `${k.toLowerCase()}=${v.skipped}`).join(', ')} ` +
              `— prerequisites were unresolved and the rows were silently dropped`,
    };
  }
  return { ok: true, parsed, reason: null };
}

// Orphans are a recorded outcome, not an unresolved prerequisite: reported, never fatal.
function pbotSchemasNotes(parsed) {
  return Object.entries(parsed)
    .filter(([, v]) => v.orphans > 0)
    .map(([k, v]) => `${k.toLowerCase()} orphans=${v.orphans}`);
}

// --- Preflight --------------------------------------------------------------

// 1. Environment, as the union over the SELECTED steps only, so --from authorities
//    does not demand PBOT_TOKEN.
function preflightEnv(selected) {
  const groups = new Set(selected.flatMap((s) => s.env));
  const required = [...groups].flatMap((g) => ENV_GROUPS[g]);
  const missing = required.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    throw new CheckFailure(
      `Preflight 1/5 (environment) failed. Missing for the selected steps:\n  ${missing.join('\n  ')}`
    );
  }
  console.log(`  1/5 environment      ok (${[...groups].sort().join(', ')})`);
  return groups;
}

// 5. Declared input files. Checked here, alongside the environment, because both are
//    local: a missing worklist should not cost a database connection, let alone six
//    completed steps.
async function preflightInputs(selected) {
  const { existsSync, accessSync, constants } = await import('node:fs');
  const declared = selected.flatMap((s) => s.inputs.map((i) => ({ step: s.name, path: i })));
  const bad = [];
  for (const { step, path } of declared) {
    const full = join(REPO_ROOT, path);
    if (!existsSync(full)) { bad.push(`${path} (required by ${step}) — not found at ${full}`); continue; }
    try { accessSync(full, constants.R_OK); } catch { bad.push(`${path} (required by ${step}) — not readable`); }
  }
  if (bad.length > 0) {
    throw new CheckFailure(`Preflight 5/5 (input files) failed:\n  ${bad.join('\n  ')}`);
  }
  console.log(`  5/5 input files      ok (${declared.length} declared)`);
}

// 2. Connectivity. MariaDB only if a selected step declares it.
async function preflightConnectivity(pg, groups) {
  try {
    await pg.query('SELECT 1');
  } catch (err) {
    // Creating the database, and installing the extensions create_new.sql assumes,
    // are both outside the runner. Say so rather than surfacing a bare driver error.
    if (err.code === '3D000') {
      throw new CheckFailure(
        `Preflight 2/5 (connectivity) failed: database "${process.env.PG_DATABASE}" does not exist.\n` +
        `  Creating the database is outside this runner. Create it, install PostGIS in it ` +
        `(createdb; psql -c 'CREATE EXTENSION postgis'), then re-run with --createdb.`
      );
    }
    throw new CheckFailure(`Preflight 2/5 (connectivity) failed: ${err.message}`);
  }
  let mariadbClosed = null;
  if (groups.has('MARIADB')) {
    const { mariadb, closeMariadb } = await import('./lib/mariadb-pool.js');
    const conn = await mariadb.getConnection();
    conn.release();
    mariadbClosed = closeMariadb;
  }
  console.log(`  2/5 connectivity     ok (postgres${groups.has('MARIADB') ? ' + mariadb' : ''})`);
  return mariadbClosed;
}

// 3. Dictionaries: all 14 exist and are seeded.
async function preflightDictionaries(pg) {
  const { rows } = await pg.query(
    `SELECT c.relname AS name
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'dictionaries' AND c.relkind = 'r'`
  );
  const present = new Set(rows.map((r) => r.name));
  const problems = DICTIONARY_TABLES.filter((t) => !present.has(t)).map((t) => `dictionaries.${t} — does not exist`);
  for (const t of DICTIONARY_TABLES.filter((t) => present.has(t))) {
    const { rows: [{ n }] } = await pg.query(`SELECT COUNT(*)::int AS n FROM dictionaries.${t}`);
    if (n === 0) problems.push(`dictionaries.${t} — exists but is empty`);
  }
  if (problems.length > 0) {
    throw new CheckFailure(`Preflight 3/5 (dictionaries) failed:\n  ${problems.join('\n  ')}`);
  }
  console.log(`  3/5 dictionaries     ok (${DICTIONARY_TABLES.length} tables seeded)`);
}

// 4. Every table a selected step is the FIRST writer of is empty. This is what
//    stops a silent double-load of the five non-idempotent steps.
async function preflightFirstWriterEmpty(pg, selected) {
  const tables = [...new Set(selected.flatMap((s) => s.firstWriterOf))];
  await evaluateAll(pg, tables.map(empty), 'Preflight 4/5 (first-writer tables must be empty) failed:');
  console.log(`  4/5 target tables    ok (${tables.length} empty)`);
}

// --- Spawn and postconditions -----------------------------------------------

async function countTables(pg, tables) {
  const counts = {};
  for (const t of tables) {
    const { rows: [{ n }] } = await pg.query(`SELECT COUNT(*)::int AS n FROM ${t}`);
    counts[t] = n;
  }
  return counts;
}

// Spawned, never imported: five of the nine entry points call main() at module load,
// so importing one would run the migration as a side effect of the import.
function spawnStep(step) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(REPO_ROOT, step.script)], {
      cwd: REPO_ROOT,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    child.stdout.on('data', (d) => { stdout += d; process.stdout.write(d); });
    child.stderr.on('data', (d) => { stdout += d; process.stderr.write(d); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout }));
  });
}

// A step's own stdout is not copied into the log: migrate-opinions.js alone warns
// per record across 517K rows, which would bury the counts. Summary values plus a
// capped sample of WARNING lines instead.
const WARNING_SAMPLE_LIMIT = 20;

function sampleWarnings(stdout) {
  const all = stdout.split('\n').filter((l) => /WARNING:/.test(l)).map((l) => l.trim());
  if (all.length === 0) return [];
  const kept = all.slice(0, WARNING_SAMPLE_LIMIT);
  if (all.length > kept.length) kept.push(`... ${all.length - kept.length} further WARNING line(s) suppressed`);
  return kept;
}

// `records` is passed in so a step that fails still reaches the run log.
async function runStep(pg, step, records) {
  const record = { step: step.name, script: step.script, startedAt: new Date().toISOString() };

  await evaluateAll(pg, step.preconditions(), `Precondition failed for step '${step.name}':`);
  console.log(`  preconditions ok (${step.preconditions().length} checks)`);

  const before = await countTables(pg, step.writes);
  const { code, stdout } = await spawnStep(step);
  const after = await countTables(pg, step.writes);

  record.endedAt = new Date().toISOString();
  record.exitCode = code;
  record.counts = Object.fromEntries(
    step.writes.map((t) => [t, { before: before[t], after: after[t], delta: after[t] - before[t] }])
  );
  record.warnings = sampleWarnings(stdout);
  records.push(record);

  if (code !== 0) {
    throw new CheckFailure(`Step '${step.name}' exited ${code}.`);
  }

  // Exit code 0 is necessary but not sufficient.
  const stalled = step.writes.filter((t) => after[t] - before[t] <= 0);
  if (stalled.length > 0) {
    throw new CheckFailure(
      `Step '${step.name}' exited 0 but wrote no rows to: ${stalled.join(', ')} ` +
      `(${stalled.map((t) => `${t} ${before[t]}→${after[t]}`).join(', ')})`
    );
  }

  if (step.name === 'pbot-schemas') {
    const summary = parsePbotSchemasSummary(stdout);
    record.pbotSummary = summary.parsed;
    if (!summary.ok) {
      throw new CheckFailure(`Step 'pbot-schemas' exited 0 but failed output verification: ${summary.reason}`);
    }
    record.notes = pbotSchemasNotes(summary.parsed);
    if (record.notes.length > 0) console.log(`  note: ${record.notes.join(', ')} (recorded, not fatal)`);
  }

  console.log(`  ${step.writes.map((t) => `${t} +${record.counts[t].delta}`).join(', ')}`);
}

// --- --createdb -------------------------------------------------------------
// postgresql/create_new.sql has no psql meta-commands, no COPY, and no explicit
// BEGIN/COMMIT, so PostgreSQL runs the whole file as one implicit transaction: it
// lands complete or rolls back to an empty database. Shelling out to psql would
// need an external binary and a separately built connection string, and would leave
// a half-built schema on failure.
//
// It has no top-level DROP and begins with a bare `CREATE SCHEMA dictionaries`, so
// applying it to a populated database fails before any row is touched. The flag
// initializes an empty database; it does not reset a populated one.
async function applyCreateDb(pg) {
  const { readFileSync } = await import('node:fs');
  const sqlPath = join(REPO_ROOT, 'postgresql', 'create_new.sql');
  console.log(`\nApplying ${sqlPath} as a single transaction...`);
  let sql;
  try {
    sql = readFileSync(sqlPath, 'utf8');
  } catch (err) {
    throw new CheckFailure(`--createdb could not read ${sqlPath}: ${err.message}`);
  }
  try {
    await pg.query(sql);
  } catch (err) {
    const populated = err.code === '42P06' || /already exists/i.test(err.message || '');
    throw new CheckFailure(
      `--createdb failed: ${err.message}\n` +
      `  The script ran as one implicit transaction, so it rolled back completely — ` +
      `the database was not left half-built.` +
      (populated
        ? `\n  This database already has the schema. --createdb initializes an EMPTY database; ` +
          `it does not reset a populated one. Drop and recreate the database first, or omit --createdb.`
        : '')
    );
  }
  console.log('  schema and dictionary seeds applied');
}

// --- Run log ----------------------------------------------------------------
// Appended, never overwritten: the log's value is diffing a failed run against the
// last good one. Summary values plus WARNING lines rather than full stdout, which on
// a 517K-row step would bury the numbers.
async function writeRunLog(header, records, outcome) {
  const { appendFileSync } = await import('node:fs');
  const lines = [];
  lines.push('='.repeat(78));
  lines.push(`run started ${header.startedAt}`);
  lines.push(`argv        ${header.argv.join(' ') || '(none)'}`);
  for (const r of records) {
    lines.push(`--- ${r.step}  (${r.script})`);
    lines.push(`    ${r.startedAt} → ${r.endedAt}   exit=${r.exitCode}`);
    for (const [table, c] of Object.entries(r.counts || {})) {
      lines.push(`    ${table.padEnd(28)} ${c.before} → ${c.after}   delta ${c.delta >= 0 ? '+' : ''}${c.delta}`);
    }
    for (const [kind, v] of Object.entries(r.pbotSummary || {})) {
      lines.push(`    ${kind.padEnd(28)} ${Object.entries(v).map(([k, n]) => `${k}=${n}`).join(', ')}`);
    }
    for (const w of r.warnings || []) lines.push(`    ${w}`);
  }
  lines.push(`outcome     ${outcome}`);
  lines.push(`run ended   ${new Date().toISOString()}`);
  lines.push('');
  try {
    appendFileSync(join(SCRIPT_DIR, 'run-migrations.log'), lines.join('\n') + '\n');
  } catch (err) {
    console.error(`  (could not append to run-migrations.log: ${err.message})`);
  }
}

// --- Entry point ------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  // --list is answered before anything else is loaded: no .env, no pool, no
  // connection. Every heavier import below is dynamic for the same reason.
  if (opts.list) {
    for (const name of STEP_NAMES) console.log(name);
    return 0;
  }

  validateArgs(opts);
  const selected = selectSteps(opts);

  console.log(`Steps selected (${selected.length}): ${selected.map((s) => s.name).join(', ')}`);
  console.log('Preflight:');

  // dotenv before any env inspection, and before pg-pool.js runs its own check.
  await import('dotenv/config');

  const groups = preflightEnv(selected);
  await preflightInputs(selected);

  const { pg, closePg } = await import('./lib/pg-pool.js');
  let closeMariadb = null;
  const records = [];

  const header = { startedAt: new Date().toISOString(), argv: process.argv.slice(2) };
  let outcome = 'incomplete';

  try {
    closeMariadb = await preflightConnectivity(pg, groups);

    // --createdb precedes the dictionary and emptiness checks: it is what makes
    // them pass on a green-field database.
    if (opts.createdb) await applyCreateDb(pg);

    await preflightDictionaries(pg);
    await preflightFirstWriterEmpty(pg, selected);

    // Halt on the first failure: every later step consumes state an earlier one
    // produces, so a second failure would only be noise caused by the first.
    for (const step of selected) {
      console.log(`\n=== ${step.name} ===`);
      await runStep(pg, step, records);
    }
    outcome = `success — ${records.length} step(s) completed`;
    console.log(`\nAll ${records.length} step(s) completed.`);
    return 0;
  } catch (err) {
    outcome = `FAILED — ${err instanceof CheckFailure ? err.message.split('\n')[0] : err.message}`;
    throw err;
  } finally {
    await writeRunLog(header, records, outcome);
    await closePg();
    if (closeMariadb) await closeMariadb();
  }
}

// Only run when invoked directly, so the pure helpers above can be imported by the
// harness in tests/ without starting a pipeline.
const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) main()
  .then((code) => { process.exitCode = code; })
  .catch((err) => {
    if (err instanceof CheckFailure) {
      console.error(`\nrun-migrations: ${err.message}`);
    } else {
      console.error('\nrun-migrations failed:', err);
    }
    process.exitCode = 1;
  });
