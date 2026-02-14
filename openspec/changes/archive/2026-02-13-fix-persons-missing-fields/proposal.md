## Why

The persons migration (`migrate-persons.js`) does not carry over five fields that have data in the source MariaDB `person` table: `email` (1,245/1,304 populated), `institution` (1,302/1,304), `country` (738/1,304), `gender` (737/1,304), and `middle` (391/1,304). Instead, these are set to NULL or hardcoded defaults ("Anonymous" gender, "Unknown" country). The `middle` field exists in the source but is ignored in favor of parsing logic that derives it from `name` — the source value should take precedence when available.

## What Changes

- Map source `email` → target `email` (direct copy, NULL if empty)
- Map source `institution` → target `institution` (direct copy, NULL if empty)
- Map source `gender` enum (`'F'`→Female, `'M'`→Male, NULL→Anonymous) → target `gender_id` FK via `dictionaries.genders` lookup
- Map source `country` (free-text full name, e.g. "United States") → target `country_id` FK via `dictionaries.countries` lookup on `full_name`. Unmapped values (typos like "Untied States", "US", "USA", "England", "The Netherlands") need a mapping table or fallback to "Unknown"
- Prefer source `middle` field over the parsed middle value — use the existing parsing logic only when the source `middle` column is NULL or empty
- Add `middle`, `email`, `institution`, `country`, `gender` to the MariaDB SELECT query

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `person-migration`: The "Read all person records" requirement must include the `middle`, `email`, `institution`, `country`, and `gender` columns. The "Name field mapping" requirement must prefer the source `middle` value when available. The "Default values for new columns" requirement must change — `email`, `institution`, `gender_id`, and `country_id` should now be mapped from source data instead of using hardcoded defaults.

## Impact

- **Modified file**: `migrate-persons.js` — updated SELECT query, new mapping logic for gender/country, changed middle/email/institution handling
- **Dictionary dependency**: `dictionaries.genders` and `dictionaries.countries` must be seeded (already present)
- **Country mapping concern**: Source uses free-text country names with ~38 distinct values including variants ("US"/"USA"/"United States", "Untied States", "England"/"United Kingdom", "The Netherlands"/"Netherlands"). A normalization map is needed for these variants to match `dictionaries.countries.full_name`.
- **Data coverage**: After this fix, gender will be mapped for 56% of persons (737/1,304), country for 57% (738/1,304), email for 95%, institution for 99.8%, middle for 30% — the rest retain their current defaults
- **Downstream impact**: None — persons table schema unchanged, only data values improve
- **No new dependencies** — reuses existing `db.js`, `dictionaries.genders`, `dictionaries.countries`
