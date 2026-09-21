## ADDED Requirements

### Requirement: Mint a permid for every person
The script SHALL mint a `permid` for every person row it inserts, using the UUIDv7 generator exported by
`src/lib/uuidv7.js`. The permid SHALL be freshly generated and SHALL NOT be derived from `person_no`,
`legacyIDs.oldpbdbID`, `legacyIDs.pbotID`, the person's email, or any other source value.

The permid is a flat column on `persons`, not a property of the `person` JSONB. It joins — and does not
replace — the identifiers the row already carries: `id` (seeded from `person_no`) remains the key every
`authorizer_person_id` and `enterer_person_id` in the schema references, and `legacyIDs.oldpbdbID` remains
the record of where the row came from.

#### Scenario: Every migrated person has a permid
- **WHEN** the migration completes
- **THEN** all 1,304 rows in `persons` have a non-NULL `permid` whose version nibble is 7

#### Scenario: Permids are distinct
- **WHEN** the migration completes
- **THEN** the number of distinct `permid` values in `persons` equals the number of rows

#### Scenario: Permid is not derived from source values
- **WHEN** a person with `person_no = 42` is migrated
- **THEN** the row's `permid` is a generated UUIDv7 unrelated to `42`, and `person->legacyIDs->>'oldpbdbID'` is still `'42'`

## MODIFIED Requirements

### Requirement: Idempotent upsert
The script SHALL use `INSERT ... ON CONFLICT (id) DO UPDATE SET ...` so that re-running the migration updates existing rows rather than failing on duplicates or deleting data. The upsert SHALL update `role_id`, `authorizer_person_id`, `person` (JSONB), and `active`.

The upsert SHALL NOT update `permid`. The permid is supplied in the INSERT column list and omitted from the
`DO UPDATE SET` list, so it is written once, when the row is created, and never again.

This exclusion is what makes the permid permanent. The script mints a fresh permid on every pass over a
source row, including passes that resolve to an update; were `permid` in the `DO UPDATE SET` list, each
re-run would issue every person a new identifier, silently invalidating every external reference to them.
No other minted-permid table in the project has this hazard, because no other one upserts on a surrogate
`id` — so the exclusion is stated here rather than left to resemble an oversight.

#### Scenario: First run
- **WHEN** the script runs against an empty `persons` table
- **THEN** all 1,304 rows are inserted

#### Scenario: Repeated run
- **WHEN** the script runs and `persons` already contains previously migrated rows
- **THEN** existing rows are updated with current source data and no duplicates are created

#### Scenario: Permid survives a re-run
- **WHEN** the script runs a second time against a `persons` table it has already populated
- **THEN** every row's `permid` is byte-for-byte the value it held before the re-run, while `role_id`, `authorizer_person_id`, `person`, and `active` are refreshed from source

#### Scenario: Re-run does not exhaust or collide permids
- **WHEN** a re-run mints permids for rows that then resolve to updates
- **THEN** the minted values are discarded by the `DO UPDATE SET` list rather than written, and no unique-constraint violation occurs on `persons.permid`
