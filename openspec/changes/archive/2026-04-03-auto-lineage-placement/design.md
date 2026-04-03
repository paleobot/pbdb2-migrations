## Context

The entity versioning trigger system (from `version-trigger-system` change) currently requires callers to explicitly set `preceded_by_id` on INSERT. An AFTER INSERT trigger then swings FK references and sets `succeeded_by_id` on the old version. This works, but places the burden of lineage placement on the caller.

The existing trigger infrastructure in `create_new.sql` consists of:
- `swing_fks_to_new_version()` — generic FK swinging via `pg_constraint`
- `handle_new_version()` — AFTER INSERT trigger function
- `install_version_trigger()` — helper to install the trigger on a table

## Goals / Non-Goals

**Goals:**
- Automatically determine lineage placement on INSERT using `permid` lookup
- Always overwrite caller-provided `preceded_by_id` and `succeeded_by_id`
- Detect and raise an error on corrupted lineages (multiple heads for same `permid`)
- Keep the mechanism generic — no hardcoded table knowledge
- Rename `install_version_trigger` → `install_version_triggers` to reflect it now installs two triggers

**Non-Goals:**
- Fixing the `permid` type inconsistency (`text` vs `integer` across tables) — separate concern
- Lineage repair tooling for corrupted data
- Versioning `persons` or tables still under design

## Decisions

### 1. BEFORE INSERT trigger for lineage placement

**Decision:** Add a BEFORE INSERT trigger that runs before the existing AFTER INSERT trigger. The BEFORE trigger finds the current lineage head (matching `permid`, `succeeded_by_id IS NULL`) and sets `NEW.preceded_by_id` accordingly. It also forces `NEW.succeeded_by_id = NULL`.

**Rationale:** BEFORE triggers can modify `NEW`, which is exactly what we need. The AFTER trigger's `WHEN (NEW.preceded_by_id IS NOT NULL)` guard still works correctly because it sees the values set by the BEFORE trigger.

**Alternatives considered:**
- Modifying the AFTER trigger to do both jobs — not possible; AFTER triggers cannot modify the inserted row
- Application-level logic — defeats the purpose; we want the database to enforce this

### 2. Always overwrite caller-provided values

**Decision:** The BEFORE trigger unconditionally overwrites `preceded_by_id` and sets `succeeded_by_id = NULL`, regardless of what the caller provides.

**Rationale:** The whole point is to prevent manual errors. If callers could override, we'd still have the same class of bugs. The database is the single source of truth for lineage placement.

### 3. Raise error on corrupted lineage

**Decision:** If the query finds more than one row with matching `permid` and `succeeded_by_id IS NULL`, raise an exception.

**Rationale:** Multiple heads for the same `permid` indicates data corruption. Silently picking one would mask the problem. Failing loudly forces investigation and repair.

### 4. Dynamic table reference via TG_TABLE_NAME

**Decision:** The BEFORE trigger function uses `TG_TABLE_NAME` and dynamic SQL to query the same table, identical to how `handle_new_version()` works.

**Rationale:** Keeps the function generic — one function definition works for all versioned tables.

### 5. Rename install_version_trigger → install_version_triggers

**Decision:** Rename to plural since it now installs two triggers (BEFORE and AFTER).

**Rationale:** Naming accuracy. The function installs a pair of triggers that work together.

## Risks / Trade-offs

- **[BEFORE trigger performance]** → Adds one SELECT query per INSERT to find the lineage head. This is a single indexed lookup on `(permid, succeeded_by_id)` and is negligible. A composite index would help but is not required at current scale.
- **[Trigger execution order]** → PostgreSQL fires triggers of the same type in alphabetical order by trigger name. The BEFORE trigger must fire before the AFTER trigger, which is guaranteed since they are different types (BEFORE vs AFTER). No naming concern.
- **[Migration scripts]** → Existing migration scripts that set `preceded_by_id` explicitly will still work — the value will just be overwritten. No migration script changes needed.
