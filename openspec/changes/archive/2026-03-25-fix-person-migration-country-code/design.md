## Context

The `persons` table schema has changed: `country_id integer` (FK to `dictionaries.countries`) has been replaced by `country_code text` (ISO 3166-1 alpha-2). The `dictionaries.countries` table is no longer used by this script. The existing `migrate-persons.js` still queries and inserts into `dictionaries.countries`, so it fails against the current PostgreSQL schema.

The `@countrystatecity/countries` npm package is already installed and provides `getCountries()`, an async function returning ~250 country objects with `name` and `iso2` fields.

## Goals / Non-Goals

**Goals:**
- Replace all `dictionaries.countries` usage with `@countrystatecity/countries` package lookup
- Produce ISO alpha-2 country codes instead of integer FKs
- Retain the existing normalization map for known source data variants
- Keep the script idempotent (upsert behavior preserved)

**Non-Goals:**
- Modifying gender, role, or name mapping logic (unchanged)
- Updating the reference migration scripts (separate change)
- Adding new country variants beyond what exists in the current normalization map

## Decisions

### 1. Build lookup map at startup from async `getCountries()`

Call `getCountries()` once at the top of `main()` and build a case-insensitive `name → iso2` map. This replaces the PostgreSQL query against `dictionaries.countries`.

**Why**: The package data is static per version — no need to call it per row. Building the map once is simple and fast.

**Alternative considered**: Querying a local JSON file or maintaining a hand-rolled country list. Rejected because the npm package is already a dependency and stays current with ISO standards.

### 2. Normalization map resolves to country names, not ISO codes

The `COUNTRY_NORMALIZE` map continues to map source variants to canonical country names (e.g., `'usa' → 'United States'`), which then resolve through the package lookup map to ISO codes.

**Why**: This keeps the normalization map readable and decoupled from specific codes. If a country name changes in the package, only the map entry needs updating. "Russia" and "Venezuela" are direct matches in the package (unlike the old `dictionaries.countries` which used "Russian Federation" and "Venezuela, Bolivarian Republic of"), so those entries can be removed from the normalization map.

### 3. Unmapped countries become `NULL`, not a sentinel value

Previously, unmapped countries defaulted to an "Unknown" dictionary row FK. Now they produce `NULL` with a logged warning.

**Why**: `NULL` is semantically correct for "unknown" in PostgreSQL and avoids polluting the data with sentinel values. The warning log preserves traceability.

### 4. Minimal diff to existing script

Only the country-related code paths change:
- Remove: "Unknown" country insert, `dictionaries.countries` queries, `countryMap` from DB
- Add: `import { getCountries }` from package, build `countryNameToCode` map, update normalization map entries
- Modify: INSERT/UPSERT column `country_id` → `country_code`, parameter value from integer to string/null

**Why**: The rest of the script (name parsing, role mapping, gender mapping, upsert structure) is working correctly and should not be touched.

## Risks / Trade-offs

**Package API is async** → Handled by awaiting `getCountries()` once at startup before the row loop. No per-row async overhead.

**Package country names may differ from source expectations** → Mitigated by the normalization map. The existing map covers all known variants in the source data. Unmapped values log warnings for manual review.

**No "Unknown" sentinel in target** → If downstream queries expect a non-NULL country value for all persons, they'll need to handle NULLs. This is the correct behavior per the new schema design.
