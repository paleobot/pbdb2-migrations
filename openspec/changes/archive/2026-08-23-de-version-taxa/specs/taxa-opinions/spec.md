## MODIFIED Requirements

### Requirement: Versioning regimes are applied correctly per table

`taxon_annotations` SHALL be versioned via `install_version_triggers()` (getting `place_in_lineage()`, `handle_new_version()`, and the automatic `permid` head index). `taxa` SHALL NOT be versioned: it carries no `preceded_by_id`/`succeeded_by_id` and is not passed to `install_version_triggers()` — it SHALL instead enforce `UNIQUE (permid)` (one row per permid, updated in place, not a lineage of historical rows). The three opinion tables SHALL be versioned by carrying `permid` + succession columns but SHALL NOT call `install_version_triggers()`, and SHALL instead hand-create their own head-only `permid` indexes.

#### Scenario: The ledger and annotations get the trigger helper

- **WHEN** the schema is inspected after applying `create_new.sql`
- **THEN** version triggers are installed on `taxon_annotations` but not on `taxa`, and `taxa` has no `preceded_by_id`/`succeeded_by_id` columns and a `UNIQUE (permid)` constraint

#### Scenario: The opinion tables do not get the trigger helper

- **WHEN** the schema is inspected after applying `create_new.sql`
- **THEN** no version triggers exist on `name_opinions`, `assignment_opinions`, or `validity_opinions`, and each has a hand-created partial index on `(permid) WHERE succeeded_by_id IS NULL`

### Requirement: rebuild_taxa() materializes the ledger and the invariant holds

`rebuild_taxa()` SHALL call `derive_taxa(all)` and load the `taxa` ledger by upserting in place: updating a permid's existing row where derived output differs, and inserting a row where the permid is new, recording provenance (`winning_name_opinion_id`, `winning_assignment_opinion_id`, `winning_validity_opinion_id`). A callable check SHALL assert the invariant `derive_taxa(all) ≡ the current taxa rows`.

#### Scenario: After rebuild, derive_taxa(all) equals the ledger heads

- **WHEN** `rebuild_taxa()` runs over a fixture opinion set
- **THEN** the invariant check reports equality between `derive_taxa(all)` and the current `taxa` rows

#### Scenario: A no-op re-derivation appends no versions

- **WHEN** `rebuild_taxa()` runs twice with no intervening opinion changes
- **THEN** the second run updates and inserts no rows (output equals the existing `taxa` rows)

#### Scenario: Ledger rows carry winning-opinion provenance

- **WHEN** a taxon's classification is set by a specific assignment opinion
- **THEN** its `taxa` row's `winning_assignment_opinion_id` references that opinion
