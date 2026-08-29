// Cheap diagnostic for whether derive_taxa()'s recursive "reach" CTEs are
// hitting a combinatorial blowup: computes real connected-component sizes over
// the lineage union (and separately the concept union) via iterative min-label
// propagation (bounded by graph diameter, no reach-all-pairs blowup) instead of
// derive_taxa()'s own reach(src,node) pattern -- so this stays fast even if
// derive_taxa() itself doesn't.
//
// Approximation: uses ALL live lineage/concept edges, not just each subject's
// single winning edge (derive_taxa()'s ranking step) -- this can only make
// components larger/equal to the real ones, never smaller, so it's a safe
// upper-bound diagnostic for "is there a giant component," not a byte-for-byte
// stand-in for derive_taxa()'s own union-find.
import { pgPlay, closePgPlay } from '../../pg-play-pool.js';

async function componentSizes(client, label, edgeClassFilter) {
  console.log(`=== ${label} ===`);

  await client.query('DROP TABLE IF EXISTS diag_label, diag_undir');
  await client.query(`
    CREATE TEMP TABLE diag_label AS
    SELECT subject_permid AS node, subject_permid AS label
    FROM name_opinions
    WHERE removed IS NOT TRUE AND succeeded_by_id IS NULL AND edge_class = 'root'
  `);
  await client.query('CREATE INDEX ON diag_label(node)');
  await client.query('ANALYZE diag_label');

  await client.query(`
    CREATE TEMP TABLE diag_undir AS
    SELECT subject_permid AS a, target_permid AS b
    FROM name_opinions
    WHERE removed IS NOT TRUE AND succeeded_by_id IS NULL
      AND edge_class = ${edgeClassFilter} AND negates = false AND target_permid IS NOT NULL
    UNION ALL
    SELECT target_permid, subject_permid
    FROM name_opinions
    WHERE removed IS NOT TRUE AND succeeded_by_id IS NULL
      AND edge_class = ${edgeClassFilter} AND negates = false AND target_permid IS NOT NULL
  `);
  await client.query('CREATE INDEX ON diag_undir(a)');
  await client.query('ANALYZE diag_undir');

  const { rows: edgeCount } = await client.query('SELECT count(*) FROM diag_undir');
  console.log(`  edges (directed both ways): ${edgeCount[0].count}`);

  let iter = 0;
  const t0 = process.hrtime.bigint();
  while (true) {
    iter++;
    const { rowCount } = await client.query(`
      WITH upd AS (
        SELECT l.node, min(l2.label::text)::uuid AS new_label
        FROM diag_label l
        JOIN diag_undir e ON e.a = l.node
        JOIN diag_label l2 ON l2.node = e.b
        GROUP BY l.node
      )
      UPDATE diag_label t
      SET label = upd.new_label
      FROM upd
      WHERE upd.node = t.node AND upd.new_label < t.label
    `);
    if (rowCount === 0 || iter > 200) break;
  }
  const elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`  converged after ${iter} iteration(s), ${elapsedMs.toFixed(1)} ms`);

  const { rows: dist } = await client.query(`
    SELECT component_size, count(*) AS num_components, component_size * count(*) AS nodes_in_bucket
    FROM (SELECT label, count(*) AS component_size FROM diag_label GROUP BY label) c
    GROUP BY component_size
    ORDER BY component_size DESC
    LIMIT 15
  `);
  console.log('  largest component sizes (size: how many components that size, nodes covered):');
  for (const r of dist) {
    console.log(`    ${r.component_size}: ${r.num_components} component(s), ${r.nodes_in_bucket} nodes`);
  }

  const { rows: total } = await client.query('SELECT count(DISTINCT label) AS components, count(*) AS nodes FROM diag_label');
  console.log(`  total: ${total[0].components} components across ${total[0].nodes} nodes`);
}

async function main() {
  const client = await pgPlay.connect();
  try {
    await componentSizes(client, "lineage union-find (edge_class='lineage')", "'lineage'");
    console.log('');
    await componentSizes(client, "concept union-find (edge_class='concept')", "'concept'");
  } finally {
    await client.query('DROP TABLE IF EXISTS diag_label, diag_undir');
    client.release();
  }
}

main()
  .catch((err) => {
    console.error('Diagnostic failed:', err);
    process.exitCode = 1;
  })
  .finally(() => closePgPlay());
