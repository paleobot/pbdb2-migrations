## 1. Add BEFORE INSERT trigger function

- [x] 1.1 Add `place_in_lineage()` BEFORE INSERT trigger function to `create_new.sql` — queries `TG_TABLE_NAME` for existing rows with matching `permid` and `succeeded_by_id IS NULL`, sets `NEW.preceded_by_id` to the head's `id` (or NULL if new lineage), forces `NEW.succeeded_by_id = NULL`, raises error if multiple heads found

## 2. Update install helper

- [x] 2.1 Rename `install_version_trigger` to `install_version_triggers` (plural) in function definition
- [x] 2.2 Add BEFORE INSERT trigger installation to `install_version_triggers` — installs `place_in_lineage()` trigger alongside existing AFTER INSERT trigger
- [x] 2.3 Update all 7 call sites from `install_version_trigger` to `install_version_triggers`
