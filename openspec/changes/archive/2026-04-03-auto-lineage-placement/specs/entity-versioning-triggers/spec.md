## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Trigger is installed on all solidified versioned tables
The triggers SHALL be installed on: `refs`, `timescales`, `intervals`, `collections`, `schemas`, `characters`, `states`. The installer function is named `install_version_triggers` (plural) and installs both a BEFORE INSERT trigger (for lineage placement) and an AFTER INSERT trigger (for FK swinging and version chain maintenance).

#### Scenario: Each versioned table has both triggers
- **WHEN** `create_new.sql` is executed
- **THEN** each of the seven listed tables SHALL have a BEFORE INSERT trigger that determines lineage placement AND an AFTER INSERT trigger that fires when `preceded_by_id IS NOT NULL`
