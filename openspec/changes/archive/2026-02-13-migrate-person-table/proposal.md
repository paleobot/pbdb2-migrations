## Why

The `person` table is the foundational entity in PBDB — every data-entry table references it via `authorizer_no`, `enterer_no`, and `modifier_no`. It must be migrated first before any other table can be populated in the new PostgreSQL database. The source and target schemas differ significantly in name handling, role representation, and the addition of new columns (email, orcid, gender, country, institution), so a mapping script is needed rather than a direct copy.

## What Changes

- Create a Node.js migration script that reads from MariaDB `person` (1,304 rows) and writes to PostgreSQL `persons`
- Map legacy name fields (`name`, `reversed_name`, `first_name`, `last_name`) to the new structure (`given_name`, `family_name`, `middle`)
- Map legacy role representation (SET column + `is_authorizer`/`superuser` booleans) to the new `role_id` FK against `dictionaries.roles`
- Map `heir_no` (0-as-NULL self-reference) — determine if this concept carries forward or is dropped
- Handle columns that exist in the target but not the source (`email`, `password`, `orcid`, `gender_id`, `country_id`, `institution`, `total_hours`) with sensible defaults or NULLs
- Map `person_no` → `id`, preserving original IDs for FK consistency with subsequent table migrations
- Map `active` from tinyint(1) to boolean
- Parameterize MariaDB and PostgreSQL connection info via a `.env` file
- Set up shared database connection utilities for reuse by future migration scripts

## Capabilities

### New Capabilities
- `person-migration`: Script to extract person records from MariaDB, transform column mappings, and load into PostgreSQL `persons` table
- `db-connection-config`: Shared `.env`-based configuration and connection pooling for both MariaDB and PostgreSQL, reusable across all migration scripts

### Modified Capabilities

_(none — no existing specs)_

## Impact

- **Source table**: MariaDB `person` (1,304 rows, 10 columns)
- **Target table**: PostgreSQL `persons` (14 columns)
- **Column mapping complexity**:
  - `first_name` → `given_name`, `last_name` → `family_name` (direct rename)
  - `name` / `reversed_name` — may be needed to derive `middle` or validate given/family split
  - `role` SET + `is_authorizer` + `superuser` → single `role_id` FK (requires mapping logic against `dictionaries.roles`)
  - `heir_no` — no target column equivalent; may need to be dropped or handled separately
  - `gender_id`, `country_id` — required NOT NULL in target but absent from source; need a default strategy
- **Dependencies**: `dictionaries.roles`, `dictionaries.genders`, and `dictionaries.countries` must be seeded in PostgreSQL before this migration runs
- **Downstream impact**: All subsequent migrations (refs, authorities, collections, occurrences, opinions) depend on `persons.id` being populated with the correct legacy `person_no` values
- **New files**: `.env` (git-ignored), `db.js` or similar connection module, `migrate-persons.js` script
- **New dependencies**: `dotenv` npm package
