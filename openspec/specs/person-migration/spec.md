# person-migration Specification

## Purpose
Migrate legacy MariaDB `person` rows into the new PostgreSQL persons table.

## Requirements

### Requirement: Read all person records from MariaDB
The script SHALL read all rows from the MariaDB `person` table, selecting columns: `person_no`, `name`, `reversed_name`, `first_name`, `last_name`, `middle`, `email`, `institution`, `country`, `gender`, `role`, `is_authorizer`, `active`, `superuser`.

`heir_no` SHALL NOT be selected. It was named in this list and in the source query from the beginning and was
never read by any line of the script; selecting it implied a mapping that does not exist.

#### Scenario: Full extraction
- **WHEN** the migration script executes the source query
- **THEN** all 1,304 person records are read from MariaDB including the `middle`, `email`, `institution`, `country`, and `gender` columns

#### Scenario: Unused source column is not selected
- **WHEN** the source query is inspected
- **THEN** it names no `heir_no` column

### Requirement: Preserve legacy IDs
The script SHALL insert each person's `person_no` as the `id` column in PostgreSQL `persons`, preserving the original identifiers for FK consistency with downstream migrations.

#### Scenario: ID mapping
- **WHEN** a person with `person_no = 42` is migrated
- **THEN** the resulting row in `persons` has `id = 42`

#### Scenario: Identity sequence reset
- **WHEN** all person records have been inserted
- **THEN** the script resets the `persons` identity sequence to `MAX(id) + 1` so that future auto-generated IDs do not collide

### Requirement: Name field mapping
The script SHALL build name fields into the `person` JSONB object as follows:
- `first_name` → `givenName`
- `last_name` → `familyName`
- `middle` is populated from the source `middle` column when non-empty; otherwise derived by parsing the `name` field (any tokens between `first_name` and `last_name` are extracted as the middle name/initial)

If `first_name` and `last_name` are both empty strings, the script SHALL fall back to parsing `reversed_name` (format: "Last, First Middle") or `name` to populate `givenName`, `familyName`, and `middle`.

#### Scenario: Source middle field available
- **WHEN** a person has `middle = 'P.'` and `first_name = 'John'`, `last_name = 'Alroy'`
- **THEN** the JSONB contains `givenName: 'John'`, `familyName: 'Alroy'`, `middle: 'P.'`

#### Scenario: Source middle field empty, parsed from name
- **WHEN** a person has `middle = NULL` or `middle = ''`, `first_name = 'John'`, `last_name = 'Alroy'`, `name = 'John P. Alroy'`
- **THEN** the JSONB contains `givenName: 'John'`, `familyName: 'Alroy'`, `middle: 'P.'`

#### Scenario: Name without middle
- **WHEN** a person has `middle = NULL`, `first_name = 'Jane'`, `last_name = 'Smith'`, `name = 'Jane Smith'`
- **THEN** the JSONB contains `givenName: 'Jane'`, `familyName: 'Smith'` and `middle` is omitted

#### Scenario: Empty structured name fields
- **WHEN** a person has `first_name = ''`, `last_name = ''`, `name = 'J. P. Alroy'`
- **THEN** the script parses `name` or `reversed_name` to derive `givenName`, `familyName`, and `middle` in the JSONB

#### Scenario: Ambiguous name parsing
- **WHEN** the middle name cannot be clearly determined (e.g. multi-part surnames)
- **THEN** the script logs a warning with the `person_no` and raw name values for manual review and `middle` is omitted from the JSONB

### Requirement: Role mapping
The script SHALL map the legacy role representation to a single `role_id` FK referencing `dictionaries.roles`, using the following priority order (highest wins):

| Priority | Condition | Target role_id |
|----------|-----------|----------------|
| 1 | `superuser = 1` | 1 (Superadmin) |
| 2 | `role` contains 'officer' | 2 (Admin) |
| 3 | `is_authorizer = 1` | 3 (Authorizer) |
| 4 | `role` contains 'technician' | 4 (Enterer) |
| 5 | `role` contains 'student' | 5 (Student) |
| 6 | fallback | 6 (Person) |

#### Scenario: Superuser takes precedence
- **WHEN** a person has `superuser = 1` and `role = 'authorizer,officer'`
- **THEN** `role_id = 1` (Superadmin)

#### Scenario: Officer without superuser
- **WHEN** a person has `superuser = 0`, `role = 'authorizer,officer'`, `is_authorizer = 1`
- **THEN** `role_id = 2` (Admin)

#### Scenario: Authorizer only
- **WHEN** a person has `superuser = 0`, `role = 'authorizer'`, `is_authorizer = 1`
- **THEN** `role_id = 3` (Authorizer)

#### Scenario: No role indicators
- **WHEN** a person has `superuser = 0`, `is_authorizer = 0`, `role = NULL` or empty
- **THEN** `role_id = 6` (Person)

### Requirement: Default values for new columns
The script SHALL build person attributes into the `person` JSONB object using source data where available, with fallback defaults. Remaining flat columns are populated directly.

| JSONB property | Source | Fallback |
|----------------|--------|----------|
| `gender` | `gender` mapped to string name | `"Anonymous"` |
| `countryCode` | `country` resolved against `dictionaries.admin0` | omitted |
| `email` | `email` (trimmed, empty → omitted) | omitted |
| `institution` | `institution` (trimmed, empty → omitted) | omitted |
| `orcid` | — | omitted |
| `legacyIDs.oldpbdbID` | `String(person_no)` | always set |

| Flat column | Source | Fallback |
|-------------|--------|----------|
| `password` | — | NULL |
| `total_hours` | — | NULL |

#### Scenario: Email populated
- **WHEN** a person has `email = 'jsmith@example.com'`
- **THEN** the JSONB contains `email: 'jsmith@example.com'`

#### Scenario: Email empty
- **WHEN** a person has `email = ''` or `email = NULL`
- **THEN** the `email` property is omitted from the JSONB

#### Scenario: Institution populated
- **WHEN** a person has `institution = 'Yale University'`
- **THEN** the JSONB contains `institution: 'Yale University'`

#### Scenario: Institution empty
- **WHEN** a person has `institution = ''` or `institution = NULL`
- **THEN** the `institution` property is omitted from the JSONB

#### Scenario: Legacy ID stored
- **WHEN** a person has `person_no = 42`
- **THEN** the JSONB contains `legacyIDs: { oldpbdbID: '42' }`

### Requirement: Authorizer person self-reference
The script SHALL populate `authorizer_person_id` as follows:
- Persons with role Authorizer or above (role_id 1, 2, or 3): self-reference (their own `id`)
- Persons with role Enterer, Student, or Person (role_id 4, 5, or 6): self-reference as fallback (source data does not contain authorizer assignments)

#### Scenario: Authorizer references self
- **WHEN** a person is mapped to role_id 3 (Authorizer)
- **THEN** `authorizer_person_id` is set to their own `id`

#### Scenario: Student references self as fallback
- **WHEN** a person is mapped to role_id 5 (Student) and no authorizer assignment is available in the source
- **THEN** `authorizer_person_id` is set to their own `id`

### Requirement: Active boolean mapping
The script SHALL convert the MariaDB `active` column (tinyint: 0 or 1) to a PostgreSQL boolean (`true`/`false`).

#### Scenario: Active person
- **WHEN** a person has `active = 1`
- **THEN** `active = true` in PostgreSQL

#### Scenario: Inactive person
- **WHEN** a person has `active = 0`
- **THEN** `active = false` in PostgreSQL

### Requirement: Idempotent upsert
The script SHALL use `INSERT ... ON CONFLICT (id) DO UPDATE SET ...` so that re-running the migration updates existing rows rather than failing on duplicates or deleting data. The upsert SHALL update `role_id`, `authorizer_person_id`, `person` (JSONB), and `active`.

The upsert SHALL NOT update `permid`. The permid is supplied in the INSERT column list and omitted from the
`DO UPDATE SET` list, so it is written once, when the row is created, and never again.

This exclusion is what makes the permid permanent. The script mints a fresh permid on every pass over a
source row, including passes that resolve to an update; were `permid` in the `DO UPDATE SET` list, each
re-run would issue every person a new identifier, silently invalidating every external reference to them.
No other minted-permid table in the project has this hazard, because no other one upserts on a surrogate
`id` — so the exclusion is stated here rather than left to resemble an oversight.

#### Scenario: First run
- **WHEN** the script runs against an empty `persons` table
- **THEN** all 1,304 rows are inserted

#### Scenario: Repeated run
- **WHEN** the script runs and `persons` already contains previously migrated rows
- **THEN** existing rows are updated with current source data and no duplicates are created

#### Scenario: Permid survives a re-run
- **WHEN** the script runs a second time against a `persons` table it has already populated
- **THEN** every row's `permid` is byte-for-byte the value it held before the re-run, while `role_id`, `authorizer_person_id`, `person`, and `active` are refreshed from source

#### Scenario: Re-run does not exhaust or collide permids
- **WHEN** a re-run mints permids for rows that then resolve to updates
- **THEN** the minted values are discarded by the `DO UPDATE SET` list rather than written, and no unique-constraint violation occurs on `persons.permid`
### Requirement: Row count verification
The script SHALL verify after migration that the number of rows in PostgreSQL `persons` matches the number of rows read from MariaDB `person`, and log the counts.

#### Scenario: Counts match
- **WHEN** 1,304 rows are read from MariaDB and 1,304 rows exist in PostgreSQL after migration
- **THEN** the script logs a success message with the count

#### Scenario: Count mismatch
- **WHEN** the PostgreSQL row count does not match the MariaDB source count
- **THEN** the script logs a warning with both counts

### Requirement: Migration logging
The script SHALL log:
- Start and completion messages with timestamps
- Number of rows read from source
- Number of rows upserted to target
- Any name parsing warnings (ambiguous middle names)
- The original role SET value for each person alongside the mapped role_id

#### Scenario: Successful migration log output
- **WHEN** the migration completes without errors
- **THEN** the console output includes start time, row counts, and a completion summary

### Requirement: Gender mapping
The script SHALL map the source `gender` enum to a string value in the `person` JSONB `gender` property:

| Source `gender` | JSONB `gender` value |
|-----------------|----------------------|
| `'F'` | `"Female"` |
| `'M'` | `"Male"` |
| NULL or empty | `"Anonymous"` |

The `dictionaries.genders` table lookup is no longer required for this mapping.

#### Scenario: Female gender
- **WHEN** a person has `gender = 'F'`
- **THEN** the JSONB contains `gender: 'Female'`

#### Scenario: Male gender
- **WHEN** a person has `gender = 'M'`
- **THEN** the JSONB contains `gender: 'Male'`

#### Scenario: NULL gender
- **WHEN** a person has `gender = NULL`
- **THEN** the JSONB contains `gender: 'Anonymous'`

### Requirement: Country mapping
The script SHALL map the source `country` free-text field to an ISO 3166-1 alpha-2 country code by resolving it
against `dictionaries.admin0`, using the same normalize-then-alias pipeline `collection-migration` specifies
for its toponyms. The `@countrystatecity/countries` npm package SHALL NOT be used, and SHALL be removed from
`package.json`, of which this script is the only consumer.

Resolution SHALL: (1) normalize both the legacy value and the dictionary entries by casefolding, trimming,
stripping diacritics (Unicode NFD + combining-mark removal), and collapsing whitespace and punctuation;
(2) match against admin0 `name`, `iso` and `iso3`; (3) fall back to the shared curated alias map (normalized
legacy string → ISO code). That pipeline — `normalizeName`, `COUNTRY_ALIASES`, and the `dictionaries.admin0`
loader — SHALL live in `src/lib/` and be imported by both this script and `migrate-collections.js`, as
`migration-script-layout` requires of a helper two migrations share.

The two variants this script previously normalized that the shared alias map does not already carry —
`'untied states'` and `'england'` — SHALL be added to it. The map already carries `netherlands` and
`russian federation`, which the `admin0` spellings (`'The Netherlands'`, `'Russia'`) would otherwise miss.

For any source value that does not resolve, the `countryCode` property SHALL be omitted from the JSONB and the
script SHALL log a warning with the `person_no` and unmatched value.

The change of source SHALL be verified against the migrated data rather than by inspection: every
`countryCode` currently stored is present in `admin0.iso`, so the stored values are a valid baseline, and the
new resolution SHALL be diffed against them per `person_no`. Every person that resolves to a country today
SHALL still resolve to the same country.

#### Scenario: Direct country match
- **WHEN** a person has `country = 'Germany'`
- **THEN** the JSONB contains `countryCode: 'DE'`

#### Scenario: Normalized variant
- **WHEN** a person has `country = 'USA'`
- **THEN** the JSONB contains `countryCode: 'US'`

#### Scenario: Typo variant
- **WHEN** a person has `country = 'Untied States'`
- **THEN** the JSONB contains `countryCode: 'US'`

#### Scenario: England maps to United Kingdom
- **WHEN** a person has `country = 'England'`
- **THEN** the JSONB contains `countryCode: 'GB'`

#### Scenario: Dictionary spelling differs from the legacy value
- **WHEN** a person has `country = 'The Netherlands'` and `dictionaries.admin0` spells it `'The Netherlands'`, or `country = 'Russian Federation'` and the dictionary spells it `'Russia'`
- **THEN** both resolve, through the normalized dictionary match and the alias map respectively

#### Scenario: NULL or empty country
- **WHEN** a person has `country = NULL` or `country = ''`
- **THEN** the `countryCode` property is omitted from the JSONB

#### Scenario: Unmapped country value
- **WHEN** a person has a `country` value that resolves against neither the normalized `dictionaries.admin0` entries nor the alias map
- **THEN** the `countryCode` property is omitted from the JSONB and the script logs a warning with the `person_no` and original value

#### Scenario: No regression against the stored baseline
- **WHEN** the new resolution is run over the source and compared with the `countryCode` stored by the previous implementation
- **THEN** every `person_no` that held a `countryCode` holds the same one, and any difference is an added match rather than a lost one

### Requirement: Validate the built jsonb against the `db` variant
The script SHALL compile the `db` variant of `personSource` — resolved from `dictionaries` by `resolveEnums`
— once, before the first source row is read, and SHALL validate every `person` object against it before
writing. A row that fails validation SHALL be reported with its `person_no` and the ajv errors.

Resolution before the first read is what makes an empty or missing dictionary abort the run rather than fail
row by row, matching `migrate-collections.js` and `migrate-specimens.js`.

The script SHALL build the jsonb and the flat column values separately, as those two scripts do, and SHALL NOT
route its writes through `split()`.

#### Scenario: Schema resolved and compiled up front
- **WHEN** the script starts
- **THEN** it resolves and compiles the person `db` variant before reading any MariaDB row, and logs that it has done so

#### Scenario: Empty dictionary aborts the run
- **WHEN** `dictionaries.genders` holds no rows
- **THEN** the script exits non-zero naming `dictionaries.genders.name`, before any person is read or written

#### Scenario: Every written person validates
- **WHEN** the migration completes
- **THEN** all 1,304 `person` objects validated against the `db` variant, and none was written without validating

#### Scenario: Unresolvable country becomes a hard failure
- **WHEN** a `countryCode` is produced that is not among `dictionaries.admin0.iso`
- **THEN** validation fails for that row and it is reported, rather than being written with a country nothing recognises
### Requirement: Mint a permid for every person
The script SHALL mint a `permid` for every person row it inserts, using the UUIDv7 generator exported by
`src/lib/uuidv7.js`. The permid SHALL be freshly generated and SHALL NOT be derived from `person_no`,
`legacyIDs.oldpbdbID`, `legacyIDs.pbotID`, the person's email, or any other source value.

The permid is a flat column on `persons`, not a property of the `person` JSONB. It joins — and does not
replace — the identifiers the row already carries: `id` (seeded from `person_no`) remains the key every
`authorizer_person_id` and `enterer_person_id` in the schema references, and `legacyIDs.oldpbdbID` remains
the record of where the row came from.

#### Scenario: Every migrated person has a permid
- **WHEN** the migration completes
- **THEN** all 1,304 rows in `persons` have a non-NULL `permid` whose version nibble is 7

#### Scenario: Permids are distinct
- **WHEN** the migration completes
- **THEN** the number of distinct `permid` values in `persons` equals the number of rows

#### Scenario: Permid is not derived from source values
- **WHEN** a person with `person_no = 42` is migrated
- **THEN** the row's `permid` is a generated UUIDv7 unrelated to `42`, and `person->legacyIDs->>'oldpbdbID'` is still `'42'`
