## Purpose

Derives a clade-to-clade concept and containment hierarchy for `unranked`/`unranked clade` lineages — the
synonymy and containment relationships `derive_taxa()` deliberately excludes from the Linnaean hierarchy
whenever either side of a candidate edge is unranked, leaving those lineages isolated as singleton,
rootless concepts in `taxa` today.

## Requirements

### Requirement: derive_taxa_clades() is a pure function of taxa's lineage identity and the opinion tables

`derive_taxa_clades()` SHALL compute clade concepts reading only: `taxa`'s existing lineage-level identity
(`original_permid`, `accepted_spelling_permid`, `rank_id`, `winning_validity_opinion_id`) restricted to
lineages whose accepted rank is `unranked` or `unranked clade`; and the Layer 1 opinion tables
(`name_opinions` for concept-class edges, `assignment_opinions` for containment edges) and `refs` (for
`pubyr`), restricted to current, non-removed assertions (`removed IS NOT TRUE AND succeeded_by_id IS
NULL`). It SHALL NOT recompute lineage grouping or accepted-spelling selection — those are rank-agnostic
and already correct in `taxa`. It SHALL NOT read its own output table, and SHALL NOT write to `taxa`.

#### Scenario: Lineage identity is reused, not recomputed

- **WHEN** `derive_taxa_clades()` runs
- **THEN** it reads `original_permid`/`accepted_spelling_permid`/`rank_id` for unranked/unranked-clade
  lineages directly from `taxa`'s own lineage-level output, rather than re-deriving `name_opinions`
  `lineage`-class edges itself

#### Scenario: Output does not depend on a prior run

- **WHEN** `derive_taxa_clades()` is called after its own output table is truncated
- **THEN** it recomputes the same result from `taxa`'s lineage identity and the opinion tables alone

### Requirement: Concept grouping is scoped to clade-to-clade edges only

For each unranked/unranked-clade lineage, `derive_taxa_clades()` SHALL select its single top-ranked
current concept-class opinion (`ORDER BY evidence DESC, COALESCE(pubyr, ref.pubyr) DESC, id DESC`) among
candidates whose target also resolves to an unranked/unranked-clade lineage. A candidate whose target
resolves to a Linnaean-ranked lineage SHALL NOT be considered — cross-boundary synonymy stays excluded,
consistent with `derive_taxa()`'s own exclusion, since a clade and a Linnaean rank are not the kind of
thing that can be "the same name." `derive_taxa_clades()` SHALL union the resulting non-negating edges
into clade concepts and select each concept's senior lineage by the same seniority tiebreak `derive_taxa()`
already defines.

#### Scenario: Two synonymous clades merge into one concept

- **WHEN** two lineages, both accepted at `unranked clade`, have a winning concept-class opinion naming
  one a junior synonym of the other
- **THEN** `derive_taxa_clades()` unions them into the same concept, taking the senior lineage's accepted
  spelling as the concept's name

#### Scenario: A cross-boundary synonymy candidate is not considered

- **WHEN** an unranked-clade lineage's top-ranked concept-class opinion names a Linnaean-ranked lineage as
  target
- **THEN** `derive_taxa_clades()` does not consider that edge at all; the clade lineage's concept grouping
  proceeds as if the edge did not exist, exactly as `derive_taxa()` already treats it

### Requirement: Classification pooling is scoped to clade-to-clade edges only

`derive_taxa_clades()` SHALL choose each clade concept's `containing_concept_permid` from the top
`assignment_opinions` candidates pooled across all permids in the concept, restricted to candidates whose
containing permid also resolves to an unranked/unranked-clade lineage, by the same canonical `ORDER BY`. A
candidate SHALL be excluded from this pool entirely if its `containing_permid` resolves to the same
concept as the subject. If no eligible candidate remains, the concept's `containing_concept_permid` SHALL
be `NULL` (rootless) — the same fallback `derive_taxa()` uses for its own concepts.

#### Scenario: A clade concept is assigned a container from another clade

- **WHEN** a clade concept's senior lineage has a winning `assignment_opinions` candidate whose containing
  permid resolves to a different unranked-clade lineage
- **THEN** `derive_taxa_clades()` uses it to set the concept's `containing_concept_permid`

#### Scenario: A self-referential candidate is excluded from the pool

- **WHEN** a clade concept's pooled candidates include one whose `containing_permid` resolves to the same
  concept as the subject
- **THEN** `derive_taxa_clades()` excludes it from the ranking contest entirely and falls through to the
  next-ranked remaining candidate, or to `NULL` if none remains

### Requirement: No rank-cardinality ordering exists among clades

`derive_taxa_clades()` SHALL NOT attempt a rank-cardinality exclusion analogous to `_dt_assign`'s
finer-contains-coarser check: unlike Linnaean ranks, `unranked` and `unranked clade` both carry `height IS
NULL` in `dictionaries.taxonomy_ranks`, so there is no finer/coarser ordering between clade concepts to
check. Cycle prevention for clade-to-clade containment relies solely on the self-reference exclusion above
and the general cycle-detection guard below.

#### Scenario: Two clade concepts may contain each other's siblings without a rank check

- **WHEN** two clade concepts each have winning assignment opinions naming the other's sibling as
  container
- **THEN** `derive_taxa_clades()` does not exclude either candidate on rank-cardinality grounds; only a
  genuine cycle (resolved per the requirement below, not raised) or a direct self-reference would exclude
  either candidate

### Requirement: derive_taxa_clades() terminates on cycles by resolving them, not raising

`derive_taxa_clades()` SHALL terminate on synonymy cycles among clades (treating the cycle as one
concept), the same way `derive_taxa()` does. A direct self-reference SHALL resolve to
`containing_concept_permid = NULL` via the pooling exclusion above and SHALL NOT reach the cycle-breaking
step below.

A genuine classification cycle spanning two or more distinct clade concepts SHALL NOT be surfaced as an
error. Because there is no rank-cardinality firewall to prevent such a cycle from forming in the first
place (per the requirement above), `derive_taxa_clades()` SHALL instead resolve it: repeatedly identify
every concept whose own containment chain returns to itself (a precise check — a concept merely downstream
of a cycle, whose own chain terminates once it reaches a cycle member, is not itself a cycle member and is
unaffected), and among those concepts' own winning candidate edges, exclude the single one ranked lowest by
the canonical order (`evidence DESC, COALESCE(pubyr, ref.pubyr) DESC, id DESC` — i.e. weakest first) from
future candidacy, causing that concept's containment to fall through to its next-best remaining candidate,
or to `NULL` if none remains. This SHALL repeat until no concept's containment chain returns to itself.
Resolution SHALL NOT alter or remove any candidate belonging to a concept outside the current cycle set.

#### Scenario: A synonymy cycle among clades resolves to one concept

- **WHEN** concept-class opinions among clade lineages form a cycle (A synonym of B, B synonym of A)
- **THEN** `derive_taxa_clades()` completes and returns one concept for the cycle's members

#### Scenario: A genuine containment cycle among clades is resolved, not raised

- **WHEN** assignment opinions imply clade concept A contains clade concept B, and (directly or
  transitively) B contains A, with no direct self-reference anywhere in the chain
- **THEN** `derive_taxa_clades()` excludes the lower-ranked of the two concepts' winning candidate edges
  from candidacy and re-resolves, rather than raising an error, until neither A's nor B's containment
  chain returns to itself

#### Scenario: A concept merely downstream of a cycle is not itself treated as a cycle member

- **WHEN** concept C's own winning containment candidate names concept A as its container, and A is part
  of a genuine cycle with B, but C is not itself part of any cycle
- **THEN** `derive_taxa_clades()` does not alter or exclude C's own candidate — only A's and B's candidates
  are eligible for exclusion, and C continues to resolve to whichever of A/B remains standing as A's
  container once the cycle is broken

#### Scenario: A resolved cycle can require cutting more than one candidate edge

- **WHEN** a concept's cycle membership persists after its current-weakest candidate is excluded, because
  its next-best remaining candidate is itself part of a (possibly different) cycle
- **THEN** `derive_taxa_clades()` continues excluding the weakest remaining edge among current cycle
  members each round until no concept's containment chain returns to itself, rather than stopping after a
  single exclusion

### Requirement: The taxa_clades ledger exists as derived output

The schema SHALL define a `taxa_clades` table with **one row per minted clade permid** — mirroring `taxa`'s
own per-permid shape, not one row per concept — holding the immutable identity denormalized from each
permid's own minting opinion (`name`, `rank_id`, `authority_id`), the derived identity (`original_permid`,
`accepted_spelling_permid`, `concept_permid`), classification (`containing_concept_permid` nullable, a
plain permid pointer not a SQL foreign key, same convention as `taxa.containing_concept_permid`), and
provenance (`winning_name_opinion_id`, `winning_assignment_opinion_id`, `winning_validity_opinion_id` FKs
to the opinion tables). A permid's own `rank_id` SHALL NOT be constrained to `unranked`/`unranked clade` —
a rerank-history lineage can link permids minted at genuinely different ranks into one lineage, so only the
lineage's **accepted** rank (the `accepted_spelling_permid`'s own `rank_id`) is guaranteed to be
`unranked`/`unranked clade`; individual member permids are not. Every permid sharing a lineage or concept
SHALL carry the same `original_permid`/`accepted_spelling_permid`/`concept_permid`/
`containing_concept_permid`/`winning_assignment_opinion_id` (concept-level facts, repeated per row, the
same way `taxa` repeats them across every permid in a Linnaean concept).

#### Scenario: A clade concept's member permids share classification

- **WHEN** `derive_taxa_clades()` accepts a clade concept with more than one member permid (e.g. a
  rerank-history lineage, or a synonymized junior lineage)
- **THEN** `taxa_clades` holds one row per member permid, all sharing the same `concept_permid` and
  `containing_concept_permid`

#### Scenario: A member permid's own rank need not be unranked/unranked clade

- **WHEN** a clade lineage's accepted spelling is accepted at `unranked clade`, but one of its member
  permids was originally minted at a Linnaean rank (later reranked into that lineage)
- **THEN** `taxa_clades` still holds a row for that permid, with its own (Linnaean) `rank_id` — the schema
  does not reject or normalize it to `unranked clade`

### Requirement: rebuild_taxa_clades() materializes the ledger and the invariant holds

`rebuild_taxa_clades()` SHALL call `derive_taxa_clades(all)` and load the `taxa_clades` ledger by upserting
in place, keyed on `permid`: updating a permid's existing row where derived output differs, and inserting a
row where the permid is new, recording provenance (`winning_name_opinion_id`,
`winning_assignment_opinion_id`, `winning_validity_opinion_id`). A callable check SHALL assert the
invariant `derive_taxa_clades(all) ≡ the current taxa_clades rows`.

#### Scenario: After rebuild, derive_taxa_clades(all) equals the ledger heads

- **WHEN** `rebuild_taxa_clades()` runs over a fixture opinion set
- **THEN** the invariant check reports equality between `derive_taxa_clades(all)` and the current
  `taxa_clades` rows

#### Scenario: A no-op re-derivation updates no rows

- **WHEN** `rebuild_taxa_clades()` runs twice with no intervening opinion changes
- **THEN** the second run updates and inserts no rows (output equals the existing `taxa_clades` rows)

### Requirement: derive_taxa_clades() is deterministic

Repeated calls against unchanged inputs SHALL produce the same clade concepts, containment, and winner
selections, including identical tie-break outcomes.

#### Scenario: Repeated calls agree

- **WHEN** `derive_taxa_clades()` is called twice in succession with no changes to its inputs
- **THEN** both calls return the identical concept set and containment edges
