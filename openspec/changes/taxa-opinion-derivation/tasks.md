# Tasks — taxa-opinion-derivation (B1)

> **Applied 2026-07-31.** `derive_taxa()` / `rebuild_taxa()` / `assert_taxa_invariant()`
> folded into `postgresql/create_new.sql` (in `public`, no schema). Verified by a
> from-empty build on localhost PG16 (PostGIS + ltree) plus a 23-assertion fixture
> suite (one per spec scenario) — all green. **Task 9.4: `derive_taxa` required NO
> change to B3's schema** — it works against the committed `taxa-opinions-schema`
> unchanged, which validates that schema shape. A and B1 can now be archived together.
> Fixture/scenario SQL preserved in `.scratch/taxa-opinion-derivation/`.
>
> One test-expectation correction during apply: the mutual-synonymy seniority
> tiebreak resolves at step (a) of the settled rule (canonical `ORDER BY`, which
> includes `id`), so the fixture was rewritten to let evidence decide — the
> implementation matches the settled rule; the original assertion was wrong.

Target-schema functions in `postgresql/create_new.sql`, on top of the schema from
change `taxa-opinions-schema`. Not a data migration: `derive_taxa()` is exercised by SQL
fixtures. Design in design.md; model rationale in `docs/classic-taxa-opinions.md`
§9.5.2 / §9.5.5 / §9.5.6 / §9.8.4. Verify on localhost PG16 (PostGIS + ltree),
same gate as B3. Each spec scenario in specs/taxa-opinions/spec.md should map to a
fixture assertion in group 8.

## 1. Scaffolding

- [x] 1.1 Place the new functions in `public` with descriptive names (`derive_taxa` / `rebuild_taxa` / `assert_taxa_invariant`), after the taxa/opinions tables — no dedicated schema, matching the versioning-function convention (`install_version_triggers` et al.).
- [x] 1.2 Define the `derive_taxa()` output row shape — a composite type (or `RETURNS TABLE`) mirroring the `taxa` derived columns: `permid, name, rank_id, original_permid, accepted_spelling_permid, concept_permid, containing_concept_permid, classification_path, nomenclatural_status_id, winning_name_opinion_id, winning_assignment_opinion_id, winning_validity_opinion_id`. (Decision 1)
- [x] 1.3 Establish a head-only opinion view/CTE convention (`removed IS NOT TRUE AND succeeded_by_id IS NULL`) reused by every pass. (Purity requirement)

## 2. Grouping (the two union-finds)

- [x] 2.1 Lineage connected-components recursive CTE over `lineage`-class `name_opinions` edges (both directions, `UNION`); assign each component its `root` permid as `original_permid`. (Decision 2; §9.8.4 step 1)
- [x] 2.2 Concept connected-components recursive CTE over `concept`-class `name_opinions` edges; identify each component's member lineages. (Decision 2; §9.8.4 step 2)
- [x] 2.3 Confirm both CTEs terminate on cycles by set-dedup (no explicit visited-list needed). (Cycle requirement)

## 3. Ranking and the two scopes

- [x] 3.1 Canonical winner helper: `DISTINCT ON (<group>) … ORDER BY evidence DESC, COALESCE(pubyr, ref.pubyr) DESC, id DESC`, joining `refs` for `pubyr` only. (Decision 3; §9.5.2)
- [x] 3.2 Accepted spelling per lineage: top-ranked subject **scoped to the senior lineage**, excluding `never_accepted` reasons; carry its `rank_id` as the accepted rank. (Decision 4; §9.8.4 step 3)
- [x] 3.3 Classification per concept: winning `assignment_opinions` **pooled across the whole concept**, equal-rank-only, species excluded (junior-synonym borrowing). (Decision 4; §9.8.4 step 5, §9.5.2 step 3)
- [x] 3.4 Validity per permid: winning `validity_opinions` → `nomenclatural_status_id` (NULL = valid).

## 4. Seniority and cycles

- [x] 4.1 Senior-lineage resolution: follow winning `concept` edges to the sink; on ambiguity apply the settled tiebreak — canonical `ORDER BY` → oldest `original` pubyr → lowest `permid`. Set `concept_permid` = senior lineage's accepted spelling. (Decision 5; §9.8.4 step 4)
- [x] 4.2 Containment-cycle guard in the path assembly: raise a clear error (not loop / not partial path) if a concept transitively contains itself. (Cycle requirement)

## 5. classification_path

- [x] 5.1 Assemble `classification_path` (`ltree`, root→node) by recursive walk over the resolved `containing_concept_permid` adjacency, last, after grouping/classification. (Decision 8; §9.7.4)

## 6. Assemble derive_taxa()

- [x] 6.1 Compose passes 2–5 into `derive_taxa(permids uuid[])` returning the row shape from 1.2; one row per minted permid (`name`/`rank_id` from the minting opinion), none for un-minted permids. (Decision 7; totality requirement)
- [x] 6.2 Seed expansion: expand the `permids` argument to full lineage/concept components (and any concepts needed for `classification_path`) before computing, so `derive_taxa(subset)` matches `derive_taxa(all)` for the seeds. `permids := all` (NULL/empty) derives everything. (Decision 6)

## 7. rebuild_taxa() and the invariant

- [x] 7.1 `rebuild_taxa()`: call `derive_taxa(all)`, diff against current `taxa` heads, append a new version only where output differs, stamping the `winning_*_opinion_id` provenance. Uses `install_version_triggers('taxa')` from B3 for chain/head maintenance.
- [x] 7.2 Invariant check `assert_taxa_invariant()`: a callable function asserting `derive_taxa(all) ≡ current ledger heads` (row-for-row on the derived columns), for CI / post-import.

## 8. Fixtures and tests (one per spec scenario)

- [x] 8.1 Build a fixtures harness (minimal persons/refs + opinion sets) analogous to B3's `verify_checks.sql`.
- [x] 8.2 Grouping: lineage shares `original_permid`; junior synonym shares `concept_permid` = senior's accepted spelling.
- [x] 8.3 Accepted spelling: recency/evidence winner within a lineage; misspelling never accepted; junior's newest spelling does NOT win the concept's name.
- [x] 8.4 Borrowing: placement filed under a junior name sets the concept's parent (equal rank); species placement is NOT borrowed.
- [x] 8.5 Seniority tiebreak: mutual synonymy resolves to one deterministic senior, stable across repeated calls.
- [x] 8.6 Cycles: synonymy cycle → one concept, terminates; containment cycle → raises.
- [x] 8.7 Subset equivalence: `derive_taxa(ARRAY[<one junior permid>])` row equals its `derive_taxa(all)` row.
- [x] 8.8 Totality: N minted permids → N rows, all `name`/`rank_id` non-NULL.
- [x] 8.9 Path: `A.B.C` ltree matches the adjacency chain.
- [x] 8.10 rebuild_taxa()/invariant: after rebuild the invariant holds; a second no-op rebuild appends nothing; provenance recorded.

## 9. Verification

- [x] 9.1 Apply `create_new.sql` to a fresh empty PG16 DB (PostGIS + ltree); confirm the new functions build clean.
- [x] 9.2 Run the full fixtures suite (group 8); all scenarios pass.
- [x] 9.3 Run `openspec validate taxa-opinion-derivation` and reconcile any drift.
- [x] 9.4 Record whether `derive_taxa()` forced any change to B3's `create_new.sql` block (expected-and-cheap; informs archiving A alongside B).
