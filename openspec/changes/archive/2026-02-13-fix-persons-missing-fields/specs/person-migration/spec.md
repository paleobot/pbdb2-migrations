## MODIFIED Requirements

### Requirement: Read all person records from MariaDB
The script SHALL read all rows from the MariaDB `person` table, selecting columns: `person_no`, `name`, `reversed_name`, `first_name`, `last_name`, `middle`, `email`, `institution`, `country`, `gender`, `role`, `is_authorizer`, `active`, `heir_no`, `superuser`.

#### Scenario: Full extraction
- **WHEN** the migration script executes the source query
- **THEN** all 1,304 person records are read from MariaDB including the `middle`, `email`, `institution`, `country`, and `gender` columns

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

### Requirement: Default values for new columns
The script SHALL populate target columns using source data where available, with fallback defaults:

| Column | Source | Fallback |
|--------|--------|----------|
| gender_id | `gender` mapped via `dictionaries.genders` | id of "Anonymous" (id 4) |
| country_id | `country` matched to `dictionaries.countries.full_name` | id of "Unknown" (abbreviation 'XX') |
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

## ADDED Requirements

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
The script SHALL map the source `country` free-text field to `dictionaries.countries` by matching against `full_name` (case-insensitive). A normalization map SHALL handle known variants:

| Source variant | Target `full_name` |
|----------------|--------------------|
| "US" | "United States" |
| "USA" | "United States" |
| "Untied States" | "United States" |
| "England" | "United Kingdom" |
| "The Netherlands" | "Netherlands" |

For any source value that does not match after normalization, the script SHALL fall back to the "Unknown" country (abbreviation 'XX') and log a warning with the `person_no` and unmatched value.

#### Scenario: Direct country match
- **WHEN** a person has `country = 'Germany'`
- **THEN** `country_id` is set to the id of "Germany" in `dictionaries.countries`

#### Scenario: Normalized variant
- **WHEN** a person has `country = 'USA'`
- **THEN** `country_id` is set to the id of "United States" in `dictionaries.countries`

#### Scenario: Typo variant
- **WHEN** a person has `country = 'Untied States'`
- **THEN** `country_id` is set to the id of "United States" in `dictionaries.countries`

#### Scenario: NULL or empty country
- **WHEN** a person has `country = NULL` or `country = ''`
- **THEN** `country_id` is set to the id of "Unknown" (abbreviation 'XX')

#### Scenario: Unmapped country value
- **WHEN** a person has a `country` value that does not match any `dictionaries.countries.full_name` after normalization
- **THEN** `country_id` is set to the id of "Unknown" and the script logs a warning with the `person_no` and original value
