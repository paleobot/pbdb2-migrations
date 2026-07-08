## Context

Each versioned table has two identifiers: `permid uuid` (stable across versions, the external identity) and `id` (unique per version row, the surrogate key that every FK targets and that the version triggers "swing"). This change widens `id` — not `permid` — from `integer` to `bigint`. The `permid uuid` decision stands.

## Decisions

### Keys move together, or the FK cap defeats the purpose

PostgreSQL permits a foreign key where the child column is `integer` and the parent PK is `bigint` (both are integer types with a cross-type equality operator). But such a child column still caps at 2^31, so it cannot address the high rows the widening is meant to protect. Therefore every FK column that references a widened `id` must widen with it. The PK and all its referencing columns are one atomic unit.

### Scope: only solidified, in-flux tables excluded

In scope: `refs`, `collections`, `schemas`, `characters`, `states`, `authorities` (+ child tables `additional_collection_refs`, `additional_schema_refs`).

Explicitly excluded because their design is still in flux: `timescales`, `intervals`, `taxa`, `rank_opinions`, `assignment_opinions`, `rename_opinions`, `homonyms`, `occurrences`. Widening them now would be churn against tables that are about to change shape anyway.

### Interim heterogeneous FKs are acceptable

Excluding some tables leaves a few integer→bigint foreign keys, where an excluded table references a widened one:

- `timescales.reference_id`, `intervals.reference_id` → `refs.id`
- `occurrences.reference_id` → `refs.id`; `occurrences.collection_id` → `collections.id`
- taxa-cluster `reference_id` / `authority_id` → `refs.id` / `authorities.id`

These create and validate fine. The only limitation is that the child (integer) column cannot store a parent id above 2^31. That is not reachable in the near term, and each is resolved when its table is solidified and widened. The FK-swing trigger updates these columns too; a swung value above 2^31 would raise a range error — again, not near-term reachable, and gone once the tables widen.

### `persons` and `dictionaries.*` stay integer

These are non-versioned and bounded (people; enumerations). They consume one id per entity, not per edit, and will never approach `integer` exhaustion. Keeping them `integer` means their referencing columns (`authorizer_person_id`, `enterer_person_id`, `role_id`, `reference_type_id`, etc.) also stay `integer` — no change and no mismatch.

### No in-place ALTER; rebuild and re-migrate

`refs`, `collections`, and `authorities` already hold migrated data, but all three are slated to re-run in the combined taxa pass. Since in-place widening would require dropping and recreating every FK constraint across the graph, the clean path is to make the edits in `create_new.sql`, rebuild the schema, and re-migrate. The identity sequences restart as `bigint`.

### node-postgres returns `int8` as string

The `pg` driver returns `bigint` (int8) columns as JavaScript **strings** (to avoid precision loss beyond `Number.MAX_SAFE_INTEGER`), whereas `integer` (int4) comes back as a `number`. The migration scripts pass `RETURNING id` values back into subsequent inserts as opaque handles (e.g. `refMap`, `collectionMeta`), which is safe — a string bound to a `bigint` parameter round-trips correctly. The risk is only if any code does arithmetic on an id or a strict `===` number comparison. Task 3.3 audits the in-scope scripts for this before the re-migration. No script change is bundled into this change.

## Risks / Trade-offs

- **Heterogeneous FKs during the interim** (mitigated above; bounded by 2^31, resolved on solidification).
- **String-typed ids in JS** (mitigated by task 3.3; ids are opaque handles today).

## Migration Plan

Edits are to `postgresql/create_new.sql` only; applied on the next schema rebuild + combined re-migration. No standalone data migration.
