## MODIFIED Requirements

### Requirement: Concept grouping collapses synonyms

For each lineage, `derive_taxa()` SHALL select the single top-ranked current `concept`-class opinion among all opinions filed under any of that lineage's member permids (`ORDER BY evidence DESC, COALESCE(pubyr, ref.pubyr) DESC, id DESC`). If that winner is non-negating, its edge (lineage → target lineage) feeds the concept union-find; if the winner is negating (`negates = true`), the lineage contributes no concept edge this round and forms a concept of its own unless some other current opinion pulls it elsewhere. `derive_taxa()` SHALL union the resulting edges into concepts and assign every permid in a concept the same `concept_permid` — the accepted spelling of the concept's **senior** lineage. A `concept`-class candidate edge SHALL be excluded from the union-find entirely — on either side — if either lineage's accepted rank (per the lineage-grouping requirement) is `unranked` or `unranked clade`: these are cladistic ranks, not part of the Linnaean containment system, and merging one into a concept alongside a Linnaean-ranked ancestor or descendant is exactly the mechanism that produces spurious containment cycles (a lineage's concept folding back into one of its own containing ancestors). An excluded lineage forms its own concept, exactly as if it had no `concept`-class opinion at all.

#### Scenario: A junior synonym shares the concept's accepted name

- **WHEN** lineage J is a `junior synonym` (concept edge) of senior lineage S
- **THEN** `derive_taxa()` reports the same `concept_permid` for members of J and S, equal to S's accepted spelling

#### Scenario: A later, higher-ranked opinion redirects a lineage's concept

- **WHEN** lineage L has two current `concept`-class opinions (filed under any of its member permids) targeting different lineages, and the higher-ranked one targets lineage S
- **THEN** `derive_taxa()` unions L into S's concept, not the lower-ranked opinion's target's concept

#### Scenario: A winning negation returns a lineage to its own concept

- **WHEN** lineage L's current `concept`-class opinions are a lower-ranked one (reason `junior synonym`, `negates = false`, target S) asserting L is a junior synonym of senior lineage S, and a higher-ranked one citing the same `junior synonym` reason with `negates = true` and the same target S, rejecting that claim
- **THEN** `derive_taxa()` reports `concept_permid` for L's members equal to L's own accepted spelling, not S's

#### Scenario: An unranked-clade lineage never merges into another concept via synonymy

- **WHEN** a lineage accepted at rank `unranked clade` (or `unranked`) has a winning `concept`-class opinion naming it a junior synonym of a lineage accepted at a Linnaean rank (e.g. `class`, `family`)
- **THEN** `derive_taxa()` excludes that edge from the concept union-find, and the unranked-clade lineage forms its own concept rather than merging into the Linnaean-ranked lineage's concept

#### Scenario: Two unranked-clade lineages do not merge with each other either

- **WHEN** two lineages both accepted at rank `unranked clade` have a winning `concept`-class opinion between them
- **THEN** `derive_taxa()` still excludes that edge — the exclusion applies whenever either side is unranked/unranked clade, not only when one side is Linnaean-ranked — and each forms its own concept

## MODIFIED Requirements

### Requirement: Classification is pooled across the whole concept (junior-synonym borrowing)

`derive_taxa()` SHALL choose each concept's `containing_concept_permid` from the top `assignment_opinions` pooled across **all permids in the concept**, by the canonical `ORDER BY`. Borrowing SHALL apply only at **equal rank**, and SHALL be **excluded for species** (a species is placed by its own direct allocation). A candidate SHALL be excluded from this pool entirely — never entering the ranking contest — if its `containing_permid` resolves to the same concept as the subject (i.e. the concept would be its own container). A candidate SHALL also be excluded if either the subject's lineage or the containing permid's lineage is accepted at rank `unranked` or `unranked clade` — the same cladistic-vs-Linnaean reasoning as the concept-grouping exclusion applies here: an unranked-clade lineage SHALL NOT be assigned a `containing_concept_permid` of its own, and SHALL NOT be eligible to serve as another concept's container. A candidate SHALL also be excluded if the containing lineage's accepted rank is **finer** than the subject lineage's accepted rank (a rank inversion — a container SHALL NOT be more finely ranked than what it contains); equal rank between subject and container SHALL NOT be excluded by this check, since equal-rank containment (e.g. one genus placed within another) is a legitimate, common pattern independent of the dedicated equal-rank-borrowing mechanism above. If excluding self-referential, unranked, or rank-inverted candidates leaves no candidate for a concept, that concept's `containing_concept_permid` SHALL be `NULL` (rootless), the same outcome already used elsewhere for "no container asserted," rather than an error or a synthesized guess.

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

#### Scenario: An unranked-clade concept is never assigned a container

- **WHEN** a concept's accepted spelling is at rank `unranked clade`, and its senior lineage has a winning `assignment_opinions` candidate
- **THEN** `derive_taxa()` excludes that candidate from the pool and sets the concept's `containing_concept_permid` to `NULL` rather than using it

#### Scenario: An unranked-clade lineage is never borrowed as another concept's container

- **WHEN** a concept's pooled candidates include one whose `containing_permid` resolves to a lineage accepted at rank `unranked` or `unranked clade`
- **THEN** `derive_taxa()` excludes that candidate from the pool, falling through to the next-ranked non-excluded candidate or to `NULL` if none remains

#### Scenario: A rank-inverted candidate is excluded, and a coarser or equal-rank candidate wins instead

- **WHEN** a concept's pooled candidates include one whose containing lineage's accepted rank is finer than the subject lineage's accepted rank (e.g. a family's senior lineage cited as contained by a subfamily), and at least one other candidate whose containing lineage is coarser-or-equal-ranked
- **THEN** `derive_taxa()` excludes the rank-inverted candidate from the ranking contest entirely, and sets `containing_concept_permid` from the top-ranked remaining candidate

#### Scenario: Equal-rank containment is not excluded by the rank-cardinality check

- **WHEN** a concept's pooled candidate names a containing lineage accepted at the same rank as the subject lineage (e.g. one genus placed within another)
- **THEN** `derive_taxa()` does not exclude that candidate on rank-cardinality grounds; it competes normally in the ranking contest

#### Scenario: A concept whose only candidates are rank-inverted ends up rootless

- **WHEN** every candidate pooled for a concept has a containing lineage finer-ranked than the subject lineage
- **THEN** `derive_taxa()` sets that concept's `containing_concept_permid` to `NULL` rather than raising an error or selecting one of the excluded candidates anyway

## MODIFIED Requirements

### Requirement: derive_taxa() terminates on cycles and surfaces containment cycles

`derive_taxa()` SHALL terminate on synonymy cycles (treating the cycle as one concept). A direct self-reference — a single concept whose only pooled containment candidate(s) resolve back to itself — SHALL be resolved to `containing_concept_permid = NULL` by the pooling exclusion above, and SHALL NOT reach the cycle guard at all. A cycle whose formation depended on an `unranked`/`unranked clade` lineage participating in concept-class merging or containment pooling, or on a rank-inverted containment candidate, SHALL likewise never form in the first place, per the exclusions above, and SHALL NOT reach the cycle guard. A genuine classification (containment) cycle spanning two or more distinct concepts of compatible rank — one that does not depend on unranked-clade participation or a rank inversion — SHALL still be surfaced as an error rather than looping or emitting a partial path.

#### Scenario: A synonymy cycle does not loop

- **WHEN** the concept edges form a cycle
- **THEN** `derive_taxa()` completes and returns one concept for the cycle's members

#### Scenario: A containment cycle raises

- **WHEN** assignment opinions imply that concept A contains concept B, and (directly or transitively through other distinct concepts) B contains A, no concept in the cycle is accepted at rank `unranked` or `unranked clade`, and no edge in the cycle is a rank inversion
- **THEN** `derive_taxa()` raises an error identifying the cycle rather than returning

#### Scenario: A direct self-containment candidate resolves to rootless, not a raised cycle

- **WHEN** a concept's only pooled containment candidate(s) name that same concept as container (a length-one cycle)
- **THEN** `derive_taxa()` resolves it to `containing_concept_permid = NULL` via the pooling exclusion, and this concept never triggers the containment-cycle guard

#### Scenario: A cycle that only forms via an unranked-clade lineage never reaches the guard

- **WHEN** a chain of concept-class and/or containment edges would form a cycle only because one of its links merges or places an `unranked`/`unranked clade` lineage
- **THEN** the concept-grouping and classification-pooling exclusions above prevent that link from ever forming, so the cycle never exists and the guard is never triggered by it

#### Scenario: A cycle that only forms via a rank-inverted containment edge never reaches the guard

- **WHEN** a chain of containment edges would form a cycle only because one of its links places a coarser-ranked lineage inside a finer-ranked one
- **THEN** the classification-pooling exclusion above prevents that link from ever forming, so the cycle never exists and the guard is never triggered by it
