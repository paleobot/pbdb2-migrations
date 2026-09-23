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
The script SHALL generate a UUIDv7 for each reference and store it as the `permid` column, obtaining it from
the shared UUIDv7 helper module rather than generating a UUID inline. On idempotent re-runs, the `permid`
MUST NOT be overwritten.

This requirement previously specified a v4 UUID from `crypto.randomUUID()`. That was superseded by the
`permid-uuidv7` capability, which forbids `crypto.randomUUID()` for permid generation; the superseding change
did not correct this text, leaving the two specifications in direct contradiction. The script has generated
UUIDv7 values since that change landed.

#### Scenario: First insertion
- **WHEN** a reference is inserted for the first time
- **THEN** a new UUIDv7 is generated and stored as `permid`

#### Scenario: Idempotent re-run preserves permid
- **WHEN** the script is re-run and a reference with the same `id` already exists
- **THEN** the existing `permid` value is preserved (not overwritten by the upsert)

### Requirement: Publication type mapping
The script SHALL map legacy `publication_type` values to the jsonb `publicationType` string using the following mapping. It SHALL NOT write a `reference_type_id` column, which no longer exists: the reference source's inline `publicationType` enum is the only vocabulary for publication types.

| Legacy value | jsonb publicationType | jsonb bookType |
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

The mapping SHALL be a table in the script; it SHALL NOT be read from `dictionaries`.

#### Scenario: Direct mapping
- **WHEN** a ref has `publication_type = 'journal article'`
- **THEN** jsonb `publicationType` = "journal article", and the row written has no `reference_type_id` column

#### Scenario: Standalone book with bookType
- **WHEN** a ref has `publication_type = 'Ph.D. thesis'`
- **THEN** jsonb `publicationType` = "standalone book" and jsonb `bookType` = "Ph.D. thesis"

#### Scenario: NULL publication type
- **WHEN** a ref has `publication_type = NULL`
- **THEN** jsonb `publicationType` = "other"

#### Scenario: Unmapped legacy value
- **WHEN** a ref has a `publication_type` not listed in the mapping table
- **THEN** jsonb `publicationType` = "other" and the script logs a warning with the `reference_no` and original value

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
The script SHALL map `reftitle` to the jsonb `title` field. A `reftitle` that is NULL or blank after trimming
SHALL be treated as absent.

When `reftitle` is absent and the ref maps to "standalone book" or "edited collection", the script SHALL use
the legacy `pubtitle`, trimmed, as `title` if it is non-blank. Legacy PBDB records a whole book with
`reftitle` empty and the book's title in `pubtitle`; without this fallback the title is discarded, because
`pubtitle` has no other destination for those two types. The value SHALL be taken verbatim, including the few
that begin `in ` and name a containing volume rather than the ref, and each fallback SHALL be logged with the
`reference_no`.

For every other type, an absent `reftitle` leaves `title` omitted: their `pubtitle` is routed to its own
field, or names a container the type has no field for.

#### Scenario: Standard title
- **WHEN** a ref has `reftitle = 'On the origin of species'`
- **THEN** the jsonb `title` = "On the origin of species"

#### Scenario: NULL title
- **WHEN** a ref maps to "journal article" and has `reftitle = NULL`
- **THEN** the jsonb `title` is omitted and the script logs a warning

#### Scenario: Book title recovered from pubtitle
- **WHEN** a ref maps to "standalone book", has `reftitle = ''` and `pubtitle = 'Systema Naturae'`
- **THEN** the jsonb `title` = "Systema Naturae" and the script logs the `reference_no` as a pubtitle fallback

#### Scenario: Edited collection title recovered from pubtitle
- **WHEN** a ref maps to "edited collection", has `reftitle = NULL` and `pubtitle = 'Corals of the World'`
- **THEN** the jsonb `title` = "Corals of the World"

#### Scenario: Reftitle wins when present
- **WHEN** a ref maps to "standalone book" and has both `reftitle = 'Mazon Creek Fossils'` and a non-blank `pubtitle`
- **THEN** the jsonb `title` = "Mazon Creek Fossils" and no fallback is logged

#### Scenario: Other types do not fall back
- **WHEN** a ref maps to "other", has `reftitle = ''` and `pubtitle = 'Geological Society of America Abstracts with Programs'`
- **THEN** the jsonb `title` is omitted

#### Scenario: Restored count
- **WHEN** the migration completes against the full legacy source
- **THEN** 1,468 refs have a `title` taken from `pubtitle`, and 541 of the refs it wrote have no `title`

### Requirement: Publication title routing
The script SHALL map the legacy `pubtitle` column to a type-specific jsonb field:

| Target publicationType | jsonb field |
|---|---|
| journal article | `journalTitle` |
| serial monograph | `seriesTitle` |
| article in edited collection | `bookTitle` |
| standalone book | `title`, only when `reftitle` is absent (see Title mapping); otherwise not mapped |
| edited collection | `title`, only when `reftitle` is absent (see Title mapping); otherwise not mapped |
| unpublished | (not mapped) |
| other | (not mapped) |

#### Scenario: Journal article pubtitle
- **WHEN** a ref maps to "journal article" and has `pubtitle = 'Nature'`
- **THEN** the jsonb contains `journalTitle: "Nature"`

#### Scenario: Article in edited collection pubtitle
- **WHEN** a ref maps to "article in edited collection" and has `pubtitle = 'Fossil Record'`
- **THEN** the jsonb contains `bookTitle: "Fossil Record"`

#### Scenario: Book pubtitle alongside a reftitle
- **WHEN** a ref maps to "standalone book" and has a non-blank `reftitle`
- **THEN** its `pubtitle` is not written to any jsonb field

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

A `firstpage` of `0` SHALL be written as `first: 1` and logged with the `reference_no`. Pages are numbered from
1 and the schema requires `first ≥ 1`; four legacy refs (11244, 52520, 62283, 88689) begin their range at 0,
which is taken to mean the first page.

#### Scenario: Numeric pages
- **WHEN** a ref has `firstpage = '100'` and `lastpage = '150'`
- **THEN** the jsonb contains `pages: {first: 100, last: 150}`

#### Scenario: Only firstpage
- **WHEN** a ref has `firstpage = '100'` and `lastpage` is NULL or empty
- **THEN** the jsonb contains `pages: {first: 100, last: 100}`

#### Scenario: Non-numeric pages
- **WHEN** a ref has `firstpage = 'iv'`
- **THEN** the `pages` object is omitted and the script logs a warning with the `reference_no` and raw values

#### Scenario: First page zero
- **WHEN** a ref has `firstpage = '0'` and `lastpage = '140'`
- **THEN** the jsonb contains `pages: {first: 1, last: 140}` and the script logs the `reference_no`

### Requirement: Language mapping
The script SHALL map the legacy `language` enum to the values of `dictionaries.languages.name` (Chinese, English, French, German, Italian, Japanese, Portuguese, Russian, Spanish, other, unknown). The legacy value `Portugese` SHALL map to `Portuguese`. Legacy values not in the target vocabulary SHALL map to "other". NULL SHALL map to "unknown".

#### Scenario: Direct match
- **WHEN** a ref has `language = 'French'`
- **THEN** the jsonb `language` = "French"

#### Scenario: Misspelling corrected
- **WHEN** a ref has `language = 'Portugese'`
- **THEN** the jsonb `language` = "Portuguese"

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
- Number of titles taken from `pubtitle`, and each such `reference_no`
- Warnings for: NULL publication types, non-numeric pages, unparseable otherauthors, missing authors, zero person IDs
- Elapsed time

#### Scenario: Successful migration log output
- **WHEN** the migration completes without errors
- **THEN** the console output includes start time, source counts, upsert count, pub type summary, the pubtitle fallback count, any warnings, and elapsed time

### Requirement: Validate the built jsonb against the `db` variant
The script SHALL build its validator once at startup by deriving the `db` variant of `referenceSource` in
`payloadSchemas/reference.schema.js`, resolving its enums from `dictionaries`, and compiling it with
`createAjv()`. It SHALL validate every built `reference` object before any database write. A validation
failure SHALL log the offending `reference_no`, the errors and the payload, and SHALL abort the migration.
Enum resolution failures, including an empty `dictionaries.book_types` or `dictionaries.languages`, SHALL
abort the migration before any source row is read.

The `db` variant applies no per-type rule, so a PBDB ref carrying a field its type does not allow on create
validates as stored; the script SHALL NOT drop such fields. A violation reaching the validator therefore
indicates a transformation bug, such as a `language` or `bookType` outside its dictionary.

The script SHALL build the jsonb and the column values separately and SHALL NOT route its writes through
`split()`.

#### Scenario: Schema resolved and compiled up front
- **WHEN** the script starts
- **THEN** it resolves and compiles the reference `db` variant before reading any MariaDB row

#### Scenario: Legacy extras are kept
- **WHEN** a ref maps to "journal article" and has `publisher = 'Elsevier BV'`
- **THEN** the jsonb keeps `publisher: "Elsevier BV"` and validates

#### Scenario: Validation failure aborts the run
- **WHEN** a built payload fails `db`-variant validation
- **THEN** the offending `reference_no`, errors, and payload are logged and the migration aborts

#### Scenario: Every written ref validates
- **WHEN** the migration completes
- **THEN** every `reference` object written validated against the `db` variant, and none was written without validating

