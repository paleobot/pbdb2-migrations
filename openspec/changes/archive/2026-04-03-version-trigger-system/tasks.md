## 1. Define versioning functions

- [x] 1.1 Add `swing_fks_to_new_version(target_table text, old_id integer, new_id integer)` function to `create_new.sql` — queries `pg_constraint`, excludes `preceded_by_id`/`succeeded_by_id`, executes UPDATE for each discovered FK
- [x] 1.2 Add `handle_new_version()` trigger function to `create_new.sql` — calls `swing_fks_to_new_version` using `TG_TABLE_NAME` and `NEW.preceded_by_id`, then sets `succeeded_by_id` on the old row
- [x] 1.3 Add `install_version_trigger(target_table text)` function to `create_new.sql` — creates an `AFTER INSERT ... WHEN (NEW.preceded_by_id IS NOT NULL)` trigger on the given table

All three functions go after the last dictionary table and before the `persons` table definition.

## 2. Install triggers on versioned tables

- [x] 2.1 Add `SELECT install_version_trigger('refs');` after `CREATE TABLE refs`
- [x] 2.2 Add `SELECT install_version_trigger('timescales');` after `CREATE TABLE timescales`
- [x] 2.3 Add `SELECT install_version_trigger('intervals');` after `CREATE TABLE intervals`
- [x] 2.4 Add `SELECT install_version_trigger('collections');` after `CREATE TABLE collections`
- [x] 2.5 Add `SELECT install_version_trigger('schemas');` after `CREATE TABLE schemas`
- [x] 2.6 Add `SELECT install_version_trigger('characters');` after `CREATE TABLE characters`
- [x] 2.7 Add `SELECT install_version_trigger('states');` after `CREATE TABLE states`
