// Precise timing of derive_taxa(NULL) (full derive-all) and rebuild_taxa()
// (derive-all + materialize into taxa) against pg_play's current Layer 1 data.
//
// Uses process.hrtime.bigint() (nanosecond monotonic clock) around each query;
// pg_play is localhost, so client/network overhead is negligible relative to
// the server-side computation being measured.
//
// derive_taxa(NULL) is timed via `SELECT count(*) FROM derive_taxa(NULL)`
// rather than `SELECT * FROM derive_taxa(NULL)` -- this still forces full
// server-side evaluation of every row, but returns only one row to the client,
// so result-set transfer/deserialization time isn't conflated with derivation
// compute time.
import { pgPlay, closePgPlay } from '../../pg-play-pool.js';

function ms(ns) {
  return Number(ns) / 1e6;
}

async function timeQuery(label, sql) {
  const t0 = process.hrtime.bigint();
  const result = await pgPlay.query(sql);
  const t1 = process.hrtime.bigint();
  const elapsed = ms(t1 - t0);
  console.log(`  ${label}: ${elapsed.toFixed(1)} ms`);
  return { result, elapsed };
}

async function main() {
  console.log(`[${new Date().toISOString()}] Benchmarking derive_taxa() against pg_play...`);

  const { rows: l1 } = await pgPlay.query(`
    SELECT
      (SELECT count(*) FROM name_opinions WHERE removed IS NOT TRUE AND succeeded_by_id IS NULL) AS name_opinions,
      (SELECT count(*) FROM assignment_opinions WHERE removed IS NOT TRUE AND succeeded_by_id IS NULL) AS assignment_opinions,
      (SELECT count(*) FROM validity_opinions WHERE removed IS NOT TRUE AND succeeded_by_id IS NULL) AS validity_opinions
  `);
  console.log(`  Layer 1 (live rows): name_opinions=${l1[0].name_opinions}, assignment_opinions=${l1[0].assignment_opinions}, validity_opinions=${l1[0].validity_opinions}`);

  const { rows: taxaBefore } = await pgPlay.query('SELECT count(*) FROM taxa');
  console.log(`  taxa (before): ${taxaBefore[0].count}`);

  console.log('');
  console.log('=== derive_taxa(NULL) pure compute -- SELECT count(*) FROM derive_taxa(NULL) ===');
  const runs = [];
  const RUN_COUNT = 3;
  for (let i = 1; i <= RUN_COUNT; i++) {
    const { result, elapsed } = await timeQuery(`run ${i}/${RUN_COUNT}`, 'SELECT count(*) FROM derive_taxa(NULL)');
    console.log(`    -> ${result.rows[0].count} permids derived`);
    runs.push(elapsed);
  }
  const min = Math.min(...runs);
  const max = Math.max(...runs);
  const avg = runs.reduce((a, b) => a + b, 0) / runs.length;
  console.log(`  min ${min.toFixed(1)} ms / max ${max.toFixed(1)} ms / avg ${avg.toFixed(1)} ms across ${RUN_COUNT} runs`);

  console.log('');
  console.log('=== rebuild_taxa() cold -- taxa is empty, so this is a full derive + full insert ===');
  const { result: coldResult, elapsed: coldElapsed } = await timeQuery('cold rebuild_taxa()', 'SELECT rebuild_taxa()');
  console.log(`    -> ${coldResult.rows[0].rebuild_taxa} rows written`);

  console.log('');
  console.log('=== rebuild_taxa() warm -- taxa already matches derive output, so this is derive + a no-op diff ===');
  const { result: warmResult, elapsed: warmElapsed } = await timeQuery('warm rebuild_taxa()', 'SELECT rebuild_taxa()');
  console.log(`    -> ${warmResult.rows[0].rebuild_taxa} rows written`);

  const { rows: taxaAfter } = await pgPlay.query('SELECT count(*) FROM taxa');
  console.log('');
  console.log(`  taxa (after): ${taxaAfter[0].count}`);

  console.log('');
  console.log('=== Summary ===');
  console.log(`  derive_taxa(NULL) pure compute:      min ${min.toFixed(1)} ms / max ${max.toFixed(1)} ms / avg ${avg.toFixed(1)} ms (n=${RUN_COUNT})`);
  console.log(`  rebuild_taxa() cold (derive + write): ${coldElapsed.toFixed(1)} ms`);
  console.log(`  rebuild_taxa() warm (derive + no-op): ${warmElapsed.toFixed(1)} ms`);
  console.log(`[${new Date().toISOString()}] Done.`);
}

main()
  .catch((err) => {
    console.error('Benchmark failed:', err);
    process.exitCode = 1;
  })
  .finally(() => closePgPlay());
