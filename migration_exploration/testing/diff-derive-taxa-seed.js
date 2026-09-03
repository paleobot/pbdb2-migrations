// Reusable correctness-diff helper for openspec/changes/optimize-derive-taxa-seed.
//
// Compares a seed-scoped call's output against the corresponding rows of a
// full, un-seeded derive -- the byte-identical-output bar every task in that
// change's tasks.md (2.5, 3.3, 4.3) must clear. Exported as a function so
// each of derive_taxa()/derive_linnaean()/derive_taxa_clades()'s own
// verification script can import and reuse it (per tasks.md 1.2: "reused for
// every correctness check below, not rewritten per function") rather than
// hand-rolling its own comparison.
//
// Usage as a library:
//   import { diffSeeded } from './diff-derive-taxa-seed.js';
//   const { ok, diffs } = await diffSeeded(client, 'derive_taxa', permids);
//
// Usage as a CLI (runs the full fixture battery from seed-scoping-fixtures.js
// as one multi-element seed call, then each fixture individually):
//   node migration_exploration/testing/diff-derive-taxa-seed.js [fnName]
//   (fnName defaults to 'derive_taxa'; derive_taxa_clades's own parameter is
//   named `permids`, not `seed`, but is passed positionally here either way)
import { pgPlay, closePgPlay } from '../../pg-play-pool.js';
import { SEED_BATTERY } from './seed-scoping-fixtures.js';

function rowsEqual(a, b, columns) {
  return columns.every((c) => {
    const av = a[c];
    const bv = b[c];
    if (av === null || av === undefined) return bv === null || bv === undefined;
    // classification_path (ltree) and array columns stringify comparably via pg's driver.
    return String(av) === String(bv);
  });
}

// Diffs `SELECT * FROM <fnName>($1::uuid[])` against `SELECT * FROM
// <fnName>(NULL) WHERE permid = ANY($1::uuid[])`, sorted by permid. Returns
// { ok, diffs, seededCount, fullCount } -- diffs is a list of
// { permid, reason, seededRow, fullRow } for anything that didn't match.
async function diffSeeded(client, fnName, permids) {
  const { rows: seededRows } = await client.query(
    `SELECT * FROM ${fnName}($1::uuid[]) ORDER BY permid`,
    [permids],
  );
  const { rows: fullRows } = await client.query(
    `SELECT * FROM ${fnName}(NULL) WHERE permid = ANY($1::uuid[]) ORDER BY permid`,
    [permids],
  );

  const columns = seededRows[0] ? Object.keys(seededRows[0]) : Object.keys(fullRows[0] ?? {});
  const seededByPermid = new Map(seededRows.map((r) => [r.permid, r]));
  const fullByPermid = new Map(fullRows.map((r) => [r.permid, r]));

  const diffs = [];
  for (const permid of permids) {
    const seededRow = seededByPermid.get(permid);
    const fullRow = fullByPermid.get(permid);
    if (!seededRow && !fullRow) {
      diffs.push({ permid, reason: 'missing from both calls (bad fixture permid?)' });
      continue;
    }
    if (!seededRow) {
      diffs.push({ permid, reason: 'present in derive_*(NULL) but missing from seeded call', fullRow });
      continue;
    }
    if (!fullRow) {
      diffs.push({ permid, reason: 'present in seeded call but missing from derive_*(NULL) (unexpected)', seededRow });
      continue;
    }
    if (!rowsEqual(seededRow, fullRow, columns)) {
      const mismatchedColumns = columns.filter((c) => !rowsEqual(seededRow, fullRow, [c]));
      diffs.push({ permid, reason: `column mismatch: ${mismatchedColumns.join(', ')}`, seededRow, fullRow });
    }
  }

  return { ok: diffs.length === 0, diffs, seededCount: seededRows.length, fullCount: fullRows.length };
}

function printResult(label, permids, result) {
  console.log(`\n=== ${label} (${permids.length} permid(s)) ===`);
  console.log(`  seeded rows: ${result.seededCount}, full-filtered rows: ${result.fullCount}`);
  if (result.ok) {
    console.log('  OK: byte-identical to derive_*(NULL)');
    return;
  }
  console.log(`  FAIL: ${result.diffs.length} divergence(s)`);
  for (const d of result.diffs) {
    console.log(`    permid ${d.permid}: ${d.reason}`);
  }
}

async function main() {
  const fnName = process.argv[2] || 'derive_taxa';
  const client = await pgPlay.connect();
  let anyFail = false;
  try {
    console.log(`[${new Date().toISOString()}] Diffing ${fnName}(seed) against ${fnName}(NULL) for the fixture battery...`);

    // 1. All fixtures in one multi-element seed call.
    const allPermids = SEED_BATTERY.map((f) => f.permid);
    const combined = await diffSeeded(client, fnName, allPermids);
    printResult('all fixtures, one multi-element seed array', allPermids, combined);
    if (!combined.ok) anyFail = true;

    // 2. Each fixture individually, so a failure points at exactly one case.
    for (const fixture of SEED_BATTERY) {
      const result = await diffSeeded(client, fnName, [fixture.permid]);
      printResult(fixture.label, [fixture.permid], result);
      if (!result.ok) anyFail = true;
    }

    console.log('');
    console.log(anyFail ? 'FAIL' : 'PASS');
    if (anyFail) process.exitCode = 1;
  } finally {
    client.release();
    await closePgPlay();
  }
}

const isMain = process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href;
if (isMain) {
  main().catch((err) => {
    console.error('diff-derive-taxa-seed failed:', err);
    process.exitCode = 1;
  });
}

export { diffSeeded };
