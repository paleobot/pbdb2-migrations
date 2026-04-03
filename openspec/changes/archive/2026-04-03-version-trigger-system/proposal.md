## Why

When a versioned entity (e.g., a schema or collection) gets a new version, all foreign keys pointing to the old version's `id` must be updated to point to the new version's `id`. Without an automated mechanism, this is error-prone — every caller must remember which tables reference which, and forgetting one silently leaves stale references. A generic, trigger-based system that uses PostgreSQL's `pg_constraint` catalog makes this self-maintaining as the schema evolves.

See: [paleobot/pbdb2-dev#9](https://github.com/paleobot/pbdb2-dev/issues/9)

## What Changes

- Add a `swing_fks_to_new_version()` function that queries `pg_constraint` to find all foreign keys referencing a given table and updates them from old id to new id, excluding version-chain columns (`preceded_by_id`, `succeeded_by_id`) by naming convention
- Add a `handle_new_version()` trigger function that calls `swing_fks_to_new_version()` and sets `succeeded_by_id` on the old version row
- Add an `install_version_trigger()` helper that installs the trigger on any table
- Install triggers on the seven currently-solidified versioned tables: `refs`, `timescales`, `intervals`, `collections`, `schemas`, `characters`, `states`
- Each `install_version_trigger()` call is placed immediately after its corresponding `CREATE TABLE` statement
- Rename `timescales.preceded_by`/`succeeded_by` and `intervals.preceded_by`/`succeeded_by` to `preceded_by_id`/`succeeded_by_id` — the `_id` suffix is a hard requirement for the trigger system

## Capabilities

### New Capabilities
- `entity-versioning-triggers`: Generic trigger system that automatically swings foreign key references and maintains version chains when new entity versions are inserted into versioned tables

### Modified Capabilities

## Impact

- **postgresql/create_new.sql**: Three new functions added after dictionary tables, seven `SELECT install_version_trigger(...)` calls added after their respective table definitions
- No migration script changes — this is target schema infrastructure
- No API changes — triggers fire transparently on INSERT
- Tables affected: `refs`, `timescales`, `intervals`, `collections`, `schemas`, `characters`, `states`, plus any table that references them via FK
