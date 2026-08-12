# permid-uuidv7 Specification

## Purpose
Require every minted `permid` across the migration scripts to be a UUIDv7 value.

## Requirements

### Requirement: Permids are generated as UUIDv7
Every migration script that mints a `permid` SHALL generate it as a UUIDv7 value. The in-scope tables are `authorities`, `collections`, `refs`, `schemas`, `characters`, and `states`. Scripts SHALL NOT use `crypto.randomUUID()` (UUIDv4) or any externally-sourced identifier as the permid for these tables.

#### Scenario: Authorities/collections/refs permid is v7
- **WHEN** `migrate-authorities.js`, `migrate-collections.js`, or `migrate-refs.js` inserts a row
- **THEN** the `permid` is a UUIDv7 whose version nibble equals 7

#### Scenario: Pbot-sourced permid is v7
- **WHEN** `migrate-pbot-refs.js` or `migrate-pbot-schemas.js` inserts a refs/schemas/characters/states row
- **THEN** the `permid` is a freshly generated UUIDv7, not the source `pbotID`

#### Scenario: No UUIDv4 permids remain
- **WHEN** the in-scope migrations have completed
- **THEN** no row in the six in-scope tables has a permid whose version nibble is 4

### Requirement: Shared UUIDv7 generation helper
The project SHALL provide a single ESM helper module that exports a UUIDv7 generator backed by the `uuid` npm package's `v7` function. All migration scripts that mint permids SHALL import this helper rather than generating UUIDs inline, so the generation strategy can be changed in one place.

#### Scenario: Scripts import the shared helper
- **WHEN** a migration script needs a new permid
- **THEN** it calls the shared helper's exported generator, and no script imports `randomUUID` from `crypto` for permid generation

#### Scenario: Backed by the uuid package
- **WHEN** the helper generates a value
- **THEN** the value is produced by the `uuid` package's `v7` function and is a valid UUIDv7

### Requirement: External legacy identifiers preserved in legacyIDs
When a migration stops using an externally-sourced identifier (e.g. PBot `pbotID`) as the permid, that identifier SHALL remain captured in the entity's JSONB `legacyIDs` object so that no source identifier is lost and cross-entity lookups keyed on `legacyIDs->>'pbotID'` continue to resolve.

#### Scenario: pbotID retained after permid change
- **WHEN** a pbot-sourced row is migrated with a generated UUIDv7 permid
- **THEN** the row's JSONB contains `legacyIDs.pbotID` equal to the original PBot `pbotID`

### Requirement: Database enforces UUIDv7 version on in-scope permid columns
The target schema in `postgresql/create_new.sql` SHALL apply a CHECK constraint on the `permid` column of each in-scope table asserting the UUID version nibble is 7, using `CHECK ((get_byte(uuid_send(permid), 6) >> 4) = 7)`. This form is valid on PostgreSQL 16; it MAY be replaced with `uuid_extract_version(permid) = 7` once the database is on PostgreSQL 18.

#### Scenario: Non-v7 permid rejected
- **WHEN** an INSERT or UPDATE sets an in-scope table's `permid` to a UUIDv4 value
- **THEN** PostgreSQL rejects the write with a check-constraint violation

#### Scenario: v7 permid accepted
- **WHEN** an INSERT sets an in-scope table's `permid` to a valid UUIDv7 value
- **THEN** the write succeeds

### Requirement: Timescales and intervals excluded from scope
The `timescales` and `intervals` permid columns SHALL NOT receive the UUIDv7 generation change nor the CHECK constraint in this change, because their migration design is not yet finalized.

#### Scenario: No CHECK on deferred tables
- **WHEN** `create_new.sql` is applied
- **THEN** neither `timescales.permid` nor `intervals.permid` has a UUIDv7 CHECK constraint
