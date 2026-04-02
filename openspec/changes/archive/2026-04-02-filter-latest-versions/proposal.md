## Why

The schema query in `play/server.js` does not filter by version. All main tables (schemas, characters, states) use `preceded_by_id`/`succeeded_by_id` columns to track version lineage, where each entity's `permid` stays constant across versions. Currently there is only one version per entity (initial migration), but the query needs to be future-proof: when edits create new versions, it must return only the latest version of each entity (`succeeded_by_id IS NULL`).

## What Changes

- Add `AND s.succeeded_by_id IS NULL` to the `target_schema` CTE in `SCHEMA_QUERY` so only the latest schema version is selected
- Add `AND c.succeeded_by_id IS NULL` to the `char_tree` base case so only the latest character versions are walked
- Add `AND s.succeeded_by_id IS NULL` to the `state_tree` base case so only the latest state versions are walked
- Recursive cases (parent-child hierarchy traversal) are unchanged -- under the assumed versioning strategy (Option A: update all FKs when a new version is created), structural FKs always point to the latest version

## Capabilities

### New Capabilities

_(none)_

### Modified Capabilities

_(none -- this is a query-only change in `play/server.js`, no spec-level behavior changes)_

## Impact

- **Code**: `play/server.js` -- `SCHEMA_QUERY` constant (3 lines added)
- **Tables involved**: `schemas`, `characters`, `states` (all in `public` schema)
- **Risk**: Low. The filter is additive (`AND` clause) and currently a no-op since all `succeeded_by_id` values are NULL in the initial migration. No data transformation or schema changes required.
