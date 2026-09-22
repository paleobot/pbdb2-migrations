## MODIFIED Requirements

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

## ADDED Requirements

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
