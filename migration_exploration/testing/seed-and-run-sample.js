// Empirical test: sample a handful of real opinions per (status, spelling_reason)
// pair from pg_classic (read-only), seed just enough of persons/refs/authorities/
// name_opinions into pg_play by copying already-correct rows from pg_migrated
// (read-only), then run each of the 48 real, UNMODIFIED pair handlers -- via
// db.js's MIGRATION_TEST_MODE shim -- against that scoped sample.
//
// Stops immediately (leaving pg_play's state as-is for inspection) the first
// time a handler exits non-zero. Expected skip-and-log conditions inside a
// handler are not failures -- only a thrown/uncaught error or a FATAL exit is.
import { pgClassic, closePgClassic } from '../../pg-classic-pool.js';
import { pgMigrated, closePgMigrated } from '../../pg-migrated-pool.js';
import { pgPlay, closePgPlay } from '../../pg-play-pool.js';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SAMPLE_PER_PAIR = 5;
const REPO_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const SENTINEL_PERSON_ID = 1; // lib/identity.js's 0-sentinel fallback target

const PAIRS = [
  ['belongs-to', 'original-spelling', 'belongs to', 'original spelling'],
  ['belongs-to', 'recombination', 'belongs to', 'recombination'],
  ['belongs-to', 'correction', 'belongs to', 'correction'],
  ['belongs-to', 'misspelling', 'belongs to', 'misspelling'],
  ['belongs-to', 'rank-change', 'belongs to', 'rank change'],
  ['belongs-to', 'reassignment', 'belongs to', 'reassignment'],
  ['subjective-synonym-of', 'original-spelling', 'subjective synonym of', 'original spelling'],
  ['subjective-synonym-of', 'correction', 'subjective synonym of', 'correction'],
  ['subjective-synonym-of', 'rank-change', 'subjective synonym of', 'rank change'],
  ['subjective-synonym-of', 'recombination', 'subjective synonym of', 'recombination'],
  ['subjective-synonym-of', 'misspelling', 'subjective synonym of', 'misspelling'],
  ['subjective-synonym-of', 'reassignment', 'subjective synonym of', 'reassignment'],
  ['objective-synonym-of', 'original-spelling', 'objective synonym of', 'original spelling'],
  ['objective-synonym-of', 'correction', 'objective synonym of', 'correction'],
  ['objective-synonym-of', 'rank-change', 'objective synonym of', 'rank change'],
  ['objective-synonym-of', 'recombination', 'objective synonym of', 'recombination'],
  ['objective-synonym-of', 'misspelling', 'objective synonym of', 'misspelling'],
  ['invalid-subgroup-of', 'original-spelling', 'invalid subgroup of', 'original spelling'],
  ['invalid-subgroup-of', 'correction', 'invalid subgroup of', 'correction'],
  ['invalid-subgroup-of', 'rank-change', 'invalid subgroup of', 'rank change'],
  ['invalid-subgroup-of', 'recombination', 'invalid subgroup of', 'recombination'],
  ['invalid-subgroup-of', 'misspelling', 'invalid subgroup of', 'misspelling'],
  ['invalid-subgroup-of', 'reassignment', 'invalid subgroup of', 'reassignment'],
  ['misspelling-of', 'misspelling', 'misspelling of', 'misspelling'],
  ['replaced-by', 'original-spelling', 'replaced by', 'original spelling'],
  ['replaced-by', 'correction', 'replaced by', 'correction'],
  ['replaced-by', 'rank-change', 'replaced by', 'rank change'],
  ['replaced-by', 'recombination', 'replaced by', 'recombination'],
  ['replaced-by', 'misspelling', 'replaced by', 'misspelling'],
  ['nomen-dubium', 'original-spelling', 'nomen dubium', 'original spelling'],
  ['nomen-dubium', 'correction', 'nomen dubium', 'correction'],
  ['nomen-dubium', 'rank-change', 'nomen dubium', 'rank change'],
  ['nomen-dubium', 'recombination', 'nomen dubium', 'recombination'],
  ['nomen-dubium', 'misspelling', 'nomen dubium', 'misspelling'],
  ['nomen-nudum', 'original-spelling', 'nomen nudum', 'original spelling'],
  ['nomen-nudum', 'correction', 'nomen nudum', 'correction'],
  ['nomen-nudum', 'rank-change', 'nomen nudum', 'rank change'],
  ['nomen-nudum', 'recombination', 'nomen nudum', 'recombination'],
  ['nomen-nudum', 'misspelling', 'nomen nudum', 'misspelling'],
  ['nomen-oblitum', 'original-spelling', 'nomen oblitum', 'original spelling'],
  ['nomen-oblitum', 'correction', 'nomen oblitum', 'correction'],
  ['nomen-oblitum', 'misspelling', 'nomen oblitum', 'misspelling'],
  ['nomen-oblitum', 'recombination', 'nomen oblitum', 'recombination'],
  ['nomen-vanum', 'original-spelling', 'nomen vanum', 'original spelling'],
  ['nomen-vanum', 'correction', 'nomen vanum', 'correction'],
  ['nomen-vanum', 'misspelling', 'nomen vanum', 'misspelling'],
  ['nomen-vanum', 'recombination', 'nomen vanum', 'recombination'],
  ['nomen-vanum', 'reassignment', 'nomen vanum', 'reassignment'],
].map(([folder, file, status, spellingReason]) => ({
  folder,
  file,
  status,
  spellingReason,
  path: path.join(REPO_ROOT, 'migration_exploration', 'opinions', folder, `${file}.js`),
}));

function nonZero(...vals) {
  return vals.filter((v) => v !== null && v !== undefined && Number(v) !== 0).map(Number);
}

const RESET_TABLES = [
  'persons', 'refs', 'authorities', 'name_opinions',
  'assignment_opinions', 'validity_opinions', 'taxa',
];

async function resetPlay() {
  console.log(`[${new Date().toISOString()}] Resetting pg_play (${RESET_TABLES.join(', ')})...`);
  await pgPlay.query(`TRUNCATE ${RESET_TABLES.join(', ')} RESTART IDENTITY CASCADE`);
  console.log('  Truncated. (CASCADE only reaches tables that reference these -- verified empty otherwise as of the last check.)');
}

async function main() {
  await resetPlay();

  console.log(`[${new Date().toISOString()}] Sampling up to ${SAMPLE_PER_PAIR} opinions per pair from pg_classic...`);

  const samples = []; // { ...pair, opinionNos: [...], rows: [...] }
  const taxonNos = new Set();
  const referenceNos = new Set();
  const personIds = new Set([SENTINEL_PERSON_ID]);

  for (const pair of PAIRS) {
    const { rows } = await pgClassic.query(
      `SELECT opinion_no, child_no, child_spelling_no, parent_no, parent_spelling_no,
              reference_no, authorizer_no, enterer_no
       FROM opinions
       WHERE status = $1 AND spelling_reason = $2
       ORDER BY random()
       LIMIT $3`,
      [pair.status, pair.spellingReason, SAMPLE_PER_PAIR],
    );
    if (rows.length === 0) {
      console.warn(`  WARNING: 0 source rows for ${pair.folder}/${pair.file} (status='${pair.status}', spelling_reason='${pair.spellingReason}')`);
    }
    for (const r of rows) {
      for (const t of nonZero(r.child_no, r.child_spelling_no, r.parent_no, r.parent_spelling_no)) taxonNos.add(t);
      for (const rn of nonZero(r.reference_no)) referenceNos.add(rn);
      for (const p of nonZero(r.authorizer_no, r.enterer_no)) personIds.add(p);
    }
    samples.push({ ...pair, opinionNos: rows.map((r) => r.opinion_no), rows });
  }

  const totalSampled = samples.reduce((n, s) => n + s.opinionNos.length, 0);
  console.log(`  Sampled ${totalSampled} opinions across ${samples.length} pairs.`);
  console.log(`  Closure so far: ${taxonNos.size} taxon_nos, ${referenceNos.size} reference_nos, ${personIds.size} person_nos.`);

  // ---- Resolve the closure against pg_migrated (read-only) ----
  console.log(`[${new Date().toISOString()}] Resolving dependency closure against pg_migrated...`);

  const { rows: rootRows } = taxonNos.size
    ? await pgMigrated(
        `SELECT * FROM name_opinions WHERE edge_class = 'root' AND oldpbdb_taxon_no = ANY($1::int[])`,
        [[...taxonNos]],
      )
    : { rows: [] };
  console.log(`  Resolved ${rootRows.length} / ${taxonNos.size} taxon_nos to root name_opinions in pg_migrated.`);

  const authorityIds = new Set();
  for (const r of rootRows) {
    if (r.authority_id !== null) authorityIds.add(Number(r.authority_id));
    if (r.reference_id !== null) referenceNos.add(Number(r.reference_id));
    for (const p of nonZero(r.authorizer_person_id, r.enterer_person_id)) personIds.add(p);
  }

  const { rows: authorityRows } = authorityIds.size
    ? await pgMigrated(`SELECT * FROM authorities WHERE id = ANY($1::bigint[])`, [[...authorityIds]])
    : { rows: [] };
  console.log(`  Resolved ${authorityRows.length} / ${authorityIds.size} authority_ids.`);

  for (const a of authorityRows) {
    if (a.reference_id !== null) referenceNos.add(Number(a.reference_id));
    for (const p of nonZero(a.authorizer_person_id, a.enterer_person_id)) personIds.add(p);
  }

  const { rows: refRows } = referenceNos.size
    ? await pgMigrated(`SELECT * FROM refs WHERE id = ANY($1::bigint[])`, [[...referenceNos]])
    : { rows: [] };
  console.log(`  Resolved ${refRows.length} / ${referenceNos.size} reference_nos.`);

  for (const r of refRows) {
    for (const p of nonZero(r.authorizer_person_id, r.enterer_person_id)) personIds.add(p);
  }

  const { rows: personRows } = personIds.size
    ? await pgMigrated(`SELECT * FROM persons WHERE id = ANY($1::int[])`, [[...personIds]])
    : { rows: [] };
  console.log(`  Resolved ${personRows.length} / ${personIds.size} person_nos.`);

  // ---- Seed pg_play, in FK order: persons -> refs -> authorities -> name_opinions ----
  console.log(`[${new Date().toISOString()}] Seeding pg_play...`);

  for (const p of personRows) {
    await pgPlay.query(
      `INSERT INTO persons (id, password, role_id, person, authorizer_person_id, active, total_hours)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING`,
      [p.id, p.password, p.role_id, JSON.stringify(p.person), p.authorizer_person_id, p.active, p.total_hours],
    );
  }
  console.log(`  Seeded ${personRows.length} persons.`);

  for (const r of refRows) {
    await pgPlay.query(
      `INSERT INTO refs (id, permid, reference_type_id, authorizer_person_id, enterer_person_id,
                          reference, preceded_by_id, succeeded_by_id, removed)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO NOTHING`,
      [r.id, r.permid, r.reference_type_id, r.authorizer_person_id, r.enterer_person_id,
       JSON.stringify(r.reference), r.preceded_by_id, r.succeeded_by_id, r.removed],
    );
  }
  console.log(`  Seeded ${refRows.length} refs.`);

  for (const a of authorityRows) {
    await pgPlay.query(
      `INSERT INTO authorities (id, permid, authorizer_person_id, enterer_person_id,
                                 authority, reference_id, preceded_by_id, succeeded_by_id, removed)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO NOTHING`,
      [a.id, a.permid, a.authorizer_person_id, a.enterer_person_id,
       JSON.stringify(a.authority), a.reference_id, a.preceded_by_id, a.succeeded_by_id, a.removed],
    );
  }
  console.log(`  Seeded ${authorityRows.length} authorities.`);

  for (const n of rootRows) {
    await pgPlay.query(
      `INSERT INTO name_opinions (id, permid, authorizer_person_id, enterer_person_id, oldpbdb_taxon_no,
                                   subject_permid, target_permid, reason_id, edge_class, objective,
                                   new_name, rank_id, authority_id, reference_id, publication_year,
                                   attribution, evidence, removed, preceded_by_id, succeeded_by_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       ON CONFLICT (id) DO NOTHING`,
      [n.id, n.permid, n.authorizer_person_id, n.enterer_person_id, n.oldpbdb_taxon_no,
       n.subject_permid, n.target_permid, n.reason_id, n.edge_class, n.objective,
       n.new_name, n.rank_id, n.authority_id, n.reference_id, n.publication_year,
       n.attribution === null ? null : JSON.stringify(n.attribution), n.evidence, n.removed,
       n.preceded_by_id, n.succeeded_by_id],
    );
  }
  console.log(`  Seeded ${rootRows.length} name_opinions (root).`);

  for (const t of ['persons', 'refs', 'authorities', 'name_opinions']) {
    await pgPlay.query(`SELECT setval(pg_get_serial_sequence('${t}','id'), (SELECT COALESCE(MAX(id), 1) FROM ${t}))`);
  }
  console.log('  Identity sequences reset.');

  // ---- Run each pair's real, unmodified handler against its sample ----
  console.log(`[${new Date().toISOString()}] Running handlers...`);

  const attempted = samples.filter((s) => s.opinionNos.length > 0);
  let ranCount = 0;
  for (const s of attempted) {
    ranCount++;
    console.log('');
    console.log(`--- [${ranCount}/${attempted.length}] ${s.folder}/${s.file}.js -- opinion_nos: ${s.opinionNos.join(', ')} ---`);

    const exitCode = await new Promise((resolve) => {
      const child = spawn(process.execPath, [s.path], {
        cwd: REPO_ROOT,
        stdio: 'inherit',
        env: {
          ...process.env,
          MIGRATION_TEST_MODE: '1',
          MIGRATION_TEST_OPINION_NOS: s.opinionNos.join(','),
        },
      });
      child.on('exit', (code) => resolve(code));
    });

    if (exitCode !== 0) {
      console.error('');
      console.error(`STOPPED: ${s.folder}/${s.file}.js exited with code ${exitCode}.`);
      console.error(`  status='${s.status}' spelling_reason='${s.spellingReason}'`);
      console.error(`  opinion_nos: ${s.opinionNos.join(', ')}`);
      console.error('  pg_play left as-is for inspection.');
      process.exitCode = 1;
      return;
    }
  }

  console.log('');
  console.log(`[${new Date().toISOString()}] All ${attempted.length} pairs completed with no failures.`);
}

main()
  .catch((err) => {
    console.error('Sample test runner failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePgPlay();
    await closePgClassic();
    await closePgMigrated();
  });
