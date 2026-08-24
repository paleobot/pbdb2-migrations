-- Prototype for rebuild_taxa_full() — the supported entry point for a full
-- rebuild across all three ledgers, enforcing correct ordering:
-- rebuild_taxa() must run before rebuild_taxa_clades() (which reads taxa's
-- lineage-level output), which must run before rebuild_clade_attachments()
-- (which reads both taxa's and taxa_clades's resolved concept output). See:
--   openspec/changes/derive-clade-attachments/design.md
--   openspec/changes/derive-clade-attachments/specs/clade-attachments/spec.md
--
-- No transaction-control statements needed: a plain PL/pgSQL function already
-- runs as part of its caller's transaction (or its own implicit one) --
-- calling all three steps in sequence inside one function body already gives
-- the required atomicity.
--
-- ANALYZE between stages is included from the start, not added reactively:
-- a sibling exploration of a different storage design for this same problem
-- (branch clade-rework-single) hit a real 9+ minute incident here, caused by
-- a bulk write leaving the next stage's heavy self-joins planning off stale
-- post-truncate statistics -- see design.md. ANALYZE taxa after rebuild_taxa()
-- and ANALYZE taxa_clades after rebuild_taxa_clades() pre-empt the same
-- failure here. No trailing ANALYZE for clade_attachments -- nothing
-- downstream reads it within this function.
CREATE OR REPLACE FUNCTION rebuild_taxa_full()
RETURNS TABLE (
    taxa_changed integer,
    taxa_clades_changed integer,
    clade_attachments_changed integer
) LANGUAGE plpgsql AS $fn$
BEGIN
    taxa_changed := rebuild_taxa();
    EXECUTE 'ANALYZE taxa';
    taxa_clades_changed := rebuild_taxa_clades();
    EXECUTE 'ANALYZE taxa_clades';
    clade_attachments_changed := rebuild_clade_attachments();
    RETURN NEXT;
END;
$fn$;
