## ADDED Requirements

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
The script SHALL attempt to match each PBot Person to an existing PostgreSQL `persons` record using a three-step cascade:

1. **ORCID match**: If the PBot Person has a non-null, non-empty `orcid`, normalize it (strip `https://orcid.org/` prefix) and query `WHERE orcid = $1`.
2. **Email match**: If ORCID match fails or PBot Person has no ORCID, query `WHERE lower(email) = lower($1)`.
3. **Name match**: If email match fails, query `WHERE lower(given_name) = lower($1) AND lower(family_name) = lower($2)`.

At each step, if exactly one row is returned, the match is accepted. If ORCID or email returns multiple rows, the first row SHALL be used (these fields should be unique in practice). If name match returns multiple rows, the person SHALL be skipped with a warning.

#### Scenario: ORCID match found
- **WHEN** a PBot Person has `orcid = 'https://orcid.org/0000-0002-5242-8573'` and a PG person has `orcid = '0000-0002-5242-8573'`
- **THEN** the PG person is matched and no further cascade steps are attempted

#### Scenario: ORCID not available, email match found
- **WHEN** a PBot Person has `orcid = null` and `email = 'ecurrano@uwyo.edu'` and a PG person has `email = 'ecurrano@uwyo.edu'`
- **THEN** the PG person is matched via email

#### Scenario: Email match is case-insensitive
- **WHEN** a PBot Person has `email = 'ECurrano@UWyo.EDU'` and a PG person has `email = 'ecurrano@uwyo.edu'`
- **THEN** the PG person is matched

#### Scenario: ORCID and email fail, name match found
- **WHEN** a PBot Person has no ORCID, no email match in PG, and `given = 'Ellen'`, `surname = 'Currano'`, and exactly one PG person has `given_name = 'Ellen'` and `family_name = 'Currano'`
- **THEN** the PG person is matched via name

#### Scenario: Ambiguous name match — warn and skip
- **WHEN** a PBot Person has `given = 'John'`, `surname = 'Smith'` and two PG persons match on name
- **THEN** the person is skipped, a warning is logged with the PBot `pbotID` and the matching PG `id` values, and no insert or update occurs

#### Scenario: No match at any level
- **WHEN** a PBot Person does not match on ORCID, email, or name
- **THEN** the person proceeds to insertion as a new record

### Requirement: Backfill ORCID on matched persons
When a PBot Person matches an existing PG person and the PBot Person has a non-null, non-empty `orcid`, the script SHALL update the PG person's `orcid` field if the current PG value is NULL or empty. The ORCID SHALL be normalized by stripping the `https://orcid.org/` URL prefix if present.

#### Scenario: PG person has no ORCID, PBot has one
- **WHEN** PG person id=1053 has `orcid = NULL` and PBot Person has `orcid = 'https://orcid.org/0000-0002-5242-8573'`
- **THEN** PG person id=1053 is updated with `orcid = '0000-0002-5242-8573'`

#### Scenario: PG person already has ORCID
- **WHEN** PG person already has `orcid = '0000-0002-5242-8573'`
- **THEN** the existing ORCID is preserved, no update occurs

#### Scenario: PBot Person has no ORCID
- **WHEN** PBot Person has `orcid = null` or `orcid = ''`
- **THEN** no ORCID update is performed

### Requirement: Backfill email on matched persons
When a PBot Person matches an existing PG person (via ORCID or name) and the PBot Person has a non-null, non-empty `email`, the script SHALL update the PG person's `email` field if the current PG value is NULL or empty.

#### Scenario: PG person has no email, PBot has one
- **WHEN** PG person id=42 has `email = NULL` and PBot Person has `email = 'jsmith@example.com'`
- **THEN** PG person id=42 is updated with `email = 'jsmith@example.com'`

#### Scenario: PG person already has email
- **WHEN** PG person already has `email = 'existing@example.com'`
- **THEN** the existing email is preserved, no update occurs

#### Scenario: Matched via email — no backfill needed
- **WHEN** a PBot Person matches via email
- **THEN** the PG person already has that email, so no email backfill occurs

### Requirement: Insert new person records for unmatched PBot persons
The script SHALL insert a new row into PostgreSQL `persons` for each PBot Person that does not match any existing record. The new person SHALL have:
- `given_name` from PBot `given`
- `family_name` from PBot `surname`
- `middle` = NULL
- `email` from PBot `email`
- `password` = NULL
- `orcid` from PBot `orcid` (normalized: URL prefix stripped), or NULL if empty
- `role_id` = 6 (Person)
- `authorizer_person_id` = 1106 (Douglas Meredith)
- `gender_id` = the id for 'Anonymous' from `dictionaries.genders`
- `country_code` = NULL
- `institution` = NULL
- `active` = true
- `total_hours` = NULL

The `id` SHALL be auto-generated by the PostgreSQL identity sequence.

#### Scenario: New person inserted with ORCID
- **WHEN** PBot Person `given = 'Tammo'`, `surname = 'Reichgelt'`, `email = 'treichgelt@example.com'`, `orcid = 'https://orcid.org/0000-0001-8652-5489'` has no PG match
- **THEN** a new person is inserted with `given_name = 'Tammo'`, `family_name = 'Reichgelt'`, `email = 'treichgelt@example.com'`, `orcid = '0000-0001-8652-5489'`, `role_id = 6`, `gender_id` for Anonymous, `country_code = NULL`, `authorizer_person_id = 1106`

#### Scenario: New person inserted without ORCID
- **WHEN** PBot Person has `orcid = ''`
- **THEN** the new person is inserted with `orcid = NULL`

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
