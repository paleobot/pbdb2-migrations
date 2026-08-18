# taxa-opinions Specification

## Purpose
TBD - created by archiving change taxa-opinions-schema. Update Purpose after archive.
## Requirements
### Requirement: Layer 1 assertion tables exist

The schema SHALL define three append-only assertion tables — `name_opinions`, `assignment_opinions`, and `validity_opinions` — each carrying a `bigint` identity primary key, a `permid uuid`, `authorizer_person_id`/`enterer_person_id` FKs to `persons`, `reference_id` FK to `refs`, an `evidence boolean NOT NULL`, an optional `pubyr integer` and `attribution jsonb`, a `removed boolean`, and `preceded_by_id`/`succeeded_by_id` self-referencing FKs. All `*_permid` columns SHALL be plain `uuid` pointers, NOT SQL foreign keys (there is no permid registry table).

#### Scenario: The three opinion tables are present with their key columns

- **WHEN** `create_new.sql` is applied to an empty database
- **THEN** `name_opinions`, `assignment_opinions`, and `validity_opinions` each exist with the columns above, and no `rank_opinions`, `rename_opinions`, `type_opinions`, or `trait_opinions` table exists

#### Scenario: permid columns are not foreign keys

- **WHEN** an opinion row is inserted whose `subject_permid` (or target) references a uuid that appears in no other row
- **THEN** the insert succeeds — there is no FK or registry table to violate

### Requirement: name_opinions models typed edges with a minting shape

`name_opinions` SHALL represent typed edges between name-as-spelled permids: `subject_permid` defers to `target_permid` in the manner given by `reason_id`, whose `edge_class` (`'root'` | `'lineage'` | `'concept'`) selects the derivation grouping. Identity (`new_name`, `rank_id`) is an immutable attribute of a permid, minted once on its `root` row; edges assert relationships between permids whose identities already live on their own root rows. A same-row CHECK SHALL enforce the minting shape so that `new_name` and `rank_id` are populated **iff** `edge_class = 'root'`: `'root'` rows carry no target but do carry `new_name` and `rank_id`; `'lineage'` rows carry a target and carry neither `new_name` nor `rank_id`; `'concept'` rows carry a target and carry neither `new_name` nor `rank_id`. A row SHALL NOT have `subject_permid` equal to `target_permid`.

#### Scenario: A valid root (minting) opinion is accepted

- **WHEN** a `name_opinions` row is inserted with `edge_class = 'root'`, `target_permid IS NULL`, and `new_name` and `rank_id` populated
- **THEN** the insert succeeds

#### Scenario: A root opinion carrying a target is rejected

- **WHEN** a `name_opinions` row is inserted with `edge_class = 'root'` and a non-NULL `target_permid`
- **THEN** the minting-shape CHECK rejects the insert

#### Scenario: A valid lineage edge with no identity is accepted

- **WHEN** a `name_opinions` row is inserted with `edge_class = 'lineage'`, a non-NULL `target_permid`, and `new_name IS NULL` and `rank_id IS NULL`
- **THEN** the insert succeeds

#### Scenario: A lineage edge carrying an identity is rejected

- **WHEN** a `name_opinions` row is inserted with `edge_class = 'lineage'` and a non-NULL `new_name` or `rank_id`
- **THEN** the minting-shape CHECK rejects the insert

#### Scenario: A concept edge carrying an identity is rejected

- **WHEN** a `name_opinions` row is inserted with `edge_class = 'concept'` and a non-NULL `new_name` or `rank_id`
- **THEN** the minting-shape CHECK rejects the insert

#### Scenario: A self-referential edge is rejected

- **WHEN** a `name_opinions` row is inserted with `subject_permid = target_permid`
- **THEN** the `name_opinion_not_self` CHECK rejects the insert

### Requirement: edge_class is provably faithful to the dictionary (Way 2)

Each `name_opinions` row SHALL carry an `edge_class text NOT NULL` copy of its reason's class, pinned to `dictionaries.namechange_reasons` by a composite foreign key `(reason_id, edge_class) → (id, edge_class)`. This SHALL make it impossible to store a row whose `edge_class` disagrees with its `reason_id`, and SHALL block reclassifying a reason in the dictionary while any opinion still references the old pair.

#### Scenario: A mismatched (reason_id, edge_class) pair is rejected

- **WHEN** a `name_opinions` row is inserted with a `reason_id` whose dictionary `edge_class` is `'lineage'` but the row supplies `edge_class = 'concept'`
- **THEN** the composite FK rejects the insert because no `(id, 'concept')` pair exists for that reason

#### Scenario: Reclassifying a referenced reason is refused

- **WHEN** an `UPDATE` attempts to change `edge_class` of a `namechange_reasons` row that a `name_opinions` row still references
- **THEN** the default `NO ACTION` referential rule refuses the update

### Requirement: validity_opinions is untargeted, self-referential testimony

`validity_opinions` SHALL carry `nomenclatural_status_id` as a plain FK to `dictionaries.nomenclatural_statuses`, and SHALL NOT carry a `target_permid` or `targeted` column — every row is a self-referential assertion about `subject_permid`'s own naming act, never a relationship to another permid. `dictionaries.nomenclatural_statuses` SHALL carry a `bars_candidacy boolean NOT NULL DEFAULT false` column instead of `targeted`, true only for `nomen nudum`.

#### Scenario: validity_opinions has no target column

- **WHEN** `validity_opinions` is inspected after applying `create_new.sql`
- **THEN** it has no `target_permid` and no `targeted` column, and `nomenclatural_status_id` is a plain (non-composite) FK to `dictionaries.nomenclatural_statuses`

#### Scenario: Only nomen nudum bars candidacy

- **WHEN** the `nomenclatural_statuses` dictionary is queried
- **THEN** `nomen nudum` has `bars_candidacy = true` and `nomen dubium`/`nomen vanum`/`nomen oblitum` have `bars_candidacy = false`

### Requirement: The taxa ledger exists as derived output

The schema SHALL define a `taxa` table with one row per name-as-spelled permid, holding the immutable denormalized identity (`name text NOT NULL`, `rank_id integer NOT NULL` FK to `dictionaries.taxonomy_ranks`, optional `authority_id`), the derived identity triad (`original_permid`, `accepted_spelling_permid`, `concept_permid`, all `NOT NULL`), classification (`containing_concept_permid` nullable, `classification_path ltree`), `nomenclatural_status_id`, and provenance (`winning_name_opinion_id`, `winning_assignment_opinion_id`, `winning_validity_opinion_id` FKs to the three opinion tables). It SHALL NOT carry `authorizer_person_id`/`enterer_person_id` (no row is hand-entered) and SHALL NOT carry a `winning_rank_opinion_id`.

#### Scenario: The taxa ledger has the derived triad and provenance

- **WHEN** `create_new.sql` is applied to an empty database
- **THEN** `taxa` exists with `original_permid`, `accepted_spelling_permid`, `concept_permid` all `NOT NULL`, `classification_path` of type `ltree`, the three `winning_*_opinion_id` FKs, and no `authorizer_person_id`, `enterer_person_id`, or `winning_rank_opinion_id`

#### Scenario: taxa.rank_id is mandatory

- **WHEN** a `taxa` row is inserted with `rank_id IS NULL`
- **THEN** the `NOT NULL` constraint rejects it (a materialized taxon always has a knowable rank)

### Requirement: Versioning regimes are applied correctly per table

`taxa` and `taxon_annotations` SHALL be versioned via `install_version_triggers()` (getting `place_in_lineage()`, `handle_new_version()`, and the automatic `permid` head index). The three opinion tables SHALL be versioned by carrying `permid` + succession columns but SHALL NOT call `install_version_triggers()`, and SHALL instead hand-create their own head-only `permid` indexes.

#### Scenario: The ledger and annotations get the trigger helper

- **WHEN** the schema is inspected after applying `create_new.sql`
- **THEN** version triggers are installed on `taxa` and `taxon_annotations`

#### Scenario: The opinion tables do not get the trigger helper

- **WHEN** the schema is inspected after applying `create_new.sql`
- **THEN** no version triggers exist on `name_opinions`, `assignment_opinions`, or `validity_opinions`, and each has a hand-created partial index on `(permid) WHERE succeeded_by_id IS NULL`

### Requirement: permid columns enforce uuidv7

Every `permid`-bearing column (the opinion tables, `taxa`, `taxon_annotations`) and `homonyms.homonym_group_id` SHALL enforce version 7 via `CHECK ((get_byte(uuid_send(<col>), 6) >> 4) = 7)`, consistent with the `permid-uuidv7` convention already in `create_new.sql`.

#### Scenario: A non-v7 uuid is rejected

- **WHEN** a row is inserted with a `permid` whose UUID version nibble is not 7
- **THEN** the v7 CHECK rejects the insert

### Requirement: Non-derived tables sit outside the stack

The schema SHALL define `taxon_annotations` (versioned curatorial prose: `common_name`, `comments`, `discussion`, `discussed_by_reference_id`) keyed by `subject_permid`, and `homonyms` grouping permids by an app-minted `homonym_group_id uuid` (uuidv7), with `UNIQUE (homonym_group_id, permid)`. Neither SHALL be reconstructable by `derive()`; `taxa` SHALL NOT carry a `has_homonym` flag.

#### Scenario: Annotations and homonyms exist independently of the ledger

- **WHEN** `create_new.sql` is applied to an empty database
- **THEN** `taxon_annotations` and `homonyms` exist, and `taxa` has no `has_homonym` column

#### Scenario: A homonym group spans more than two members

- **WHEN** three permids are inserted into `homonyms` sharing one `homonym_group_id`
- **THEN** all three rows are accepted (grouped representation supports n > 2 homonyms)

### Requirement: Dictionaries are reconciled to the settled vocabularies

`dictionaries.taxonomy_ranks` SHALL gain an explicit `height integer` (NULL for `unranked`/`unranked clade`) and include the previously-missing `order` rank. `dictionaries.namechange_reasons` SHALL carry `edge_class` (`NOT NULL`, `IN ('root','lineage','concept')`) and `never_accepted`, expose the composite `UNIQUE (id, edge_class)`, and seed exactly the ten tokens `original`, `misspelling`, `reranked`, `recombination`, `assignment`, `correction`, `junior synonym`, `replaced by`, `invalid subgroup`, `nomen oblitum` — with no `code` token, `invalid subgroup` and `nomen oblitum` both `edge_class = 'concept'`. `dictionaries.nomenclatural_statuses` SHALL exist with `(status, bars_candidacy)` seeded for exactly `nomen dubium`, `nomen nudum`, `nomen vanum`, `nomen oblitum` — `invalid subgroup of` is not a member (it lives in `namechange_reasons` instead) — with `bars_candidacy = true` only for `nomen nudum`.

#### Scenario: Rank ordering is explicit and complete

- **WHEN** the `taxonomy_ranks` dictionary is queried
- **THEN** `order` is present, and `height` is populated for all ranked values while `unranked` and `unranked clade` have `height IS NULL`

#### Scenario: namechange_reasons holds exactly the ten reconciled tokens

- **WHEN** the `namechange_reasons` dictionary is queried
- **THEN** exactly the ten tokens are present, `code` is absent, `invalid subgroup` and `nomen oblitum` both have `edge_class = 'concept'`, and `misspelling` has `never_accepted = true`

#### Scenario: nomenclatural_statuses carries the residual self-referential nomen family

- **WHEN** the `nomenclatural_statuses` dictionary is queried
- **THEN** exactly `nomen dubium`, `nomen nudum`, `nomen vanum`, `nomen oblitum` are present, `invalid subgroup of` is absent, and only `nomen nudum` has `bars_candidacy = true`

### Requirement: The obsolete taxa/opinions block is removed and the schema builds clean

The pre-inversion `taxa` / `assignment_opinions` / `rank_opinions` / `rename_opinions` / `homonyms` block SHALL be removed from `create_new.sql`, with no residual FK columns of the form `taxon_id`/`parent_taxon_id → taxa("id")`. `create_new.sql` SHALL apply successfully to an empty database, with the taxa/opinions block placed after its dependencies (`persons`, `refs`, `authorities`, the `dictionaries.*` seeds, and the versioning/permid infrastructure) and after `CREATE EXTENSION IF NOT EXISTS ltree`.

#### Scenario: create_new.sql runs end-to-end on an empty database

- **WHEN** `create_new.sql` is applied to a fresh, empty PostgreSQL database
- **THEN** it completes without error and the `ltree` extension is present

#### Scenario: No pre-inversion swing FKs remain

- **WHEN** `create_new.sql` is searched for `REFERENCES taxa("id")`
- **THEN** the only matches are `taxa`'s own `preceded_by_id`/`succeeded_by_id` succession columns — no `taxon_id` or `parent_taxon_id` FK to `taxa("id")` exists

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

