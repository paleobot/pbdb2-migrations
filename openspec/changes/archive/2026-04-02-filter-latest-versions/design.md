## Context

The `SCHEMA_QUERY` in `play/server.js` uses recursive CTEs to build a full schema tree (schema + characters + states). Each entity table has `preceded_by_id`/`succeeded_by_id` columns for version lineage, but the query currently has no version filtering. With only one version per entity (from the initial migration), this works by accident. It will break when edits create new versions.

## Goals / Non-Goals

**Goals:**
- Ensure the schema query always returns the latest version of each entity
- Make the fix minimal and non-breaking for the current single-version data

**Non-Goals:**
- Implementing the update/versioning workflow itself (future work)
- Adding version filtering to refs joins (assumes Option A: FKs always point to latest version)
- Indexing `succeeded_by_id` columns (premature until update traffic exists)

## Decisions

**Filter on `succeeded_by_id IS NULL` rather than `preceded_by_id IS NULL` or MAX(id)**

The latest version is defined as the record with no successor. This is O(1) per row (simple NULL check) and doesn't require a subquery or window function. Alternatives considered:
- `MAX(id) ... GROUP BY permid` — requires a subquery per CTE, more complex
- `preceded_by_id IS NOT NULL` for "not the first" — doesn't identify the latest, just non-originals

**Apply filter only to base cases of recursive CTEs, not recursive steps**

The recursive steps walk parent→child structure (`parent_character_id`, `parent_state_id`), not version chains. Under Option A (all FKs updated when a new version is created), structural FKs always reference the latest version, so recursive steps naturally only encounter latest-version records.

**No changes to refs joins**

`schemas.reference_id` and `additional_schema_refs.reference_id` join to `refs.id`. Under Option A, these FKs will point to the latest ref version. No additional filtering needed.

## Risks / Trade-offs

**[Risk] Option A not yet implemented** — The versioning strategy (update all FKs on new version) is assumed but not built. If the eventual implementation uses a different strategy, the recursive CTE logic may need revisiting. → Mitigation: This filter is correct regardless of strategy; only the recursive-case assumption depends on Option A.

**[Risk] `succeeded_by_id IS NULL` matches both "latest version" and "only version"** — This is correct behavior, not a bug. Current data (all NULL) returns identical results. → No mitigation needed.
