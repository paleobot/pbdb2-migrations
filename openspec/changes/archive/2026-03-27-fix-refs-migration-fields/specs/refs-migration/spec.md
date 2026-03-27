## MODIFIED Requirements

### Requirement: Read all source data from MariaDB
The script SHALL read all rows from MariaDB `refs` table (including the `comments` column), plus all rows from `ref_authors` and `ref_editors`. The `ref_authors` and `ref_editors` rows SHALL be pre-loaded into Maps keyed by `reference_no` for lookup during transformation.

#### Scenario: Full extraction
- **WHEN** the migration script executes the source queries
- **THEN** all 93,863 refs rows (including the `comments` column), 14,144 ref_authors rows, and 414 ref_editors rows are read from MariaDB and logged

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

### Requirement: Batched upsert
The script SHALL insert rows in batches (e.g. 500 per batch) using multi-value INSERT into the `refs` table with `ON CONFLICT (id) DO UPDATE SET ...`. The `permid` column MUST be excluded from the UPDATE SET to preserve UUIDs on re-runs.

#### Scenario: Target table name
- **WHEN** the script executes INSERT statements
- **THEN** the target table is `refs` (not `"references"`)
