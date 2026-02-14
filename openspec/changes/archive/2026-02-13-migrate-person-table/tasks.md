## 1. Project Setup

- [x] 1.1 Install `dotenv` package: `npm install dotenv`
- [x] 1.2 Create `.env.example` with all connection variables (MARIADB_HOST, MARIADB_PORT, MARIADB_USER, MARIADB_PASSWORD, MARIADB_DATABASE, PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE) and default values for ports and MARIADB_DATABASE
- [x] 1.3 Create `.env` from `.env.example` and populate with actual connection values
- [x] 1.4 Add `.env` to `.gitignore`

## 2. Shared Connection Module

- [x] 2.1 Create `db.js` that loads `.env` via `dotenv`, validates required variables are present (exit with clear error if missing), and exports `mariadb` (mysql2/promise pool), `pg` (pg.Pool), and `closeAll()` function
- [x] 2.2 Verify `db.js` connects to both databases by running a simple test query against each (e.g. `SELECT 1`)

## 3. Person Migration Script — Setup and Source Read

- [x] 3.1 Create `migrate-persons.js` that imports `{ mariadb, pg, closeAll }` from `./db` and wraps everything in an async main with try/catch/finally calling `closeAll()`
- [x] 3.2 Add source query: `SELECT person_no, name, reversed_name, first_name, last_name, role, is_authorizer, active, heir_no, superuser FROM person` — log the count of rows read

## 4. Person Migration Script — Dictionary Lookups

- [x] 4.1 Insert "Unknown" country into `dictionaries.countries` (abbreviation `'XX'`, full_name `'Unknown'`) using `INSERT ... ON CONFLICT DO NOTHING` or equivalent, then query back its `id`
- [x] 4.2 Query the `id` for "Anonymous" from `dictionaries.genders` (expected id 4)
- [x] 4.3 Query the full `dictionaries.roles` table to build a role name → id lookup map for verification

## 5. Person Migration Script — Transform Logic

- [x] 5.1 Implement name mapping function: `first_name` → `given_name`, `last_name` → `family_name`. Derive `middle` by extracting tokens from `name` that are not `first_name` or `last_name`. Fall back to parsing `reversed_name` or `name` when `first_name`/`last_name` are empty. Log warnings for ambiguous cases.
- [x] 5.2 Implement role mapping function: check `superuser` → role_id 1, `role` contains 'officer' → 2, `is_authorizer` → 3, `role` contains 'technician' → 4, `role` contains 'student' → 5, fallback → 6. Log the original role SET value alongside the mapped role_id for each person.
- [x] 5.3 Implement active mapping: convert tinyint 0/1 to boolean false/true
- [x] 5.4 Set `authorizer_person_id` to the person's own `id` for all rows (self-reference fallback since source lacks authorizer assignments)
- [x] 5.5 Set default values: `gender_id` → Anonymous id, `country_id` → Unknown id, `email`/`password`/`orcid`/`institution`/`total_hours` → NULL

## 6. Person Migration Script — Upsert and Finalize

- [x] 6.1 Implement upsert using `INSERT INTO persons (id, given_name, family_name, middle, email, password, orcid, role_id, authorizer_person_id, gender_id, country_id, institution, active, total_hours) VALUES (...) ON CONFLICT (id) DO UPDATE SET ...` for each transformed row
- [x] 6.2 Reset the `persons` identity sequence after all inserts: `SELECT setval(pg_get_serial_sequence('persons', 'id'), (SELECT MAX(id) FROM persons))`
- [x] 6.3 Add row count verification: query `SELECT COUNT(*) FROM persons`, compare to source count, log success or warning

## 7. Verification

- [x] 7.1 Run the migration script against the actual databases and confirm it completes without errors
- [x] 7.2 Verify row count: 1,304 rows in PostgreSQL `persons`
- [x] 7.3 Spot-check a few records: confirm name fields, role mappings, and defaults are correct
- [x] 7.4 Run the script a second time to confirm idempotency (same row count, no errors)
