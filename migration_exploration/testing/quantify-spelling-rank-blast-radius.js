// Quantifies the blast radius of the NEW "spelling-rank consistency" rule
// (test-spelling-rank-consistency.js), on top of the already-shipped
// self-reference + unranked-rank exclusions. Same before/after methodology as
// quantify-unranked-blast-radius.js: BEFORE = shipped fixes only, AFTER =
// shipped fixes + the new rule, restricted to concepts NOT downstream of the
// 2 known remaining cycles (Elasmotheriini/Elasmotheriina, Hyriidae/Hyriinae),
// so the count reflects unintended collateral changes, not the intended fix.
import { pgPlay, closePgPlay } from '../../pg-play-pool.js';

function ms(ns) { return Number(ns) / 1e6; }

async function buildPipeline(client, { spellingRankConsistency }) {
  await client.query(`
    DROP TABLE IF EXISTS _dt_identity, _dt_edge_cand, _dt_permid_edge, _dt_lin_winner,
      _dt_lin, _dt_valid, _dt_linmeta, _dt_con_winner, _dt_con, _dt_conmeta, _dt_assign, _dt_node
  `);
  await client.query(`
    CREATE TEMP TABLE _dt_identity AS
    SELECT n.subject_permid AS permid, n.id AS opinion_id, n.new_name, n.rank_id, n.authority_id
    FROM name_opinions n
    WHERE n.removed IS NOT TRUE AND n.succeeded_by_id IS NULL AND n.edge_class = 'root'
  `);
  await client.query('CREATE INDEX ON _dt_identity(permid); ANALYZE _dt_identity');
  await client.query(`
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
  await client.query(`
    CREATE TEMP TABLE _dt_permid_edge AS
    WITH ranked AS MATERIALIZED (
      SELECT permid, opinion_id, evidence, yr, never_accepted,
             row_number() OVER (PARTITION BY permid ORDER BY evidence DESC, yr DESC NULLS LAST, opinion_id DESC) AS rn
      FROM _dt_edge_cand WHERE negates = false
    )
    SELECT permid, opinion_id, evidence, yr, never_accepted FROM ranked WHERE rn = 1
  `);
  await client.query('CREATE INDEX ON _dt_permid_edge(permid); ANALYZE _dt_permid_edge');
  await client.query(`
    CREATE TEMP TABLE _dt_lin_winner AS
    WITH ranked AS MATERIALIZED (
      SELECT permid, target_permid, negates,
             row_number() OVER (PARTITION BY permid ORDER BY evidence DESC, yr DESC NULLS LAST, opinion_id DESC) AS rn
      FROM _dt_edge_cand WHERE edge_class = 'lineage'
    )
    SELECT permid, target_permid, negates FROM ranked WHERE rn = 1
  `);
  await client.query('CREATE INDEX ON _dt_lin_winner(permid); ANALYZE _dt_lin_winner');
  await client.query(`
    CREATE TEMP TABLE _dt_lin AS
    WITH RECURSIVE
    lin_undir AS MATERIALIZED (
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
  await client.query(`
    CREATE TEMP TABLE _dt_valid AS
    WITH cand AS MATERIALIZED (
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
  await client.query(`
    CREATE TEMP TABLE _dt_linmeta AS
    WITH
    eligible AS MATERIALIZED (
      SELECT pe.permid, pe.evidence, pe.yr, pe.opinion_id
      FROM _dt_permid_edge pe
      LEFT JOIN _dt_valid dv ON dv.permid = pe.permid
      WHERE pe.never_accepted = false AND COALESCE(dv.bars_candidacy, false) = false
    ),
    sinks AS MATERIALIZED (
      SELECT l.lin_rep, l.permid FROM _dt_lin l
      WHERE NOT EXISTS (SELECT 1 FROM _dt_lin_winner w WHERE w.negates = false AND w.permid = l.permid)
    ),
    sink_counts AS MATERIALIZED (SELECT lin_rep, count(*) AS n FROM sinks GROUP BY lin_rep),
    roots AS MATERIALIZED (
      SELECT sc.lin_rep, s.permid AS original_permid
      FROM sink_counts sc JOIN sinks s ON s.lin_rep = sc.lin_rep
      WHERE sc.n = 1
      UNION ALL
      SELECT sc.lin_rep,
             (array_agg(cand.permid ORDER BY cand.evidence DESC, cand.yr DESC NULLS LAST,
                        cand.opinion_id DESC, cand.permid))[1]
      FROM sink_counts sc
      JOIN LATERAL (
          SELECT pe.permid, pe.evidence, pe.yr, pe.opinion_id
          FROM (SELECT permid FROM sinks WHERE lin_rep = sc.lin_rep
                UNION ALL
                SELECT l.permid FROM _dt_lin l WHERE l.lin_rep = sc.lin_rep AND sc.n = 0) c
          JOIN _dt_permid_edge pe ON pe.permid = c.permid
      ) cand ON true
      WHERE sc.n != 1
      GROUP BY sc.lin_rep
    ),
    spelling AS MATERIALIZED (
      SELECT l.lin_rep, e.permid, di.rank_id,
             row_number() OVER (PARTITION BY l.lin_rep
                 ORDER BY e.evidence DESC, e.yr DESC NULLS LAST, e.opinion_id DESC) AS rn,
             e.evidence AS acc_ev, e.yr AS acc_yr, e.opinion_id AS acc_id
      FROM _dt_lin l JOIN eligible e ON e.permid = l.permid JOIN _dt_identity di ON di.permid = e.permid
    )
    SELECT s.lin_rep, r.original_permid, s.permid AS accepted_spelling_permid, s.rank_id AS accepted_rank_id,
           s.acc_ev, s.acc_yr, s.acc_id,
           (SELECT COALESCE(pe2.yr, 999999) FROM _dt_permid_edge pe2 WHERE pe2.permid = r.original_permid) AS original_yr
    FROM spelling s JOIN roots r ON r.lin_rep = s.lin_rep WHERE s.rn = 1
  `);
  await client.query('CREATE INDEX ON _dt_linmeta(lin_rep); ANALYZE _dt_linmeta');

  const srcJoin = spellingRankConsistency
    ? `JOIN _dt_identity di_s ON di_s.permid = n.subject_permid
       JOIN _dt_identity di_t ON di_t.permid = n.target_permid`
    : '';
  const srcWhere = spellingRankConsistency
    ? `AND di_s.rank_id = lm_s.accepted_rank_id AND di_t.rank_id = lm_t.accepted_rank_id`
    : '';
  await client.query(`
    CREATE TEMP TABLE _dt_con_winner AS
    WITH cand AS MATERIALIZED (
      SELECT ls.lin_rep AS jr, lt.lin_rep AS sr, n.evidence,
             COALESCE(n.publication_year, NULLIF(r.reference->>'publicationYear','')::int) AS yr,
             n.id AS opinion_id, n.negates
      FROM name_opinions n
      JOIN _dt_lin ls ON ls.permid = n.subject_permid
      JOIN _dt_lin lt ON lt.permid = n.target_permid
      JOIN _dt_linmeta lm_s ON lm_s.lin_rep = ls.lin_rep
      JOIN _dt_linmeta lm_t ON lm_t.lin_rep = lt.lin_rep
      ${srcJoin}
      LEFT JOIN refs r ON r.id = n.reference_id
      WHERE n.removed IS NOT TRUE AND n.succeeded_by_id IS NULL AND n.edge_class = 'concept'
        AND lm_s.accepted_rank_id NOT IN (24, 25) AND lm_t.accepted_rank_id NOT IN (24, 25)
        ${srcWhere}
    ),
    ranked AS MATERIALIZED (
      SELECT jr, sr, negates,
             row_number() OVER (PARTITION BY jr ORDER BY evidence DESC, yr DESC NULLS LAST, opinion_id DESC) AS rn
      FROM cand
    )
    SELECT jr, sr, negates FROM ranked WHERE rn = 1
  `);
  await client.query('CREATE INDEX ON _dt_con_winner(jr); ANALYZE _dt_con_winner');
  await client.query(`
    CREATE TEMP TABLE _dt_con AS
    WITH RECURSIVE
    con_edge AS MATERIALIZED (SELECT jr, sr FROM _dt_con_winner WHERE negates = false),
    con_undir AS MATERIALIZED (SELECT jr AS a, sr AS b FROM con_edge UNION SELECT sr, jr FROM con_edge),
    reach(src, node) AS (
      SELECT DISTINCT lin_rep, lin_rep FROM _dt_lin
      UNION
      SELECT r.src, u.b FROM reach r JOIN con_undir u ON u.a = r.node
    )
    SELECT src AS lin_rep, min(node::text)::uuid AS con_rep FROM reach GROUP BY src
  `);
  await client.query('CREATE INDEX ON _dt_con(lin_rep); CREATE INDEX ON _dt_con(con_rep); ANALYZE _dt_con');
  await client.query(`
    CREATE TEMP TABLE _dt_conmeta AS
    WITH con_sources AS MATERIALIZED (SELECT DISTINCT jr FROM _dt_con_winner WHERE negates = false),
    ranked AS MATERIALIZED (
      SELECT c.con_rep, c.lin_rep,
             row_number() OVER (PARTITION BY c.con_rep ORDER BY
                 (cs.jr IS NULL) DESC,
                 lm.acc_ev DESC, lm.acc_yr DESC NULLS LAST, lm.acc_id DESC,
                 lm.original_yr ASC, lm.original_permid ASC) AS rn
      FROM _dt_con c
      JOIN _dt_linmeta lm ON lm.lin_rep = c.lin_rep
      LEFT JOIN con_sources cs ON cs.jr = c.lin_rep
    )
    SELECT r.con_rep, r.lin_rep AS senior_lin, lm.accepted_spelling_permid AS concept_permid,
           lm.accepted_rank_id AS concept_rank_id, tr.taxonomy_rank AS concept_rank_name
    FROM ranked r
    JOIN _dt_linmeta lm ON lm.lin_rep = r.lin_rep
    JOIN dictionaries.taxonomy_ranks tr ON tr.id = lm.accepted_rank_id
    WHERE r.rn = 1
  `);
  await client.query('CREATE INDEX ON _dt_conmeta(con_rep); ANALYZE _dt_conmeta');

  const assignSrcJoin = spellingRankConsistency
    ? `JOIN _dt_identity di_s ON di_s.permid = a.subject_permid
       LEFT JOIN _dt_identity di_c ON di_c.permid = a.containing_permid`
    : '';
  const assignSrcWhere = spellingRankConsistency
    ? `AND di_s.rank_id = lm.accepted_rank_id
       AND (a.containing_permid IS NULL OR di_c.rank_id = ccm.accepted_rank_id)`
    : '';
  await client.query(`
    CREATE TEMP TABLE _dt_assign AS
    WITH cand AS MATERIALIZED (
      SELECT cm.con_rep, a.id AS opinion_id, a.containing_permid, a.evidence,
             COALESCE(a.publication_year, NULLIF(r.reference->>'publicationYear','')::int) AS yr,
             a.subject_permid
      FROM assignment_opinions a
      JOIN _dt_lin sl ON sl.permid = a.subject_permid
      JOIN _dt_con  sc ON sc.lin_rep = sl.lin_rep
      JOIN _dt_conmeta cm ON cm.con_rep = sc.con_rep
      JOIN _dt_linmeta lm ON lm.lin_rep = sl.lin_rep
      ${assignSrcJoin}
      LEFT JOIN refs r ON r.id = a.reference_id
      LEFT JOIN _dt_lin ccl ON ccl.permid = a.containing_permid
      LEFT JOIN _dt_con ccc ON ccc.lin_rep = ccl.lin_rep
      LEFT JOIN _dt_linmeta ccm ON ccm.lin_rep = ccl.lin_rep
      WHERE a.removed IS NOT TRUE AND a.succeeded_by_id IS NULL
        AND ( sl.lin_rep = cm.senior_lin
              OR (cm.concept_rank_name <> 'species' AND lm.accepted_rank_id = cm.concept_rank_id) )
        AND ccc.con_rep IS DISTINCT FROM cm.con_rep
        AND lm.accepted_rank_id NOT IN (24, 25)
        AND (ccm.accepted_rank_id IS NULL OR ccm.accepted_rank_id NOT IN (24, 25))
        ${assignSrcWhere}
    ),
    win AS MATERIALIZED (
      SELECT con_rep, opinion_id, containing_permid, subject_permid,
             row_number() OVER (PARTITION BY con_rep ORDER BY evidence DESC, yr DESC NULLS LAST, opinion_id DESC) AS rn
      FROM cand
    )
    SELECT w.con_rep, w.opinion_id AS winning_assignment_opinion_id, w.subject_permid, w.containing_permid,
           cc.con_rep AS containing_con_rep
    FROM win w
    LEFT JOIN _dt_lin cl ON cl.permid = w.containing_permid
    LEFT JOIN _dt_con cc ON cc.lin_rep = cl.lin_rep
    WHERE w.rn = 1
  `);
  await client.query('CREATE INDEX ON _dt_assign(con_rep); ANALYZE _dt_assign');
  await client.query(`
    CREATE TEMP TABLE _dt_node AS
    SELECT cm.con_rep, cm.concept_permid, cm.concept_rank_id, cm.concept_rank_name,
           ccm.concept_permid AS containing_concept_permid,
           a.winning_assignment_opinion_id
    FROM _dt_conmeta cm
    LEFT JOIN _dt_assign a ON a.con_rep = cm.con_rep
    LEFT JOIN _dt_conmeta ccm ON ccm.con_rep = a.containing_con_rep
  `);
  await client.query('CREATE INDEX ON _dt_node(concept_permid); ANALYZE _dt_node');
}

async function main() {
  const client = await pgPlay.connect();
  try {
    console.log(`[${new Date().toISOString()}] Building BEFORE pipeline (shipped fixes only, no spelling-rank-consistency)...`);
    let t0 = process.hrtime.bigint();
    await buildPipeline(client, { spellingRankConsistency: false });
    console.log(`  built in ${ms(process.hrtime.bigint() - t0).toFixed(1)} ms`);

    await client.query('DROP TABLE IF EXISTS _dt_node_before');
    await client.query('CREATE TEMP TABLE _dt_node_before AS SELECT * FROM _dt_node');
    await client.query('CREATE INDEX ON _dt_node_before(concept_permid); ANALYZE _dt_node_before');

    console.log('Peeling BEFORE to find the 2-known-cycle downstream survivor set...');
    await client.query('DROP TABLE IF EXISTS _cyc_active');
    await client.query(`
      CREATE TEMP TABLE _cyc_active AS
      SELECT concept_permid, containing_concept_permid
      FROM _dt_node_before WHERE containing_concept_permid IS NOT NULL
    `);
    await client.query('CREATE INDEX ON _cyc_active(concept_permid); ANALYZE _cyc_active');
    let round = 0;
    while (true) {
      round++;
      const { rowCount } = await client.query(`
        DELETE FROM _cyc_active a
        WHERE NOT EXISTS (SELECT 1 FROM _cyc_active b WHERE b.concept_permid = a.containing_concept_permid)
      `);
      if (rowCount === 0) break;
    }
    await client.query('DROP TABLE IF EXISTS _cyc_downstream_before');
    await client.query('CREATE TEMP TABLE _cyc_downstream_before AS SELECT concept_permid FROM _cyc_active');
    await client.query('CREATE INDEX ON _cyc_downstream_before(concept_permid); ANALYZE _cyc_downstream_before');
    const { rows: dsCount } = await client.query('SELECT count(*) FROM _cyc_downstream_before');
    console.log(`  Peeled in ${round} rounds. Downstream-of-a-cycle (BEFORE): ${dsCount[0].count}`);

    console.log(`[${new Date().toISOString()}] Building AFTER pipeline (+ spelling-rank-consistency)...`);
    t0 = process.hrtime.bigint();
    await buildPipeline(client, { spellingRankConsistency: true });
    console.log(`  built in ${ms(process.hrtime.bigint() - t0).toFixed(1)} ms`);

    console.log('');
    console.log('=== Blast radius: concepts NOT downstream of the 2 known cycles, whose containing_concept_permid changes ===');
    const { rows: blastRadius } = await client.query(`
      SELECT
        count(*) FILTER (WHERE b.containing_concept_permid IS NOT NULL AND a.containing_concept_permid IS NULL) AS newly_rootless,
        count(*) FILTER (WHERE b.containing_concept_permid IS NOT NULL AND a.containing_concept_permid IS NOT NULL
                          AND b.containing_concept_permid <> a.containing_concept_permid) AS reassigned,
        count(*) FILTER (WHERE b.containing_concept_permid IS NULL AND a.containing_concept_permid IS NOT NULL) AS newly_contained
      FROM _dt_node_before b
      JOIN _dt_node a ON a.concept_permid = b.concept_permid
      WHERE NOT EXISTS (SELECT 1 FROM _cyc_downstream_before d WHERE d.concept_permid = b.concept_permid)
    `);
    console.log(' ', blastRadius[0]);

    const { rows: totalConcepts } = await client.query('SELECT count(*) FROM _dt_node');
    console.log(`  Out of ${totalConcepts[0].count} total concepts.`);

    console.log('');
    console.log('=== Spot-check: up to 15 examples of any change ===');
    const { rows: sample } = await client.query(`
      SELECT n1.new_name AS concept_name, b.concept_rank_name,
             nb.new_name AS old_containing_name, na.new_name AS new_containing_name
      FROM _dt_node_before b
      JOIN _dt_node a ON a.concept_permid = b.concept_permid
      LEFT JOIN name_opinions n1 ON n1.subject_permid = b.concept_permid AND n1.edge_class = 'root'
      LEFT JOIN name_opinions nb ON nb.subject_permid = b.containing_concept_permid AND nb.edge_class = 'root'
      LEFT JOIN name_opinions na ON na.subject_permid = a.containing_concept_permid AND na.edge_class = 'root'
      WHERE NOT EXISTS (SELECT 1 FROM _cyc_downstream_before d WHERE d.concept_permid = b.concept_permid)
        AND b.containing_concept_permid IS DISTINCT FROM a.containing_concept_permid
      LIMIT 15
    `);
    for (const r of sample) {
      console.log(`  "${r.concept_name}" (${r.concept_rank_name}): "${r.old_containing_name ?? 'NULL'}" -> "${r.new_containing_name ?? 'NULL'}"`);
    }
  } finally {
    await client.query('DROP TABLE IF EXISTS _cyc_active').catch(() => {});
    client.release();
    await closePgPlay();
  }
}

main().catch((err) => {
  console.error('Quantification failed:', err);
  process.exitCode = 1;
});
