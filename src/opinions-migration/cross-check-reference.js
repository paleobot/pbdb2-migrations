// Cross-check the single-script migrate-opinions.js output (primary PG_DATABASE)
// against the 48-handler reference (PG_REF_DATABASE, built by
// run-reference-handlers.js). Both DBs are clones sharing identical dictionaries
// and root name_opinions, so output rows compare DIRECTLY on permids — no
// translation. Per-run columns (id, permid, created_at, preceded_by_id,
// succeeded_by_id) are excluded from every comparison.
//
// Two layers (task 5.6):
//   (a) structural — per-table counts and counts grouped by each table's
//       discriminators, matching exactly;
//   (b) row-level — a multiset fingerprint over each table's run-independent
//       canonical content; on mismatch, the differing canonical rows are pulled
//       and the symmetric difference reported.
//
// Writes cross-check-reference-report.txt into this directory.
import 'dotenv/config';
import { Pool } from 'pg';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPORT = join(dirname(fileURLToPath(import.meta.url)), 'cross-check-reference-report.txt');
const REF_DB = process.env.PG_REF_DATABASE || 'pbdb_ref';

function pool(database) {
  return new Pool({
    host: process.env.PG_HOST, port: parseInt(process.env.PG_PORT || '5432', 10),
    user: process.env.PG_USER, password: process.env.PG_PASSWORD, database, max: 2,
  });
}

// Canonical, run-independent row text per table (excludes id/permid/created_at/
// preceded_by_id/succeeded_by_id; subject/target/containing permids are shared
// across the two clones, so they ARE part of identity here).
const CANON = {
  assignment_opinions: {
    from: 'assignment_opinions',
    where: '',
    key: `subject_permid||'|'||coalesce(containing_permid::text,'~')||'|'||questioned||'|'||reference_id||'|'||coalesce(publication_year::text,'~')||'|'||coalesce(attribution::text,'~')||'|'||evidence||'|'||coalesce(removed::text,'~')`,
    discriminators: `questioned, evidence, (containing_permid IS NULL) AS containing_null, (publication_year IS NULL) AS pubyear_null`,
  },
  validity_opinions: {
    from: 'validity_opinions',
    where: '',
    key: `subject_permid||'|'||nomenclatural_status_id||'|'||reference_id||'|'||coalesce(publication_year::text,'~')||'|'||coalesce(attribution::text,'~')||'|'||evidence||'|'||coalesce(removed::text,'~')`,
    discriminators: `nomenclatural_status_id, evidence, (publication_year IS NULL) AS pubyear_null`,
  },
  name_opinions: {
    from: 'name_opinions',
    where: `edge_class IN ('concept','lineage')`,
    key: `subject_permid||'|'||target_permid||'|'||reason_id||'|'||edge_class||'|'||coalesce(objective::text,'~')||'|'||reference_id||'|'||coalesce(publication_year::text,'~')||'|'||coalesce(attribution::text,'~')||'|'||evidence||'|'||negates||'|'||coalesce(removed::text,'~')`,
    discriminators: `edge_class, reason_id, objective, negates, evidence, (target_permid IS NULL) AS target_null, (publication_year IS NULL) AS pubyear_null`,
  },
};

async function tableCount(p, spec) {
  const w = spec.where ? `WHERE ${spec.where}` : '';
  return Number((await p.query(`SELECT COUNT(*) n FROM ${spec.from} ${w}`)).rows[0].n);
}

async function discriminatorGroups(p, spec) {
  const w = spec.where ? `WHERE ${spec.where}` : '';
  const cols = spec.discriminators;
  const groupCols = cols.split(',').map((c) => c.trim().replace(/ AS .*/i, '')).join(', ');
  const { rows } = await p.query(`SELECT ${cols}, COUNT(*)::int n FROM ${spec.from} ${w} GROUP BY ${groupCols} ORDER BY ${groupCols}`);
  const map = new Map();
  for (const r of rows) {
    const { n, ...rest } = r;
    map.set(JSON.stringify(rest), n);
  }
  return map;
}

// Multiset fingerprint: hash each canonical row, group to (rowhash → count),
// then hash the sorted "hash:count" list. Order-independent, duplicate-preserving,
// memory-light in the DB.
async function fingerprint(p, spec) {
  const w = spec.where ? `WHERE ${spec.where}` : '';
  const { rows } = await p.query(
    `SELECT md5(string_agg(h||':'||c, '' ORDER BY h)) AS fp
       FROM (SELECT md5(${spec.key}) h, COUNT(*) c FROM ${spec.from} ${w} GROUP BY md5(${spec.key})) g`,
  );
  return rows[0].fp;
}

// On fingerprint mismatch, pull grouped (canonical_key → count) from both and
// report the symmetric difference (bounded).
async function drillDown(pa, pb, spec, out) {
  const w = spec.where ? `WHERE ${spec.where}` : '';
  const load = async (p) => {
    const { rows } = await p.query(`SELECT ${spec.key} k, COUNT(*)::int c FROM ${spec.from} ${w} GROUP BY ${spec.key}`);
    const m = new Map();
    for (const r of rows) m.set(r.k, r.c);
    return m;
  };
  const [a, b] = await Promise.all([load(pa), load(pb)]);
  let onlyA = 0, onlyB = 0, countDiff = 0;
  const samples = [];
  for (const [k, ca] of a) {
    const cb = b.get(k);
    if (cb === undefined) { onlyA++; if (samples.length < 15) samples.push(`only-primary (x${ca}): ${k.slice(0, 200)}`); }
    else if (cb !== ca) { countDiff++; if (samples.length < 15) samples.push(`count ${ca} vs ${cb}: ${k.slice(0, 160)}`); }
  }
  for (const [k, cb] of b) if (!a.has(k)) { onlyB++; if (samples.length < 15) samples.push(`only-reference (x${cb}): ${k.slice(0, 200)}`); }
  out(`    symmetric difference: only-in-primary=${onlyA}, only-in-reference=${onlyB}, count-mismatch keys=${countDiff}`);
  for (const s of samples) out(`      ${s}`);
  return onlyA === 0 && onlyB === 0 && countDiff === 0;
}

async function main() {
  const out = [];
  const log = (s = '') => { out.push(s); console.log(s); };
  const primaryDb = process.env.PG_DATABASE;
  log(`opinions cross-check: primary '${primaryDb}' vs reference '${REF_DB}' (48-handler) — ${new Date().toISOString()}`);
  log('(excluded per-run columns: id, permid, created_at, preceded_by_id, succeeded_by_id)');
  log('');

  const A = pool(primaryDb);
  const B = pool(REF_DB);
  let allMatch = true;
  try {
    // Sanity: roots must be identical (both clones) — the comparison's foundation.
    const rootA = Number((await A.query(`SELECT COUNT(*) n FROM name_opinions WHERE edge_class='root'`)).rows[0].n);
    const rootB = Number((await B.query(`SELECT COUNT(*) n FROM name_opinions WHERE edge_class='root'`)).rows[0].n);
    log(`root name_opinions: primary=${rootA} reference=${rootB} ${rootA === rootB ? 'MATCH' : 'DIFF'}`);
    if (rootA !== rootB) { allMatch = false; log('  WARNING: root layers differ — the DBs are not comparable clones.'); }
    log('');

    for (const [table, spec] of Object.entries(CANON)) {
      log(`== ${table}${spec.where ? ` (${spec.where})` : ''} ==`);

      // Layer (a): structural counts + discriminator groups.
      const [cA, cB] = [await tableCount(A, spec), await tableCount(B, spec)];
      const countMatch = cA === cB;
      if (!countMatch) allMatch = false;
      log(`  count: primary=${cA} reference=${cB} ${countMatch ? 'MATCH' : 'DIFF'}`);

      const [gA, gB] = [await discriminatorGroups(A, spec), await discriminatorGroups(B, spec)];
      const keys = new Set([...gA.keys(), ...gB.keys()]);
      let discMatch = true;
      for (const k of [...keys].sort()) {
        const a = gA.get(k) || 0, b = gB.get(k) || 0;
        if (a !== b) { discMatch = false; log(`    DISC DIFF ${k}: primary=${a} reference=${b}`); }
      }
      if (discMatch) log(`  discriminator groups: ${keys.size} groups all MATCH`);
      else allMatch = false;

      // Layer (b): row-level multiset fingerprint.
      const [fA, fB] = [await fingerprint(A, spec), await fingerprint(B, spec)];
      if (fA === fB) {
        log(`  row-level fingerprint: MATCH (${fA})`);
      } else {
        log(`  row-level fingerprint: DIFF (primary=${fA} reference=${fB}) — drilling down...`);
        const clean = await drillDown(A, B, spec, log);
        if (!clean) allMatch = false;
      }
      log('');
    }

    log('== Conclusion ==');
    log(allMatch
      ? '  The single-script output is IDENTICAL to the 48-handler reference on all run-independent content.'
      : '  Differences found — see the DISC DIFF / symmetric-difference detail above.');
  } finally {
    await A.end(); await B.end();
  }

  writeFileSync(REPORT, out.join('\n') + '\n');
  log('');
  log(`Wrote ${REPORT}`);
  if (!allMatch) process.exitCode = 1;
}

main().catch((err) => { console.error('cross-check-reference failed:', err.message); process.exitCode = 1; });
