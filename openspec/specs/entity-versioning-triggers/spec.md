### Requirement: FK references swing to new version on insert
When a new version of a versioned entity is inserted (i.e., a row with `preceded_by_id IS NOT NULL`), the system SHALL automatically update all foreign key columns in other tables that reference the old version's `id` to point to the new version's `id`.

#### Scenario: New version of a schema swings character references
- **WHEN** a new row is inserted into `schemas` with `preceded_by_id` pointing to an existing schema row
- **THEN** all rows in `characters` where `parent_schema_id` equals the old schema's `id` SHALL be updated to reference the new schema's `id`

#### Scenario: New version of a character swings state references
- **WHEN** a new row is inserted into `characters` with `preceded_by_id` pointing to an existing character row
- **THEN** all rows in `states` where `parent_character_id` equals the old character's `id` SHALL be updated to reference the new character's `id`

#### Scenario: New version of a collection swings additional_collection_refs
- **WHEN** a new row is inserted into `collections` with `preceded_by_id` pointing to an existing collection row
- **THEN** all rows in `additional_collection_refs` where `collection_id` equals the old collection's `id` SHALL be updated to reference the new collection's `id`

#### Scenario: Self-referential FKs are swung
- **WHEN** a new version of a character is inserted and other characters reference the old version via `parent_character_id`
- **THEN** those child characters SHALL have their `parent_character_id` updated to the new version's `id`

### Requirement: Version-chain columns are excluded from swinging
The system SHALL NOT update `preceded_by_id` or `succeeded_by_id` columns when swinging FK references. These columns form the version chain and must remain stable.

#### Scenario: preceded_by_id is not swung
- **WHEN** a new version of entity A is inserted, and entity B has `preceded_by_id` pointing to entity A's old `id`
- **THEN** entity B's `preceded_by_id` SHALL remain unchanged

#### Scenario: succeeded_by_id is not swung
- **WHEN** a new version of entity A is inserted, and entity C has `succeeded_by_id` pointing to entity A's old `id`
- **THEN** entity C's `succeeded_by_id` SHALL remain unchanged

### Requirement: Old version succeeded_by_id is set automatically
When a new version is inserted, the system SHALL set `succeeded_by_id` on the old version row to point to the new version's `id`.

#### Scenario: Old version gets succeeded_by_id populated
- **WHEN** a new row is inserted into `refs` with `preceded_by_id = 42`
- **THEN** the row in `refs` with `id = 42` SHALL have its `succeeded_by_id` set to the new row's `id`

### Requirement: Initial entity creation does not trigger FK swinging
The trigger SHALL only fire when `preceded_by_id IS NOT NULL`. Inserting a brand-new entity (first version, no predecessor) SHALL NOT invoke the FK swinging logic.

#### Scenario: First version insert is unaffected
- **WHEN** a new row is inserted into `collections` with `preceded_by_id IS NULL`
- **THEN** no FK swinging or `succeeded_by_id` updates SHALL occur

### Requirement: FK discovery is generic via pg_constraint
The system SHALL use PostgreSQL's `pg_constraint` catalog to discover foreign keys at runtime, rather than hardcoding table/column relationships.

#### Scenario: Newly added FK is automatically discovered
- **WHEN** a new table is created with a FK referencing `schemas.id`, and a schema is subsequently versioned
- **THEN** the new table's FK column SHALL be swung to the new schema version without any changes to the trigger functions

### Requirement: Lineage placement is determined automatically by permid
On every INSERT into a versioned table, the system SHALL query for existing rows with the same `permid` where `succeeded_by_id IS NULL` to find the current lineage head. If a head is found, the system SHALL set `preceded_by_id` to the head's `id`. If no head is found, `preceded_by_id` SHALL remain NULL (new lineage).

#### Scenario: Insert into existing lineage
- **WHEN** a new row is inserted into `refs` with `permid = 'abc123'` and an existing row in `refs` has `permid = 'abc123'` and `succeeded_by_id IS NULL`
- **THEN** the new row's `preceded_by_id` SHALL be set to that existing row's `id`

#### Scenario: Insert as new lineage
- **WHEN** a new row is inserted into `schemas` with `permid = 'xyz789'` and no existing row in `schemas` has `permid = 'xyz789'`
- **THEN** the new row's `preceded_by_id` SHALL remain NULL

### Requirement: Caller-provided preceded_by_id is always overwritten
The system SHALL overwrite any caller-provided `preceded_by_id` value. The database determines lineage placement, not the caller.

#### Scenario: Explicit preceded_by_id is ignored
- **WHEN** a new row is inserted into `collections` with `preceded_by_id = 99` explicitly provided, but the actual lineage head for that `permid` has `id = 42`
- **THEN** the inserted row's `preceded_by_id` SHALL be `42`, not `99`

#### Scenario: Explicit preceded_by_id is cleared for new lineage
- **WHEN** a new row is inserted with `preceded_by_id = 10` but no existing rows share the same `permid`
- **THEN** the inserted row's `preceded_by_id` SHALL be NULL

### Requirement: Caller-provided succeeded_by_id is always cleared
The system SHALL set `succeeded_by_id` to NULL on every INSERT, regardless of any caller-provided value. The `succeeded_by_id` column is only set by the AFTER INSERT trigger when a subsequent version is created.

#### Scenario: Explicit succeeded_by_id is ignored
- **WHEN** a new row is inserted with `succeeded_by_id = 50` explicitly provided
- **THEN** the inserted row's `succeeded_by_id` SHALL be NULL

### Requirement: Corrupted lineage raises an error
If more than one row exists with the same `permid` and `succeeded_by_id IS NULL` in the same table, the system SHALL raise an error and refuse the INSERT.

#### Scenario: Multiple heads detected
- **WHEN** a new row is inserted into `characters` with `permid = 'dup1'` and two existing rows in `characters` have `permid = 'dup1'` and `succeeded_by_id IS NULL`
- **THEN** the system SHALL raise an exception indicating a corrupted lineage

### Requirement: Trigger is installed on all solidified versioned tables
The triggers SHALL be installed on: `refs`, `timescales`, `intervals`, `collections`, `schemas`, `characters`, `states`. The installer function is named `install_version_triggers` (plural) and installs both a BEFORE INSERT trigger (for lineage placement) and an AFTER INSERT trigger (for FK swinging and version chain maintenance).

#### Scenario: Each versioned table has both triggers
- **WHEN** `create_new.sql` is executed
- **THEN** each of the seven listed tables SHALL have a BEFORE INSERT trigger that determines lineage placement AND an AFTER INSERT trigger that fires when `preceded_by_id IS NOT NULL`

### Requirement: Surrogate keys on solidified versioned tables are bigint
On the solidified versioned tables (`refs`, `collections`, `schemas`, `characters`, `states`, `authorities`), the surrogate `id` primary key SHALL be `bigint GENERATED BY DEFAULT AS IDENTITY`, and every foreign-key column that references such an `id` SHALL also be `bigint`. Foreign-key columns that reference non-versioned, bounded tables (`persons`, `dictionaries.*`) SHALL remain `integer`.

Rationale: versioned tables consume `id` values per edit, not per entity, so `integer` (2^31) exhaustion is a realistic long-term risk that `bigint` removes.

#### Scenario: Versioned table id is bigint
- **WHEN** `create_new.sql` is executed
- **THEN** `refs.id`, `collections.id`, `schemas.id`, `characters.id`, `states.id`, and `authorities.id` SHALL be of type `bigint`

#### Scenario: References to a versioned id are bigint
- **WHEN** a column is a foreign key to a versioned table's `id` (e.g. `collections.reference_id`, `characters.parent_schema_id`, `additional_collection_refs.collection_id`, or any `preceded_by_id`/`succeeded_by_id` on an in-scope table)
- **THEN** that column SHALL be of type `bigint`

#### Scenario: References to bounded tables stay integer
- **WHEN** a column is a foreign key to `persons.id` or a `dictionaries.*` id (e.g. `authorizer_person_id`, `reference_type_id`)
- **THEN** that column SHALL remain `integer`

### Requirement: Version-trigger helper functions operate on bigint identifiers
The `swing_fks_to_new_version` function SHALL accept `bigint` for its `old_id` and `new_id` parameters, and `place_in_lineage` SHALL use a `bigint` variable for the discovered lineage head id.

#### Scenario: Swing function signature is bigint
- **WHEN** `create_new.sql` defines `swing_fks_to_new_version`
- **THEN** its signature SHALL be `swing_fks_to_new_version(target_table text, old_id bigint, new_id bigint)`

#### Scenario: Lineage placement handles bigint head ids
- **WHEN** `place_in_lineage` looks up the current lineage head's `id`
- **THEN** it SHALL hold that id in a `bigint` variable
