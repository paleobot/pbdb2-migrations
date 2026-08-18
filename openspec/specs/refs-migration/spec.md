# refs-migration Specification

## Purpose
Migrate legacy MariaDB `refs` (with `ref_authors`/`ref_editors`) into the new PostgreSQL `refs` table.

## Requirements

### Requirement: Read all source data from MariaDB
The script SHALL read all rows from MariaDB `refs` table (including the `comments` column), plus all rows from `ref_authors` and `ref_editors`. The `ref_authors` and `ref_editors` rows SHALL be pre-loaded into Maps keyed by `reference_no` for lookup during transformation.

#### Scenario: Full extraction
- **WHEN** the migration script executes the source queries
- **THEN** all 93,863 refs rows (including the `comments` column), 14,144 ref_authors rows, and 414 ref_editors rows are read from MariaDB and logged

### Requirement: Preserve legacy IDs
The script SHALL insert each ref's `reference_no` as the `id` column in PostgreSQL `references`, preserving original identifiers for FK consistency with downstream migrations.

#### Scenario: ID mapping
- **WHEN** a ref with `reference_no = 1000` is migrated
- **THEN** the resulting row in `references` has `id = 1000`

#### Scenario: Identity sequence reset
- **WHEN** all ref records have been inserted
- **THEN** the script resets the `references` identity sequence to `MAX(id) + 1`

### Requirement: Generate permid UUID
The script SHALL generate a v4 UUID using `crypto.randomUUID()` for each reference and store it as the `permid` column. On idempotent re-runs, the `permid` MUST NOT be overwritten.

#### Scenario: First insertion
- **WHEN** a reference is inserted for the first time
- **THEN** a new UUID is generated and stored as `permid`

#### Scenario: Idempotent re-run preserves permid
- **WHEN** the script is re-run and a reference with the same `id` already exists
- **THEN** the existing `permid` value is preserved (not overwritten by the upsert)

### Requirement: Publication type mapping
The script SHALL map legacy `publication_type` values to `dictionaries.reference_types` IDs and jsonb `publicationType` strings using the following mapping:

| Legacy value | Target reference_type | jsonb bookType |
|---|---|---|
| "journal article" | "journal article" | — |
| "serial monograph" | "serial monograph" | — |
| "unpublished" | "unpublished" | — |
| "book/book chapter" | "edited collection" | — |
| "book chapter" | "article in edited collection" | — |
| "book" | "standalone book" | "monograph" |
| "compendium" | "standalone book" | "compendium" |
| "Ph.D. thesis" | "standalone book" | "Ph.D. thesis" |
| "M.S. thesis" | "standalone book" | "M.S. thesis" |
| "guidebook" | "standalone book" | "guidebook" |
| "news article" | "other" | — |
| "abstract" | "other" | — |
| NULL | "other" | — |
| any other | "other" | — |

#### Scenario: Direct mapping
- **WHEN** a ref has `publication_type = 'journal article'`
- **THEN** `reference_type_id` maps to "journal article" and jsonb `publicationType` = "journal article"

#### Scenario: Standalone book with bookType
- **WHEN** a ref has `publication_type = 'Ph.D. thesis'`
- **THEN** `reference_type_id` maps to "standalone book", jsonb `publicationType` = "standalone book", and jsonb `bookType` = "Ph.D. thesis"

#### Scenario: NULL publication type
- **WHEN** a ref has `publication_type = NULL`
- **THEN** `reference_type_id` maps to "other" and jsonb `publicationType` = "other"

#### Scenario: Unmapped legacy value
- **WHEN** a ref has a `publication_type` not listed in the mapping table
- **THEN** `reference_type_id` maps to "other" and the script logs a warning with the `reference_no` and original value

### Requirement: Author assembly
The script SHALL build a jsonb `authors` array of `{familyName, givenName}` objects for each reference. If `ref_authors` entries exist for a `reference_no`, those SHALL be used (ordered by `place`). Otherwise, the script SHALL build authors from the flat fields (`author1init`/`author1last`, `author2init`/`author2last`, `otherauthors`).

#### Scenario: ref_authors entries available
- **WHEN** a reference has entries in `ref_authors`
- **THEN** the `authors` array is built from `ref_authors` ordered by `place`, each as `{familyName, givenName}`

#### Scenario: Flat fields only
- **WHEN** a reference has no `ref_authors` entries and `author1last = 'Smith'`, `author1init = 'J.'`
- **THEN** the `authors` array contains at least `[{familyName: "Smith", givenName: "J."}]`

#### Scenario: otherauthors parsing
- **WHEN** a reference has no `ref_authors` entries and `otherauthors` is non-empty
- **THEN** the script attempts to parse `otherauthors` into additional author entries with `{familyName, givenName}` and logs a warning for unparseable values

#### Scenario: No author data
- **WHEN** a reference has no `ref_authors` entries and all flat author fields are empty
- **THEN** the `authors` array is empty and the script logs a warning with the `reference_no`

### Requirement: Editor handling
The script SHALL populate the jsonb `editors` field as a string. If `ref_editors` entries exist for a `reference_no`, those SHALL be concatenated into a string. Otherwise, the `editors` varchar field from `refs` SHALL be used directly.

#### Scenario: ref_editors entries available
- **WHEN** a reference has entries in `ref_editors`
- **THEN** the jsonb `editors` field is a concatenated string of those editor names

#### Scenario: Flat editors field
- **WHEN** a reference has no `ref_editors` entries and `editors = 'Smith, J. and Jones, B.'`
- **THEN** the jsonb `editors` field is "Smith, J. and Jones, B."

### Requirement: Title mapping
The script SHALL map `reftitle` to the jsonb `title` field.

#### Scenario: Standard title
- **WHEN** a ref has `reftitle = 'On the origin of species'`
- **THEN** the jsonb `title` = "On the origin of species"

#### Scenario: NULL title
- **WHEN** a ref has `reftitle = NULL`
- **THEN** the jsonb `title` is omitted and the script logs a warning

### Requirement: Publication title routing
The script SHALL map the legacy `pubtitle` column to a type-specific jsonb field:

| Target reference_type | jsonb field |
|---|---|
| journal article | `journalTitle` |
| serial monograph | `seriesTitle` |
| article in edited collection | `bookTitle` |
| standalone book | (not mapped — title is `reftitle`) |
| edited collection | (not mapped — title is `reftitle`) |
| unpublished | (not mapped) |
| other | (not mapped) |

#### Scenario: Journal article pubtitle
- **WHEN** a ref maps to "journal article" and has `pubtitle = 'Nature'`
- **THEN** the jsonb contains `journalTitle: "Nature"`

#### Scenario: Article in edited collection pubtitle
- **WHEN** a ref maps to "article in edited collection" and has `pubtitle = 'Fossil Record'`
- **THEN** the jsonb contains `bookTitle: "Fossil Record"`

### Requirement: Volume and number mapping
The script SHALL map `pubvol` to `journalVolume` (journal articles) or `seriesVolume` (serial monographs), and `pubno` to `journalNumber` (journal articles only).

#### Scenario: Journal volume and number
- **WHEN** a ref maps to "journal article" with `pubvol = '42'` and `pubno = '3'`
- **THEN** the jsonb contains `journalVolume: "42"` and `journalNumber: "3"`

#### Scenario: Serial monograph volume
- **WHEN** a ref maps to "serial monograph" with `pubvol = '15'`
- **THEN** the jsonb contains `seriesVolume: "15"`

### Requirement: Pages mapping
The script SHALL map `firstpage` and `lastpage` to a jsonb `pages` object with integer `first` and `last` properties. If either value is non-numeric, the script SHALL skip the `pages` object and log a warning.

#### Scenario: Numeric pages
- **WHEN** a ref has `firstpage = '100'` and `lastpage = '150'`
- **THEN** the jsonb contains `pages: {first: 100, last: 150}`

#### Scenario: Only firstpage
- **WHEN** a ref has `firstpage = '100'` and `lastpage` is NULL or empty
- **THEN** the jsonb contains `pages: {first: 100, last: 100}`

#### Scenario: Non-numeric pages
- **WHEN** a ref has `firstpage = 'iv'`
- **THEN** the `pages` object is omitted and the script logs a warning with the `reference_no` and raw values

### Requirement: Language mapping
The script SHALL map the legacy `language` enum to the target enum (Chinese, English, French, German, Italian, Japanese, Portugese, Russian, Spanish, other, unknown). Legacy values not in the target enum SHALL map to "other". NULL SHALL map to "unknown".

#### Scenario: Direct match
- **WHEN** a ref has `language = 'French'`
- **THEN** the jsonb `language` = "French"

#### Scenario: Unmapped language
- **WHEN** a ref has `language = 'Dutch'`
- **THEN** the jsonb `language` = "other"

#### Scenario: NULL language
- **WHEN** a ref has `language = NULL`
- **THEN** the jsonb `language` = "unknown"

### Requirement: Additional jsonb fields
The script SHALL populate:
- `doi` from the source `doi` column (NULL if empty)
- `legacyIDs` as an object containing `oldpbdbID` from the source `reference_no` (as a string) for traceability
- `publicationYear` from the source `pubyr`
- `publisher` from the source `publisher` (for applicable publication types)
- `publicationCity` from the source `pubcity` (for applicable publication types)
- `comments` from the source `comments` column (omitted if NULL or empty)

#### Scenario: DOI present
- **WHEN** a ref has `doi = '10.1234/example'`
- **THEN** the jsonb contains `doi: "10.1234/example"`

#### Scenario: oldpbdbID nested under legacyIDs
- **WHEN** a ref with `reference_no = 5000` is migrated
- **THEN** the jsonb contains `legacyIDs: { oldpbdbID: "5000" }`

#### Scenario: Comments present
- **WHEN** a ref has `comments = 'See also ref 1234'`
- **THEN** the jsonb contains `comments: "See also ref 1234"`

#### Scenario: Comments NULL or empty
- **WHEN** a ref has `comments = NULL` or `comments = ''`
- **THEN** the `comments` field is omitted from the jsonb

### Requirement: Person ID mapping
The script SHALL map `authorizer_no` → `authorizer_person_id` and `enterer_no` → `enterer_person_id`, referencing the already-migrated `persons` table. The 0-as-NULL pattern SHALL be handled: if a value is 0, the script SHALL use the other field as fallback; if both are 0, the script SHALL log a warning and use a designated fallback person ID.

#### Scenario: Standard person mapping
- **WHEN** a ref has `authorizer_no = 10` and `enterer_no = 20`
- **THEN** `authorizer_person_id = 10` and `enterer_person_id = 20`

#### Scenario: Zero authorizer with valid enterer
- **WHEN** a ref has `authorizer_no = 0` and `enterer_no = 20`
- **THEN** `authorizer_person_id = 20` (fallback) and the script logs a warning

### Requirement: New columns with defaults
The script SHALL set:
- `preceded_by_id` = NULL
- `succeeded_by_id` = NULL
- `removed` = false

#### Scenario: Succession model defaults
- **WHEN** any ref is migrated
- **THEN** `preceded_by_id` and `succeeded_by_id` are NULL and `removed` is false

### Requirement: Batched upsert
The script SHALL insert rows in batches (e.g. 500 per batch) using multi-value INSERT into the `refs` table with `ON CONFLICT (id) DO UPDATE SET ...`. The `permid` column MUST be excluded from the UPDATE SET to preserve UUIDs on re-runs.

#### Scenario: Batch processing
- **WHEN** 93,863 rows are migrated
- **THEN** rows are inserted in batches rather than individually

#### Scenario: Idempotent re-run
- **WHEN** the script is re-run against a populated `refs` table
- **THEN** existing rows are updated (except `permid`) and no duplicates are created

#### Scenario: Target table name
- **WHEN** the script executes INSERT statements
- **THEN** the target table is `refs` (not `"references"`)

### Requirement: Row count verification
The script SHALL verify after migration that the PostgreSQL `references` row count matches the MariaDB `refs` source count, and log the result.

#### Scenario: Counts match
- **WHEN** 93,863 rows are read and 93,863 rows exist in PostgreSQL after migration
- **THEN** the script logs a success message

#### Scenario: Count mismatch
- **WHEN** counts do not match
- **THEN** the script logs a warning with both counts

### Requirement: Migration logging
The script SHALL log:
- Start and completion messages with timestamps
- Source row counts (refs, ref_authors, ref_editors)
- Number of rows upserted
- Publication type mapping summary (count per target type)
- Warnings for: NULL publication types, non-numeric pages, unparseable otherauthors, missing authors, zero person IDs
- Elapsed time

#### Scenario: Successful migration log output
- **WHEN** the migration completes without errors
- **THEN** the console output includes start time, source counts, upsert count, pub type summary, any warnings, and elapsed time
