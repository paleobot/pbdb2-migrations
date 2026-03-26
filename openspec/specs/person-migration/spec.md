### Requirement: Read all person records from MariaDB
The script SHALL read all rows from the MariaDB `person` table, selecting columns: `person_no`, `name`, `reversed_name`, `first_name`, `last_name`, `middle`, `email`, `institution`, `country`, `gender`, `role`, `is_authorizer`, `active`, `heir_no`, `superuser`.

#### Scenario: Full extraction
- **WHEN** the migration script executes the source query
- **THEN** all 1,304 person records are read from MariaDB including the `middle`, `email`, `institution`, `country`, and `gender` columns

### Requirement: Preserve legacy IDs
The script SHALL insert each person's `person_no` as the `id` column in PostgreSQL `persons`, preserving the original identifiers for FK consistency with downstream migrations.

#### Scenario: ID mapping
- **WHEN** a person with `person_no = 42` is migrated
- **THEN** the resulting row in `persons` has `id = 42`

#### Scenario: Identity sequence reset
- **WHEN** all person records have been inserted
- **THEN** the script resets the `persons` identity sequence to `MAX(id) + 1` so that future auto-generated IDs do not collide

### Requirement: Name field mapping
The script SHALL map name fields as follows:
- `first_name` → `given_name`
- `last_name` → `family_name`
- `middle` is populated from the source `middle` column when non-empty; otherwise derived by parsing the `name` field (any tokens between `first_name` and `last_name` are extracted as the middle name/initial)

If `first_name` and `last_name` are both empty strings, the script SHALL fall back to parsing `reversed_name` (format: "Last, First Middle") or `name` to populate `given_name`, `family_name`, and `middle`.

#### Scenario: Source middle field available
- **WHEN** a person has `middle = 'P.'` and `first_name = 'John'`, `last_name = 'Alroy'`
- **THEN** `given_name = 'John'`, `family_name = 'Alroy'`, `middle = 'P.'` (source value used directly)

#### Scenario: Source middle field empty, parsed from name
- **WHEN** a person has `middle = NULL` or `middle = ''`, `first_name = 'John'`, `last_name = 'Alroy'`, `name = 'John P. Alroy'`
- **THEN** `given_name = 'John'`, `family_name = 'Alroy'`, `middle = 'P.'` (parsed from name)

#### Scenario: Name without middle
- **WHEN** a person has `middle = NULL`, `first_name = 'Jane'`, `last_name = 'Smith'`, `name = 'Jane Smith'`
- **THEN** `given_name = 'Jane'`, `family_name = 'Smith'`, `middle = NULL`

#### Scenario: Empty structured name fields
- **WHEN** a person has `first_name = ''`, `last_name = ''`, `name = 'J. P. Alroy'`
- **THEN** the script parses `name` or `reversed_name` to derive `given_name`, `family_name`, and `middle`

#### Scenario: Ambiguous name parsing
- **WHEN** the middle name cannot be clearly determined (e.g. multi-part surnames)
- **THEN** the script logs a warning with the `person_no` and raw name values for manual review and sets `middle = NULL`

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
The script SHALL populate target columns using source data where available, with fallback defaults:

| Column | Source | Fallback |
|--------|--------|----------|
| gender_id | `gender` mapped via `dictionaries.genders` | id of "Anonymous" (id 4) |
| country_code | `country` matched via `@countrystatecity/countries` | NULL |
| email | `email` (trimmed, empty → NULL) | NULL |
| institution | `institution` (trimmed, empty → NULL) | NULL |
| password | — | NULL |
| orcid | — | NULL |
| total_hours | — | NULL |

#### Scenario: Email populated
- **WHEN** a person has `email = 'jsmith@example.com'`
- **THEN** `email = 'jsmith@example.com'` in PostgreSQL

#### Scenario: Email empty
- **WHEN** a person has `email = ''` or `email = NULL`
- **THEN** `email = NULL` in PostgreSQL

#### Scenario: Institution populated
- **WHEN** a person has `institution = 'Yale University'`
- **THEN** `institution = 'Yale University'` in PostgreSQL

#### Scenario: Institution empty
- **WHEN** a person has `institution = ''` or `institution = NULL`
- **THEN** `institution = NULL` in PostgreSQL

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
The script SHALL use `INSERT ... ON CONFLICT (id) DO UPDATE SET ...` so that re-running the migration updates existing rows rather than failing on duplicates or deleting data.

#### Scenario: First run
- **WHEN** the script runs against an empty `persons` table
- **THEN** all 1,304 rows are inserted

#### Scenario: Repeated run
- **WHEN** the script runs and `persons` already contains previously migrated rows
- **THEN** existing rows are updated with current source data and no duplicates are created

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
The script SHALL map the source `gender` enum to `dictionaries.genders` as follows:

| Source `gender` | Target `dictionaries.genders` |
|-----------------|-------------------------------|
| `'F'` | Female |
| `'M'` | Male |
| NULL | Anonymous |

The script SHALL load all genders from `dictionaries.genders` into a name→id map and use it for the lookup.

#### Scenario: Female gender
- **WHEN** a person has `gender = 'F'`
- **THEN** `gender_id` is set to the id of "Female" in `dictionaries.genders`

#### Scenario: Male gender
- **WHEN** a person has `gender = 'M'`
- **THEN** `gender_id` is set to the id of "Male" in `dictionaries.genders`

#### Scenario: NULL gender
- **WHEN** a person has `gender = NULL`
- **THEN** `gender_id` is set to the id of "Anonymous" in `dictionaries.genders`

### Requirement: Country mapping
The script SHALL map the source `country` free-text field to an ISO 3166-1 alpha-2 country code using the `@countrystatecity/countries` npm package. The package's `getCountries()` function returns an array of country objects with `name` and `iso2` fields. The script SHALL build a case-insensitive `name → iso2` lookup map from this data.

A normalization map SHALL handle known variants in the source data:

| Source variant | Normalized name | ISO code |
|----------------|-----------------|----------|
| "US" | "United States" | US |
| "USA" | "United States" | US |
| "Untied States" | "United States" | US |
| "England" | "United Kingdom" | GB |
| "The Netherlands" | "Netherlands" | NL |
| "Russia" | (direct match) | RU |
| "Venezuela" | (direct match) | VE |

For any source value that does not match after normalization, the script SHALL set `country_code` to `NULL` and log a warning with the `person_no` and unmatched value.

#### Scenario: Direct country match
- **WHEN** a person has `country = 'Germany'`
- **THEN** `country_code` is set to `'DE'`

#### Scenario: Normalized variant
- **WHEN** a person has `country = 'USA'`
- **THEN** `country_code` is set to `'US'`

#### Scenario: Typo variant
- **WHEN** a person has `country = 'Untied States'`
- **THEN** `country_code` is set to `'US'`

#### Scenario: England maps to United Kingdom
- **WHEN** a person has `country = 'England'`
- **THEN** `country_code` is set to `'GB'`

#### Scenario: NULL or empty country
- **WHEN** a person has `country = NULL` or `country = ''`
- **THEN** `country_code` is set to `NULL`

#### Scenario: Unmapped country value
- **WHEN** a person has a `country` value that does not match any country name from `@countrystatecity/countries` after normalization
- **THEN** `country_code` is set to `NULL` and the script logs a warning with the `person_no` and original value

### Requirement: PBot enterer persons can be inserted with auto-generated IDs
When PBot enterer persons are inserted by the pbot-refs-migration script, they SHALL use PostgreSQL auto-generated identity IDs rather than explicit IDs. The `persons` identity sequence SHALL be reset to `MAX(id)` after insertion.

#### Scenario: Auto-generated person ID
- **WHEN** a new PBot enterer person is inserted without an explicit `id`
- **THEN** the PostgreSQL identity sequence assigns the next available integer ID

#### Scenario: No collision with existing IDs
- **WHEN** the persons identity sequence is at 1306 and a new person is inserted
- **THEN** the new person receives id=1307 or higher

### Requirement: ORCID can be updated on existing persons
Existing person records MAY have their `orcid` field updated when a trusted external source (such as PBot) provides an ORCID value and the current PG value is NULL or empty. The ORCID value SHALL be normalized by stripping the `https://orcid.org/` URL prefix if present.

#### Scenario: ORCID updated from PBot
- **WHEN** PG person id=1053 has `orcid = NULL` and a PBot source provides `orcid = 'https://orcid.org/0000-0002-5242-8573'`
- **THEN** PG person id=1053 is updated with `orcid = '0000-0002-5242-8573'`

#### Scenario: Existing ORCID not overwritten
- **WHEN** PG person already has a non-null, non-empty `orcid` value
- **THEN** the existing ORCID is preserved
