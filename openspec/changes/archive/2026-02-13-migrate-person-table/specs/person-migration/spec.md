## ADDED Requirements

### Requirement: Insert Unknown country dictionary entry
The migration script SHALL insert an entry into `dictionaries.countries` with abbreviation `'XX'` and full_name `'Unknown'` if one does not already exist. This entry is used as the default `country_id` for migrated persons.

#### Scenario: Unknown country does not exist
- **WHEN** the migration runs and no row with abbreviation `'XX'` exists in `dictionaries.countries`
- **THEN** a new row is inserted with abbreviation `'XX'` and full_name `'Unknown'`

#### Scenario: Unknown country already exists
- **WHEN** the migration runs and a row with abbreviation `'XX'` already exists in `dictionaries.countries`
- **THEN** the existing row is used and no duplicate is created

### Requirement: Read all person records from MariaDB
The script SHALL read all rows from the MariaDB `person` table, selecting columns: `person_no`, `name`, `reversed_name`, `first_name`, `last_name`, `role`, `is_authorizer`, `active`, `heir_no`, `superuser`.

#### Scenario: Full extraction
- **WHEN** the migration script executes the source query
- **THEN** all 1,304 person records are read from MariaDB

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
- `middle` is derived by parsing the `name` field: any tokens between `first_name` and `last_name` are extracted as the middle name/initial

If `first_name` and `last_name` are both empty strings, the script SHALL fall back to parsing `reversed_name` (format: "Last, First Middle") or `name` to populate `given_name`, `family_name`, and `middle`.

#### Scenario: Standard name with middle initial
- **WHEN** a person has `first_name = 'John'`, `last_name = 'Alroy'`, `name = 'John P. Alroy'`
- **THEN** `given_name = 'John'`, `family_name = 'Alroy'`, `middle = 'P.'`

#### Scenario: Name without middle
- **WHEN** a person has `first_name = 'Jane'`, `last_name = 'Smith'`, `name = 'Jane Smith'`
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
The script SHALL populate target columns that have no source equivalent using these defaults:

| Column | Default |
|--------|---------|
| gender_id | id of "Anonymous" in `dictionaries.genders` (id 4) |
| country_id | id of "Unknown" (abbreviation 'XX') in `dictionaries.countries` |
| email | NULL |
| password | NULL |
| orcid | NULL |
| institution | NULL |
| total_hours | NULL |

#### Scenario: Gender defaults to Anonymous
- **WHEN** any person is migrated
- **THEN** `gender_id` is set to the id of the "Anonymous" gender entry

#### Scenario: Country defaults to Unknown
- **WHEN** any person is migrated
- **THEN** `country_id` is set to the id of the "Unknown" country entry

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
