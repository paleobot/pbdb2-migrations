## ADDED Requirements

### Requirement: Layer 1 assertion tables exist

The schema SHALL define three append-only assertion tables — `name_opinions`, `assignment_opinions`, and `validity_opinions` — each carrying a `bigint` identity primary key, a `permid uuid`, `authorizer_person_id`/`enterer_person_id` FKs to `persons`, `reference_id` FK to `refs`, an `evidence boolean NOT NULL`, an optional `pubyr integer` and `attribution jsonb`, a `removed boolean`, and `preceded_by_id`/`succeeded_by_id` self-referencing FKs. All `*_permid` columns SHALL be plain `uuid` pointers, NOT SQL foreign keys (there is no permid registry table).

#### Scenario: The three opinion tables are present with their key columns

- **WHEN** `create_new.sql` is applied to an empty database
- **THEN** `name_opinions`, `assignment_opinions`, and `validity_opinions` each exist with the columns above, and no `rank_opinions`, `rename_opinions`, `type_opinions`, or `trait_opinions` table exists

#### Scenario: permid columns are not foreign keys

- **WHEN** an opinion row is inserted whose `subject_permid` (or target) references a uuid that appears in no other row
- **THEN** the insert succeeds — there is no FK or registry table to violate

### Requirement: name_opinions models typed edges with a minting shape

`name_opinions` SHALL represent typed edges between name-as-spelled permids: `subject_permid` defers to `target_permid` in the manner given by `reason_id`, whose `edge_class` (`'root'` | `'lineage'` | `'concept'`) selects the derivation grouping. A same-row CHECK SHALL enforce the minting shape: `'root'` rows carry no target but do carry `new_name` and `rank_id`; `'lineage'` rows carry a target and carry `new_name` and `rank_id`; `'concept'` rows carry a target and carry neither `new_name` nor `rank_id`. A row SHALL NOT have `subject_permid` equal to `target_permid`.

#### Scenario: A valid root (minting) opinion is accepted

- **WHEN** a `name_opinions` row is inserted with `edge_class = 'root'`, `target_permid IS NULL`, and `new_name` and `rank_id` populated
- **THEN** the insert succeeds

#### Scenario: A root opinion carrying a target is rejected

- **WHEN** a `name_opinions` row is inserted with `edge_class = 'root'` and a non-NULL `target_permid`
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

### Requirement: validity_opinions enforces the targeted rule

`validity_opinions` SHALL carry `status_id`, a `targeted boolean NOT NULL` copy pinned to `dictionaries.nomenclatural_statuses` by a composite FK `(status_id, targeted) → (id, targeted)`, and a `target_permid` required exactly when `targeted` is true, enforced by a same-row CHECK (`targeted = (target_permid IS NOT NULL)`).

#### Scenario: A targeted status without a target is rejected

- **WHEN** a `validity_opinions` row is inserted with a `status_id` whose status is `targeted = true` (e.g. `invalid subgroup of`) and `target_permid IS NULL`
- **THEN** the `validity_target_shape` CHECK rejects the insert

#### Scenario: A non-targeted status with a target is rejected

- **WHEN** a `validity_opinions` row is inserted with a `status_id` whose status is `targeted = false` (e.g. `nomen dubium`) and a non-NULL `target_permid`
- **THEN** the CHECK rejects the insert

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

`dictionaries.taxonomy_ranks` SHALL gain an explicit `height integer` (NULL for `unranked`/`unranked clade`) and include the previously-missing `order` rank. `dictionaries.namechange_reasons` SHALL carry `edge_class` (`NOT NULL`, `IN ('root','lineage','concept')`) and `never_accepted`, expose the composite `UNIQUE (id, edge_class)`, and seed exactly the eight tokens `original`, `misspelling`, `reranked`, `recombination`, `assignment`, `correction`, `junior synonym`, `replaced by` — with no `code` token and no `nomen oblitum` token. `dictionaries.nomenclatural_statuses` SHALL exist with `(status, targeted)` seeded for the nomen family plus `invalid subgroup of`, and expose the composite `UNIQUE (id, targeted)`.

#### Scenario: Rank ordering is explicit and complete

- **WHEN** the `taxonomy_ranks` dictionary is queried
- **THEN** `order` is present, and `height` is populated for all ranked values while `unranked` and `unranked clade` have `height IS NULL`

#### Scenario: namechange_reasons holds exactly the eight reconciled tokens

- **WHEN** the `namechange_reasons` dictionary is queried
- **THEN** exactly the eight tokens are present, `code` and `nomen oblitum` are absent, and `misspelling` has `never_accepted = true`

#### Scenario: nomenclatural_statuses carries the nomen family

- **WHEN** the `nomenclatural_statuses` dictionary is queried
- **THEN** `nomen dubium`/`nomen nudum`/`nomen vanum`/`nomen oblitum` are present with `targeted = false` and `invalid subgroup of` with `targeted = true`

### Requirement: The obsolete taxa/opinions block is removed and the schema builds clean

The pre-inversion `taxa` / `assignment_opinions` / `rank_opinions` / `rename_opinions` / `homonyms` block SHALL be removed from `create_new.sql`, with no residual FK columns of the form `taxon_id`/`parent_taxon_id → taxa("id")`. `create_new.sql` SHALL apply successfully to an empty database, with the taxa/opinions block placed after its dependencies (`persons`, `refs`, `authorities`, the `dictionaries.*` seeds, and the versioning/permid infrastructure) and after `CREATE EXTENSION IF NOT EXISTS ltree`.

#### Scenario: create_new.sql runs end-to-end on an empty database

- **WHEN** `create_new.sql` is applied to a fresh, empty PostgreSQL database
- **THEN** it completes without error and the `ltree` extension is present

#### Scenario: No pre-inversion swing FKs remain

- **WHEN** `create_new.sql` is searched for `REFERENCES taxa("id")`
- **THEN** the only matches are `taxa`'s own `preceded_by_id`/`succeeded_by_id` succession columns — no `taxon_id` or `parent_taxon_id` FK to `taxa("id")` exists
