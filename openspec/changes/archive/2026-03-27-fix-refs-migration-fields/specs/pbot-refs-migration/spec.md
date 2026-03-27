## MODIFIED Requirements

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

#### Scenario: Authors ordered correctly
- **WHEN** a PBot Reference has authoredBy entries with `order = '2'` (Scott Wing) and `order = '1'` (Nathan Jud)
- **THEN** the JSONB `authors` array is `[{familyName: 'Jud', givenName: 'Nathan'}, {familyName: 'Wing', givenName: 'Scott'}]`

### Requirement: Idempotent upsert on permid
The script SHALL use `ON CONFLICT (permid)` on the `refs` table to make re-runs idempotent. If a reference with the same `permid` already exists, the script SHALL update the `reference_type_id`, `authorizer_person_id`, `enterer_person_id`, `reference`, and `removed` columns.

#### Scenario: Target table name
- **WHEN** the script executes INSERT statements
- **THEN** the target table is `refs` (not `"references"`)
