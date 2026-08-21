// _dt_linmeta as a whole is the confirmed bottleneck (6+ min, vs <4s for
// everything before it), but the LATERAL degenerate-group tiebreak turned out
// to fire on ZERO groups (diagnose-sink-degeneracy.js) -- so something else in
// that statement is slow. This splits it into its actual sub-CTEs as separate
// timed temp tables: eligible, roots (sc.n=1 branch only, now known to be the
// only branch that ever contributes), spelling, then the final join +
// correlated subquery on its own.
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
    console.log(`[${new Date().toISOString()}] Rebuilding cheap prerequisites (identity, edge_cand, permid_edge, lin_winner, lin, valid)...`);
    await client.query(`
      DROP TABLE IF EXISTS _dt_identity, _dt_edge_cand, _dt_permid_edge, _dt_lin_winner, _dt_lin, _dt_valid
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

    await timed(client, '_dt_valid', `
      CREATE TEMP TABLE _dt_valid AS
      WITH cand AS (
        SELECT v.subject_permid AS permid, v.nomenclatural_status_id, v.id AS opinion_id,
               v.evidence,
               COALESCE(v.publication_year, NULLIF(r.reference->>'publicationYear','')::int) AS yr,
               ns.bars_candidacy,
               row_number() OVER (PARTITION BY v.subject_permid
                   ORDER BY v.evidence DESC,
                            COALESCE(v.publication_year, NULLIF(r.reference->>'publicationYear','')::int) DESC NULLS LAST,
                            v.id DESC) AS rn
        FROM validity_opinions v
        JOIN dictionaries.nomenclatural_statuses ns ON ns.id = v.nomenclatural_status_id
        LEFT JOIN refs r ON r.id = v.reference_id
        WHERE v.removed IS NOT TRUE AND v.succeeded_by_id IS NULL
      )
      SELECT permid, nomenclatural_status_id, opinion_id AS winning_validity_opinion_id, bars_candidacy
      FROM cand WHERE rn = 1
    `);
    await client.query('CREATE INDEX ON _dt_valid(permid); ANALYZE _dt_valid');

    console.log('');
    console.log(`[${new Date().toISOString()}] Splitting _dt_linmeta into its own sub-CTEs, materialized + timed separately...`);

    await client.query('DROP TABLE IF EXISTS _diag_eligible, _diag_sinks, _diag_sink_counts, _diag_roots, _diag_spelling');

    await timed(client, 'eligible', `
      CREATE TEMP TABLE _diag_eligible AS
      SELECT pe.permid, pe.evidence, pe.yr, pe.opinion_id
      FROM _dt_permid_edge pe
      LEFT JOIN _dt_valid dv ON dv.permid = pe.permid
      WHERE pe.never_accepted = false AND COALESCE(dv.bars_candidacy, false) = false
    `);
    await client.query('CREATE INDEX ON _diag_eligible(permid); ANALYZE _diag_eligible');
    const { rows: eligCount } = await client.query('SELECT count(*) FROM _diag_eligible');
    console.log(`    -> ${eligCount[0].count} rows`);

    await timed(client, 'sinks', `
      CREATE TEMP TABLE _diag_sinks AS
      SELECT l.lin_rep, l.permid FROM _dt_lin l
      WHERE NOT EXISTS (SELECT 1 FROM _dt_lin_winner w WHERE w.negates = false AND w.permid = l.permid)
    `);
    await client.query('CREATE INDEX ON _diag_sinks(lin_rep)');

    await timed(client, 'sink_counts', `
      CREATE TEMP TABLE _diag_sink_counts AS
      SELECT lin_rep, count(*) AS n FROM _diag_sinks GROUP BY lin_rep
    `);
    await client.query('CREATE INDEX ON _diag_sink_counts(lin_rep); ANALYZE _diag_sink_counts');

    // Known from diagnose-sink-degeneracy.js: every group has n=1, so this is
    // just the first UNION ALL branch of the real `roots` CTE.
    await timed(client, 'roots (n=1 branch only -- confirmed the only one that fires)', `
      CREATE TEMP TABLE _diag_roots AS
      SELECT sc.lin_rep, s.permid AS original_permid
      FROM _diag_sink_counts sc JOIN _diag_sinks s ON s.lin_rep = sc.lin_rep
      WHERE sc.n = 1
    `);
    await client.query('CREATE INDEX ON _diag_roots(lin_rep); ANALYZE _diag_roots');
    const { rows: rootsCount } = await client.query('SELECT count(*) FROM _diag_roots');
    console.log(`    -> ${rootsCount[0].count} rows`);

    await timed(client, 'spelling', `
      CREATE TEMP TABLE _diag_spelling AS
      SELECT l.lin_rep, e.permid, di.rank_id,
             row_number() OVER (PARTITION BY l.lin_rep ORDER BY e.evidence DESC, e.yr DESC NULLS LAST, e.opinion_id DESC) AS rn,
             e.evidence AS acc_ev, e.yr AS acc_yr, e.opinion_id AS acc_id
      FROM _dt_lin l JOIN _diag_eligible e ON e.permid = l.permid JOIN _dt_identity di ON di.permid = e.permid
    `);
    await client.query('CREATE INDEX ON _diag_spelling(lin_rep); ANALYZE _diag_spelling');
    const { rows: spellingCount } = await client.query('SELECT count(*) FROM _diag_spelling');
    console.log(`    -> ${spellingCount[0].count} rows`);

    await timed(client, 'final join (roots + spelling WHERE rn=1, no correlated subquery)', `
      CREATE TEMP TABLE _diag_linmeta_nosubq AS
      SELECT s.lin_rep, r.original_permid, s.permid AS accepted_spelling_permid, s.rank_id AS accepted_rank_id,
             s.acc_ev, s.acc_yr, s.acc_id
      FROM _diag_spelling s JOIN _diag_roots r ON r.lin_rep = s.lin_rep WHERE s.rn = 1
    `);
    const { rows: finalCount } = await client.query('SELECT count(*) FROM _diag_linmeta_nosubq');
    console.log(`    -> ${finalCount[0].count} rows`);

    await timed(client, 'the correlated subquery alone (original_yr per row)', `
      CREATE TEMP TABLE _diag_linmeta_full AS
      SELECT m.*,
             (SELECT COALESCE(pe2.yr, 999999) FROM _dt_permid_edge pe2 WHERE pe2.permid = m.original_permid) AS original_yr
      FROM _diag_linmeta_nosubq m
    `);
    const { rows: fullCount } = await client.query('SELECT count(*) FROM _diag_linmeta_full');
    console.log(`    -> ${fullCount[0].count} rows`);
  } finally {
    await client.query(`
      DROP TABLE IF EXISTS _diag_eligible, _diag_sinks, _diag_sink_counts, _diag_roots, _diag_spelling,
        _diag_linmeta_nosubq, _diag_linmeta_full
    `).catch(() => {});
    client.release();
    await closePgPlay();
  }
}

main().catch((err) => {
  console.error('Diagnostic failed:', err);
  process.exitCode = 1;
});
