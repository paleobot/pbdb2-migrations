## Why

The `persons` table no longer uses a `dictionaries.countries` FK (`country_id`). It now has a `country_code text` column, and country lookup uses the `@countrystatecity/countries` npm package instead of a database dictionary table. The person migration script must be updated to match this schema change.

## What Changes

- **BREAKING**: `migrate-persons.js` no longer inserts into or queries `dictionaries.countries`
- `migrate-persons.js` uses the `@countrystatecity/countries` package to resolve the MariaDB `person.country` free-text field to an ISO country code
- The script writes to `persons.country_code` (text) instead of `persons.country_id` (integer FK)
- The normalization map for known country name variants (e.g., "USA" → "United States", "England" → "United Kingdom") is retained but now resolves to ISO codes rather than dictionary table IDs
- Unmapped or empty country values produce a `NULL` country_code rather than a FK to an "Unknown" dictionary row

## Capabilities

### New Capabilities

None

### Modified Capabilities

- `person-migration`: Country mapping requirement changes from `dictionaries.countries` FK lookup to `@countrystatecity/countries` package lookup producing an ISO country code string

## Impact

- **Modified file**: `migrate-persons.js` — country resolution logic rewritten
- **New dependency**: `@countrystatecity/countries` npm package (must be installed)
- **Removed dependency**: `dictionaries.countries` table is no longer read or written by this script
- **Source table**: MariaDB `person` (unchanged)
- **Target table**: PostgreSQL `persons` — `country_code text` column replaces `country_id integer`
