// Task 2.6 for openspec/changes/fix-dt-assign-containment-cycle: there is no
// automated fixture-comparison harness for the 48 opinion pairs (per
// opinions-validation-status memory, that validation was live-probing, not a
// persisted expected-output suite) -- and the two obvious substitutes don't
// work either: `derive_taxa(NULL)` (real, unfixed) already raises on the 73
// self-loops today, and re-running run-full-migration.js only re-seeds Layer 1
// tables, which this change never touches.
//
// So this does the regression check the change actually needs directly:
// build the FIXED pipeline through _dt_node, peel (find-containment-cycle.js's
// method) to find every concept downstream of ANY remaining cycle (the
// separate Eukarya/Eumetazoa one -- see containment-cycle-open-problem
// memory), sample concept_permids from the SAFE complement (unaffected by
// either this fix or the separate cycle), and diff derive_taxa(seed) (real,
// still unfixed) against derive_taxa_analyzed(seed) (fixed) row-for-row.
// Equality confirms this fix changes nothing for concepts it isn't meant to
// touch.
import { pgPlay, closePgPlay } from '../../pg-play-pool.js';

const SAMPLE_SIZE = 500;

function ms(ns) { return Number(ns) / 1e6; }

async function main() {
  const client = await pgPlay.connect();
  try {
    console.log(`[${new Date().toISOString()}] Rebuilding FIXED pipeline through _dt_node...`);
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
    await client.query(`
      CREATE TEMP TABLE _dt_con_winner AS
      WITH cand AS MATERIALIZED (
        SELECT ls.lin_rep AS jr, lt.lin_rep AS sr, n.evidence,
               COALESCE(n.publication_year, NULLIF(r.reference->>'publicationYear','')::int) AS yr,
               n.id AS opinion_id, n.negates
        FROM name_opinions n
        JOIN _dt_lin ls ON ls.permid = n.subject_permid
        JOIN _dt_lin lt ON lt.permid = n.target_permid
        LEFT JOIN refs r ON r.id = n.reference_id
        WHERE n.removed IS NOT TRUE AND n.succeeded_by_id IS NULL AND n.edge_class = 'concept'
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
        LEFT JOIN refs r ON r.id = a.reference_id
        LEFT JOIN _dt_lin ccl ON ccl.permid = a.containing_permid
        LEFT JOIN _dt_con ccc ON ccc.lin_rep = ccl.lin_rep
        WHERE a.removed IS NOT TRUE AND a.succeeded_by_id IS NULL
          AND ( sl.lin_rep = cm.senior_lin
                OR (cm.concept_rank_name <> 'species' AND lm.accepted_rank_id = cm.concept_rank_id) )
          AND ccc.con_rep IS DISTINCT FROM cm.con_rep
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

    console.log(`[${new Date().toISOString()}] Peeling to find the safe (non-cycle-downstream) complement...`);
    await client.query('DROP TABLE IF EXISTS _cyc_active');
    await client.query(`
      CREATE TEMP TABLE _cyc_active AS
      SELECT concept_permid, containing_concept_permid
      FROM _dt_node WHERE containing_concept_permid IS NOT NULL
    `);
    await client.query('CREATE INDEX ON _cyc_active(concept_permid)');
    await client.query('ANALYZE _cyc_active');
    let round = 0;
    while (true) {
      round++;
      const { rowCount } = await client.query(`
        DELETE FROM _cyc_active a
        WHERE NOT EXISTS (SELECT 1 FROM _cyc_active b WHERE b.concept_permid = a.containing_concept_permid)
      `);
      if (rowCount === 0) break;
    }
    const { rows: survivorCount } = await client.query('SELECT count(*) FROM _cyc_active');
    console.log(`  Peeling converged after ${round} rounds. Cycle-downstream survivors: ${survivorCount[0].count}`);

    console.log(`[${new Date().toISOString()}] Sampling ${SAMPLE_SIZE} safe concept_permids...`);
    const { rows: sample } = await client.query(`
      SELECT dn.concept_permid AS permid
      FROM _dt_node dn
      WHERE NOT EXISTS (SELECT 1 FROM _cyc_active c WHERE c.concept_permid = dn.concept_permid)
      ORDER BY random()
      LIMIT ${SAMPLE_SIZE}
    `);
    const seed = sample.map((r) => r.permid);
    console.log(`  Sampled ${seed.length} permids.`);

    console.log(`[${new Date().toISOString()}] Running derive_taxa(seed) (real, unfixed)...`);
    const t0 = process.hrtime.bigint();
    const { rows: oldRows } = await client.query('SELECT * FROM derive_taxa($1::uuid[]) ORDER BY permid', [seed]);
    console.log(`  ${oldRows.length} rows, ${ms(process.hrtime.bigint() - t0).toFixed(1)} ms`);

    console.log(`[${new Date().toISOString()}] Running derive_taxa_analyzed(seed) (fixed)...`);
    const t1 = process.hrtime.bigint();
    const { rows: newRows } = await client.query('SELECT * FROM derive_taxa_analyzed($1::uuid[]) ORDER BY permid', [seed]);
    console.log(`  ${newRows.length} rows, ${ms(process.hrtime.bigint() - t1).toFixed(1)} ms`);

    console.log('');
    console.log('=== Diffing row sets ===');
    if (oldRows.length !== newRows.length) {
      console.log(`  ROW COUNT MISMATCH: old=${oldRows.length} new=${newRows.length}`);
    }
    const byPermidOld = new Map(oldRows.map((r) => [r.permid, r]));
    const byPermidNew = new Map(newRows.map((r) => [r.permid, r]));
    let diffs = 0;
    const allPermids = new Set([...byPermidOld.keys(), ...byPermidNew.keys()]);
    for (const p of allPermids) {
      const o = byPermidOld.get(p);
      const n = byPermidNew.get(p);
      if (!o || !n) {
        diffs++;
        console.log(`  permid ${p}: present in ${o ? 'old only' : 'new only'}`);
        continue;
      }
      const keys = Object.keys(o);
      const mismatched = keys.filter((k) => String(o[k]) !== String(n[k]));
      if (mismatched.length > 0) {
        diffs++;
        console.log(`  permid ${p} ("${o.name}") differs on: ${mismatched.join(', ')}`);
        for (const k of mismatched) console.log(`    ${k}: old=${o[k]} new=${n[k]}`);
      }
    }
    console.log(`  Total differing permids: ${diffs} / ${allPermids.size} sampled`);
  } finally {
    await client.query('DROP TABLE IF EXISTS _cyc_active').catch(() => {});
    client.release();
    await closePgPlay();
  }
}

main().catch((err) => {
  console.error('Regression check failed:', err);
  process.exitCode = 1;
});
