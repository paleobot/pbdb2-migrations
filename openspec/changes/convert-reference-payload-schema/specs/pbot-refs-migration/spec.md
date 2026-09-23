## RENAMED Requirements

- FROM: `### Requirement: Map reference_type_id from publicationType`
- TO: `### Requirement: Normalize publicationType to the reference enum`

## MODIFIED Requirements

### Requirement: Normalize publicationType to the reference enum
The script SHALL write each PBot Reference's `publicationType` to the jsonb as a value of the reference source's
inline `publicationType` enum. It SHALL NOT load `dictionaries.reference_types` or write a `reference_type_id`
column, neither of which exists. The script SHALL apply the following PBot-specific aliases to the jsonb value:

| PBot `publicationType` | jsonb `publicationType` |
|---|---|
| `contributed article in edited book` | `article in edited collection` |
| `edited book of contributed articles` | `edited collection` |

If the `publicationType` is absent, or is neither an enum value nor an alias, the script SHALL write "other".

#### Scenario: Known publication type
- **WHEN** a PBot Reference has `publicationType = 'journal article'`
- **THEN** the jsonb `publicationType` is "journal article"

#### Scenario: Aliased publication type — contributed article
- **WHEN** a PBot Reference has `publicationType = 'contributed article in edited book'`
- **THEN** the jsonb `publicationType` is "article in edited collection"

#### Scenario: Aliased publication type — edited book
- **WHEN** a PBot Reference has `publicationType = 'edited book of contributed articles'`
- **THEN** the jsonb `publicationType` is "edited collection"

#### Scenario: Unknown publication type
- **WHEN** a PBot Reference has `publicationType = 'dataset'` (neither an enum value nor an alias)
- **THEN** the jsonb `publicationType` is "other" and a warning is logged

#### Scenario: Missing publication type
- **WHEN** a PBot Reference has `publicationType = null`
- **THEN** the jsonb `publicationType` is "other"

#### Scenario: No stored PBot ref holds a non-enum type
- **WHEN** the migration completes
- **THEN** no `refs` row with a `legacyIDs.pbotID` has a jsonb `publicationType` outside the enum, where the 16 + 1 aliased refs previously held the PBot string

### Requirement: Build reference JSONB from PBot fields
The script SHALL construct the `reference` JSONB column from PBot Reference fields using the following mapping:

| PBot field | JSONB field | Condition |
|---|---|---|
| `title` | `title` | Always |
| `year` | `publicationYear` | When non-null |
| `publicationType` | `publicationType` | Always, normalized (see Normalize publicationType to the reference enum) |
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

After mapping, the script SHALL keep only the shared fields and the fields the normalized type allows, as
defined by `PUBLICATION_TYPES` in `payloadSchemas/reference.schema.js`; it SHALL NOT keep its own copy of the
lists. Each field removed SHALL be logged with the reference's `pbotID`, the field name and the value. A type
declared unrestricted (`other`) keeps every mapped field.

PBot refs are held to the create-time field rule and PBDB refs are not, because PBot's extras are entry
noise from a UI that never enforced types (`publisher: "PBot"`, `"self"`, `"TBD"` on unpublished workbench
entries), while PBDB's are bibliographic history.

#### Scenario: Journal article with full fields
- **WHEN** a PBot Reference has `publicationType = 'journal article'`, `title = 'Test'`, `year = '2023'`, `journal = 'Nature'`, `publicationVolume = '123'`, `publicationNumber = '4'`, `doi = '10.1234/test'`, and two authoredBy persons
- **THEN** the JSONB contains `{ publicationType: 'journal article', title: 'Test', publicationYear: '2023', journalTitle: 'Nature', journalVolume: '123', journalNumber: '4', doi: '10.1234/test', language: 'unknown', authors: [{familyName, givenName}, ...], legacyIDs: { pbotID: '...' } }`

#### Scenario: Notes mapped to comments
- **WHEN** a PBot Reference has `notes = 'Needs verification'`
- **THEN** the JSONB contains `comments: "Needs verification"`

#### Scenario: Description mapped to description
- **WHEN** a PBot Reference of type `unpublished` has `description = 'Unpublished field notes from 2019 expedition'`
- **THEN** the JSONB contains `description: "Unpublished field notes from 2019 expedition"`

#### Scenario: Both notes and description present
- **WHEN** a PBot Reference of type `unpublished` has `notes = 'Review pending'` and `description = 'Lab dataset'`
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

#### Scenario: Placeholder publisher dropped from an unpublished ref
- **WHEN** a PBot Reference of type `unpublished` has `publisher = 'PBot'`
- **THEN** the JSONB has no `publisher`, and the log names the `pbotID`, `publisher` and `"PBot"`

#### Scenario: Catch-all keeps every field
- **WHEN** a PBot Reference of type `other` has `publisher = 'Geological Society of America'`
- **THEN** the JSONB keeps `publisher`

#### Scenario: Known drop count
- **WHEN** the migration runs against the current PBot data
- **THEN** it drops 18 fields from 15 references, and a run dropping more is a regression

### Requirement: Idempotent upsert on legacyIDs.pbotID
The script SHALL make re-runs idempotent by keying on the reference's stable `legacyIDs.pbotID` rather than on `permid`. If a `refs` row already exists whose `reference->'legacyIDs'->>'pbotID'` matches the incoming PBot reference, the script SHALL update the `authorizer_person_id`, `enterer_person_id`, `reference`, and `removed` columns while preserving the existing `id` and `permid`. A new row (with a newly generated permid) SHALL be inserted only when no such existing row is found.

#### Scenario: First run
- **WHEN** no `refs` row has `reference->'legacyIDs'->>'pbotID'` equal to the incoming pbotID
- **THEN** a new row is inserted with a freshly generated UUIDv7 permid

#### Scenario: Re-run preserves permid and id
- **WHEN** a `refs` row already exists with `reference->'legacyIDs'->>'pbotID'` equal to the incoming pbotID
- **THEN** that row is updated in place and its existing `permid` and `id` are preserved (no duplicate row, no new permid)

#### Scenario: Target table name
- **WHEN** the script executes INSERT/UPDATE statements
- **THEN** the target table is `refs` (not `"references"`)

### Requirement: Verification and logging
The script SHALL log: start time, number of references fetched, number skipped (pbdbid), number of references upserted, number of references skipped due to missing enterer, number of fields dropped and of references they were dropped from, and end time with elapsed duration. The script SHALL verify the final count of PBot-sourced references in PG matches the expected count.

#### Scenario: Successful run logging
- **WHEN** the migration completes successfully
- **THEN** the log includes fetch count, skip count, upsert count, dropped-field count, verification result, and elapsed time

#### Scenario: Count mismatch
- **WHEN** the number of PBot references upserted does not match the expected count
- **THEN** a warning is logged with both counts

## ADDED Requirements

### Requirement: Validate the built jsonb against the `db` variant
The script SHALL build its validator once at startup by deriving the `db` variant of `referenceSource`,
resolving its enums from `dictionaries`, and compiling it with `createAjv()`, before any PBot Reference is
fetched. It SHALL validate every built `reference` object, after aliasing and field filtering, before any
database write. A validation failure SHALL log the offending `pbotID`, the errors and the payload, and SHALL
abort the migration.

#### Scenario: Schema resolved before fetching
- **WHEN** the script starts
- **THEN** it resolves and compiles the reference `db` variant before issuing the GraphQL request

#### Scenario: Validation failure aborts the run
- **WHEN** a built payload fails `db`-variant validation
- **THEN** the offending `pbotID`, errors, and payload are logged and the migration aborts before writing it
