## Purpose

Derives many-to-many cross-boundary containment edges between Linnaean concepts (`taxa`) and
unranked-clade concepts (`taxa_clades`), from the `assignment_opinions` rows that both ledgers' own
derivations exclude by design, so that clade/rank attachment becomes queryable derived data instead of
discarded evidence.

## ADDED Requirements

### Requirement: derive_clade_attachments() is a pure function of opinions and the two concept ledgers

`derive_clade_attachments()` SHALL compute attachment edges reading only `assignment_opinions`, `refs`
(for `pubyr`), and the resolved concept-level output of `taxa` (`concept_permid` and accepted rank) and
`taxa_clades` (its concept-level equivalent). It SHALL NOT read its own output table, and SHALL NOT write
to `taxa` or `taxa_clades`. It SHALL consider only current, non-removed assertions (`removed IS NOT TRUE
AND succeeded_by_id IS NULL`), consistent with how `derive_taxa()` scopes opinion currency.

#### Scenario: Output does not depend on a prior run

- **WHEN** `derive_clade_attachments()` is called after its own output table is truncated
- **THEN** it recomputes the same edge set from `assignment_opinions`, `refs`, `taxa`, and `taxa_clades`
  alone

#### Scenario: Output does not depend on unresolved opinions from the other two ledgers

- **WHEN** `taxa` and `taxa_clades` have already resolved their own concept groupings for a set of permids
- **THEN** `derive_clade_attachments()` uses only their resolved `concept_permid` output for those
  permids, not the raw `name_opinions`/`assignment_opinions` rows that produced it

### Requirement: The candidate pool is exactly the cross-boundary containment opinions

`derive_clade_attachments()` SHALL consider an `assignment_opinions` row a candidate if and only if the
subject's lineage resolves, via `taxa` or `taxa_clades`, to one side of the ranked/unranked-clade line and
the containing permid's lineage resolves to the other side. A row where both sides resolve to the same
side (both Linnaean-ranked, or both `unranked`/`unranked clade`) SHALL NOT be a candidate for this
derivation — same-side containment is already handled, or already excluded, by `derive_taxa()`'s own
classification-pooling requirement.

#### Scenario: A ranked-subject / clade-container row is a candidate

- **WHEN** an `assignment_opinions` row names a subject whose lineage is accepted at a Linnaean rank and a
  containing permid whose lineage is accepted at `unranked clade`
- **THEN** `derive_clade_attachments()` includes it in its candidate pool with direction
  `ranked-in-clade`

#### Scenario: A clade-subject / ranked-container row is a candidate

- **WHEN** an `assignment_opinions` row names a subject whose lineage is accepted at `unranked` or
  `unranked clade` and a containing permid whose lineage is accepted at a Linnaean rank
- **THEN** `derive_clade_attachments()` includes it in its candidate pool with direction
  `clade-in-ranked`

#### Scenario: A same-side row is excluded

- **WHEN** an `assignment_opinions` row's subject and containing permid both resolve to Linnaean-ranked
  lineages, or both resolve to `unranked`/`unranked clade` lineages
- **THEN** `derive_clade_attachments()` excludes it from its candidate pool entirely

### Requirement: Candidates are resolved to concept identity before ranking

`derive_clade_attachments()` SHALL map each candidate's subject and containing permid to its resolved
`concept_permid` in `taxa` or `taxa_clades` (whichever ledger claims that lineage) before ranking, the
same way `derive_taxa()` resolves synonym spellings to their concept rather than comparing raw permids.

#### Scenario: A synonym spelling in the raw opinion resolves to its concept

- **WHEN** a candidate opinion's subject permid is a junior-synonym spelling already folded into a larger
  concept in `taxa` (or `taxa_clades`)
- **THEN** `derive_clade_attachments()` treats the candidate as belonging to that concept, not to the raw
  spelling permid

### Requirement: A subject concept and its target concept are never the same concept

Because `derive_taxa()`'s concept-grouping requirement already excludes concept-class (synonymy) merges
across the ranked/unranked-clade boundary, a ranked concept and an unranked-clade concept can never
resolve to the same `concept_permid`. `derive_clade_attachments()` SHALL nonetheless exclude, defensively,
any candidate whose resolved subject and target concepts are equal, entirely from the ranking contest
rather than filtering it out after the fact.

#### Scenario: A same-row self-reference is excluded by the existing opinion constraint

- **WHEN** an `assignment_opinions` row is inserted with `subject_permid` equal to `containing_permid`
- **THEN** the existing same-row distinctness constraint on `assignment_opinions` rejects the insert
  before `derive_clade_attachments()` ever sees it

#### Scenario: A resolved same-concept candidate is excluded if it ever occurs

- **WHEN** a candidate's containing permid resolves to the same concept, across `taxa` and `taxa_clades`,
  as the subject's concept
- **THEN** `derive_clade_attachments()` excludes it from the ranking contest entirely, rather than
  emitting a self-attaching edge

### Requirement: Winner selection is scoped per (subject concept, target concept) pair

For each distinct `(subject concept, target concept, direction)` combination with at least one candidate,
`derive_clade_attachments()` SHALL select the single top-ranked current candidate by `ORDER BY evidence
DESC, COALESCE(pubyr, ref.pubyr) DESC, id DESC` — the same canonical order `derive_taxa()` uses — as that
pair's accepted edge. This selection is scoped to the pair, not to the subject alone: it resolves
disagreement about a single specific attachment without suppressing a subject's other, independently
supported attachments.

#### Scenario: Repeated opinions about the same attachment collapse to one accepted edge

- **WHEN** a subject concept has two current candidate opinions, both naming the same target concept as
  container, differing in `pubyr`
- **THEN** `derive_clade_attachments()` selects the higher-ranked one by the canonical order as the
  accepted edge for that pair, and does not emit the other

### Requirement: A subject concept may carry multiple accepted attachment edges

Unlike `taxa.containing_concept_permid`, attachment cardinality SHALL be many-to-many: a subject concept
with independently supported, non-conflicting candidate edges to more than one target concept SHALL have
an accepted edge emitted for each.

#### Scenario: Independently supported attachments to distinct targets are both retained

- **WHEN** a subject concept has current, top-ranked candidate opinions (per the pair-scoped selection
  above) naming two different target concepts as containers
- **THEN** `derive_clade_attachments()` emits an accepted edge for each target concept

### Requirement: The attachment ledger records direction and provenance

`derive_clade_attachments()` SHALL emit one row per accepted edge, carrying the subject `concept_permid`,
a direction (`ranked-in-clade` or `clade-in-ranked`), the target `concept_permid`, and the winning
`assignment_opinions` id as an FK. It SHALL NOT duplicate `evidence`/`pubyr` on the emitted row — that
provenance is reachable via the FK.

#### Scenario: An accepted edge is emitted with full provenance

- **WHEN** `derive_clade_attachments()` accepts a candidate as the winner for a `(subject concept, target
  concept, direction)` pair
- **THEN** it emits exactly one row containing the subject concept, direction, target concept, and the
  winning `assignment_opinions` id

### Requirement: derive_clade_attachments() is deterministic

Repeated calls against unchanged `assignment_opinions`, `refs`, `taxa`, and `taxa_clades` data SHALL
produce the same edge set, including the same choice of winner for any pair with tied `evidence`/`pubyr`
candidates (broken by `id DESC`, per the canonical order).

#### Scenario: Repeated calls agree

- **WHEN** `derive_clade_attachments()` is called twice in succession with no changes to its inputs
- **THEN** both calls return the identical set of accepted edges, including identical winners for any
  tied pairs

### Requirement: rebuild_clade_attachments() materializes the ledger and the invariant holds

`rebuild_clade_attachments()` SHALL call `derive_clade_attachments(all)` and load the `clade_attachments`
ledger by upserting in place, keyed on the `(concept_permid, direction, attached_to_concept_permid)`
triple — its natural key, since attachment cardinality is many-to-many: updating an edge's existing row
where its `winning_assignment_opinion_id` differs, and inserting a row where the edge is new. A callable
check SHALL assert the invariant `derive_clade_attachments(all) ≡ the current clade_attachments rows`.

#### Scenario: After rebuild, derive_clade_attachments(all) equals the ledger heads

- **WHEN** `rebuild_clade_attachments()` runs over a fixture opinion set
- **THEN** the invariant check reports equality between `derive_clade_attachments(all)` and the current
  `clade_attachments` rows

### Requirement: rebuild_taxa_full() enforces correct ordering across all three rebuild steps

`derive_taxa_clades()` reads `taxa`'s lineage-level output, and `derive_clade_attachments()` reads both
`taxa`'s and `taxa_clades`'s resolved concept output — so `rebuild_taxa_clades()` SHALL run only after
`rebuild_taxa()`, and `rebuild_clade_attachments()` SHALL run only after `rebuild_taxa_clades()`. An
orchestrating function, `rebuild_taxa_full()`, SHALL run `rebuild_taxa()`, then `rebuild_taxa_clades()`,
then `rebuild_clade_attachments()`, in that order, within a single transaction, and SHALL be the supported
entry point for a full rebuild. Calling the three steps independently and out of order is possible but
unsupported.

#### Scenario: rebuild_taxa_full() produces a fully consistent set of ledgers from empty tables

- **WHEN** `rebuild_taxa_full()` is called against `taxa`, `taxa_clades`, and `clade_attachments` tables
  with no prior rows
- **THEN** all three ledgers end up fully and correctly populated, in one call, with no manual step-ordering
  required by the caller

#### Scenario: A no-op re-derivation updates no rows

- **WHEN** `rebuild_clade_attachments()` runs twice with no intervening opinion changes
- **THEN** the second run updates and inserts no rows (output equals the existing `clade_attachments` rows)
