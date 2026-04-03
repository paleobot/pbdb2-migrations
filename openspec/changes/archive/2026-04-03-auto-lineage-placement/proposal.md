## Why

The current versioning trigger system requires callers to explicitly provide `preceded_by_id` on INSERT. This is error-prone: forgetting it orphans the record from its lineage, and providing the wrong value can splice into or corrupt an unrelated lineage. Since the database already has `permid` to identify lineages and `succeeded_by_id IS NULL` to identify the current head, the system should automatically determine lineage placement on every insert.

See: [paleobot/pbdb2-dev#9](https://github.com/paleobot/pbdb2-dev/issues/9)

## What Changes

- Add a BEFORE INSERT trigger function that automatically sets `preceded_by_id` by finding the current head of the lineage (matching `permid`, `succeeded_by_id IS NULL`), overwriting any caller-provided value
- The BEFORE trigger also clears any caller-provided `succeeded_by_id` (always set to NULL on insert — the AFTER trigger on the *next* version will set it)
- If no existing records share the `permid`, `preceded_by_id` stays NULL (new lineage — AFTER trigger won't fire)
- If multiple heads are found for the same `permid` (corrupted lineage), raise an error
- **BREAKING**: Rename `install_version_trigger` to `install_version_triggers` (plural) — it now installs both BEFORE and AFTER triggers
- Extend `install_version_triggers` to install the new BEFORE trigger alongside the existing AFTER trigger

## Capabilities

### New Capabilities

### Modified Capabilities
- `entity-versioning-triggers`: Adding automatic lineage placement via BEFORE INSERT trigger; callers no longer provide `preceded_by_id` or `succeeded_by_id`

## Impact

- **postgresql/create_new.sql**: New BEFORE INSERT trigger function, renamed `install_version_trigger` → `install_version_triggers`, updated all 7 call sites
- No migration script changes — this is target schema infrastructure
- **API callers**: No longer need to provide `preceded_by_id` or `succeeded_by_id` on insert — any provided values are overwritten. This simplifies the API contract.
