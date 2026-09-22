# pbot-person-migration Specification

## Purpose
Migrate PBot GraphQL Person nodes into the new PostgreSQL persons table.

## Requirements

### Requirement: Fetch Person nodes from PBot GraphQL API
The script SHALL fetch all Person nodes from `https://pbot.paleobiodb.org/graphql` using a single POST request. The query SHALL retrieve `pbotID`, `given`, `surname`, `email`, `orcid`, and `registered` fields.

#### Scenario: Successful fetch
- **WHEN** the script sends the GraphQL query to pbot.paleobiodb.org
- **THEN** all Person nodes are returned with their full field set

#### Scenario: API unreachable
- **WHEN** the GraphQL endpoint is unreachable or returns an error
- **THEN** the script logs the error and exits with a non-zero exit code

### Requirement: Filter persons by email
The script SHALL skip any Person node that has a null or empty `email` field. Only persons with a non-null, non-empty email address SHALL be processed.

#### Scenario: Person with email
- **WHEN** a Person has `email = 'ecurrano@uwyo.edu'`
- **THEN** the person is processed for migration

#### Scenario: Person without email
- **WHEN** a Person has `email = null` or `email = ''`
- **THEN** the person is skipped

#### Scenario: Filter count logged
- **WHEN** persons are filtered out due to missing email
- **THEN** the script logs the total number of persons fetched, the number skipped, and the number to be processed

### Requirement: Match cascade — ORCID first, email second, name third
The script SHALL attempt to match each PBot Person to an existing PostgreSQL `persons` record using a three-step cascade. All queries target the `person` JSONB column instead of flat columns:

1. **ORCID match**: If the PBot Person has a non-null, non-empty `orcid`, normalize it (strip `https://orcid.org/` prefix) and query `WHERE person->>'orcid' = $1`.
2. **Email match**: If ORCID match fails or PBot Person has no ORCID, query `WHERE lower(person->>'email') = lower($1)`.
3. **Name match**: If email match fails, query `WHERE lower(person->>'givenName') = lower($1) AND lower(person->>'familyName') = lower($2)`.

At each step, if exactly one row is returned, the match is accepted. If ORCID or email returns multiple rows, the first row SHALL be used. If name match returns multiple rows, the person SHALL be skipped with a warning.

#### Scenario: ORCID match via JSONB path
- **WHEN** a PBot Person has `orcid = 'https://orcid.org/0000-0002-5242-8573'` and a PG person has `person->>'orcid' = '0000-0002-5242-8573'`
- **THEN** the PG person is matched

#### Scenario: Email match via JSONB path
- **WHEN** a PBot Person has `email = 'ecurrano@uwyo.edu'` and a PG person has `person->>'email' = 'ecurrano@uwyo.edu'`
- **THEN** the PG person is matched via email (case-insensitive)

#### Scenario: Name match via JSONB path
- **WHEN** a PBot Person has `given = 'Ellen'`, `surname = 'Currano'` and a PG person has `person->>'givenName' = 'Ellen'`, `person->>'familyName' = 'Currano'`
- **THEN** the PG person is matched via name (case-insensitive)

### Requirement: Backfill ORCID on matched persons
When a PBot Person matches an existing PG person and the PBot Person has a non-null, non-empty `orcid`, the script SHALL set the PG person's JSONB `orcid` property if the current value is NULL or missing. The ORCID SHALL be normalized by stripping the URL prefix.

The backfill SHALL be applied in JavaScript to the `person` object read from the row, not by a `jsonb_set`
statement. See the validated-write requirement: all three backfills are applied to one object, validated
once, and written once.

#### Scenario: ORCID backfill
- **WHEN** PG person id=1053 has no `orcid` in the `person` JSONB and PBot Person has `orcid = 'https://orcid.org/0000-0002-5242-8573'`
- **THEN** PG person id=1053's `person` object is written with `orcid: '0000-0002-5242-8573'`

#### Scenario: PG person already has ORCID in JSONB
- **WHEN** PG person already has `person->>'orcid' = '0000-0002-5242-8573'`
- **THEN** no change is made to `orcid`

### Requirement: Backfill email on matched persons
When a PBot Person matches an existing PG person (via ORCID or name) and the PBot Person has a non-null, non-empty `email`, the script SHALL set the PG person's JSONB `email` property if the current value is NULL or missing.

The backfill SHALL be applied in JavaScript to the `person` object read from the row, not by a `jsonb_set`
statement.

#### Scenario: Email backfill
- **WHEN** PG person id=42 has no `email` in the `person` JSONB and PBot Person has `email = 'jsmith@example.com'`
- **THEN** PG person id=42's `person` object is written with `email: 'jsmith@example.com'`

#### Scenario: PG person already has email in JSONB
- **WHEN** PG person already has `person->>'email' = 'existing@example.com'`
- **THEN** no change is made to `email`

### Requirement: Insert new person records for unmatched PBot persons
The script SHALL insert a new row into PostgreSQL `persons` for each PBot Person that does not match any existing record. The new person SHALL have:
- `permid` = a freshly minted UUIDv7 from `src/lib/uuidv7.js`
- `role_id` = 6 (Person)
- `authorizer_person_id` = 1106 (Douglas Meredith)
- `active` = true
- `password` = NULL
- `total_hours` = NULL
- `person` JSONB built as:
  - `givenName` from PBot `given`
  - `familyName` from PBot `surname`
  - `email` from PBot `email`
  - `orcid` from PBot `orcid` (normalized), omitted if empty
  - `gender` = `'Anonymous'`
  - `countryCode` omitted (not available from PBot)
  - `institution` omitted (not available from PBot)
  - `middle` omitted (not available from PBot)
  - `legacyIDs: { pbotID: <PBot pbotID> }`

The `id` SHALL be auto-generated by the PostgreSQL identity sequence.

The permid SHALL NOT be derived from the PBot `pbotID`. `pbotID` is a UUID and is therefore tempting to
reuse directly, but `permid-uuidv7` already forbids adopting an externally-sourced identifier as a permid,
and `pbotID` continues to be preserved in `legacyIDs` where cross-entity lookups expect it.

#### Scenario: New person inserted with JSONB
- **WHEN** PBot Person `given = 'Tammo'`, `surname = 'Reichgelt'`, `email = 'treichgelt@example.com'`, `orcid = 'https://orcid.org/0000-0001-8652-5489'`, `pbotID = 'abc-123'` has no PG match
- **THEN** a new person is inserted with a minted UUIDv7 `permid`, `role_id = 6`, `authorizer_person_id = 1106`, `active = true`, and `person` JSONB containing `{ givenName: 'Tammo', familyName: 'Reichgelt', email: 'treichgelt@example.com', orcid: '0000-0001-8652-5489', gender: 'Anonymous', legacyIDs: { pbotID: 'abc-123' } }`

#### Scenario: New person inserted without ORCID
- **WHEN** PBot Person has `orcid = ''`
- **THEN** the `orcid` property is omitted from the JSONB

#### Scenario: Permid is not the pbotID
- **WHEN** a PBot Person with `pbotID = 'ec4353ee-467a-43cc-8383-524bd63987a7'` is inserted as a new person
- **THEN** the row's `permid` is a minted UUIDv7 different from that `pbotID`, and `person->legacyIDs->>'pbotID'` still equals `'ec4353ee-467a-43cc-8383-524bd63987a7'`

### Requirement: Gender handling
The script SHALL set `gender` as a string property in the `person` JSONB instead of looking up `gender_id` from `dictionaries.genders`. New PBot persons SHALL have `gender: 'Anonymous'`. The `dictionaries.genders` lookup is no longer required.

#### Scenario: New person gender
- **WHEN** a new PBot person is inserted
- **THEN** the JSONB contains `gender: 'Anonymous'`

### Requirement: Legacy ID storage
The script SHALL store the PBot `pbotID` in the `person` JSONB under `legacyIDs.pbotID` for all newly inserted persons.

#### Scenario: Legacy ID for new person
- **WHEN** a PBot Person with `pbotID = 'ec4353ee-467a-43cc-8383-524bd63987a7'` is inserted as a new person
- **THEN** the JSONB contains `legacyIDs: { pbotID: 'ec4353ee-467a-43cc-8383-524bd63987a7' }`

### Requirement: Backfill pbotID on matched persons
When a PBot Person matches an existing PG person, the script SHALL add `legacyIDs.pbotID` to the matched
person's JSONB. If the person JSONB does not yet have a `legacyIDs` object, the script SHALL create it.
Existing `legacyIDs` properties (e.g., `oldpbdbID`) SHALL be preserved.

The backfill SHALL be applied in JavaScript to the `person` object read from the row, not by a `jsonb_set`
or `person || jsonb_build_object(...)` statement.

#### Scenario: Matched person gets pbotID backfill
- **WHEN** PG person id=1053 matches a PBot Person with `pbotID = 'abc-123'` and the PG person's JSONB has `legacyIDs: { oldpbdbID: '1053' }`
- **THEN** the written object has `legacyIDs: { oldpbdbID: '1053', pbotID: 'abc-123' }`

#### Scenario: Matched person has no existing legacyIDs
- **WHEN** PG person matches and the JSONB has no `legacyIDs` property
- **THEN** the written object has `legacyIDs: { pbotID: 'abc-123' }`

### Requirement: Every written person object is validated
The script SHALL compile the `db` variant of `personSource` — resolved from `dictionaries` by `resolveEnums`
— once, before any PBot data is fetched, and SHALL validate every `person` object against it before writing,
on both the insert branch and the matched branch.

For a matched person the script SHALL read the stored `person` object, apply the ORCID, email and
`legacyIDs.pbotID` backfills to it in memory, validate the result, and write the whole object in a single
`UPDATE`. It SHALL NOT write a matched person with more than one statement, and SHALL make no write at all
when no backfill applies.

These three backfills are not the project's only unvalidated writes to a payload jsonb — the refs and
pbot-schemas migrations write theirs unvalidated too, each awaiting its own conversion — but they are the only
ones that mutate a payload already stored, by `jsonb_set` against a column the database does not constrain.
A validator placed at the insert site alone would never see them, and a malformed result would be found, if
at all, by the audit long afterwards.

#### Scenario: Matched person written once
- **WHEN** a matched person needs both an ORCID and a `legacyIDs.pbotID` backfill
- **THEN** the script issues one `UPDATE` carrying the whole validated `person` object, not one statement per property

#### Scenario: Nothing to backfill
- **WHEN** a matched person already has every value the PBot Person could supply
- **THEN** no `UPDATE` is issued for that person

#### Scenario: Inserted person validates
- **WHEN** an unmatched PBot Person is inserted
- **THEN** its `person` object validated against the `db` variant before the INSERT

#### Scenario: Invalid result is not written
- **WHEN** applying a backfill would produce an object that fails the `db` variant
- **THEN** the script reports the PG `id` and the ajv errors and does not write that row

#### Scenario: Resolution precedes the fetch
- **WHEN** a dictionary the person source reads is empty
- **THEN** the script exits non-zero before issuing the PBot GraphQL request
### Requirement: ORCID normalization
All ORCID values from PBot SHALL be normalized by stripping the `https://orcid.org/` or `http://orcid.org/` URL prefix if present. A null or empty ORCID after trimming SHALL be treated as NULL.

#### Scenario: Full URL ORCID
- **WHEN** PBot Person has `orcid = 'https://orcid.org/0000-0002-5242-8573'`
- **THEN** the normalized value is `'0000-0002-5242-8573'`

#### Scenario: Bare ORCID
- **WHEN** PBot Person has `orcid = '0000-0002-5242-8573'`
- **THEN** the normalized value is `'0000-0002-5242-8573'` (unchanged)

#### Scenario: Empty ORCID
- **WHEN** PBot Person has `orcid = ''` or `orcid = '   '`
- **THEN** the normalized value is NULL

### Requirement: Persons identity sequence reset
The script SHALL reset the `persons` identity sequence to `MAX(id)` after inserting any new person records.

#### Scenario: Sequence reset after inserts
- **WHEN** new person records have been inserted
- **THEN** the script executes `SELECT setval(pg_get_serial_sequence('persons', 'id'), (SELECT MAX(id) FROM persons))`

#### Scenario: No new inserts — no sequence reset
- **WHEN** all PBot persons matched existing PG records and no inserts occurred
- **THEN** the identity sequence is not modified

### Requirement: PG-only connection
The script SHALL connect only to PostgreSQL (no MariaDB dependency). It SHALL use the same PG connection configuration as `migrate-pbot-refs.js` (environment variables: `PG_HOST`, `PG_USER`, `PG_PASSWORD`, `PG_DATABASE`, optional `PG_PORT`).

#### Scenario: Required environment variables
- **WHEN** any of `PG_HOST`, `PG_USER`, `PG_PASSWORD`, `PG_DATABASE` is missing
- **THEN** the script logs which variables are missing and exits with a non-zero exit code

### Requirement: Verification and logging
The script SHALL log: start time, number of persons fetched from PBot, number filtered (no email), number processed, number matched (by ORCID/email/name), number of ambiguous name matches skipped, number inserted, number of ORCIDs backfilled, number of emails backfilled, and end time with elapsed duration.

#### Scenario: Successful run logging
- **WHEN** the migration completes successfully
- **THEN** the log includes all counts and a completion summary with elapsed time

#### Scenario: Match method breakdown
- **WHEN** persons are matched by different methods
- **THEN** the log includes separate counts for ORCID matches, email matches, and name matches

### Requirement: Idempotent operation
The script SHALL be safe to re-run. Matching is based on ORCID, email, and name lookups against current PG state. Backfill updates only write when the target field is NULL or empty. New inserts only occur when no match is found; if the same PBot person was inserted on a prior run, it will match on a subsequent run (via email or ORCID) rather than creating a duplicate.

#### Scenario: Re-run after successful migration
- **WHEN** the script runs a second time with no changes to PBot data
- **THEN** all PBot persons match existing PG records, no new inserts occur, and backfill updates are no-ops

#### Scenario: Re-run after new PBot persons added
- **WHEN** the script runs a second time and PBot has new Person nodes
- **THEN** only the new persons are inserted; previously migrated persons are matched and not duplicated
### Requirement: Matched persons keep their existing permid
When a PBot Person matches an existing PG person via the ORCID, email, or name cascade, the script SHALL NOT
mint, write, or overwrite that person's `permid`. The matched row keeps the permid it was given by
`src/persons-migration/migrate-persons.js`.

This follows from what a match means. The cascade's purpose is to recognise that a PBot Person and a PG
person are the same human; minting a second permid for them would contradict the match the script just made.
The script's existing backfills — `orcid`, `email`, and `legacyIDs.pbotID` — add source-specific identifiers
alongside the permid; the permid is the canonical identifier they hang from, so it is the one value a
matched row never receives from this script.

#### Scenario: Matched person's permid is untouched
- **WHEN** a PBot Person matches PG person id=1053 and the script backfills `orcid`, `email`, or `legacyIDs.pbotID`
- **THEN** person id=1053's `permid` is unchanged, and the backfill statements target only the `person` JSONB

#### Scenario: One human, one permid, several legacy IDs
- **WHEN** a person migrated from classic PBDB is subsequently matched to a PBot Person
- **THEN** the row holds one `permid`, and `legacyIDs` holds both `oldpbdbID` and `pbotID`

#### Scenario: Re-run mints no additional permids
- **WHEN** the script runs a second time with no changes to PBot data, so every PBot Person matches an existing PG record
- **THEN** no new `persons` row is inserted and no `permid` is minted or modified

#### Scenario: Permid is not a merge key
- **WHEN** two `persons` rows legitimately describe the same human, as persons 414 and 911 do
- **THEN** they hold two distinct permids, and the script does not merge, alias, or reconcile them
