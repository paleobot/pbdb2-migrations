## REMOVED Requirements

### Requirement: Insert Unknown country dictionary entry
**Reason**: The `dictionaries.countries` table is no longer used. Country resolution now uses the `@countrystatecity/countries` npm package, producing an ISO country code string.
**Migration**: Country lookup logic replaced by package-based resolution in the "Country mapping" requirement.

## MODIFIED Requirements

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
