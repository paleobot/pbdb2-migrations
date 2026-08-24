## 1. Prototype `derive_taxa_clades()` against real data

- [x] 1.1 In `migration_exploration/testing/derive-taxa-clades.sql`, draft `derive_taxa_clades(permids)`:
      read `taxa`'s existing lineage-level output (`original_permid`, `accepted_spelling_permid`,
      `rank_id`, `winning_validity_opinion_id`) restricted to `rank_id IN (24, 25)`, without recomputing
      `_dt_lin`-style lineage grouping.
- [x] 1.2 Implement the clade-to-clade concept-grouping union-find: mirror `_dt_con_winner`'s candidate
      CTE and canonical `ORDER BY evidence DESC, COALESCE(pubyr, ref.pubyr) DESC, id DESC`, restricted to
      candidates where **both** the subject's and target's lineage resolve to rank 24/25 (the inverse of
      `derive_taxa()`'s exclusion, which drops the edge if *either* side is unranked).
- [x] 1.3 Implement the clade-to-clade classification pooling: mirror `_dt_assign`'s candidate CTE and
      canonical `ORDER BY`, restricted to candidates where both the subject's and containing lineage
      resolve to rank 24/25, with the self-reference exclusion but **no** rank-cardinality exclusion
      (per design.md — `height IS NULL` for both `unranked` and `unranked clade`, so there's no ordering
      to check).
- [x] 1.4 Implement the cycle-resolution loop: precisely identify concepts whose own containment chain
      returns to themselves (not merely downstream of a cycle), cut the single weakest candidate edge
      (lowest evidence/pubyr/id) among current cycle members, and repeat until none remain. **Design
      change from the original "raise as error" plan** — see design.md and specs/taxa-clades/spec.md,
      both updated 2026-08-23 after 5 genuine cycles (11/2140 concepts) turned up in pg_play data during
      task 1.3 testing; user directed resolution over raising, with the known "occasional backwards
      placement on ties" caveat disclosed rather than hidden. Verified: 18 opinions cut, 0 cycles remain,
      non-cycle concepts unaffected, resolved placements checked by hand for all 11 affected concepts.
- [x] 1.5 Deploy the prototype into `pg_play` — done incidentally throughout 1.1-1.4's testing
      (`CREATE OR REPLACE FUNCTION`); formally re-confirmed via 2.1's script.

## 2. Verify `derive_taxa_clades()` on real data

- [x] 2.1 Write `migration_exploration/testing/enumerate-clade-containment-cycles.js` (modeled on
      `enumerate-containment-cycles.js`, adapted to report both raw and post-resolution cycle counts) and
      run it against `pg_play` — record the counts. **Result**: raw = 5 distinct cycles, 11 concepts
      (`Ichthyosauria`/`Eoichthyosauria`; `Notosuchia`/`Ziphosuchia`;
      `Cotylosauria`/`Procolophonia`/`Procolophonomorpha`; `Ornithopoda`/`Clypeodonta`;
      `Tapiromorpha`/`Ceratomorpha`) — exactly matching the counts found during 1.3/1.4 testing.
      Post-resolution = 0 remaining, 18 opinions cut.
- [x] 2.2 ~~**Decision gate**~~ — resolved during 1.4: 5 genuine cycles (11/2140 concepts) found; user
      directed the weakest-edge-cut resolution documented there, superseding the original "raise as
      error"/decision-gate plan. Folded into 1.4 rather than left as a separate later step.
- [x] 2.3 Call `derive_taxa_clades(NULL)` directly against `pg_play` — confirm it completes with 0
      remaining cycles (per 2.1) and record row/concept counts. **Result**: 2140 concept rows, 0 remaining
      cycles, ~9.8s (18-iteration cycle-breaking loop; each iteration rebuilds `_dtc_assign`/`_dtc_node`
      over ~2140 concepts — acceptable for this scale, not benchmarked further).
- [x] 2.4 Spot-check a handful of known synonymous or nested clade pairs against the output to confirm
      sensible concept merges and containment, not just "it ran" — including a specific review of the 11
      cycle-resolved concepts' final placements (design.md Risks: the weakest-edge cut can occasionally
      leave a directionally backwards result, so this needs a real look, not just a completion check).
      **Result**: synonymy merges check out (`Predentata`→`Ornithischia`, `Batoidea`/`Batomorphi`,
      `Eutheria`/`Asioryctitheria` are genuine known synonym pairs); random non-cycle containment
      placements look plausible (`Malacopterygii`→`Teleostomi`, `Chromalveolata`→`Eucarya`). All 11
      cycle-resolved concepts now acyclic. One placement is flagged, not rubber-stamped: `Ornithopoda`
      (a well-established, widely-used ornithischian clade) now resolves under `Clypeodonta` (a much more
      obscure name) — plausibly the "occasional backwards placement" caveat design.md disclosed, though
      without deeper literature review this can't be confirmed either way. Recorded here rather than
      silently accepted; revisit if `taxa_clades` output is ever curated by a domain expert.

## 3. Port `derive_taxa_clades()` to `create_new.sql`

- [x] 3.1 Add the validated `derive_taxa_clades()` function and the `taxa_clades` table definition to
      `postgresql/create_new.sql`, with inline comments explaining the clade-scoped filters, following
      the existing `_dt_con_winner`/`_dt_assign` comment convention. Placed after `assert_taxa_invariant()`,
      before the stubbed occurrences block. Comments describe current behavior/rationale plainly rather
      than narrating the task-by-task construction history (that belongs in this file and the prototype
      script, not the schema). **Note**: only the function + table were added, matching this task's exact
      scope — no `rebuild_taxa_clades()`/`assert_taxa_clades_invariant()` counterparts to `taxa`'s were
      written, since neither was ever in tasks.md's scope. Flagging this as a real gap: without a rebuild
      function, `taxa_clades` has no supported way to actually get populated outside of a manual
      `INSERT ... SELECT * FROM derive_taxa_clades(NULL)`. Worth deciding whether to add one before this
      change is considered done.
- [x] 3.2 Redeploy into `pg_play` and re-run `derive_taxa_clades(NULL)` — confirm parity with the
      prototype's row/concept counts and cycle behavior from section 2. **Result**: exact parity — 2140
      concept rows, 0 remaining cycles, 1384 rooted (matches section 2 exactly). Verified the table DDL
      accepts the function's output shape via a rolled-back test insert (no rebuild function yet to do
      this for real — see 3.1's note).
- [x] 3.3 **Added mid-flight** (user direction, closing 3.1's gap): `rebuild_taxa_clades()` and
      `assert_taxa_clades_invariant()`, mirroring `rebuild_taxa()`/`assert_taxa_invariant()` exactly
      (upsert keyed on `concept_permid` instead of `permid`, same no-op-on-no-change `WHERE IS DISTINCT
      FROM` guard). Added a matching spec requirement to specs/taxa-clades/spec.md ("rebuild_taxa_clades()
      materializes the ledger and the invariant holds"), mirroring taxa-opinions' own requirement of the
      same name.
- [x] 3.4 Verify `rebuild_taxa_clades()`/`assert_taxa_clades_invariant()` against `pg_play`. **Result**:
      cold rebuild inserted 2140 rows; warm re-run correctly reported 0 changed (true no-op); invariant
      check passed. `taxa_clades` is now genuinely populated in `pg_play`, not just derivable on the fly.
- [x] 3.5 **Corrected mid-flight, before section 4 could start**: `taxa_clades`'s "one row per concept"
      shape (3.1) was wrong — a raw `assignment_opinions` permid can be any clade lineage member, not just
      a concept's accepted spelling, and a concept-only table can't resolve one. Revised `taxa_clades` to
      mirror `taxa` exactly: one row per minted permid. Also removed an incorrect
      `CHECK (rank_id IN (24,25))` surfaced by this fix — a member permid's own rank_id is not constrained
      to 24/25 (rerank-history lineages link permids minted at different ranks into one lineage; confirmed
      against real data, e.g. `Baurusuchinae` rank_id=7 in a lineage accepted at `unranked clade`). Updated
      `derive_taxa_clades()`, `rebuild_taxa_clades()`, `assert_taxa_clades_invariant()`, the prototype
      script, specs/taxa-clades/spec.md, and design.md to match. Re-verified end-to-end: 3312 permid rows
      (up from 2140 concept rows), 2140 distinct concepts (unchanged), 0 remaining cycles, warm rebuild
      no-ops, invariant holds, and a junior permid (`Baurusuchinae`'s reranked spelling) now resolves via a
      direct `taxa_clades.permid` lookup to the same concept/containment as its accepted spelling.

## 4. Prototype `derive_clade_attachments()` against real data

- [x] 4.1 In `migration_exploration/testing/derive-clade-attachments.sql`, draft
      `derive_clade_attachments(permids)`: build the cross-boundary candidate pool from
      `assignment_opinions`, resolving subject/container permids through `taxa.concept_permid` and
      `taxa_clades.concept_permid`. Resolution done via a single `_dca_resolve` CTE (any permid's side is
      determined by `taxa_clades` membership, since `taxa` itself is rank-agnostic and contains every
      permid regardless of side) — made simple specifically because of 3.5's permid-level `taxa_clades` fix.
- [x] 4.2 Implement pair-scoped winner selection (`(subject concept, target concept, direction)`,
      canonical `ORDER BY`), keeping multiple non-conflicting targets per subject rather than collapsing
      to one winner per subject. **Result**: 3,364 subjects genuinely have >1 distinct accepted target,
      confirming many-to-many cardinality is common, not a hypothetical edge case.
- [x] 4.3 Implement the defensive same-concept exclusion (per spec: currently unreachable given the
      upstream concept-grouping exclusion that already prevents ranked/clade concept merges, but filtered
      anyway).
- [x] 4.4 Deploy the prototype into `pg_play` (requires `taxa_clades` populated from section 3). **Result**:
      21,043 accepted edges (19,299 `ranked-in-clade` / 1,744 `clade-in-ranked`) in ~1.6s — well below
      derive_taxa_clades()'s ~10s, since this pass has no cycle-breaking loop. Sample edges check out
      (`Cryptoclidus`→`Plesiosauria`, `Bradoriida`→`Pancrustacea`).

## 5. Verify `derive_clade_attachments()` on real data

- [x] 5.1 Run the prototype against `pg_play` and compare the accepted-edge count to the ~23,100/~6,254
      raw-candidate estimates from `proposal.md` — record the actual post-resolution counts (expected to
      be lower once synonym collapsing and pair-scoped deduplication apply). **Result**: 21,043 accepted
      edges (19,299 `ranked-in-clade`, 1,744 `clade-in-ranked`) against a ~29,354 raw total — a modest
      reduction, meaning most raw opinions about a given attachment pair are not repeated/duplicated.
- [x] 5.2 Spot-check a handful of accepted edges in both directions (`ranked-in-clade`, `clade-in-ranked`)
      against their source `assignment_opinions` rows for correctness. **Result**: provenance traces
      correctly to real rows with matching subject/target names; all sampled placements are biologically
      plausible (`Austrosaurus`→`Titanosauria`, `Cryptoclidus`→`Plesiosauria`, `Bradoriida`→`Pancrustacea`).
- [x] 5.3 Confirm the many-to-many cardinality claim empirically: find at least one subject concept with
      more than one accepted attachment edge, or confirm none currently exist in the data — either
      outcome is a valid finding worth recording. **Result**: 3,364 subjects have more than one distinct
      accepted target — common, not a hypothetical edge case.

## 6. Port `derive_clade_attachments()` to `create_new.sql`

- [x] 6.1 Add the validated `derive_clade_attachments()` function and the `clade_attachments` table
      definition to `postgresql/create_new.sql`. **Extended** (matching the precedent set in 3.3, for
      consistency): also added `rebuild_clade_attachments()`/`assert_clade_attachments_invariant()`, keyed
      on the `(concept_permid, direction, attached_to_concept_permid)` triple since attachment cardinality
      is many-to-many. Added a matching spec requirement to specs/clade-attachments/spec.md.
- [x] 6.2 Redeploy into `pg_play` and re-run `derive_clade_attachments(NULL)` — confirm parity with the
      prototype's edge counts from section 5. **Result**: exact parity — 21,043 rows. Cold rebuild inserted
      all 21,043; warm rebuild correctly reported 0 changed; invariant check passed.

## 7. Add rebuild_taxa_full() orchestrator

- [x] 7.1 Implement `rebuild_taxa_full()`: calls `rebuild_taxa()`, then `rebuild_taxa_clades()`, then
      `rebuild_clade_attachments()`, in order, in one transaction, with `ANALYZE taxa` after the first
      stage and `ANALYZE taxa_clades` after the second — pre-emptively, per the sibling branch's confirmed
      incident (see design.md), not waiting to hit the same failure independently.
- [x] 7.2 Verify against `pg_play` from truncated `taxa`/`taxa_clades`/`clade_attachments` tables: one call
      produces a fully consistent set of all three ledgers, matching every prior section's individually-
      verified numbers (515,543 / 3,312 / 21,043 rows, 0 cycles). **Result**: cold run 93.6s, exact parity
      on all three counts, 0 cycles. Warm run reported a true `0/0/0` no-op across all three stages —
      confirming a genuine advantage of the separate-table design: unlike the sibling branch's
      `rebuild_taxa_full()` (which reverts and re-merges clade permids on every call because they share
      `taxa`), `rebuild_taxa()` here never touches `taxa_clades`/`clade_attachments` at all.
- [x] 7.3 Port `rebuild_taxa_full()` into `postgresql/create_new.sql`, redeploy into `pg_play`, and
      re-confirm parity.

## 8. Final close out

- [x] 8.1 Add a memory entry documenting: the clade-to-clade hierarchy and cross-boundary attachment
      passes are live in `create_new.sql`/`pg_play`, the measured cycle rate from 2.1/2.2, and the
      measured attachment-edge counts from 5.1. **Result**:
      `memory/project_derive-clade-attachments-status.md`, `MEMORY.md` index updated to match.
- [x] 8.2 Update the memory entry to mention `rebuild_taxa_full()` once section 7 is complete. **Result**:
      updated both this design's and the sibling design's memory entries with the comparison note (this
      design's warm run is a true `0/0/0` no-op across all three stages; the sibling's isn't, and can't be,
      without editing its own `rebuild_taxa()`).
- [ ] 8.3 Archive this OpenSpec change once the maintainer confirms the implementation matches these
      artifacts.
