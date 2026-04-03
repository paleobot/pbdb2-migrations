## Context

The target PostgreSQL schema uses an entity versioning pattern: each versioned table has `permid` (stable identity), `preceded_by_id`, and `succeeded_by_id` (version chain). When a new version of an entity is inserted, all foreign keys pointing to the old version's `id` must swing to the new version — except the version-chain columns themselves.

Currently there is no automated mechanism for this. The risk is that callers forget to update referencing tables, leaving stale FK references.

Seven tables are currently solidified and use this pattern: `refs`, `timescales`, `intervals`, `collections`, `schemas`, `characters`, `states`.

## Goals / Non-Goals

**Goals:**
- Automatically swing FK references when a new entity version is inserted
- Automatically set `succeeded_by_id` on the old version
- Make the system generic — no hardcoded table/column knowledge beyond the version-chain naming convention
- Keep the mechanism transparent to callers (trigger-based, fires on INSERT)

**Non-Goals:**
- Versioning the `persons` table (not versioned by design)
- Triggers on tables still under design (`authorities`, `opinions`, `taxa`, `occurrences`) — these will be added later when their schemas are finalized
- Handling the `additional_*_refs` join tables as versioned entities (they are not versioned; they just get their FK swung when the parent entity is versioned)
- FK index creation (a separate concern, though recommended for performance)

## Decisions

### 1. Use `pg_constraint` for generic FK discovery

**Decision:** Query PostgreSQL's `pg_constraint` catalog at trigger time to find all FKs referencing the target table.

**Rationale:** This is self-maintaining — when new tables or FK columns are added to the schema, the trigger picks them up automatically without code changes. The alternative (hardcoded FK mappings) would require manual updates every time the schema evolves.

**Trade-off:** Slightly more overhead per trigger execution (catalog query), but this runs once per version insert, not in a hot loop. Correctness and maintainability outweigh the negligible performance cost.

### 2. Exclude version-chain columns by naming convention

**Decision:** Exclude columns named `preceded_by_id` and `succeeded_by_id` from FK swinging.

**Alternatives considered:**
- `COMMENT ON COLUMN` annotations — too opaque; comments are only visible via cryptic psql queries and would be easily missed by future developers
- Dedicated exclusion table/config — more explicit but adds complexity for a problem that doesn't exist yet

**Rationale:** The naming convention is strictly enforced — versioned tables MUST use `preceded_by_id` and `succeeded_by_id` (with the `_id` suffix). The `timescales` and `intervals` tables originally used `preceded_by`/`succeeded_by` (without `_id`); these were renamed for consistency. The trigger's `WHEN` clause and the exclusion filter both depend on this exact naming, so deviations will fail loudly at trigger installation time rather than silently misbehaving.

### 3. Trigger-based, not caller-invoked

**Decision:** Use an `AFTER INSERT` trigger with a `WHEN (NEW.preceded_by_id IS NOT NULL)` guard, rather than requiring callers to explicitly call `swing_fks_to_new_version()`.

**Rationale:** A trigger makes it impossible to forget. The guard ensures the trigger only fires for version inserts (where `preceded_by_id` is set), not for initial entity creation. The trade-off is less explicit control, but for this use case, "always happens automatically" is the correct behavior.

### 4. Three-function architecture

**Decision:** Split into three functions:
- `swing_fks_to_new_version(target_table, old_id, new_id)` — the core FK-swinging logic
- `handle_new_version()` — trigger function that orchestrates: calls swing, sets `succeeded_by_id`
- `install_version_trigger(target_table)` — convenience function to install the trigger

**Rationale:** Separation of concerns. `swing_fks_to_new_version` is independently callable for testing or manual use. `handle_new_version` encapsulates the full version-transition workflow. `install_version_trigger` eliminates boilerplate.

### 5. Functions defined after dictionaries, triggers installed inline

**Decision:** Define all three functions after the dictionary tables but before `persons`. Each `SELECT install_version_trigger(...)` call goes immediately after its table's `CREATE TABLE` statement.

**Rationale:** Functions must exist before they're referenced. Placing trigger installations inline makes the relationship between table and trigger visually obvious and ensures triggers are installed in table-creation order.

## Risks / Trade-offs

- **[Naming convention drift]** → If a future table uses different names for version-chain columns (e.g., `preceded_by` without `_id`), `install_version_trigger` will fail at schema creation time because the `WHEN (NEW.preceded_by_id IS NOT NULL)` clause references a column that doesn't exist. This is by design — it fails loudly rather than silently misbehaving. **Mitigation:** The `_id` suffix is a hard requirement, not a soft convention. The `timescales` and `intervals` tables were renamed during this change to comply.
- **[Self-referential FKs]** → Tables like `characters.parent_character_id → characters.id` are self-referencing. The trigger handles these correctly — a child character pointing to the old parent gets swung to the new parent. No special handling needed.
- **[Missing FK indexes]** → PostgreSQL does not auto-create indexes on FK columns. The UPDATE statements in `swing_fks_to_new_version` will do sequential scans without them. **Mitigation:** This is a pre-existing concern not specific to this change, but FK indexes should be added as a separate task.
- **[Trigger ordering]** → If multiple triggers exist on the same table, execution order is alphabetical by trigger name. Currently there are no other triggers, so this is not an issue, but worth noting for future additions.
