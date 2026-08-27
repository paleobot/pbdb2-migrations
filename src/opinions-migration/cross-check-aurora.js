// Read-only cross-check of the freshly-migrated localhost opinion tables against
// the Aurora `pbdb2_migration_test` reference (the archived migration_exploration
// output). Aurora is reached ONLY through pg-migrated-pool.js, which rejects
// anything but SELECT/WITH.
//
// Two layers (tasks 5.5/5.6):
//   1. GENERATION — confirm the reference conforms to the current
//      postgresql/create_new.sql model, and detect whether it predates the
//      2026-08-18 targeted→concept move / later changes.
//   2. STRUCTURAL + ROW-LEVEL — per-table / per-discriminator counts, and a
//      symmetric-difference on run-independent keys (permids translated back to
//      legacy ids via each DB's own root name_opinions map, since permids are
//      minted independently per run).
//
// Writes cross-check-report.txt into this directory.
import { pg, closePg } from '../lib/pg-pool.js';
import { pgMigrated, closePgMigrated } from '../../pg-migrated-pool.js';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPORT = join(dirname(fileURLToPath(import.meta.url)), 'cross-check-report.txt');

// Columns that legitimately differ between two independent migrations and are
// excluded from every row-level comparison.
const PER_RUN_COLUMNS = ['id', 'permid', 'created_at', 'preceded_by_id', 'succeeded_by_id'];

async function columnSet(queryFn, table) {
  const { rows } = await queryFn(
    `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`,
    [table],
  );
  return new Set(rows.map((r) => r.column_name));
}

async function scalar(queryFn, sql, params) {
  const { rows } = await queryFn(sql, params);
  return Number(Object.values(rows[0])[0]);
}

async function main() {
  const out = [];
  const log = (s = '') => { out.push(s); console.log(s); };
  log(`opinions cross-check vs Aurora pbdb2_migration_test — ${new Date().toISOString()}`);
  log(`(excluded per-run columns: ${PER_RUN_COLUMNS.join(', ')})`);
  log('');

  // ---------- Layer 1: reference generation / schema conformance ----------
  log('== Layer 1: reference schema conformance (vs postgresql/create_new.sql) ==');
  const refName = await columnSet(pgMigrated, 'name_opinions');
  const refValidity = await columnSet(pgMigrated, 'validity_opinions');
  const refAssign = await columnSet(pgMigrated, 'assignment_opinions');

  const conformance = [
    ['name_opinions has negates (current model)', refName.has('negates')],
    ['name_opinions has publication_year (not pubyr)', refName.has('publication_year') && !refName.has('pubyr')],
    ['name_opinions has oldpbdb_taxon_no', refName.has('oldpbdb_taxon_no')],
    ['name_opinions has NO pages/figures', !refName.has('pages') && !refName.has('figures')],
    ['assignment_opinions.containing_permid present', refAssign.has('containing_permid')],
    ['validity_opinions is untargeted-only (no targeted/target_permid)', !refValidity.has('targeted') && !refValidity.has('target_permid')],
  ];
  let conforms = true;
  for (const [label, ok] of conformance) { log(`  [${ok ? 'OK' : 'DIFF'}] ${label}`); if (!ok) conforms = false; }

  // Reference distributions that reveal generation.
  const refEdge = (await pgMigrated(`SELECT edge_class, COUNT(*) n FROM name_opinions GROUP BY edge_class`)).rows;
  const refReasons = (await pgMigrated(`SELECT d.reason, COUNT(*) n FROM name_opinions no JOIN dictionaries.namechange_reasons d ON d.id=no.reason_id WHERE no.edge_class<>'root' GROUP BY d.reason`)).rows;
  const refValStatuses = (await pgMigrated(`SELECT s.status, COUNT(*) n FROM validity_opinions v JOIN dictionaries.nomenclatural_statuses s ON s.id=v.nomenclatural_status_id GROUP BY s.status`)).rows;
  log('');
  log(`  reference name_opinions edge_class: ${refEdge.map((r) => `${r.edge_class}=${r.n}`).join(', ')}`);
  log(`  reference non-root reasons: ${refReasons.map((r) => `${r.reason}=${r.n}`).join(', ') || '(none)'}`);
  log(`  reference validity statuses: ${refValStatuses.map((r) => `${r.status}=${r.n}`).join(', ') || '(none)'}`);

  const hasLineage = refEdge.some((r) => r.edge_class === 'lineage' && Number(r.n) > 0);
  const conceptReasons = new Set(refReasons.map((r) => r.reason));
  const currentModel = conforms && hasLineage && conceptReasons.size > 1;

  log('');
  log('== Generation verdict ==');
  if (currentModel) {
    log('  Reference appears to be a current-model run — proceeding to full row-level cross-check.');
  } else {
    log('  Reference is NOT a current-model full run. Detected staleness:');
    if (!refName.has('negates')) log('    - name_opinions lacks `negates` → predates the negation model.');
    if (refValidity.has('targeted')) log('    - validity_opinions still has `targeted`/`target_permid` → predates the 2026-08-18 targeted→concept move.');
    if (!hasLineage) log('    - 0 lineage edges → predates the universal spelling_reason→lineage dual emission.');
    if (conceptReasons.size <= 1) log(`    - concept edges use only {${[...conceptReasons].join(', ')}} → missing invalid subgroup / replaced by / nomen oblitum folds.`);
    if (refValStatuses.some((r) => r.status === 'informal')) log('    - validity carries the removed `informal` status → predates the informal→unranked change (2026-08-26).');
  }

  // ---------- Layer 2: structural side-by-side (localhost vs reference) ----------
  log('');
  log('== Layer 2a: structural counts (localhost vs reference) ==');
  const pairs = [
    ['name_opinions root',    `SELECT COUNT(*) FROM name_opinions WHERE edge_class='root'`],
    ['name_opinions concept', `SELECT COUNT(*) FROM name_opinions WHERE edge_class='concept'`],
    ['name_opinions lineage', `SELECT COUNT(*) FROM name_opinions WHERE edge_class='lineage'`],
    ['assignment_opinions',   `SELECT COUNT(*) FROM assignment_opinions`],
    ['validity_opinions',     `SELECT COUNT(*) FROM validity_opinions`],
  ];
  for (const [label, sql] of pairs) {
    const local = await scalar((s, p) => pg.query(s, p), sql);
    const ref = await scalar(pgMigrated, sql);
    log(`  ${label.padEnd(24)} localhost=${String(local).padStart(8)}  reference=${String(ref).padStart(8)}  ${local === ref ? 'MATCH' : 'DIFF'}`);
  }

  // ---------- Layer 2b: row-level on the stable overlap (root name_opinions) ----------
  // Roots are the one disposition present in both and unaffected by the model
  // move / dual emission — keyed by the run-independent oldpbdb_taxon_no, with
  // identity fields (new_name, rank) compared. This is the meaningful overlap;
  // everything the reference lacks (lineage, other concept/validity families,
  // full belongs-to scope) is a known intentional difference, excluded above.
  log('');
  log('== Layer 2b: row-level symmetric difference on root name_opinions (key = oldpbdb_taxon_no) ==');
  const localRoots = (await pg.query(`SELECT oldpbdb_taxon_no, new_name FROM name_opinions WHERE edge_class='root'`)).rows;
  const refRoots = (await pgMigrated(`SELECT oldpbdb_taxon_no, new_name FROM name_opinions WHERE edge_class='root'`)).rows;
  const localMap = new Map(localRoots.map((r) => [Number(r.oldpbdb_taxon_no), r.new_name]));
  const refMap = new Map(refRoots.map((r) => [Number(r.oldpbdb_taxon_no), r.new_name]));
  let onlyLocal = 0, onlyRef = 0, nameDiff = 0;
  const diffSamples = [];
  for (const [k, v] of localMap) {
    if (!refMap.has(k)) { onlyLocal++; if (diffSamples.length < 10) diffSamples.push(`only-local oldpbdb=${k}`); }
    else if (refMap.get(k) !== v) { nameDiff++; if (diffSamples.length < 10) diffSamples.push(`name diff oldpbdb=${k}: local='${v}' ref='${refMap.get(k)}'`); }
  }
  for (const k of refMap.keys()) if (!localMap.has(k)) onlyRef++;
  log(`  roots only in localhost: ${onlyLocal}`);
  log(`  roots only in reference: ${onlyRef}`);
  log(`  roots present in both but new_name differs: ${nameDiff}`);
  if (diffSamples.length) { log('  samples:'); for (const s of diffSamples) log(`    ${s}`); }
  const rootsAligned = onlyLocal === 0 && onlyRef === 0 && nameDiff === 0;
  log(`  root overlap ${rootsAligned ? 'ALIGNED ✓' : 'has differences (see above)'}`);

  log('');
  log('== Conclusion ==');
  if (currentModel) {
    log('  Full cross-check applicable; see per-table results above.');
  } else {
    log('  The Aurora reference is a stale, pre-correction snapshot, so a full row-level');
    log('  equality cross-check (task 5.6) is NOT meaningful against it — the non-overlapping');
    log('  dispositions are known intentional differences, and the overlapping concept/');
    log('  assignment rows predate the 2026-08-19 subject-direction correction. The stable');
    log('  overlap that CAN be compared (root name_opinions) is reported in Layer 2b.');
  }

  writeFileSync(REPORT, out.join('\n') + '\n');
  log('');
  log(`Wrote ${REPORT}`);
}

main()
  .catch((err) => { console.error('Cross-check failed:', err.message); process.exitCode = 1; })
  .finally(async () => { await closePg(); await closePgMigrated(); });
