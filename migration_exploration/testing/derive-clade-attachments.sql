-- Prototype for derive_clade_attachments() — many-to-many cross-boundary
-- containment edges between Linnaean concepts (`taxa`) and clade concepts
-- (`taxa_clades`), derived from the `assignment_opinions` rows both of those
-- ledgers' own derivations exclude (each requires both sides of a candidate
-- edge to be on the SAME side of the ranked/unranked-clade line). See:
--   openspec/changes/derive-clade-attachments/proposal.md
--   openspec/changes/derive-clade-attachments/design.md
--   openspec/changes/derive-clade-attachments/specs/clade-attachments/spec.md
--
-- Built incrementally across tasks.md section 4:
--   4.1: candidate pool (this file's `resolve`/`cand` CTEs).
--   4.2: pair-scoped winner selection (`win` CTE), many-to-many output.
--   4.3: defensive same-concept exclusion.
--
-- Resolution relies on `taxa_clades` now being one row per PERMID (mirroring
-- `taxa` exactly, corrected during section 3 -- see design.md's "taxa_clades
-- is one row per permid, not one row per concept"): any permid's SIDE and
-- true concept identity is determined by whether it has a `taxa_clades` row
-- at all (a permid can appear in `taxa` regardless of rank, since `taxa` is
-- rank-agnostic -- `taxa_clades` membership is what actually distinguishes
-- the clade side).
CREATE OR REPLACE FUNCTION derive_clade_attachments(permids uuid[] DEFAULT NULL)
RETURNS TABLE (
    concept_permid uuid,
    direction text,
    attached_to_concept_permid uuid,
    winning_assignment_opinion_id bigint
) LANGUAGE plpgsql AS $fn$
#variable_conflict use_column
BEGIN
    -- ---- resolve any permid to its side + true concept identity ------------
    -- `taxa` holds a row for every minted permid regardless of rank, so
    -- membership in `taxa_clades` (not merely a `taxa` row's own concept
    -- grouping) is what identifies the clade side and its correctly
    -- clade-merged concept_permid.
    DROP TABLE IF EXISTS _dca_resolve;
    CREATE TEMP TABLE _dca_resolve AS
    SELECT t.permid,
           (tc.permid IS NOT NULL) AS is_clade,
           COALESCE(tc.concept_permid, t.concept_permid) AS concept_permid
    FROM taxa t
    LEFT JOIN taxa_clades tc ON tc.permid = t.permid;
    CREATE UNIQUE INDEX ON _dca_resolve(permid);
    ANALYZE _dca_resolve;

    -- ---- candidate pool: cross-boundary assignment_opinions only -----------
    -- A row is a candidate iff subject and container resolve to opposite
    -- sides. Same-side rows are excluded entirely -- already handled (or
    -- already excluded) by derive_taxa()'s/derive_taxa_clades()'s own
    -- classification pooling. Defensive same-concept exclusion (spec:
    -- currently unreachable, since concept merging across the boundary is
    -- already excluded upstream, but filtered anyway).
    DROP TABLE IF EXISTS _dca_cand;
    CREATE TEMP TABLE _dca_cand AS
    SELECT a.id AS opinion_id,
           a.evidence,
           COALESCE(a.publication_year, NULLIF(r.reference->>'publicationYear','')::int) AS yr,
           rs.concept_permid AS subject_concept,
           rc.concept_permid AS container_concept,
           CASE WHEN rs.is_clade THEN 'clade-in-ranked' ELSE 'ranked-in-clade' END AS direction
    FROM assignment_opinions a
    JOIN _dca_resolve rs ON rs.permid = a.subject_permid
    JOIN _dca_resolve rc ON rc.permid = a.containing_permid
    LEFT JOIN refs r ON r.id = a.reference_id
    WHERE a.removed IS NOT TRUE AND a.succeeded_by_id IS NULL
      AND rs.is_clade IS DISTINCT FROM rc.is_clade
      AND rs.concept_permid IS DISTINCT FROM rc.concept_permid
      AND (permids IS NULL OR a.subject_permid = ANY(permids) OR a.containing_permid = ANY(permids));
    CREATE INDEX ON _dca_cand(subject_concept, container_concept, direction);
    ANALYZE _dca_cand;

    -- ---- winner selection: scoped per (subject concept, target concept, --
    -- direction) pair, not per subject -- collapses repeated/superseded ------
    -- opinions about the SAME attachment, but keeps independently-supported --
    -- attachments to distinct targets (many-to-many, unlike
    -- taxa.containing_concept_permid's single-parent shape).
    RETURN QUERY
    WITH win AS MATERIALIZED (
        SELECT subject_concept, container_concept, direction, opinion_id,
               row_number() OVER (PARTITION BY subject_concept, container_concept, direction
                   ORDER BY evidence DESC, yr DESC NULLS LAST, opinion_id DESC) AS rn
        FROM _dca_cand
    )
    SELECT subject_concept, direction, container_concept, opinion_id
    FROM win WHERE rn = 1;
END;
$fn$;
