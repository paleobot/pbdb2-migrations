## Context

The MariaDB `person` table (1,304 rows, 10 columns) needs to be migrated into the PostgreSQL `persons` table (14 columns). The schemas differ significantly:

**Source** (MariaDB `person`):
| Column | Type |
|--------|------|
| person_no | int unsigned PK |
| name | varchar(64) — display name, e.g. "J. Alroy" |
| reversed_name | varchar(64) |
| first_name | varchar(30) |
| last_name | varchar(30) |
| role | SET('authorizer','limited','officer','student','technician') |
| is_authorizer | tinyint(1) |
| active | tinyint(1) |
| heir_no | int unsigned — self-ref, 0 = none |
| superuser | tinyint(1) |

**Target** (PostgreSQL `persons`):
| Column | Type |
|--------|------|
| id | integer IDENTITY PK |
| given_name | varchar NOT NULL |
| family_name | varchar NOT NULL |
| middle | varchar |
| email | varchar |
| password | varchar |
| orcid | varchar |
| role_id | integer FK → dictionaries.roles NOT NULL |
| authorizer_person_id | integer FK → persons self-ref NOT NULL |
| gender_id | integer FK → dictionaries.genders NOT NULL |
| country_id | integer FK → dictionaries.countries NOT NULL |
| institution | varchar |
| active | boolean |
| total_hours | numeric |

This is the first migration script and will establish the patterns (project structure, connection handling, .env config) that all subsequent scripts follow.

## Goals / Non-Goals

**Goals:**
- Migrate all 1,304 person records with correct ID preservation
- Establish reusable database connection module and .env configuration pattern
- Map name fields, roles, and booleans accurately
- Handle missing target columns (email, gender, country, etc.) with safe defaults
- Make the script idempotent (safe to re-run)

**Non-Goals:**
- Populating email, password, orcid, or institution from external sources — these will be NULL/defaults
- Migrating the `heir_no` relationship (no target equivalent; dropped)
- Building a general-purpose migration framework — just shared connection config
- Handling the denormalized person name fields on other tables (that's a concern for those table migrations)

## Decisions

### 1. Project structure

```
migrations/
├── .env                  # Connection config (git-ignored)
├── .env.example          # Template with placeholder values (committed)
├── db.js                 # Shared connection pools for both databases
├── migrate-persons.js    # This migration script
├── postgresql/
├── mariadb/
└── ...
```

Migration scripts live at project root, named `migrate-<table>.js`. The shared `db.js` module exports connection pools for both databases.

**Rationale:** Flat structure is simple for a scripts project. Each script is independently runnable. No framework overhead.

### 2. Connection module (`db.js`)

Exports two connection pools initialized from `.env`:
- `mariadb` — a `mysql2/promise` pool (read-only source)
- `pg` — a `pg.Pool` instance (target)

Both pools are created lazily or on import, and expose a `closeAll()` for clean shutdown. Scripts import what they need:

```js
const { mariadb, pg, closeAll } = require('./db');
```

**Rationale:** `mysql2/promise` gives async/await support. `pg.Pool` handles connection pooling natively. Shared module avoids duplicating connection setup across scripts.

### 3. `.env` structure

```
MARIADB_HOST=
MARIADB_PORT=3306
MARIADB_USER=
MARIADB_PASSWORD=
MARIADB_DATABASE=pbdb_archive

PG_HOST=
PG_PORT=5432
PG_USER=
PG_PASSWORD=
PG_DATABASE=
```

**Rationale:** Standard `dotenv` pattern. Prefixed names avoid collision. A `.env.example` is committed as documentation.

### 4. Name field mapping

| Source | Target | Logic |
|--------|--------|-------|
| `first_name` | `given_name` | Direct copy |
| `last_name` | `family_name` | Direct copy |
| `name` | (used to derive `middle`) | Parse: if `name` contains more tokens than first + last, extract the middle portion |
| `reversed_name` | (validation only) | Cross-check but not migrated directly |

For deriving `middle`: compare the `name` field (e.g. "John P. Alroy") against `first_name` + `last_name`. Any tokens in between are the middle name/initial. If `first_name` and `last_name` are empty strings (the default), fall back to parsing `reversed_name` ("Alroy, John P.") or `name`.

**Rationale:** The source has both structured (`first_name`, `last_name`) and display (`name`) fields. The structured fields are the primary source; `name` supplements for middle name extraction.

### 5. Role mapping

Source has a SET column (`role`) plus two booleans (`is_authorizer`, `superuser`). Target has a single `role_id` FK to `dictionaries.roles`:

| dictionaries.roles id | role | Maps from |
|---|---|---|
| 1 | Superadmin | `superuser = 1` |
| 2 | Admin | `role` contains 'officer' |
| 3 | Authorizer | `is_authorizer = 1` (and not superuser/officer) |
| 4 | Enterer | `role` contains 'technician' (and not above) |
| 5 | Student | `role` contains 'student' (and not above) |
| 6 | Person | Default / fallback |

Priority order: Superadmin > Admin > Authorizer > Enterer > Student > Person. A person with multiple SET values gets their highest-privilege role.

**Alternative considered:** Mapping each SET value independently to multiple roles. Rejected because the target schema uses a single `role_id`, not a many-to-many relationship.

### 6. Required NOT NULL columns without source data

| Target Column | Strategy |
|---|---|
| `gender_id` | Default to `dictionaries.genders` id 4 ("Anonymous") |
| `country_id` | Insert an "Unknown" entry into `dictionaries.countries` (abbreviation: 'XX', full_name: 'Unknown') and use its id as the default |
| `authorizer_person_id` | Self-reference for authorizer-level and above; for students/enterers, attempt to derive from the first record they entered, or self-reference as fallback |
| `email` | NULL |
| `password` | NULL |
| `orcid` | NULL |
| `institution` | NULL |
| `total_hours` | NULL |

**Rationale:** These fields are new to the target schema and have no source data. Using recognizable defaults (like "Anonymous" gender) makes it clear the data wasn't available rather than silently inserting incorrect values.

### 7. ID preservation

Use `GENERATED BY DEFAULT AS IDENTITY` — this allows explicit ID insertion. The script will insert `person_no` as `id` directly, preserving the original IDs so all downstream migrations can map `authorizer_no`, `enterer_no`, `modifier_no` without a lookup table.

After migration, reset the identity sequence to `MAX(id) + 1` so new inserts get correct auto-generated IDs.

### 8. Idempotency

Use `INSERT ... ON CONFLICT (id) DO UPDATE SET ...` (upsert) so the script can be safely re-run. This overwrites existing rows with the same ID rather than failing on duplicates.

**Alternative considered:** `DELETE FROM persons` + re-insert. Rejected because it would break FK references from any tables already migrated.

## Risks / Trade-offs

- **Middle name extraction may be imprecise** → Mitigation: Log cases where parsing is ambiguous (e.g. multi-part surnames). With only 1,304 rows, edge cases can be manually reviewed.
- **Role mapping assumes priority hierarchy** → Mitigation: Log the original SET value alongside the mapped role_id for audit. If the mapping is wrong for specific people, it can be corrected post-migration.
- **`country_id` NOT NULL with no source data** → Mitigation: Insert an "Unknown" entry (abbreviation 'XX') into `dictionaries.countries` as part of this migration. All legacy persons get this default.
- **`authorizer_person_id` NOT NULL self-reference creates insert-order dependency** → Mitigation: Insert authorizer-level persons first (self-referencing), then insert students/enterers referencing their authorizer. Or temporarily defer the FK constraint.
- **Identity sequence reset** → Mitigation: Run `SELECT setval()` after all inserts. Low risk since this is a one-time migration.
