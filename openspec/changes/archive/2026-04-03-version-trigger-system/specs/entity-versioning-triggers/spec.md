## ADDED Requirements

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

### Requirement: Trigger is installed on all solidified versioned tables
The trigger SHALL be installed on: `refs`, `timescales`, `intervals`, `collections`, `schemas`, `characters`, `states`.

#### Scenario: Each versioned table has the trigger
- **WHEN** `create_new.sql` is executed
- **THEN** each of the seven listed tables SHALL have an `AFTER INSERT` trigger that fires when `preceded_by_id IS NOT NULL`
