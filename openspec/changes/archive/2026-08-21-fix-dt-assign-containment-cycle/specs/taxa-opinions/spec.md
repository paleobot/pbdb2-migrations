## MODIFIED Requirements

### Requirement: Classification is pooled across the whole concept (junior-synonym borrowing)

`derive_taxa()` SHALL choose each concept's `containing_concept_permid` from the top `assignment_opinions` pooled across **all permids in the concept**, by the canonical `ORDER BY`. Borrowing SHALL apply only at **equal rank**, and SHALL be **excluded for species** (a species is placed by its own direct allocation). A candidate SHALL be excluded from this pool entirely — never entering the ranking contest — if its `containing_permid` resolves to the same concept as the subject (i.e. the concept would be its own container). If excluding self-referential candidates leaves no candidate for a concept, that concept's `containing_concept_permid` SHALL be `NULL` (rootless), the same outcome already used elsewhere for "no container asserted," rather than an error or a synthesized guess.

#### Scenario: A placement filed under the junior name sets the concept's parent

- **WHEN** the most recent reliable equal-rank `belongs to` opinion in a concept is filed under a junior synonym
- **THEN** `derive_taxa()` uses it to set the concept's `containing_concept_permid`

#### Scenario: Species placement is not borrowed

- **WHEN** the subject concept is a species and a placement opinion exists on a synonym
- **THEN** `derive_taxa()` does not borrow it; the species is placed by its own direct assignment

#### Scenario: A self-referential candidate is excluded, and the next-ranked genuine candidate wins

- **WHEN** a concept's pooled candidates include one whose `containing_permid` resolves back to that same concept (e.g. a legacy `belongs to` opinion filed under a now-synonymized lineage naming the other, now-merged lineage as container) and at least one other candidate whose `containing_permid` resolves to a different concept
- **THEN** `derive_taxa()` excludes the self-referential candidate from the ranking contest entirely, and sets `containing_concept_permid` from the top-ranked remaining candidate, by the same `evidence DESC, yr DESC NULLS LAST, opinion_id DESC` order used when no self-reference is present

#### Scenario: A concept whose only candidates are self-referential ends up rootless

- **WHEN** every rank-matching `assignment_opinions` candidate pooled for a concept resolves its `containing_permid` back to that same concept
- **THEN** `derive_taxa()` sets that concept's `containing_concept_permid` to `NULL` rather than raising an error, selecting one of the excluded candidates anyway, or leaving the concept unresolved

### Requirement: derive_taxa() terminates on cycles and surfaces containment cycles

`derive_taxa()` SHALL terminate on synonymy cycles (treating the cycle as one concept). A direct self-reference — a single concept whose only pooled containment candidate(s) resolve back to itself — SHALL be resolved to `containing_concept_permid = NULL` by the pooling exclusion above, and SHALL NOT reach the cycle guard at all. A genuine classification (containment) cycle spanning two or more distinct concepts SHALL still be surfaced as an error rather than looping or emitting a partial path.

#### Scenario: A synonymy cycle does not loop

- **WHEN** the concept edges form a cycle
- **THEN** `derive_taxa()` completes and returns one concept for the cycle's members

#### Scenario: A containment cycle raises

- **WHEN** assignment opinions imply that concept A contains concept B, and (directly or transitively through other distinct concepts) B contains A
- **THEN** `derive_taxa()` raises an error identifying the cycle rather than returning

#### Scenario: A direct self-containment candidate resolves to rootless, not a raised cycle

- **WHEN** a concept's only pooled containment candidate(s) name that same concept as container (a length-one cycle)
- **THEN** `derive_taxa()` resolves it to `containing_concept_permid = NULL` via the pooling exclusion, and this concept never triggers the containment-cycle guard
