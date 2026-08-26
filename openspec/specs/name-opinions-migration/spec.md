# name-opinions-migration Specification

## Purpose
Migrate every legacy MariaDB `authorities` row into the new PostgreSQL `name_opinions` table as a root (minting) edge — self-anchored permid, reason `original`/edge_class `root` — resolving authority/reference/attribution/year provenance through the already-migrated `authorities` records. The 18 `informal`-rank rows migrate as ordinary root rows at rank `'unranked'` with no additional record. Implemented by `migrate-authorities-opinions.js`.
## Requirements
### Requirement: Read all source data from MariaDB
The script SHALL read all rows from the MariaDB `authorities` table. Required columns: `taxon_no`, `taxon_name`, `taxon_rank`, `reference_no`, `authorizer_no`, `enterer_no`. Citation-related columns (`author1last`, `author2last`, `otherauthors`, `pubyr`, `ref_is_authority`) SHALL NOT be read — attribution and publication year are sourced from the already-migrated `authorities` record, not re-derived from legacy fields.

#### Scenario: Full extraction
- **WHEN** the migration script executes the source query
- **THEN** all 517,287 rows are streamed from MariaDB and a starting row count is logged

#### Scenario: Streaming, not buffering
- **WHEN** the source query executes against 517K rows
- **THEN** rows are processed in streaming fashion and the source result set is not held entirely in memory

### Requirement: Preload new authorities into an oldpbdbID resolution map
The script SHALL preload every current-head `authorities` row (`succeeded_by_id IS NULL`) and build an in-memory Map keyed by each string entry in `authority.legacyIDs.oldpbdbIDs`, whose value carries that authority's `id`, `reference_id`, and the fields needed to build `attribution` and `publication_year` (`authority.citation`, `authority.descriptors`, `authority.publishedInReference`, `authority.year`). This is the `refMap` pattern from `migrate-authorities.js`; no DB-side GIN index is required.

#### Scenario: Map covers every absorbed taxon_no
- **WHEN** a new authority has `authority.legacyIDs.oldpbdbIDs = ['100','200','300']`
- **THEN** the Map contains entries for `'100'`, `'200'`, and `'300'`, all pointing at that authority's `id` and `reference_id`

#### Scenario: Only current heads are loaded
- **WHEN** an authority has been re-versioned (multiple rows share a permid)
- **THEN** only the row with `succeeded_by_id IS NULL` is loaded into the Map

### Requirement: Emit one root name_opinion per source row
For every source `authorities` row that resolves to a new authority, the script SHALL insert exactly one `name_opinions` row as a root (minting) edge. The row SHALL set: `reason_id` to the `dictionaries.namechange_reasons` id whose `reason = 'original'`; `edge_class = 'root'`; `target_permid = NULL`; `objective = NULL`; `evidence = false`; `new_name = taxon_name`; `oldpbdb_taxon_no = taxon_no`; `removed = false`.

#### Scenario: Root minting shape satisfied
- **WHEN** a source row is migrated
- **THEN** the inserted `name_opinions` row has `edge_class = 'root'`, `target_permid IS NULL`, and both `new_name` and `rank_id` populated, satisfying `name_opinion_shape`

#### Scenario: Reason resolves to 'original'
- **WHEN** the script resolves `reason_id`
- **THEN** it uses the `namechange_reasons` id whose `reason = 'original'` (and whose `edge_class = 'root'`), satisfying the composite `(reason_id, edge_class)` FK

#### Scenario: One name_opinion per source row
- **WHEN** all resolvable source rows are migrated
- **THEN** 517,284 `name_opinions` rows are inserted (517,287 source rows minus the 3 dangling-ref skips)

### Requirement: permid is minted and reused as subject_permid
The script SHALL generate a fresh uuidv7 for each root `name_opinions` row using the project's `uuidv7()` helper, storing it as both `permid` and `subject_permid` (a root record's subject is itself). The uuid SHALL satisfy the version-7 CHECK on both columns' table.

#### Scenario: Self-referential root permid
- **WHEN** a root `name_opinions` row is inserted
- **THEN** its `subject_permid` equals its own `permid`, and `target_permid IS NULL`

#### Scenario: Distinct permid per row
- **WHEN** two source rows are migrated
- **THEN** they receive distinct `permid` values

### Requirement: Resolve rank_id from taxonomy_ranks
The script SHALL resolve `rank_id` by matching the source `taxon_rank` to `dictionaries.taxonomy_ranks.taxonomy_rank`. All 25 legacy rank values resolve directly EXCEPT `'informal'`, which SHALL map to the id for `'unranked'`.

#### Scenario: Direct rank match
- **WHEN** a source row has `taxon_rank = 'genus'`
- **THEN** `rank_id` is the `taxonomy_ranks` id whose `taxonomy_rank = 'genus'`

#### Scenario: unranked clade resolves directly
- **WHEN** a source row has `taxon_rank = 'unranked clade'`
- **THEN** `rank_id` is the `taxonomy_ranks` id whose `taxonomy_rank = 'unranked clade'` (not remapped)

#### Scenario: informal maps to unranked
- **WHEN** a source row has `taxon_rank = 'informal'`
- **THEN** `rank_id` is the `taxonomy_ranks` id whose `taxonomy_rank = 'unranked'`

### Requirement: Resolve authority_id, reference_id, attribution, and publication_year from the new authority
For each source row, the script SHALL resolve the new `authorities` record whose `oldpbdbIDs` contains the row's `taxon_no` (via the preloaded Map) and set: `authority_id` to that authority's `id`; `reference_id` to that authority's `reference_id`; `attribution` to a jsonb object built per `payloadSchemas/opinionAttribution.schema.js` from the authority's `citation`, `descriptors`, and `publishedInReference`; and `publication_year` to the authority's `year` parsed as an integer (`NULL` when `year` is absent or the sentinel `'0'`).

#### Scenario: Authority-sourced provenance
- **WHEN** a source row with `taxon_no = 100` resolves to a new authority with `id = 5`, `reference_id = 42`, `year = '1969'`
- **THEN** the `name_opinions` row has `authority_id = 5`, `reference_id = 42`, and `publication_year = 1969`

#### Scenario: attribution shape
- **WHEN** the resolved authority has `citation = 'Smith 1969'`, `descriptors = ['Smith']`, `publishedInReference = true`
- **THEN** `attribution` is a jsonb object carrying `citation`, `descriptors`, and `publishedInReference`, valid against `opinionAttribution.schema.js`

#### Scenario: Sentinel year yields NULL publication_year
- **WHEN** the resolved authority has `year = '0'` (scenario ④ sentinel) or no `year`
- **THEN** `publication_year IS NULL`

### Requirement: Skip and log rows with no resolvable authority
The script SHALL skip any source row whose `taxon_no` is absent from the resolution Map (its authority was itself skipped as an orphan ref during the authorities migration), logging the `taxon_no` and `reference_no`. Approximate count: 3 rows (all pointing at the dangling `reference_no = 42348`). Skipped rows produce no `name_opinions` row.

#### Scenario: Orphan authority
- **WHEN** a source row has `taxon_no = 242140`, whose authority was never created (dangling `reference_no = 42348`)
- **THEN** no `name_opinions` row is inserted for it and the script logs the `taxon_no` and `reference_no`

#### Scenario: Skip count accounted
- **WHEN** the script completes
- **THEN** the count of skipped rows plus inserted `name_opinions` rows equals the source row count (3 + 517,284 = 517,287)

### Requirement: Resolve person FKs with zero-sentinel fallback
The script SHALL use `authorizer_no` and `enterer_no` directly as `persons.id` values (persons were inserted with `id = person_no`). When `authorizer_no = 0` or `enterer_no = 0`, the script SHALL substitute the other field's value; when both are 0, it SHALL fall back to `person_no = 1`. Same fallback as `migrate-authorities.js`.

#### Scenario: Both populated
- **WHEN** a source row has `authorizer_no = 5`, `enterer_no = 7`
- **THEN** `authorizer_person_id = 5` and `enterer_person_id = 7`

#### Scenario: Zero-sentinel fallback
- **WHEN** a source row has `authorizer_no = 0`, `enterer_no = 7`
- **THEN** both `authorizer_person_id` and `enterer_person_id` are 7

#### Scenario: Both zero fallback
- **WHEN** a source row has `authorizer_no = 0`, `enterer_no = 0`
- **THEN** both person FKs resolve to `person_no = 1`

### Requirement: Validate each attribution payload before any DB write
Every constructed `attribution` jsonb SHALL be validated against `payloadSchemas/opinionAttribution.schema.js` during the in-memory build phase, before any DB write. On validation failure the script SHALL log the offending `taxon_no` and failing payload and exit non-zero. Because no insert has happened yet, re-running after a fix needs no cleanup.

#### Scenario: Valid attribution
- **WHEN** an attribution object is built from a resolved authority's citation/descriptors/publishedInReference
- **THEN** ajv validation passes and the row is retained for insert

#### Scenario: Invalid attribution aborts before any insert
- **WHEN** a constructed attribution object fails schema validation
- **THEN** the script logs the offending `taxon_no` and payload, exits non-zero, and no rows have been inserted

### Requirement: Bulk insert is transaction-wrapped
The script SHALL wrap the bulk insert of all `name_opinions` rows in a single Postgres transaction (`BEGIN` … `COMMIT`). On any failure before `COMMIT`, Postgres SHALL roll back atomically, leaving `name_opinions` in its pre-run state with no manual cleanup required.

#### Scenario: Successful bulk insert
- **WHEN** all ~517,284 `name_opinions` rows insert without error
- **THEN** the transaction commits and `name_opinions` reflects the inserts

#### Scenario: Mid-insert failure rolls back atomically
- **WHEN** an unexpected error occurs after some rows have been inserted but before `COMMIT`
- **THEN** the transaction rolls back and no migrated rows remain in `name_opinions`

#### Scenario: Re-run after abort needs no manual cleanup
- **WHEN** a prior run aborted (pre-insert validation failure or mid-insert rollback)
- **THEN** re-running on the same source data produces the same result without a `TRUNCATE` step

### Requirement: Log counts and reconcile totals
The script SHALL log total source rows read, `name_opinions` inserted, informal-rank rows (rank-collapsed to `'unranked'`), and skipped orphan rows, and SHALL assert that inserted `name_opinions` plus skipped rows equals source rows read. It SHALL NOT reference `validity_opinions` in its counts.

#### Scenario: Final counts logged
- **WHEN** the script completes
- **THEN** it logs `{sourceRows, nameOpinionsInserted, informalCount, skipped}` and confirms `nameOpinionsInserted + skipped == sourceRows`

