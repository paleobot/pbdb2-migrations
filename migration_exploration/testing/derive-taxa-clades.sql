-- Prototype for derive_taxa_clades() — the clade-to-clade hierarchy derive_taxa()
-- deliberately excludes (any concept-class or assignment candidate edge with
-- either side accepted at rank unranked(25)/unranked clade(24) is dropped from
-- _dt_con_winner/_dt_assign today). See:
--   openspec/changes/derive-clade-attachments/proposal.md
--   openspec/changes/derive-clade-attachments/design.md
--   openspec/changes/derive-clade-attachments/specs/taxa-clades/spec.md
--
-- Built incrementally across tasks.md section 1:
--   1.1 (done): lineage identity, reused from `taxa` rather than recomputed —
--       see the _dtc_lineage CTE and design.md's "reuses taxa's lineage
--       identity instead of recomputing it" decision.
--   1.2 (done): clade-to-clade concept-grouping union-find (_dtc_con_winner /
--       _dtc_con / _dtc_conmeta, mirroring _dt_con_winner / _dt_con /
--       _dt_conmeta), restricted to both-sides-clade edges via
--       _dtc_permid_lineage.
--   1.3 (done): clade-to-clade classification pooling (_dtc_assign / _dtc_node,
--       mirroring _dt_assign / _dt_node), restricted to both-sides-clade
--       edges, self-reference excluded, no rank-cardinality check (no height
--       ordering exists among clades — design.md).
--   1.4 (done): cycle resolution. Unlike derive_taxa(), which RAISEs on a
--       genuine containment cycle, clades have no rank-cardinality ordering
--       to prevent cycles structurally, and real ones exist in pg_play (5
--       found: Ichthyosauria/Eoichthyosauria, Notosuchia/Ziphosuchia,
--       Ornithopoda/Clypeodonta, Tapiromorpha/Ceratomorpha,
--       Cotylosauria/Procolophonia/Procolophonomorpha — 11 concepts of 2140,
--       ~0.5%). Per explicit user direction (2026-08-23, superseding the
--       original spec/design "raise as error" behavior — see
--       specs/taxa-clades/spec.md and design.md, both updated to match): a
--       detected cycle is resolved, not raised. See the cycle-breaking loop
--       below for the resolution rule and its accepted caveat.
--
-- Output shape revised (2026-08-23, during derive-clade-attachments section 4
-- prep): ONE ROW PER MINTED PERMID, mirroring `taxa` exactly, not one row per
-- concept. A concept-only shape left junior clade synonym spellings
-- unresolvable by permid -- `derive_clade_attachments()` needs to resolve an
-- arbitrary raw assignment_opinions permid to its clade concept the same
-- simple way `_dt_assign` already resolves ranked ones via `taxa`, which
-- requires every permid (not just each concept's accepted spelling) to have
-- its own row. classification_path is deliberately NOT included -- no
-- consumer needs it yet, and building it would mean porting _dt_path's
-- recursive CTE for no immediate benefit.
CREATE OR REPLACE FUNCTION derive_taxa_clades(permids uuid[] DEFAULT NULL)
RETURNS TABLE (
    permid uuid,
    name text,
    rank_id integer,
    authority_id bigint,
    original_permid uuid,
    accepted_spelling_permid uuid,
    concept_permid uuid,
    containing_concept_permid uuid,
    nomenclatural_status_id integer,
    winning_name_opinion_id bigint,
    winning_assignment_opinion_id bigint,
    winning_validity_opinion_id bigint
) LANGUAGE plpgsql AS $fn$
#variable_conflict use_column
DECLARE
    cut_opinion_id bigint;
    iter integer := 0;
BEGIN
    -- ---- lineage identity: reused from `taxa`, not recomputed ---------------
    -- `taxa` is per-minted-permid, but the row where permid =
    -- accepted_spelling_permid IS the lineage's own representative row: its
    -- rank_id is that permid's own minted identity, which is exactly the
    -- lineage's accepted rank, and it's unique per original_permid by
    -- construction (derive_taxa() already selects exactly one
    -- accepted_spelling_permid per lineage). Lineage grouping itself
    -- (name_opinions 'lineage'-class edges, _dt_lin in derive_taxa()) is
    -- rank-agnostic and already correct here — recomputing it would be pure
    -- duplication (design.md).
    -- acc_ev/acc_yr/acc_id (the accepted spelling's own canonical introducing
    -- opinion's evidence/pubyr/id) and original_yr (the lineage's original
    -- permid's own introducing opinion's pubyr, falling back to 999999 when
    -- unknown, so an unknown year never wins an ASC "oldest" tiebreak) are
    -- pulled in here -- not part of task 1.1's narrower scope, but needed now
    -- for the seniority tiebreak below, mirroring derive_taxa()'s
    -- _dt_linmeta.acc_ev/acc_yr/acc_id/original_yr exactly.
    DROP TABLE IF EXISTS _dtc_lineage;
    CREATE TEMP TABLE _dtc_lineage AS
    SELECT t.original_permid,
           t.accepted_spelling_permid,
           t.name,
           t.rank_id AS accepted_rank_id,
           t.nomenclatural_status_id,
           t.winning_name_opinion_id,
           t.winning_validity_opinion_id,
           acc_no.evidence AS acc_ev,
           COALESCE(acc_no.publication_year, NULLIF(acc_ref.reference->>'publicationYear','')::int) AS acc_yr,
           t.winning_name_opinion_id AS acc_id,
           COALESCE(orig_no.publication_year, NULLIF(orig_ref.reference->>'publicationYear','')::int, 999999) AS original_yr
    FROM taxa t
    LEFT JOIN name_opinions acc_no ON acc_no.id = t.winning_name_opinion_id
    LEFT JOIN refs acc_ref ON acc_ref.id = acc_no.reference_id
    LEFT JOIN taxa ot ON ot.permid = t.original_permid
    LEFT JOIN name_opinions orig_no ON orig_no.id = ot.winning_name_opinion_id
    LEFT JOIN refs orig_ref ON orig_ref.id = orig_no.reference_id
    WHERE t.permid = t.accepted_spelling_permid
      AND t.rank_id IN (24, 25);
    CREATE UNIQUE INDEX ON _dtc_lineage(original_permid);
    CREATE INDEX ON _dtc_lineage(accepted_spelling_permid);
    ANALYZE _dtc_lineage;

    -- ---- permid -> lineage map, restricted to clade lineages ---------------
    -- The analog of derive_taxa()'s _dt_lin, but reused from `taxa` (every
    -- permid's own row already carries original_permid) rather than
    -- recomputed, and restricted to permids whose lineage is in _dtc_lineage
    -- (i.e. accepted at rank 24/25). Joining on this table is what enforces
    -- "both sides must be a clade lineage" below -- a candidate touching a
    -- Linnaean-ranked permid simply fails to join, the inverse of
    -- derive_taxa()'s explicit NOT IN (24,25) exclusion.
    DROP TABLE IF EXISTS _dtc_permid_lineage;
    CREATE TEMP TABLE _dtc_permid_lineage AS
    SELECT t.permid, t.original_permid
    FROM taxa t
    JOIN _dtc_lineage cl ON cl.original_permid = t.original_permid;
    CREATE INDEX ON _dtc_permid_lineage(permid);
    CREATE INDEX ON _dtc_permid_lineage(original_permid);
    ANALYZE _dtc_permid_lineage;

    -- ---- concept grouping (clade-to-clade synonymy union-find) -------------
    -- Mirrors derive_taxa()'s _dt_con_winner: each lineage's own top-ranked
    -- current concept-class opinion, pooled across all of that lineage's
    -- member permids (the join below naturally pools, since every permid
    -- sharing a lin_rep contributes a candidate row). Restricted to BOTH
    -- sides resolving into _dtc_permid_lineage (both rank 24/25) via the
    -- INNER JOINs -- the inverse of derive_taxa()'s exclusion, which drops
    -- the edge if EITHER side is unranked.
    DROP TABLE IF EXISTS _dtc_con_winner;
    CREATE TEMP TABLE _dtc_con_winner AS
    WITH cand AS MATERIALIZED (
        SELECT ls.original_permid AS jr, lt.original_permid AS sr, n.evidence,
               COALESCE(n.publication_year, NULLIF(r.reference->>'publicationYear','')::int) AS yr,
               n.id AS opinion_id, n.negates
        FROM name_opinions n
        JOIN _dtc_permid_lineage ls ON ls.permid = n.subject_permid
        JOIN _dtc_permid_lineage lt ON lt.permid = n.target_permid
        LEFT JOIN refs r ON r.id = n.reference_id
        WHERE n.removed IS NOT TRUE AND n.succeeded_by_id IS NULL AND n.edge_class = 'concept'
    ),
    ranked AS MATERIALIZED (
        SELECT jr, sr, negates,
               row_number() OVER (PARTITION BY jr
                   ORDER BY evidence DESC, yr DESC NULLS LAST, opinion_id DESC) AS rn
        FROM cand
    )
    SELECT jr, sr, negates FROM ranked WHERE rn = 1;
    CREATE INDEX ON _dtc_con_winner(jr);
    ANALYZE _dtc_con_winner;

    -- ---- concept union-find (components over each lineage's own winning, --
    -- non-negating concept edge only) ----------------------------------------
    DROP TABLE IF EXISTS _dtc_con;
    CREATE TEMP TABLE _dtc_con AS
    WITH RECURSIVE
    con_edge AS MATERIALIZED (
        SELECT jr, sr FROM _dtc_con_winner WHERE negates = false
    ),
    con_undir AS MATERIALIZED (
        SELECT jr AS a, sr AS b FROM con_edge UNION SELECT sr, jr FROM con_edge
    ),
    reach(src, node) AS (
        SELECT original_permid, original_permid FROM _dtc_lineage
        UNION
        SELECT r.src, u.b FROM reach r JOIN con_undir u ON u.a = r.node
    )
    SELECT src AS lin_rep, min(node::text)::uuid AS con_rep FROM reach GROUP BY src;
    CREATE INDEX ON _dtc_con(lin_rep);
    CREATE INDEX ON _dtc_con(con_rep);
    ANALYZE _dtc_con;

    -- ---- senior lineage per concept + concept_permid/rank -------------------
    -- Mirrors derive_taxa()'s _dt_conmeta seniority tiebreak exactly: a
    -- lineage never proposed junior to anything (con_sources) is preferred
    -- senior; ties break on the accepted spelling's own evidence/pubyr/id,
    -- then oldest original pubyr, then lowest permid.
    DROP TABLE IF EXISTS _dtc_conmeta;
    CREATE TEMP TABLE _dtc_conmeta AS
    WITH con_sources AS MATERIALIZED (
        SELECT DISTINCT jr FROM _dtc_con_winner WHERE negates = false
    ),
    ranked AS MATERIALIZED (
        SELECT c.con_rep, c.lin_rep,
               row_number() OVER (PARTITION BY c.con_rep ORDER BY
                   (cs.jr IS NULL) DESC,
                   cl.acc_ev DESC, cl.acc_yr DESC NULLS LAST, cl.acc_id DESC,
                   cl.original_yr ASC,
                   cl.original_permid ASC) AS rn
        FROM _dtc_con c
        JOIN _dtc_lineage cl ON cl.original_permid = c.lin_rep
        LEFT JOIN con_sources cs ON cs.jr = c.lin_rep
    )
    SELECT r.con_rep, r.lin_rep AS senior_lin,
           cl.accepted_spelling_permid AS concept_permid,
           cl.accepted_rank_id AS concept_rank_id
    FROM ranked r
    JOIN _dtc_lineage cl ON cl.original_permid = r.lin_rep
    WHERE r.rn = 1;
    CREATE INDEX ON _dtc_conmeta(con_rep);
    ANALYZE _dtc_conmeta;

    -- ---- classification pooling + cycle-breaking loop -----------------------
    -- Mirrors derive_taxa()'s _dt_assign: winning assignment pooled across
    -- the concept (senior lineage's own candidates always count; a junior
    -- lineage's candidate counts too when its own accepted rank equals the
    -- concept's -- the same equal-rank-borrowing shape as derive_taxa(),
    -- minus the species exclusion, which has no analog among rank 24/25).
    -- Unlike _dt_assign's permissive LEFT JOINs (which tolerate an
    -- unresolvable container by just contributing NULL containment), the
    -- joins to _dtc_permid_lineage/_dtc_con here are INNER -- per spec, a
    -- candidate whose containing permid does not resolve to a clade lineage
    -- is not eligible at all (that cross-boundary case belongs to the
    -- separate clade-attachments pass, not here). Self-reference (the
    -- container resolving back to the subject's own concept) is excluded
    -- from the ranking contest entirely, same as _dt_assign. No
    -- rank-cardinality check: unranked/unranked clade both carry
    -- height IS NULL, so there is no finer/coarser ordering to check
    -- (design.md "No rank-cardinality ordering exists among clades").
    --
    -- Because that structural firewall doesn't exist, this loop resolves
    -- genuine cycles instead of raising on them (task 1.4, superseding the
    -- original "raise as error" spec/design language -- see the file header
    -- and specs/taxa-clades/spec.md, both updated to match, per explicit
    -- user direction after 5 real cycles turned up in pg_play data): each
    -- iteration rebuilds _dtc_assign/_dtc_node excluding whatever opinions
    -- prior iterations have cut, precisely identifies genuine cycle members
    -- (a concept whose own containment chain returns to ITSELF -- not merely
    -- any node downstream of a cycle, which would over-include; same
    -- precise check derive_taxa()'s own guard uses, generalized here to
    -- return every such concept instead of just checking existence), and
    -- cuts the SINGLE weakest edge (lowest evidence/pubyr/id by the
    -- canonical order) among all current cycle members' own winning
    -- candidates. Repeats until no cycle remains. _dtc_excluded_opinions
    -- starts empty on every call.
    --
    -- Accepted caveat: cutting the globally-weakest edge can occasionally
    -- leave a directionally "backwards" placement on close evidence ties --
    -- the same failure mode noted when a similar weakest-link approach was
    -- evaluated, and rejected, for derive_taxa()'s own Hyriidae/Hyriinae
    -- cycle (fix-eukarya-eumetazoa-containment-cycle). It was rejected there
    -- only because a *better* alternative (rank-cardinality) existed and
    -- outperformed it; no such alternative exists for clades, so this is the
    -- best available option here, not a clean one -- a deliberate trade-off,
    -- not an oversight.
    DROP TABLE IF EXISTS _dtc_excluded_opinions;
    CREATE TEMP TABLE _dtc_excluded_opinions (opinion_id bigint PRIMARY KEY);

    <<cycle_break>>
    LOOP
        DROP TABLE IF EXISTS _dtc_assign;
        CREATE TEMP TABLE _dtc_assign AS
        WITH cand AS MATERIALIZED (
            SELECT cm.con_rep, a.id AS opinion_id, ccc.con_rep AS containing_con_rep,
                   a.evidence,
                   COALESCE(a.publication_year, NULLIF(r.reference->>'publicationYear','')::int) AS yr
            FROM assignment_opinions a
            JOIN _dtc_permid_lineage sl ON sl.permid = a.subject_permid
            JOIN _dtc_con sc ON sc.lin_rep = sl.original_permid
            JOIN _dtc_conmeta cm ON cm.con_rep = sc.con_rep
            JOIN _dtc_lineage cl ON cl.original_permid = sl.original_permid
            JOIN _dtc_permid_lineage ccl ON ccl.permid = a.containing_permid
            JOIN _dtc_con ccc ON ccc.lin_rep = ccl.original_permid
            LEFT JOIN refs r ON r.id = a.reference_id
            WHERE a.removed IS NOT TRUE AND a.succeeded_by_id IS NULL
              AND ( sl.original_permid = cm.senior_lin
                    OR cl.accepted_rank_id = cm.concept_rank_id )
              AND ccc.con_rep IS DISTINCT FROM cm.con_rep
              AND NOT EXISTS (SELECT 1 FROM _dtc_excluded_opinions eo WHERE eo.opinion_id = a.id)
        ),
        win AS MATERIALIZED (
            SELECT con_rep, opinion_id, containing_con_rep, evidence, yr,
                   row_number() OVER (PARTITION BY con_rep
                       ORDER BY evidence DESC, yr DESC NULLS LAST, opinion_id DESC) AS rn
            FROM cand
        )
        SELECT con_rep, opinion_id AS winning_assignment_opinion_id, containing_con_rep,
               evidence, yr
        FROM win WHERE rn = 1;
        CREATE INDEX ON _dtc_assign(con_rep);
        ANALYZE _dtc_assign;

        -- ---- per-concept node (concept_permid, containing_concept_permid) --
        DROP TABLE IF EXISTS _dtc_node;
        CREATE TEMP TABLE _dtc_node AS
        SELECT cm.con_rep, cm.concept_permid, cm.concept_rank_id,
               ccm.concept_permid AS containing_concept_permid,
               a.winning_assignment_opinion_id, a.evidence, a.yr
        FROM _dtc_conmeta cm
        LEFT JOIN _dtc_assign a ON a.con_rep = cm.con_rep
        LEFT JOIN _dtc_conmeta ccm ON ccm.con_rep = a.containing_con_rep;
        CREATE INDEX ON _dtc_node(con_rep);
        CREATE INDEX ON _dtc_node(concept_permid);
        CREATE INDEX ON _dtc_node(containing_concept_permid);
        ANALYZE _dtc_node;

        -- find the weakest winning edge among this round's genuine cycle
        -- members (NULL if none remain -- see comment above on precise vs.
        -- over-inclusive cycle-membership checks)
        SELECT a.winning_assignment_opinion_id INTO cut_opinion_id
        FROM (
            WITH RECURSIVE walk AS (
                SELECT con_rep AS start_rep, containing_concept_permid, 1 AS depth
                FROM _dtc_node WHERE containing_concept_permid IS NOT NULL
                UNION ALL
                SELECT w.start_rep, n.containing_concept_permid, w.depth + 1
                FROM walk w
                JOIN _dtc_node cn ON cn.concept_permid = w.containing_concept_permid
                JOIN _dtc_node n  ON n.con_rep = cn.con_rep
                WHERE w.depth < 10000
                  AND n.containing_concept_permid IS NOT NULL
            )
            SELECT DISTINCT w.start_rep AS con_rep
            FROM walk w
            JOIN _dtc_node self ON self.con_rep = w.start_rep
            WHERE w.containing_concept_permid = self.concept_permid
        ) cyc
        JOIN _dtc_node a ON a.con_rep = cyc.con_rep
        ORDER BY a.evidence ASC, a.yr ASC NULLS FIRST, a.winning_assignment_opinion_id ASC
        LIMIT 1;

        EXIT cycle_break WHEN cut_opinion_id IS NULL;

        INSERT INTO _dtc_excluded_opinions VALUES (cut_opinion_id);
        cut_opinion_id := NULL;

        iter := iter + 1;
        IF iter > 1000 THEN
            RAISE EXCEPTION 'derive_taxa_clades: cycle-breaking loop did not converge after 1000 iterations';
        END IF;
    END LOOP cycle_break;

    -- ---- assembly: one row per minted clade permid, mirroring taxa's own --
    -- final assembly shape exactly (_dt_identity/_dt_permid_edge/_dt_lin/
    -- _dt_linmeta/_dt_con/_dt_conmeta/_dt_node joined per-permid). Every
    -- permid sharing a lineage/concept gets the SAME original_permid/
    -- accepted_spelling_permid/concept_permid/containing_concept_permid/
    -- winning_assignment_opinion_id (concept-level facts, repeated per row);
    -- name/rank_id/authority_id/nomenclatural_status_id/
    -- winning_name_opinion_id/winning_validity_opinion_id are each permid's
    -- OWN identity/validity, read fresh from `taxa` -- not the lineage
    -- representative's. containing_concept_permid can still be NULL
    -- (rootless) when no eligible candidate exists (fewer than two clade
    -- lineages, no clade-to-clade containment opinion filed, the only
    -- candidate(s) were excluded as self-referential, or the cycle-breaking
    -- loop above cut this concept's only candidate).
    RETURN QUERY
    SELECT t2.permid,
           t2.name,
           t2.rank_id,
           t2.authority_id,
           pl.original_permid,
           cl.accepted_spelling_permid,
           nd.concept_permid,
           nd.containing_concept_permid,
           t2.nomenclatural_status_id,
           t2.winning_name_opinion_id,
           nd.winning_assignment_opinion_id,
           t2.winning_validity_opinion_id
    FROM _dtc_permid_lineage pl
    JOIN taxa t2 ON t2.permid = pl.permid
    JOIN _dtc_lineage cl ON cl.original_permid = pl.original_permid
    JOIN _dtc_con c ON c.lin_rep = pl.original_permid
    JOIN _dtc_node nd ON nd.con_rep = c.con_rep
    WHERE permids IS NULL OR pl.permid = ANY(permids);
END;
$fn$;
