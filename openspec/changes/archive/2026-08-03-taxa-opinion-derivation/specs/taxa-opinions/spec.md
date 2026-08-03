## ADDED Requirements

### Requirement: derive_taxa() is a pure function of the opinions

`derive_taxa(permids)` SHALL compute the accepted name, rank, groupings, classification, and validity of taxa reading **only** the Layer 1 opinion tables (`name_opinions`, `assignment_opinions`, `validity_opinions`) and `refs` (for `pubyr`). It SHALL NOT read the `taxa` ledger, and SHALL NOT write to any table. It SHALL consider only current, non-removed assertions (`removed IS NOT TRUE AND succeeded_by_id IS NULL`).

#### Scenario: derive_taxa() output does not depend on the ledger

- **WHEN** `derive_taxa()` is called after the `taxa` ledger is truncated
- **THEN** it returns the same rows it returned before the truncation (its output is a function of the opinions alone)

#### Scenario: superseded and removed opinions are ignored

- **WHEN** an opinion has a newer version (`succeeded_by_id` set) or `removed = true`
- **THEN** `derive_taxa()` does not use it in any ranking or grouping

### Requirement: Lineage grouping collapses spellings of one name

`derive_taxa()` SHALL union the `lineage`-class `name_opinions` edges into name-lineages and assign every permid in a lineage the same `original_permid` — the lineage's `root` (`edge_class = 'root'`, reason `original`).

#### Scenario: A correction and its root share an original_permid

- **WHEN** permid B is introduced by a `lineage`-class name edge targeting root permid A
- **THEN** `derive_taxa()` reports `original_permid = A` for both A and B

### Requirement: Concept grouping collapses synonyms

`derive_taxa()` SHALL union the `concept`-class `name_opinions` edges into concepts and assign every permid in a concept the same `concept_permid` — the accepted spelling of the concept's **senior** lineage.

#### Scenario: A junior synonym shares the concept's accepted name

- **WHEN** lineage J is a `junior synonym` (concept edge) of senior lineage S
- **THEN** `derive_taxa()` reports the same `concept_permid` for members of J and S, equal to S's accepted spelling

### Requirement: Accepted spelling is the top-ranked opinion of the senior lineage

Per lineage, `derive_taxa()` SHALL choose `accepted_spelling_permid` as the subject of the top opinion by `ORDER BY evidence DESC, COALESCE(pubyr, ref.pubyr) DESC, id DESC`, excluding subjects whose minting reason is `never_accepted` (misspellings). The accepted rank rides along (the accepted spelling's `rank_id`). Grouping SHALL be resolved before spelling selection, and the concept's accepted name SHALL be scoped to the **senior** lineage only.

#### Scenario: A more-recent, higher-evidence spelling wins within a lineage

- **WHEN** a lineage has two spellings, one asserted with evidence in a later year
- **THEN** `derive_taxa()` selects that spelling as `accepted_spelling_permid`

#### Scenario: A misspelling is never the accepted spelling

- **WHEN** the newest opinion in a lineage introduces a `misspelling` (`never_accepted`) spelling
- **THEN** `derive_taxa()` does not select it; the accepted spelling is the top-ranked non-misspelling

#### Scenario: A junior synonym's newest spelling does not win the concept's name

- **WHEN** a junior synonym lineage has the most recent spelling opinion in the whole concept
- **THEN** the concept's accepted name still comes from the **senior** lineage, not the junior one

### Requirement: Classification is pooled across the whole concept (junior-synonym borrowing)

`derive_taxa()` SHALL choose each concept's `containing_concept_permid` from the top `assignment_opinions` pooled across **all permids in the concept**, by the canonical `ORDER BY`. Borrowing SHALL apply only at **equal rank**, and SHALL be **excluded for species** (a species is placed by its own direct allocation).

#### Scenario: A placement filed under the junior name sets the concept's parent

- **WHEN** the most recent reliable equal-rank `belongs to` opinion in a concept is filed under a junior synonym
- **THEN** `derive_taxa()` uses it to set the concept's `containing_concept_permid`

#### Scenario: Species placement is not borrowed

- **WHEN** the subject concept is a species and a placement opinion exists on a synonym
- **THEN** `derive_taxa()` does not borrow it; the species is placed by its own direct assignment

### Requirement: Seniority tiebreak is total and deterministic

When `concept`-class edges yield no unique senior sink (e.g. equal-rank, equal-priority mutual synonymy), `derive_taxa()` SHALL select the senior lineage by, in order: (a) the canonical `ORDER BY` on each lineage's accepted opinion; (b) oldest `original` `pubyr`; (c) lowest `permid`.

#### Scenario: Mutual synonymy resolves to one deterministic senior

- **WHEN** "A synonym-of B" and "B synonym-of A" exist at equal rank and priority
- **THEN** `derive_taxa()` picks exactly one of A/B as senior per the tiebreak, and repeated calls return the same choice

### Requirement: derive_taxa() terminates on cycles and surfaces containment cycles

`derive_taxa()` SHALL terminate on synonymy cycles (treating the cycle as one concept). A classification (containment) cycle SHALL be surfaced as an error rather than looping or emitting a partial path.

#### Scenario: A synonymy cycle does not loop

- **WHEN** the concept edges form a cycle
- **THEN** `derive_taxa()` completes and returns one concept for the cycle's members

#### Scenario: A containment cycle raises

- **WHEN** assignment opinions imply a concept contains itself (directly or transitively)
- **THEN** `derive_taxa()` raises an error identifying the cycle rather than returning

### Requirement: derive_taxa(subset) equals derive_taxa(all) for the requested permids

`derive_taxa(permids)` SHALL return, for each requested permid, exactly the row `derive_taxa(all)` would produce, by internally expanding the seed set to full lineage/concept components before computing.

#### Scenario: Deriving a single junior synonym matches the full derivation

- **WHEN** `derive_taxa(ARRAY[<one junior-synonym permid>])` is called
- **THEN** that permid's row equals its row from `derive_taxa(all)` (same `concept_permid`, `accepted_spelling_permid`, `containing_concept_permid`, `classification_path`)

### Requirement: derive_taxa() is total over minted permids

`derive_taxa()` SHALL return exactly one row for every permid that has a minting `name_opinion` (reason `root` or a `lineage` reason), with `name` and `rank_id` taken from that minting row. It SHALL NOT emit a row for a permid with no minting opinion.

#### Scenario: Every minted permid gets exactly one row

- **WHEN** `derive_taxa(all)` runs over a fixture of N minted permids
- **THEN** it returns exactly N rows, each with non-NULL `name` and `rank_id` from the minting opinion

### Requirement: classification_path materializes the concept adjacency

`derive_taxa()` SHALL produce `classification_path` as an `ltree` of concept permids from root to node, consistent with `containing_concept_permid` (adjacency is primary; the path is derived from it).

#### Scenario: The path matches the adjacency chain

- **WHEN** concept C is contained by B which is contained by root A
- **THEN** C's `classification_path` is the ltree `A.B.C` (and `containing_concept_permid = B`)

### Requirement: rebuild_taxa() materializes the ledger and the invariant holds

`rebuild_taxa()` SHALL call `derive_taxa(all)` and load the `taxa` ledger, appending a new version only where derived output differs from the current head, recording provenance (`winning_name_opinion_id`, `winning_assignment_opinion_id`, `winning_validity_opinion_id`). A callable check SHALL assert the invariant `derive_taxa(all) ≡ current ledger heads`.

#### Scenario: After rebuild, derive_taxa(all) equals the ledger heads

- **WHEN** `rebuild_taxa()` runs over a fixture opinion set
- **THEN** the invariant check reports equality between `derive_taxa(all)` and the current `taxa` heads

#### Scenario: A no-op re-derivation appends no versions

- **WHEN** `rebuild_taxa()` runs twice with no intervening opinion changes
- **THEN** the second run appends no new `taxa` versions (output equals the existing heads)

#### Scenario: Ledger rows carry winning-opinion provenance

- **WHEN** a taxon's classification is set by a specific assignment opinion
- **THEN** its ledger head's `winning_assignment_opinion_id` references that opinion
