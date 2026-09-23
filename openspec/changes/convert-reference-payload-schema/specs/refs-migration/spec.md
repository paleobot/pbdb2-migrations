## MODIFIED Requirements

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

## ADDED Requirements

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
