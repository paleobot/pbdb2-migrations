### Requirement: Fetch all References from PBot GraphQL API
The script SHALL fetch all Reference nodes from `https://pbot.paleobiodb.org/graphql` using a single POST request. The query SHALL retrieve all scalar Reference fields (`pbotID`, `title`, `year`, `publicationType`, `firstPage`, `lastPage`, `journal`, `bookTitle`, `publicationVolume`, `publicationNumber`, `publisher`, `description`, `bookType`, `editors`, `notes`, `doi`, `pbdbid`) plus nested `enteredBy` (with `type`, `timestamp`, and `Person` fields) and `authoredBy` (with `order` and `Person` fields).

#### Scenario: Successful fetch
- **WHEN** the script sends the GraphQL query to pbot.paleobiodb.org
- **THEN** all Reference nodes are returned with their full field set, enteredBy relationships, and authoredBy relationships

#### Scenario: API unreachable
- **WHEN** the GraphQL endpoint is unreachable or returns an error
- **THEN** the script logs the error and exits with a non-zero exit code

### Requirement: Skip References with pbdbid
The script SHALL skip any Reference node that has a non-null, non-empty `pbdbid` field. These references already exist in PostgreSQL from the MariaDB migration.

#### Scenario: Reference has pbdbid
- **WHEN** a Reference has `pbdbid = '43141'`
- **THEN** the reference is skipped and not inserted into PostgreSQL

#### Scenario: Reference has no pbdbid
- **WHEN** a Reference has `pbdbid = null` or `pbdbid = ''`
- **THEN** the reference is processed for migration

#### Scenario: Skip count logged
- **WHEN** references are skipped due to pbdbid
- **THEN** the script logs the total number of skipped references

### Requirement: Resolve enterer person from ENTERED_BY relationship
The script SHALL select the `ENTERED_BY` relationship with `type = 'CREATE'` to identify the enterer Person for each Reference. If no relationship has `type = 'CREATE'`, the script SHALL fall back to the relationship with the earliest `timestamp`.

The script SHALL then look up the enterer's PG `persons.id` by querying the `persons` table using the enterer Person's PBot `pbotID` via `person->'legacyIDs'->>'pbotID' = $1`. If no matching person is found, the script SHALL log a warning and skip the reference.

#### Scenario: Single CREATE entry
- **WHEN** a Reference has one ENTERED_BY with `type = 'CREATE'`
- **THEN** that entry's Person is used as the enterer

#### Scenario: No CREATE entry — fallback to earliest
- **WHEN** a Reference has ENTERED_BY entries with types `[null, 'EDIT']` and timestamps `['2022-08-25T21:53:10.904Z', '2023-07-20T15:28:04.733Z']`
- **THEN** the entry with timestamp `2022-08-25T21:53:10.904Z` is selected and a warning is logged

#### Scenario: Enterer person found via legacyIDs.pbotID
- **WHEN** the resolved enterer has `pbotID = 'abc-123'` and a PG person has `person->'legacyIDs'->>'pbotID' = 'abc-123'`
- **THEN** the PG person's `id` is used as `enterer_person_id`

#### Scenario: Enterer person not found via legacyIDs.pbotID
- **WHEN** the resolved enterer has `pbotID = 'xyz-999'` and no PG person has a matching `legacyIDs.pbotID`
- **THEN** the reference is skipped and a warning is logged with the PBot reference `pbotID` and the unmatched enterer `pbotID`

### Requirement: Generate UUIDv7 permid
The script SHALL generate a fresh UUIDv7 (via the shared UUIDv7 helper) as the `permid` for each PBot reference. The script SHALL NOT use the reference's `pbotID` as the permid.

#### Scenario: permid assignment
- **WHEN** a PBot Reference with `pbotID = 'ec4353ee-467a-43cc-8383-524bd63987a7'` is inserted
- **THEN** the resulting `refs` row has a generated UUIDv7 `permid` (not `ec4353ee-...`), and the JSONB still contains `legacyIDs.pbotID = 'ec4353ee-467a-43cc-8383-524bd63987a7'`

### Requirement: Set authorizer_person_id to Douglas Meredith
The script SHALL set `authorizer_person_id = 1106` (Douglas Meredith) for all PBot-sourced reference records.

#### Scenario: Authorizer assignment
- **WHEN** any PBot Reference is inserted into PostgreSQL
- **THEN** the `authorizer_person_id` column is set to 1106

### Requirement: Map reference_type_id from publicationType
The script SHALL load `dictionaries.reference_types` at startup and map each PBot Reference's `publicationType` string to the corresponding `reference_type_id`. The script SHALL also register the following PBot-specific aliases:

| PBot `publicationType` | Maps to PG `reference_type` |
|---|---|
| `contributed article in edited book` | `article in edited collection` |
| `edited book of contributed articles` | `edited collection` |

If the `publicationType` is absent or does not match any dictionary entry or alias, the script SHALL default to the id for "other".

#### Scenario: Known publication type
- **WHEN** a PBot Reference has `publicationType = 'journal article'`
- **THEN** `reference_type_id` is set to the id for "journal article" in `dictionaries.reference_types`

#### Scenario: Aliased publication type — contributed article
- **WHEN** a PBot Reference has `publicationType = 'contributed article in edited book'`
- **THEN** `reference_type_id` is set to the id for "article in edited collection" in `dictionaries.reference_types`

#### Scenario: Aliased publication type — edited book
- **WHEN** a PBot Reference has `publicationType = 'edited book of contributed articles'`
- **THEN** `reference_type_id` is set to the id for "edited collection" in `dictionaries.reference_types`

#### Scenario: Unknown publication type
- **WHEN** a PBot Reference has `publicationType = 'dataset'` (not in dictionary or aliases)
- **THEN** `reference_type_id` defaults to the id for "other" and a warning is logged

#### Scenario: Missing publication type
- **WHEN** a PBot Reference has `publicationType = null`
- **THEN** `reference_type_id` defaults to the id for "other"

### Requirement: Build reference JSONB from PBot fields
The script SHALL construct the `reference` JSONB column from PBot Reference fields using the following mapping:

| PBot field | JSONB field | Condition |
|---|---|---|
| `title` | `title` | Always |
| `year` | `publicationYear` | When non-null |
| `publicationType` | `publicationType` | Always |
| `journal` | `journalTitle` | When publicationType is "journal article" |
| `publicationVolume` | `journalVolume` | When publicationType is "journal article" |
| `publicationVolume` | `seriesVolume` | When publicationType is "serial monograph" |
| `publicationNumber` | `journalNumber` | When publicationType is "journal article" |
| `publisher` | `publisher` | When non-null |
| `bookTitle` | `bookTitle` | When non-null |
| `bookType` | `bookType` | When non-null |
| `editors` | `editors` | When non-null |
| `doi` | `doi` | When non-null |
| `firstPage` / `lastPage` | `pages: {first, last}` | When firstPage is non-null and numeric |
| `notes` | `comments` | When non-null |
| `description` | `description` | When non-null |
| `pbotID` | `legacyIDs.pbotID` | Always (nested under legacyIDs object) |
| (none) | `language` | Always "unknown" |

The `authors` array SHALL be built from the `authoredBy` relationship, sorted by the `order` property, with each entry containing `{ familyName: Person.surname, givenName: Person.given }`.

#### Scenario: Journal article with full fields
- **WHEN** a PBot Reference has `publicationType = 'journal article'`, `title = 'Test'`, `year = '2023'`, `journal = 'Nature'`, `publicationVolume = '123'`, `publicationNumber = '4'`, `doi = '10.1234/test'`, and two authoredBy persons
- **THEN** the JSONB contains `{ publicationType: 'journal article', title: 'Test', publicationYear: '2023', journalTitle: 'Nature', journalVolume: '123', journalNumber: '4', doi: '10.1234/test', language: 'unknown', authors: [{familyName, givenName}, ...], legacyIDs: { pbotID: '...' } }`

#### Scenario: Notes mapped to comments
- **WHEN** a PBot Reference has `notes = 'Needs verification'`
- **THEN** the JSONB contains `comments: "Needs verification"`

#### Scenario: Description mapped to description
- **WHEN** a PBot Reference has `description = 'Unpublished field notes from 2019 expedition'`
- **THEN** the JSONB contains `description: "Unpublished field notes from 2019 expedition"`

#### Scenario: Both notes and description present
- **WHEN** a PBot Reference has `notes = 'Review pending'` and `description = 'Lab dataset'`
- **THEN** the JSONB contains both `comments: "Review pending"` and `description: "Lab dataset"`

#### Scenario: pbotID nested under legacyIDs
- **WHEN** a PBot Reference has `pbotID = 'ec4353ee-467a-43cc-8383-524bd63987a7'`
- **THEN** the JSONB contains `legacyIDs: { pbotID: 'ec4353ee-467a-43cc-8383-524bd63987a7' }`

#### Scenario: Pages parsing
- **WHEN** a PBot Reference has `firstPage = '42'` and `lastPage = '58'`
- **THEN** the JSONB contains `pages: { first: 42, last: 58 }`

#### Scenario: Non-numeric pages
- **WHEN** a PBot Reference has `firstPage = 'e12345'`
- **THEN** the `pages` field is omitted from the JSONB and a warning is logged

#### Scenario: Authors ordered correctly
- **WHEN** a PBot Reference has authoredBy entries with `order = '2'` (Scott Wing) and `order = '1'` (Nathan Jud)
- **THEN** the JSONB `authors` array is `[{familyName: 'Jud', givenName: 'Nathan'}, {familyName: 'Wing', givenName: 'Scott'}]`

### Requirement: Auto-generate reference IDs
The script SHALL NOT set explicit `id` values for PBot references. IDs SHALL be auto-generated by the PostgreSQL identity sequence. After all insertions, the script SHALL reset the identity sequence to `MAX(id)`.

#### Scenario: ID auto-generation
- **WHEN** PBot references are inserted
- **THEN** each receives an auto-generated integer ID from the `references` identity sequence

#### Scenario: Sequence reset
- **WHEN** all PBot references have been inserted
- **THEN** the script executes `SELECT setval(pg_get_serial_sequence('refs', 'id'), (SELECT MAX(id) FROM refs))`

### Requirement: Idempotent upsert on legacyIDs.pbotID
The script SHALL make re-runs idempotent by keying on the reference's stable `legacyIDs.pbotID` rather than on `permid`. If a `refs` row already exists whose `reference->'legacyIDs'->>'pbotID'` matches the incoming PBot reference, the script SHALL update the `reference_type_id`, `authorizer_person_id`, `enterer_person_id`, `reference`, and `removed` columns while preserving the existing `id` and `permid`. A new row (with a newly generated permid) SHALL be inserted only when no such existing row is found.

#### Scenario: First run
- **WHEN** no `refs` row has `reference->'legacyIDs'->>'pbotID'` equal to the incoming pbotID
- **THEN** a new row is inserted with a freshly generated UUIDv7 permid

#### Scenario: Re-run preserves permid and id
- **WHEN** a `refs` row already exists with `reference->'legacyIDs'->>'pbotID'` equal to the incoming pbotID
- **THEN** that row is updated in place and its existing `permid` and `id` are preserved (no duplicate row, no new permid)

#### Scenario: Target table name
- **WHEN** the script executes INSERT/UPDATE statements
- **THEN** the target table is `refs` (not `"references"`)

### Requirement: Set preceded_by_id, succeeded_by_id, and removed defaults
The script SHALL set `preceded_by_id = NULL`, `succeeded_by_id = NULL`, and `removed = false` for all PBot-sourced references.

#### Scenario: Default succession fields
- **WHEN** a PBot Reference is inserted
- **THEN** `preceded_by_id = NULL`, `succeeded_by_id = NULL`, `removed = false`

### Requirement: Verification and logging
The script SHALL log: start time, number of references fetched, number skipped (pbdbid), number of references upserted, number of references skipped due to missing enterer, and end time with elapsed duration. The script SHALL verify the final count of PBot-sourced references in PG matches the expected count.

#### Scenario: Successful run logging
- **WHEN** the migration completes successfully
- **THEN** the log includes fetch count, skip count, upsert count, verification result, and elapsed time

#### Scenario: Count mismatch
- **WHEN** the number of PBot references upserted does not match the expected count
- **THEN** a warning is logged with both counts
