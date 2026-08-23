## Context

`derive_taxa()` (`postgresql/create_new.sql`) resolves opinions into the Linnaean `taxa` ledger using three
internal CTE stages: lineage grouping (`_dt_lin`), concept grouping / synonymy union-find
(`_dt_con_winner`), and classification pooling / containment (`_dt_assign`), each ranking candidates by
`ORDER BY evidence DESC, COALESCE(pubyr, ref.pubyr) DESC, id DESC`. Rank 24 (`unranked clade`) and 25
(`unranked`) lineages are excluded from the latter two stages whenever *either* side of a candidate edge
is unranked — see `openspec/specs/taxa-opinions/spec.md`, concept-grouping and classification-pooling
requirements. `_dt_lin` (lineage grouping) is not rank-filtered at all: an unranked lineage's
`original_permid`/`accepted_spelling_permid` is already computed correctly and lands in `taxa` as an
isolated singleton row. See `proposal.md` for why this leaves both the clade-to-clade hierarchy and the
cross-boundary attachments as discarded, un-derived data.

This design covers two new passes, built in the same style as `derive_taxa()`:

1. `derive_taxa_clades()` → `taxa_clades` — the clade-to-clade hierarchy.
2. `derive_clade_attachments()` → `clade_attachments` — the cross-boundary edges between `taxa` and
   `taxa_clades`.

## Goals / Non-Goals

**Goals:**
- Reuse `derive_taxa()`'s CTE shape and canonical winner-selection order verbatim, so the two new passes
  are recognizable variations rather than a new algorithm to learn.
- Keep both passes strictly additive: zero changes to `_dt_con_winner`, `_dt_assign`, or any existing
  `taxa` row.
- Make both passes callable standalone (`derive_taxa_clades(permids)`,
  `derive_clade_attachments(permids)`), mirroring `derive_taxa(subset) == derive_taxa(all)` restricted to
  the requested seed set, for consistency with existing tooling (`pg_play`, `enumerate-*.js` scripts).

**Non-Goals:**
- Cross-boundary **synonymy** (concept-class `name_opinions` edges where one side is ranked and the other
  unranked) stays excluded, exactly as `derive_taxa()` excludes it today. A clade and a Linnaean rank are
  not "the same name" in the sense synonymy requires; only cross-boundary *containment* is meaningful, and
  that's what `derive_clade_attachments()` covers. This change does not introduce any new synonymy
  resolution.
- No UI, API, or query-layer changes for presenting the combined ranked+clade tree. This change produces
  the two derived ledgers and their connecting edges; consuming them in a combined view is future work.
- No change to `dictionaries.taxonomy_ranks` or the rank 24/25 definitions themselves.

## Decisions

### `derive_taxa_clades()` reuses `taxa`'s lineage identity instead of recomputing it

`_dt_lin`-style lineage grouping is rank-agnostic — an unranked lineage's `original_permid` and
`accepted_spelling_permid` are already correctly computed by `derive_taxa()` and stored in `taxa`.
Recomputing lineage grouping independently in `derive_taxa_clades()` would duplicate that logic and risk
drift between the two ledgers' idea of "the same lineage." Instead, `derive_taxa_clades()` reads `taxa`'s
lineage-level output directly (filtered to `rank_id IN (24, 25)`) as its starting point, and only
re-implements concept-grouping and classification-pooling — the two stages `derive_taxa()` actually
excludes unranked lineages from.

**Alternative considered**: give `taxa_clades` its own independent lineage-grouping pass over
`name_opinions` `lineage`-class edges, symmetric with `derive_taxa()`. Rejected — it's pure duplication of
already-correct logic, and two independently-computed notions of "lineage" for the same permids is a
correctness hazard (they could silently diverge if `name_opinions` changes are applied unevenly), not a
useful independence.

### Concept-grouping and classification-pooling are scoped by candidate edge, not carried over from `taxa`

`derive_taxa_clades()` cannot reuse `taxa`'s concept groupings (each unranked lineage is its own singleton
concept there, by construction) — it must run its own union-find over concept-class edges restricted to
both-sides-unranked, and its own pooling over assignment edges restricted to both-sides-unranked. This
mirrors `_dt_con_winner`/`_dt_assign`'s existing filter shape, just inverted and applied within a single
rank category instead of across the Linnaean/cladistic boundary.

**Alternative considered**: a single generalized `derive_taxa()` parameterized by "which rank category is
in scope," shared between `taxa` and `taxa_clades`. Rejected for this change — `derive_taxa()` is a
stable, heavily-validated function (three prior containment-cycle fixes landed against it); parameterizing
it now increases blast radius on working code for a benefit (code reuse) that's better realized later, if
at all, once `derive_taxa_clades()` has its own track record. `derive_taxa_clades()` is written as a
sibling function that happens to share structure, not a generalization of `derive_taxa()`.

### No rank-cardinality guard for clade-to-clade containment; genuine cycles are resolved, not raised

`derive_taxa()`'s second containment-cycle fix (`fix-eukarya-eumetazoa-containment-cycle`) added a
rank-cardinality exclusion (container's accepted rank must not be finer than the subject's) that closed
the last 2 of 18 known cycles. That check depends on `dictionaries.taxonomy_ranks.height`, which is `NULL`
for both `unranked` and `unranked clade` — there is no ordering to check among clades. `derive_taxa_clades()`
therefore has one fewer structural firewall against cycles than `derive_taxa()` does, and confirmed real
cycles exist in `pg_play` data (see Risks). Rather than raising on a genuine cycle the way `derive_taxa()`
does, `derive_taxa_clades()` resolves it: an iterative loop (`migration_exploration/testing/derive-taxa-
clades.sql`) precisely identifies concepts whose own containment chain returns to themselves, excludes the
single weakest candidate edge (lowest evidence/pubyr/id) among current cycle members, and repeats until
none remain. This was an explicit direction change from this design's original "raise as error" stance —
made by the user after real cycles turned up during implementation (task 1.3 testing) — see
`specs/taxa-clades/spec.md`'s cycle-termination requirement, updated to match.

**Alternative considered**: keep the raise-on-cycle behavior and require curatorial review before
`derive_taxa_clades(NULL)` can complete against real data (this design's original position). Superseded —
the user judged that, with no structural fix available (unlike the Linnaean side, where rank-cardinality
was a better alternative), automatic resolution with a disclosed caveat is preferable to blocking the
whole derivation on a handful of disputed clade pairs.

**Alternative considered**: nullify every concept in a detected cycle (no candidate edge wins) rather than
cutting only the weakest one. Rejected by the user in favor of the weakest-edge cut, which preserves
containment information for however many cycle members can still resolve to a non-cyclic candidate once
the losing edge is removed, rather than discarding all of it.

### `taxa_clades` is one row per permid, not one row per concept

The original design (and this document's own Decisions above) described `taxa_clades` as one row per
clade concept — only each concept's accepted spelling, not its junior synonyms. That broke
`derive_clade_attachments()` before it could even be written: a raw `assignment_opinions` row's
`subject_permid`/`containing_permid` can be *any* permid in a clade lineage, not just the accepted
spelling, and a concept-only `taxa_clades` has no row to resolve a junior permid through. `taxa`'s own
per-permid shape doesn't have this problem — `_dt_assign` resolves any ranked permid via a direct
`taxa.concept_permid` lookup — so `taxa_clades` now mirrors that exactly: one row per minted permid, with
every permid sharing a lineage/concept carrying the same concept-level facts (`concept_permid`,
`containing_concept_permid`, `winning_assignment_opinion_id`), repeated per row.

One consequence discovered while fixing this: a permid's own `rank_id` is **not** constrained to
`unranked`/`unranked clade`, even in `taxa_clades`. Rerank-history lineages link permids minted at
different ranks into one lineage (e.g. `Baurusuchinae` has a member permid minted at rank 7, in a lineage
whose accepted spelling is `unranked clade`) — confirmed against real `pg_play` data. Only the lineage's
*accepted* rank (the `accepted_spelling_permid`'s own `rank_id`) is guaranteed to be 24/25; a table-level
`CHECK (rank_id IN (24,25))` on every row is simply wrong for a per-permid table, and was removed after it
failed exactly this way against real data during implementation.

**Alternative considered**: add a separate `permid → concept_permid` bridge table instead of changing
`taxa_clades`'s own shape, or duplicate `derive_taxa_clades()`'s internal permid-resolution logic inside
`derive_clade_attachments()`. Rejected by the user in favor of fixing `taxa_clades` itself — no new schema
surface, no duplicated derivation logic, and `taxa_clades` ends up a genuinely complete ledger (any permid
resolvable) rather than a concept-only index that always needed a companion lookup.

### `clade_attachments` cardinality is many-to-many, keyed per `(subject concept, target concept)` pair

Covered in the `clade-attachments` spec; the design implication is that the output table has no unique
constraint on `concept_permid` alone (unlike `taxa.containing_concept_permid`, which is a single nullable
column per row) — instead, `(concept_permid, direction, attached_to_concept_permid)` is the natural key,
with winner selection deduplicating repeated/superseded opinions about the same specific pair before
insertion.

## Risks / Trade-offs

- **[Risk]** Clade-to-clade containment cycles have no rank-cardinality firewall. Confirmed against real
  `pg_play` data during task 1.3 testing: **5 genuine cycles, 11 of 2140 concepts (~0.5%)**
  (`Ichthyosauria`/`Eoichthyosauria`, `Notosuchia`/`Ziphosuchia`, `Ornithopoda`/`Clypeodonta`,
  `Tapiromorpha`/`Ceratomorpha`, and a 3-way `Cotylosauria`/`Procolophonia`/`Procolophonomorpha`) — a small,
  bounded blast radius, comparable in scale to prior Linnaean-side fixes (0.06%–0.26%). → **Mitigation**:
  resolved automatically via the weakest-edge-cut loop described above rather than raised; no manual
  curation review is required for the derivation to complete. The known caveat (an occasional
  directionally "backwards" placement on close evidence ties) is disclosed in the spec/design rather than
  hidden, and the exact cut opinions are inspectable via `_dtc_excluded_opinions` after a call.
- **[Risk]** The weakest-edge-cut resolution can, on rare ties, leave a semantically backwards placement
  (e.g. a subfamily ending up as its family's container) rather than the taxonomically "correct" direction
  — the same known failure mode documented when a similar approach was evaluated for `derive_taxa()`'s own
  Hyriidae/Hyriinae cycle. → **Mitigation**: accepted deliberately, since no rank-cardinality-style
  alternative exists for clades (this is the best available option, not a clean one); task 2.4's spot-check
  should specifically review the resolved placements for the known cycle pairs, not just confirm the
  derivation completes.
- **[Risk]** `derive_clade_attachments()`'s many-to-many output is a new cardinality shape in this schema —
  every other derived relationship here (`containing_concept_permid`) is single-parent. Downstream
  consumers (once they exist) must not assume at-most-one-row-per-subject. → **Mitigation**: the spec
  requirement and this design both call this out explicitly; no schema-level uniqueness constraint should
  be added that would silently truncate to one row per subject.
- **[Risk]** Bug-for-bug divergence between `taxa_clades`'s concept-grouping/pooling logic and
  `derive_taxa()`'s, since they're deliberately separate functions (see Decisions) rather than a shared
  parameterized implementation. A future fix to one may not get ported to the other. → **Mitigation**:
  reference `derive_taxa()`'s requirements by name in both new specs (already done) so a future reader
  checking one is prompted to check the other; accept the duplication cost for now per the Decisions
  rationale.
- **[Trade-off]** Excluding cross-boundary synonymy entirely (Non-Goals) means a clade that the literature
  treats as a rank-equivalent synonym of a Linnaean taxon (rare, but not unheard of informally) has no
  derived representation of that relationship at all — not even as a `clade_attachments` containment edge,
  since that pass only reads `assignment_opinions`, not `name_opinions`. Accepted as out of scope; revisit
  only if real data shows this pattern is common enough to matter.

## Migration Plan

1. Prototype `derive_taxa_clades()` against `pg_play`, following the same validation discipline as prior
   `derive_taxa()` changes: a standalone test script run against real production-scale data before porting
   into `create_new.sql`, checking in particular for the cycle rate called out in Risks.
2. Port `derive_taxa_clades()` and the `taxa_clades` table into `create_new.sql` once validated.
3. Prototype `derive_clade_attachments()` against `pg_play`, now that `taxa_clades` exists there, verifying
   candidate-pool counts land near the ~23K/~6K raw-opinion estimates from the proposal (after concept
   resolution collapses synonyms, the accepted-edge count will be lower — establish the real number during
   validation rather than assuming the raw count).
4. Port `derive_clade_attachments()` and the `clade_attachments` table into `create_new.sql`.
5. No rollback complexity beyond dropping the two new tables/functions — nothing else reads or depends on
   them, and `taxa`/`derive_taxa()` are untouched throughout.

## Open Questions

- Exact column list and naming for `taxa_clades` and `clade_attachments` (e.g. whether
  `clade_attachments.direction` is a text enum or two boolean/rank-category columns) — deferred to
  implementation; doesn't affect the derivation logic or the task breakdown.
- Whether `clade_attachments` needs its own `permid`-style surrogate key for future FK references from
  other tables, or whether the natural composite key is sufficient — deferred until a concrete consumer
  needs to reference a specific attachment edge.
