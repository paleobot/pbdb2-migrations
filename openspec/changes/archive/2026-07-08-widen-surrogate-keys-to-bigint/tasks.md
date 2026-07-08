## 1. Widen surrogate keys in create_new.sql

- [x] 1.1 `refs`: `id` → `bigint`; `preceded_by_id`, `succeeded_by_id` → `bigint`
- [x] 1.2 `collections`: `id`, `reference_id`, `preceded_by_id`, `succeeded_by_id` → `bigint` (leave `early_age_id`/`late_age_id` as `integer` — `intervals` out of scope)
- [x] 1.3 `additional_collection_refs`: `collection_id`, `reference_id` → `bigint` (own `id` stays `integer`)
- [x] 1.4 `schemas`: `id`, `reference_id`, `preceded_by_id`, `succeeded_by_id` → `bigint`
- [x] 1.5 `additional_schema_refs`: `schema_id`, `reference_id` → `bigint` (own `id` stays `integer`)
- [x] 1.6 `characters`: `id`, `parent_schema_id`, `parent_character_id`, `preceded_by_id`, `succeeded_by_id` → `bigint`
- [x] 1.7 `states`: `id`, `parent_character_id`, `parent_state_id`, `preceded_by_id`, `succeeded_by_id` → `bigint`
- [x] 1.8 `authorities`: `id`, `reference_id`, `preceded_by_id`, `succeeded_by_id` → `bigint`

## 2. Update trigger helper functions in create_new.sql

- [x] 2.1 `swing_fks_to_new_version`: change parameters `old_id integer, new_id integer` → `old_id bigint, new_id bigint`
- [x] 2.2 `place_in_lineage`: change the `head_id integer` declaration → `head_id bigint`

## 3. Verify

- [x] 3.1 Rebuild the schema from `create_new.sql` on a scratch DB; confirm all tables create, all triggers install, and there are no FK type errors
- [x] 3.2 Confirm the interim integer→bigint FKs on excluded tables (e.g. `timescales.reference_id`, `occurrences.collection_id`) still create without error
- [x] 3.3 Audit the `refs`, `collections`, and `authorities` migration scripts for id handling under `int8`: node-postgres returns `bigint` as a string — verify ids are treated as opaque (no arithmetic, no `===` number comparisons) before the combined re-migration
