// Rebuilds only the cheap prerequisites (_dt_identity, _dt_edge_cand,
// _dt_permid_edge, _dt_lin_winner, _dt_lin -- all confirmed fast, ~4s total)
// then computes the sink_counts distribution from _dt_linmeta's own logic
// WITHOUT running its expensive LATERAL degenerate-group tiebreak. Tells us
// how many lineage groups have 0 sinks (a lineage-level cycle) or 2+ sinks
// (a genuine tie), i.e. the actual input size to the slow part of _dt_linmeta.
import { pgPlay, closePgPlay } from '../../pg-play-pool.js';

function ms(ns) { return Number(ns) / 1e6; }
async function timed(client, label, sql) {
  const t0 = process.hrtime.bigint();
  const result = await client.query(sql);
  console.log(`  [${ms(process.hrtime.bigint() - t0).toFixed(1)} ms] ${label}`);
  return result;
}

async function main() {
  const client = await pgPlay.connect();
  try {
    console.log(`[${new Date().toISOString()}] Rebuilding cheap prerequisites...`);
    await timed(client, 'drop old', `
      DROP TABLE IF EXISTS _dt_identity, _dt_edge_cand, _dt_permid_edge, _dt_lin_winner, _dt_lin
    `);
    await timed(client, '_dt_identity', `
      CREATE TEMP TABLE _dt_identity AS
      SELECT n.subject_permid AS permid, n.id AS opinion_id, n.new_name, n.rank_id, n.authority_id
      FROM name_opinions n
      WHERE n.removed IS NOT TRUE AND n.succeeded_by_id IS NULL AND n.edge_class = 'root'
    `);
    await client.query('CREATE INDEX ON _dt_identity(permid); ANALYZE _dt_identity');

    await timed(client, '_dt_edge_cand', `
      CREATE TEMP TABLE _dt_edge_cand AS
      SELECT n.subject_permid AS permid, n.id AS opinion_id, n.edge_class, n.target_permid,
             n.evidence,
             COALESCE(n.publication_year, NULLIF(r.reference->>'publicationYear','')::int) AS yr,
             nr.never_accepted, n.negates
      FROM name_opinions n
      JOIN dictionaries.namechange_reasons nr ON nr.id = n.reason_id
      LEFT JOIN refs r ON r.id = n.reference_id
      WHERE n.removed IS NOT TRUE AND n.succeeded_by_id IS NULL AND n.edge_class IN ('root','lineage')
    `);
    await client.query('CREATE INDEX ON _dt_edge_cand(permid); ANALYZE _dt_edge_cand');

    await timed(client, '_dt_permid_edge', `
      CREATE TEMP TABLE _dt_permid_edge AS
      WITH ranked AS (
        SELECT permid, opinion_id, evidence, yr, never_accepted,
               row_number() OVER (PARTITION BY permid ORDER BY evidence DESC, yr DESC NULLS LAST, opinion_id DESC) AS rn
        FROM _dt_edge_cand WHERE negates = false
      )
      SELECT permid, opinion_id, evidence, yr, never_accepted FROM ranked WHERE rn = 1
    `);
    await client.query('CREATE INDEX ON _dt_permid_edge(permid); ANALYZE _dt_permid_edge');

    await timed(client, '_dt_lin_winner', `
      CREATE TEMP TABLE _dt_lin_winner AS
      WITH ranked AS (
        SELECT permid, target_permid, negates,
               row_number() OVER (PARTITION BY permid ORDER BY evidence DESC, yr DESC NULLS LAST, opinion_id DESC) AS rn
        FROM _dt_edge_cand WHERE edge_class = 'lineage'
      )
      SELECT permid, target_permid, negates FROM ranked WHERE rn = 1
    `);
    await client.query('CREATE INDEX ON _dt_lin_winner(permid); ANALYZE _dt_lin_winner');

    await timed(client, '_dt_lin (lineage union-find)', `
      CREATE TEMP TABLE _dt_lin AS
      WITH RECURSIVE
      lin_undir AS (
        SELECT permid AS a, target_permid AS b FROM _dt_lin_winner WHERE negates = false
        UNION
        SELECT target_permid, permid FROM _dt_lin_winner WHERE negates = false
      ),
      reach(src, node) AS (
        SELECT permid, permid FROM _dt_identity
        UNION
        SELECT r.src, u.b FROM reach r JOIN lin_undir u ON u.a = r.node
      )
      SELECT src AS permid, min(node::text)::uuid AS lin_rep FROM reach GROUP BY src
    `);
    await client.query('CREATE INDEX ON _dt_lin(permid); CREATE INDEX ON _dt_lin(lin_rep); ANALYZE _dt_lin');

    console.log('');
    console.log('=== sink_counts distribution (input to _dt_linmeta\'s LATERAL tiebreak) ===');
    await timed(client, 'sinks + sink_counts + distribution', `DROP TABLE IF EXISTS _diag_sinkcounts`);
    await client.query(`
      CREATE TEMP TABLE _diag_sinkcounts AS
      WITH sinks AS (
        SELECT l.lin_rep, l.permid FROM _dt_lin l
        WHERE NOT EXISTS (SELECT 1 FROM _dt_lin_winner w WHERE w.negates = false AND w.permid = l.permid)
      )
      SELECT lin_rep, count(*) AS n FROM sinks GROUP BY lin_rep
    `);
    const { rows: dist } = await client.query(`
      SELECT n AS sink_count, count(*) AS num_lin_reps
      FROM _diag_sinkcounts
      GROUP BY n
      ORDER BY n
    `);
    console.log('  sink_count -> num_lin_reps:');
    for (const r of dist) console.log(`    n=${r.sink_count}: ${r.num_lin_reps} lin_rep group(s)`);

    const { rows: totalLin } = await client.query('SELECT count(*) FROM _dt_lin');
    const { rows: totalGroups } = await client.query('SELECT count(DISTINCT lin_rep) FROM _dt_lin');
    console.log(`  total permids: ${totalLin[0].count}, total lin_rep groups: ${totalGroups[0].count}`);

    // lin_rep groups with NO row in sink_counts at all means... actually every
    // lin_rep should appear (even n=0 rows come from a lin_rep with sinks
    // computed as empty set -- wait, GROUP BY on an empty set produces NO row,
    // so n=0 cases don't actually show up in sink_counts at all! Every lin_rep
    // NOT in _diag_sinkcounts is implicitly n=0. Compute that explicitly:
    const { rows: implicitZero } = await client.query(`
      SELECT count(*) FROM (
        SELECT DISTINCT lin_rep FROM _dt_lin
        EXCEPT
        SELECT lin_rep FROM _diag_sinkcounts
      ) x
    `);
    console.log(`  lin_rep groups with ZERO sinks (lineage-level cycle candidates, implicit -- absent from GROUP BY): ${implicitZero[0].count}`);

    const degenerateExplicit = dist.filter((r) => Number(r.sink_count) !== 1).reduce((a, r) => a + Number(r.num_lin_reps), 0);
    console.log(`  degenerate groups feeding the LATERAL tiebreak (explicit n!=1 rows + implicit n=0): ${degenerateExplicit + Number(implicitZero[0].count)}`);
  } finally {
    await client.query('DROP TABLE IF EXISTS _diag_sinkcounts').catch(() => {});
    client.release();
    await closePgPlay();
  }
}

main().catch((err) => {
  console.error('Diagnostic failed:', err);
  process.exitCode = 1;
});
