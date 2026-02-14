## Context

The current `migrate-persons.js` reads 7 columns from MariaDB `person` (`person_no`, `name`, `reversed_name`, `first_name`, `last_name`, `role`, `is_authorizer`, `active`, `heir_no`, `superuser`) but ignores 5 columns that have meaningful data: `middle` (391 populated), `email` (1,245), `institution` (1,302), `country` (738), and `gender` (737). These are set to NULL or hardcoded defaults in the target.

The target PostgreSQL `persons` table already has columns for all five fields — `middle` (varchar), `email` (varchar), `institution` (varchar), `gender_id` (FK → `dictionaries.genders`), and `country_id` (FK → `dictionaries.countries`).

## Goals / Non-Goals

**Goals:**
- Carry over all 5 missing fields from source to target
- Map source `gender` enum to `dictionaries.genders` FK
- Map source `country` free-text to `dictionaries.countries` FK, handling known variants
- Prefer the source `middle` column over the parsed middle value
- Maintain idempotency and the existing script structure

**Non-Goals:**
- Changing the name parsing logic itself — only the `middle` priority changes
- Adding new columns to the PostgreSQL schema
- Migrating `password`/`plaintext` fields (security concern — legacy passwords should not be carried over)
- Migrating `homepage`, `photo`, `research_group`, or other fields not in the target schema

## Decisions

### 1. Gender mapping

Source `gender` is an enum: `'F'`, `'M'`, or NULL.

| Source | Target `dictionaries.genders` |
|--------|-------------------------------|
| `'F'`  | Female (id 2) |
| `'M'`  | Male (id 1) |
| NULL   | Anonymous (id 4) |

Load the genders dictionary into a map and look up by name. The existing script already looks up the Anonymous gender ID — extend this to load all genders.

### 2. Country mapping

Source `country` is a free-text varchar(80) with 38 distinct values. The target `dictionaries.countries` uses `full_name` (e.g. "United States"). Most source values match directly, but several need normalization:

```
Source variant          → Target full_name
───────────────────────────────────────────
"United States"         → "United States" (direct, 494 persons)
"US"                    → "United States"
"USA"                   → "United States"
"Untied States"         → "United States"
"England"               → "United Kingdom"
"The Netherlands"       → "Netherlands"
NULL or empty           → "Unknown" (XX)
```

**Approach:** Load `dictionaries.countries` into a `full_name → id` map (case-insensitive). Define a small hardcoded normalization map for the known variants. For any source value that doesn't match after normalization, fall back to "Unknown" and log a warning.

**Rationale:** With only 38 distinct values and ~6 known variants, a hardcoded map is simpler and more transparent than fuzzy matching. The warning log catches any new variants on re-runs.

### 3. Middle name priority

Current logic: `mapName()` derives `middle` by parsing `name` or `reversed_name`, ignoring the source `middle` column entirely.

**Change:** After calling `mapName()`, check if the source `middle` column is non-empty. If so, use it instead of the parsed value.

```js
const { givenName, familyName, middle: parsedMiddle } = mapName(row);
const middle = (row.middle && row.middle.trim()) || parsedMiddle;
```

**Rationale:** The source `middle` field is the authoritative value when present (391/1,304 records). The parsing logic is a best-effort fallback for the remaining records. This approach is minimally invasive — it doesn't change `mapName()` itself.

### 4. Email and institution

Direct copies. Trim whitespace, convert empty strings to NULL.

```js
const email = row.email?.trim() || null;
const institution = row.institution?.trim() || null;
```

### 5. Updated SELECT query

Add the 5 new columns to the MariaDB query:

```sql
SELECT person_no, name, reversed_name, first_name, last_name,
       middle, email, institution, country, gender,
       role, is_authorizer, active, heir_no, superuser
FROM person
```

### 6. Updated INSERT/upsert

The INSERT already has placeholders for `email`, `institution`, `gender_id`, and `country_id` — they're just set to NULL/defaults. Change the parameter values to use the mapped values instead. Add `middle` to the ON CONFLICT UPDATE SET clause as well (it's already in the INSERT, but the update needs to reflect the new source value).

## Risks / Trade-offs

- **Country normalization misses** → Mitigation: Log warnings for unmapped values. With only 38 distinct values, the normalization map covers all known cases. New values on future re-runs will be caught by warnings and default to "Unknown".
- **Source `middle` field could conflict with parsed value** → Mitigation: Source field takes unconditional precedence. The parsing logic is heuristic anyway, so the explicit source value is always more reliable.
- **Empty string vs NULL inconsistency in source** → Mitigation: All string fields are trimmed and converted to NULL if empty, ensuring consistent behavior.
