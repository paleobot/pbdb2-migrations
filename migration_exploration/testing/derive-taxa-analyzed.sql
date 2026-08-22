-- Test-only patched copy of derive_taxa() (postgresql/create_new.sql lines
-- 5068-5447), with two classes of change from the original, both isolated as
-- test variables rather than a rewrite:
--   1. ANALYZE (+ a few indexes) added right after every CREATE TEMP TABLE.
--   2. Every genuine non-recursive CTE marked AS MATERIALIZED, so Postgres
--      plans/executes each stage independently instead of inlining them into
--      one combined plan. CONFIRMED root cause for _dt_linmeta specifically
--      (6+ min -> 3.06s with this alone, isolated in
--      test-materialized-linmeta.js) -- applied here to every other
--      multi-CTE block with the same shape (_dt_con_winner, _dt_conmeta,
--      _dt_assign) plus the smaller single-CTE ones for consistency
--      (_dt_permid_edge, _dt_lin_winner, _dt_valid). The RECURSIVE CTEs
--      themselves (reach, p, walk) are left unmarked -- they can't be inlined
--      regardless of the hint, since they self-reference -- but their plain
--      non-recursive helper CTEs (lin_undir, con_edge, con_undir) are marked.
--
-- Deployed as a separate function name (derive_taxa_analyzed) so the original
-- derive_taxa() is untouched. Not meant to be kept -- drop after benchmarking.
CREATE OR REPLACE FUNCTION derive_taxa_analyzed(seed uuid[] DEFAULT NULL)
RETURNS TABLE (
    permid uuid,
    name text,
    rank_id integer,
    authority_id bigint,
    original_permid uuid,
    accepted_spelling_permid uuid,
    concept_permid uuid,
    containing_concept_permid uuid,
    classification_path ltree,
    nomenclatural_status_id integer,
    winning_name_opinion_id bigint,
    winning_assignment_opinion_id bigint,
    winning_validity_opinion_id bigint
) LANGUAGE plpgsql AS $fn$
#variable_conflict use_column
BEGIN
    -- ---- identity: one row per minted permid, from its own root row only ---
    DROP TABLE IF EXISTS _dt_identity;
    CREATE TEMP TABLE _dt_identity AS
    SELECT n.subject_permid AS permid, n.id AS opinion_id, n.new_name, n.rank_id, n.authority_id
    FROM name_opinions n
    WHERE n.removed IS NOT TRUE AND n.succeeded_by_id IS NULL
      AND n.edge_class = 'root';
    CREATE INDEX ON _dt_identity(permid);
    ANALYZE _dt_identity;

    IF EXISTS (SELECT 1 FROM _dt_identity GROUP BY permid HAVING count(*) > 1) THEN
        RAISE EXCEPTION 'derive_taxa_analyzed: permid % has more than one live root row (identity re-minted)',
            (SELECT permid FROM _dt_identity GROUP BY permid HAVING count(*) > 1 LIMIT 1);
    END IF;

    -- ---- candidate introducing edges: one row per (permid, opinion) --------
    DROP TABLE IF EXISTS _dt_edge_cand;
    CREATE TEMP TABLE _dt_edge_cand AS
    SELECT n.subject_permid AS permid, n.id AS opinion_id, n.edge_class, n.target_permid,
           n.evidence,
           COALESCE(n.publication_year, NULLIF(r.reference->>'publicationYear','')::int) AS yr,
           nr.never_accepted, n.negates
    FROM name_opinions n
    JOIN dictionaries.namechange_reasons nr ON nr.id = n.reason_id
    LEFT JOIN refs r ON r.id = n.reference_id
    WHERE n.removed IS NOT TRUE AND n.succeeded_by_id IS NULL
      AND n.edge_class IN ('root','lineage');
    CREATE INDEX ON _dt_edge_cand(permid);
    ANALYZE _dt_edge_cand;

    DROP TABLE IF EXISTS _dt_permid_edge;
    CREATE TEMP TABLE _dt_permid_edge AS
    WITH ranked AS MATERIALIZED (
        SELECT permid, opinion_id, evidence, yr, never_accepted,
               row_number() OVER (PARTITION BY permid
                   ORDER BY evidence DESC, yr DESC NULLS LAST, opinion_id DESC) AS rn
        FROM _dt_edge_cand
        WHERE negates = false
    )
    SELECT permid, opinion_id, evidence, yr, never_accepted FROM ranked WHERE rn = 1;
    CREATE INDEX ON _dt_permid_edge(permid);
    ANALYZE _dt_permid_edge;

    DROP TABLE IF EXISTS _dt_lin_winner;
    CREATE TEMP TABLE _dt_lin_winner AS
    WITH ranked AS MATERIALIZED (
        SELECT permid, target_permid, negates,
               row_number() OVER (PARTITION BY permid
                   ORDER BY evidence DESC, yr DESC NULLS LAST, opinion_id DESC) AS rn
        FROM _dt_edge_cand
        WHERE edge_class = 'lineage'
    )
    SELECT permid, target_permid, negates FROM ranked WHERE rn = 1;
    CREATE INDEX ON _dt_lin_winner(permid);
    ANALYZE _dt_lin_winner;

    -- ---- lineage union-find --------------------------------------------------
    DROP TABLE IF EXISTS _dt_lin;
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
    SELECT src AS permid, min(node::text)::uuid AS lin_rep FROM reach GROUP BY src;
    CREATE INDEX ON _dt_lin(permid);
    CREATE INDEX ON _dt_lin(lin_rep);
    ANALYZE _dt_lin;

    -- ---- validity per permid ------------------------------------------------
    DROP TABLE IF EXISTS _dt_valid;
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
    SELECT permid, nomenclatural_status_id, opinion_id AS winning_validity_opinion_id,
           bars_candidacy
    FROM cand WHERE rn = 1;
    CREATE INDEX ON _dt_valid(permid);
    ANALYZE _dt_valid;

    -- ---- per-lineage: eligibility, topological original_permid, accepted ---
    -- spelling ----------------------------------------------------------------
    -- CONFIRMED: this statement alone took 6+ min with plain CTEs and 3.06s
    -- with all five marked MATERIALIZED (test-materialized-linmeta.js), with
    -- ZERO changes to the query logic. Root cause was CTE inlining, not the
    -- LATERAL degenerate-group branch (which fires on 0 of 400,113 groups in
    -- the real data -- diagnose-sink-degeneracy.js) and not missing stats.
    DROP TABLE IF EXISTS _dt_linmeta;
    CREATE TEMP TABLE _dt_linmeta AS
    WITH
    eligible AS MATERIALIZED (
        SELECT pe.permid, pe.evidence, pe.yr, pe.opinion_id
        FROM _dt_permid_edge pe
        LEFT JOIN _dt_valid dv ON dv.permid = pe.permid
        WHERE pe.never_accepted = false
          AND COALESCE(dv.bars_candidacy, false) = false
    ),
    sinks AS MATERIALIZED (
        SELECT l.lin_rep, l.permid
        FROM _dt_lin l
        WHERE NOT EXISTS (
            SELECT 1 FROM _dt_lin_winner w
            WHERE w.negates = false AND w.permid = l.permid
        )
    ),
    sink_counts AS MATERIALIZED (
        SELECT lin_rep, count(*) AS n FROM sinks GROUP BY lin_rep
    ),
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
        FROM _dt_lin l
        JOIN eligible e ON e.permid = l.permid
        JOIN _dt_identity di ON di.permid = e.permid
    )
    SELECT s.lin_rep,
           r.original_permid,
           s.permid AS accepted_spelling_permid,
           s.rank_id AS accepted_rank_id,
           s.acc_ev, s.acc_yr, s.acc_id,
           (SELECT COALESCE(pe2.yr, 999999) FROM _dt_permid_edge pe2
             WHERE pe2.permid = r.original_permid) AS original_yr
    FROM spelling s JOIN roots r ON r.lin_rep = s.lin_rep
    WHERE s.rn = 1;
    CREATE INDEX ON _dt_linmeta(lin_rep);
    ANALYZE _dt_linmeta;

    -- Concept-class (synonymy) edges never merge a lineage accepted at rank
    -- unranked(25)/unranked clade(24) into another lineage's concept, on
    -- either side -- these are cladistic ranks, not part of the Linnaean
    -- containment system, and letting them merge is exactly the mechanism
    -- that produced 16 of 18 real containment cycles found in pg_play
    -- (see openspec/changes/fix-eukarya-eumetazoa-containment-cycle/).
    -- Checked via _dt_linmeta.accepted_rank_id (the LINEAGE's accepted rank),
    -- not the raw opinion's own subject/target permid -- a permid-level
    -- check left a loophole (18->4 instead of 18->2) where a concept's
    -- senior spelling is unranked but the specific lineage-mate an opinion
    -- cites as subject/target isn't.
    DROP TABLE IF EXISTS _dt_con_winner;
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
        LEFT JOIN refs r ON r.id = n.reference_id
        WHERE n.removed IS NOT TRUE AND n.succeeded_by_id IS NULL AND n.edge_class = 'concept'
          AND lm_s.accepted_rank_id NOT IN (24, 25) AND lm_t.accepted_rank_id NOT IN (24, 25)
    ),
    ranked AS MATERIALIZED (
        SELECT jr, sr, negates,
               row_number() OVER (PARTITION BY jr
                   ORDER BY evidence DESC, yr DESC NULLS LAST, opinion_id DESC) AS rn
        FROM cand
    )
    SELECT jr, sr, negates FROM ranked WHERE rn = 1;
    CREATE INDEX ON _dt_con_winner(jr);
    ANALYZE _dt_con_winner;

    -- ---- concept union-find --------------------------------------------------
    DROP TABLE IF EXISTS _dt_con;
    CREATE TEMP TABLE _dt_con AS
    WITH RECURSIVE
    con_edge AS MATERIALIZED (
        SELECT jr, sr FROM _dt_con_winner WHERE negates = false
    ),
    con_undir AS MATERIALIZED (
        SELECT jr AS a, sr AS b FROM con_edge UNION SELECT sr, jr FROM con_edge
    ),
    reach(src, node) AS (
        SELECT DISTINCT lin_rep, lin_rep FROM _dt_lin
        UNION
        SELECT r.src, u.b FROM reach r JOIN con_undir u ON u.a = r.node
    )
    SELECT src AS lin_rep, min(node::text)::uuid AS con_rep FROM reach GROUP BY src;
    CREATE INDEX ON _dt_con(lin_rep);
    CREATE INDEX ON _dt_con(con_rep);
    ANALYZE _dt_con;

    -- senior lineage per concept + concept_permid/rank
    DROP TABLE IF EXISTS _dt_conmeta;
    CREATE TEMP TABLE _dt_conmeta AS
    WITH con_sources AS MATERIALIZED (
        SELECT DISTINCT jr FROM _dt_con_winner WHERE negates = false
    ),
    ranked AS MATERIALIZED (
        SELECT c.con_rep, c.lin_rep,
               row_number() OVER (PARTITION BY c.con_rep ORDER BY
                   (cs.jr IS NULL) DESC,
                   lm.acc_ev DESC, lm.acc_yr DESC NULLS LAST, lm.acc_id DESC,
                   lm.original_yr ASC,
                   lm.original_permid ASC) AS rn
        FROM _dt_con c
        JOIN _dt_linmeta lm ON lm.lin_rep = c.lin_rep
        LEFT JOIN con_sources cs ON cs.jr = c.lin_rep
    )
    SELECT r.con_rep, r.lin_rep AS senior_lin,
           lm.accepted_spelling_permid AS concept_permid,
           lm.accepted_rank_id AS concept_rank_id,
           tr.taxonomy_rank AS concept_rank_name
    FROM ranked r
    JOIN _dt_linmeta lm ON lm.lin_rep = r.lin_rep
    JOIN dictionaries.taxonomy_ranks tr ON tr.id = lm.accepted_rank_id
    WHERE r.rn = 1;
    CREATE INDEX ON _dt_conmeta(con_rep);
    ANALYZE _dt_conmeta;

    -- ---- classification: winning assignment pooled across the concept ------
    -- Self-referential candidates (containing_permid resolves back to the
    -- subject's own concept) are excluded here, before ranking -- not just
    -- detected after -- so a concept whose only candidate(s) are
    -- self-referential ends up with zero _dt_assign rows, which _dt_node's
    -- LEFT JOIN already turns into containing_concept_permid = NULL
    -- (rootless), the same outcome already used for "no container asserted".
    -- See openspec/changes/fix-dt-assign-containment-cycle/.
    --
    -- Candidates are also excluded when either the subject's or the
    -- containing permid's lineage is accepted at rank unranked(25)/unranked
    -- clade(24) -- these cladistic ranks SHALL NOT be assigned a
    -- containing_concept_permid of their own, and SHALL NOT be eligible to
    -- serve as another concept's container. See
    -- openspec/changes/fix-eukarya-eumetazoa-containment-cycle/.
    --
    -- Candidates are also excluded on rank cardinality: a container SHALL
    -- NOT be more finely ranked than what it contains. Equal rank is
    -- permitted (e.g. one genus containing another is a legitimate, common
    -- pattern independent of the equal-rank-borrowing branch below) -- only
    -- a genuine inversion (containing lineage strictly finer than the
    -- subject lineage) is excluded. This is what fixed the last 2 real
    -- containment cycles (Hyriidae/Hyriinae, Elasmotheriini/Elasmotheriina),
    -- neither of which involved unranked ranks at all. See
    -- openspec/changes/fix-eukarya-eumetazoa-containment-cycle/.
    DROP TABLE IF EXISTS _dt_assign;
    CREATE TEMP TABLE _dt_assign AS
    WITH cand AS MATERIALIZED (
        SELECT cm.con_rep, a.id AS opinion_id, a.containing_permid,
               a.evidence,
               COALESCE(a.publication_year, NULLIF(r.reference->>'publicationYear','')::int) AS yr
        FROM assignment_opinions a
        JOIN _dt_lin sl ON sl.permid = a.subject_permid
        JOIN _dt_con  sc ON sc.lin_rep = sl.lin_rep
        JOIN _dt_conmeta cm ON cm.con_rep = sc.con_rep
        JOIN _dt_linmeta lm ON lm.lin_rep = sl.lin_rep
        LEFT JOIN refs r ON r.id = a.reference_id
        LEFT JOIN _dt_lin ccl ON ccl.permid = a.containing_permid
        LEFT JOIN _dt_con ccc ON ccc.lin_rep = ccl.lin_rep
        LEFT JOIN _dt_linmeta ccm ON ccm.lin_rep = ccl.lin_rep
        WHERE a.removed IS NOT TRUE AND a.succeeded_by_id IS NULL
          AND ( sl.lin_rep = cm.senior_lin
                OR (cm.concept_rank_name <> 'species'
                    AND lm.accepted_rank_id = cm.concept_rank_id) )
          AND ccc.con_rep IS DISTINCT FROM cm.con_rep
          AND lm.accepted_rank_id NOT IN (24, 25)
          AND (ccm.accepted_rank_id IS NULL OR ccm.accepted_rank_id NOT IN (24, 25))
          AND (ccm.accepted_rank_id IS NULL OR ccm.accepted_rank_id >= lm.accepted_rank_id)
    ),
    win AS MATERIALIZED (
        SELECT con_rep, opinion_id, containing_permid,
               row_number() OVER (PARTITION BY con_rep
                   ORDER BY evidence DESC, yr DESC NULLS LAST, opinion_id DESC) AS rn
        FROM cand
    )
    SELECT w.con_rep, w.opinion_id AS winning_assignment_opinion_id,
           cc.con_rep AS containing_con_rep
    FROM win w
    LEFT JOIN _dt_lin cl ON cl.permid = w.containing_permid
    LEFT JOIN _dt_con cc ON cc.lin_rep = cl.lin_rep
    WHERE w.rn = 1;
    CREATE INDEX ON _dt_assign(con_rep);
    ANALYZE _dt_assign;

    -- ---- per-concept node (concept_permid, containing_concept_permid) ------
    DROP TABLE IF EXISTS _dt_node;
    CREATE TEMP TABLE _dt_node AS
    SELECT cm.con_rep, cm.concept_permid, cm.concept_rank_id,
           ccm.concept_permid AS containing_concept_permid,
           a.winning_assignment_opinion_id
    FROM _dt_conmeta cm
    LEFT JOIN _dt_assign a ON a.con_rep = cm.con_rep
    LEFT JOIN _dt_conmeta ccm ON ccm.con_rep = a.containing_con_rep;
    CREATE INDEX ON _dt_node(con_rep);
    CREATE INDEX ON _dt_node(concept_permid);
    CREATE INDEX ON _dt_node(containing_concept_permid);
    ANALYZE _dt_node;

    -- ---- containment cycle guard (raises) ---------------------------------
    -- NOTE: this walk is itself a suspected further pathology (explores from
    -- every starting node up to depth 10000 before checking for a match) --
    -- left untouched here since fixing/replacing it is a separate question
    -- from the CTE-inlining fix above; a real cycle exists in the current
    -- pg_play data (see find-containment-cycle.js) so this WILL still raise.
    IF EXISTS (
        WITH RECURSIVE walk AS (
            SELECT con_rep, containing_concept_permid, 1 AS depth
            FROM _dt_node WHERE containing_concept_permid IS NOT NULL
            UNION ALL
            SELECT w.con_rep, n.containing_concept_permid, w.depth + 1
            FROM walk w
            JOIN _dt_node cn ON cn.concept_permid = w.containing_concept_permid
            JOIN _dt_node n  ON n.con_rep = cn.con_rep
            WHERE w.depth < 10000
              AND n.containing_concept_permid IS NOT NULL
        )
        SELECT 1 FROM walk w JOIN _dt_node self ON self.con_rep = w.con_rep
        WHERE w.containing_concept_permid = self.concept_permid
    ) THEN
        RAISE EXCEPTION 'derive_taxa_analyzed: classification containment cycle detected';
    END IF;

    -- ---- classification_path (root -> node) -------------------------------
    DROP TABLE IF EXISTS _dt_path;
    CREATE TEMP TABLE _dt_path AS
    WITH RECURSIVE p AS (
        SELECT con_rep, concept_permid, containing_concept_permid,
               text2ltree(replace(concept_permid::text,'-','_')) AS classification_path
        FROM _dt_node WHERE containing_concept_permid IS NULL
        UNION ALL
        SELECT cn.con_rep, cn.concept_permid, cn.containing_concept_permid,
               pp.classification_path || replace(cn.concept_permid::text,'-','_')
        FROM _dt_node cn
        JOIN _dt_node parent ON parent.concept_permid = cn.containing_concept_permid
        JOIN p pp ON pp.con_rep = parent.con_rep
    )
    SELECT con_rep, classification_path FROM p;
    CREATE INDEX ON _dt_path(con_rep);
    ANALYZE _dt_path;

    -- ---- assemble one row per minted permid -------------------------------
    RETURN QUERY
    SELECT
        m.permid,
        m.new_name,
        m.rank_id,
        m.authority_id,
        lm.original_permid,
        lm.accepted_spelling_permid,
        cm.concept_permid,
        nd.containing_concept_permid,
        pth.classification_path,
        vv.nomenclatural_status_id,
        pe.opinion_id AS winning_name_opinion_id,
        nd.winning_assignment_opinion_id,
        vv.winning_validity_opinion_id
    FROM _dt_identity m
    JOIN _dt_permid_edge pe ON pe.permid = m.permid
    JOIN _dt_lin      l   ON l.permid = m.permid
    JOIN _dt_linmeta  lm  ON lm.lin_rep = l.lin_rep
    JOIN _dt_con      c   ON c.lin_rep = l.lin_rep
    JOIN _dt_conmeta  cm  ON cm.con_rep = c.con_rep
    JOIN _dt_node     nd  ON nd.con_rep = c.con_rep
    LEFT JOIN _dt_path pth ON pth.con_rep = c.con_rep
    LEFT JOIN _dt_valid vv ON vv.permid = m.permid
    WHERE seed IS NULL OR m.permid = ANY(seed);
END;
$fn$;
