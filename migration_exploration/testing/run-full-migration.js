// Turns pg_play into a full, real migration target: copies ALL of persons/refs/
// authorities/name_opinions(root) from pg_migrated (read-only) into pg_play --
// not a sampled closure, the whole dependency layer -- then runs each of the 48
// real, UNMODIFIED pair handlers over its FULL (status, spelling_reason) slice
// (via db.js's MIGRATION_TEST_MODE shim, full-run mode: no opinion_no filter,
// keyset-paginated so memory stays bounded even for belongs-to/original-spelling's
// 743,712 rows).
//
// Stops immediately (leaving pg_play's state as-is for inspection) the first
// time a handler exits non-zero. Expected skip-and-log conditions inside a
// handler are not failures -- only a thrown/uncaught error or a FATAL exit is.
import { pgMigrated, closePgMigrated } from '../../pg-migrated-pool.js';
import { pgPlay, closePgPlay } from '../../pg-play-pool.js';
import { spawn } from 'node:child_process';
import { PAIRS, REPO_ROOT } from './pairs.js';

const SOURCE_PAGE_SIZE = 5000;
const INSERT_BATCH_SIZE = 1000;

const RESET_TABLES = [
  'persons', 'refs', 'authorities', 'name_opinions',
  'assignment_opinions', 'validity_opinions', 'taxa',
];

async function resetPlay() {
  console.log(`[${new Date().toISOString()}] Resetting pg_play (${RESET_TABLES.join(', ')})...`);
  await pgPlay.query(`TRUNCATE ${RESET_TABLES.join(', ')} RESTART IDENTITY CASCADE`);
  console.log('  Truncated. (CASCADE only reaches tables that reference these -- verified empty otherwise as of the last check.)');
}

// Reads the full source table from pg_migrated in pages (keyset on id, bounds
// memory), writing each page to pg_play in batches. `toParams` maps one source
// row to the positional params for `insertSql`; jsonb columns must already be
// JSON.stringify'd by the caller's toParams.
async function copyTable({ table, insertSql, toParams }) {
  let lastId = 0;
  let total = 0;
  while (true) {
    const { rows } = await pgMigrated(
      `SELECT * FROM ${table} WHERE id > $1 ORDER BY id LIMIT $2`,
      [lastId, SOURCE_PAGE_SIZE],
    );
    if (rows.length === 0) break;

    for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
      const batch = rows.slice(i, i + INSERT_BATCH_SIZE);
      const paramRows = batch.map(toParams);
      const width = paramRows[0].length;
      const values = paramRows
        .map((_, r) => `(${Array.from({ length: width }, (_, c) => `$${r * width + c + 1}`).join(',')})`)
        .join(',');
      await pgPlay.query(`${insertSql} VALUES ${values} ON CONFLICT (id) DO NOTHING`, paramRows.flat());
    }

    total += rows.length;
    lastId = Number(rows[rows.length - 1].id);
    if (rows.length < SOURCE_PAGE_SIZE) break;
  }
  console.log(`  Copied ${total} rows into ${table}.`);
  return total;
}

async function copyDependencies() {
  console.log(`[${new Date().toISOString()}] Copying full dependency layer from pg_migrated into pg_play...`);

  await copyTable({
    table: 'persons',
    insertSql: `INSERT INTO persons (id, password, role_id, person, authorizer_person_id, active, total_hours)`,
    toParams: (p) => [p.id, p.password, p.role_id, JSON.stringify(p.person), p.authorizer_person_id, p.active, p.total_hours],
  });

  await copyTable({
    table: 'refs',
    insertSql: `INSERT INTO refs (id, permid, reference_type_id, authorizer_person_id, enterer_person_id, reference, preceded_by_id, succeeded_by_id, removed)`,
    toParams: (r) => [r.id, r.permid, r.reference_type_id, r.authorizer_person_id, r.enterer_person_id,
      JSON.stringify(r.reference), r.preceded_by_id, r.succeeded_by_id, r.removed],
  });

  await copyTable({
    table: 'authorities',
    insertSql: `INSERT INTO authorities (id, permid, authorizer_person_id, enterer_person_id, authority, reference_id, preceded_by_id, succeeded_by_id, removed)`,
    toParams: (a) => [a.id, a.permid, a.authorizer_person_id, a.enterer_person_id,
      JSON.stringify(a.authority), a.reference_id, a.preceded_by_id, a.succeeded_by_id, a.removed],
  });

  // name_opinions holds root + lineage + concept rows; only root (identity) rows
  // are a dependency here -- the handlers themselves create the rest.
  let lastId = 0;
  let total = 0;
  while (true) {
    const { rows } = await pgMigrated(
      `SELECT * FROM name_opinions WHERE id > $1 AND edge_class = 'root' ORDER BY id LIMIT $2`,
      [lastId, SOURCE_PAGE_SIZE],
    );
    if (rows.length === 0) break;

    for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
      const batch = rows.slice(i, i + INSERT_BATCH_SIZE);
      const paramRows = batch.map((n) => [
        n.id, n.permid, n.authorizer_person_id, n.enterer_person_id, n.oldpbdb_taxon_no,
        n.subject_permid, n.target_permid, n.reason_id, n.edge_class, n.objective,
        n.new_name, n.rank_id, n.authority_id, n.reference_id, n.publication_year,
        n.attribution === null ? null : JSON.stringify(n.attribution), n.evidence, n.removed,
        n.preceded_by_id, n.succeeded_by_id,
      ]);
      const width = paramRows[0].length;
      const values = paramRows
        .map((_, r) => `(${Array.from({ length: width }, (_, c) => `$${r * width + c + 1}`).join(',')})`)
        .join(',');
      await pgPlay.query(
        `INSERT INTO name_opinions (id, permid, authorizer_person_id, enterer_person_id, oldpbdb_taxon_no,
           subject_permid, target_permid, reason_id, edge_class, objective, new_name, rank_id, authority_id,
           reference_id, publication_year, attribution, evidence, removed, preceded_by_id, succeeded_by_id)
         VALUES ${values} ON CONFLICT (id) DO NOTHING`,
        paramRows.flat(),
      );
    }

    total += rows.length;
    lastId = Number(rows[rows.length - 1].id);
    // LIMIT counts matching (root) rows, not raw rows scanned, so a
    // short page here really does mean no root rows remain past lastId.
    if (rows.length < SOURCE_PAGE_SIZE) break;
  }
  console.log(`  Copied ${total} rows into name_opinions (root only).`);

  for (const t of ['persons', 'refs', 'authorities', 'name_opinions']) {
    await pgPlay.query(`SELECT setval(pg_get_serial_sequence('${t}','id'), (SELECT COALESCE(MAX(id), 1) FROM ${t}))`);
  }
  console.log('  Identity sequences reset.');
}

async function runHandler(pair) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [pair.path], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      env: { ...process.env, MIGRATION_TEST_MODE: '1' }, // no MIGRATION_TEST_OPINION_NOS -> full-run mode
    });
    child.on('exit', (code) => resolve(code));
  });
}

async function main() {
  const startTime = new Date();
  await resetPlay();
  await copyDependencies();

  console.log(`[${new Date().toISOString()}] Running all 48 handlers over their FULL scope...`);

  for (let i = 0; i < PAIRS.length; i++) {
    const pair = PAIRS[i];
    const pairStart = new Date();
    console.log('');
    console.log(`--- [${i + 1}/${PAIRS.length}] ${pair.folder}/${pair.file}.js (status='${pair.status}', spelling_reason='${pair.spellingReason}') ---`);

    const exitCode = await runHandler(pair);
    const pairElapsed = ((new Date() - pairStart) / 1000).toFixed(1);

    if (exitCode !== 0) {
      console.error('');
      console.error(`STOPPED: ${pair.folder}/${pair.file}.js exited with code ${exitCode} after ${pairElapsed}s.`);
      console.error('  pg_play left as-is for inspection.');
      process.exitCode = 1;
      return;
    }
    console.log(`  (${pairElapsed}s)`);
  }

  const elapsed = ((new Date() - startTime) / 1000).toFixed(1);
  console.log('');
  console.log(`[${new Date().toISOString()}] All 48 pairs completed with no failures. Total: ${elapsed}s.`);

  const { rows: counts } = await pgPlay.query(`
    SELECT 'assignment_opinions' AS t, count(*) FROM assignment_opinions
    UNION ALL SELECT 'validity_opinions', count(*) FROM validity_opinions
    UNION ALL SELECT 'name_opinions (root)', count(*) FROM name_opinions WHERE edge_class = 'root'
    UNION ALL SELECT 'name_opinions (name)', count(*) FROM name_opinions WHERE edge_class = 'name'
    UNION ALL SELECT 'name_opinions (concept)', count(*) FROM name_opinions WHERE edge_class = 'concept'
  `);
  console.log('  Final pg_play counts:');
  for (const r of counts) console.log(`    ${r.t}: ${r.count}`);
}

main()
  .catch((err) => {
    console.error('Full migration runner failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePgPlay();
    await closePgMigrated();
  });
