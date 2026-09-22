## MODIFIED Requirements

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

## ADDED Requirements

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
