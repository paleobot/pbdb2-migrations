## MODIFIED Requirements

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

### Requirement: Default values for new columns
The script SHALL build person attributes into the `person` JSONB object using source data where available, with fallback defaults. Remaining flat columns are populated directly.

| JSONB property | Source | Fallback |
|----------------|--------|----------|
| `gender` | `gender` mapped to string name | `"Anonymous"` |
| `countryCode` | `country` matched via `@countrystatecity/countries` | omitted |
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

For any source value that does not match after normalization, the `countryCode` property SHALL be omitted from the JSONB and the script SHALL log a warning with the `person_no` and unmatched value.

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

#### Scenario: NULL or empty country
- **WHEN** a person has `country = NULL` or `country = ''`
- **THEN** the `countryCode` property is omitted from the JSONB

#### Scenario: Unmapped country value
- **WHEN** a person has a `country` value that does not match any country name from `@countrystatecity/countries` after normalization
- **THEN** the `countryCode` property is omitted from the JSONB and the script logs a warning with the `person_no` and original value

### Requirement: Idempotent upsert
The script SHALL use `INSERT ... ON CONFLICT (id) DO UPDATE SET ...` so that re-running the migration updates existing rows rather than failing on duplicates or deleting data. The upsert SHALL update `role_id`, `authorizer_person_id`, `person` (JSONB), and `active`.

#### Scenario: First run
- **WHEN** the script runs against an empty `persons` table
- **THEN** all 1,304 rows are inserted

#### Scenario: Repeated run
- **WHEN** the script runs and `persons` already contains previously migrated rows
- **THEN** existing rows are updated with current source data and no duplicates are created
