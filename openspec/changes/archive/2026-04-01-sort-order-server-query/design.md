## Context

`play/server.js` serves a schema API endpoint that builds a nested tree of schema → characters → states. The SQL query uses recursive CTEs (`char_tree`, `state_tree`) and assembles character/state JSON arrays with `json_build_object`. Currently it reads `order` from the JSONB (`ct.character->>'order'`) for both display and sorting. After the sort-order-column-migration, `order` no longer exists in the JSONB — it's now the `sort_order` column on `characters` and `states`.

## Goals / Non-Goals

**Goals:**
- Use `sort_order` column for SQL `ORDER BY` in character and state aggregations
- Use `sort_order` column for JS-side sorting in `buildSchemaTree`
- Stop including `order` in the API response JSON

**Non-Goals:**
- Changing the recursive CTE structure or any other query logic
- Adding `sort_order` to the API response (user wants it used for sorting only, not displayed)

## Decisions

### Fetch sort_order in CTEs, use for ordering, exclude from response
The `char_tree` and `state_tree` CTEs need to SELECT `sort_order` so it's available for the `ORDER BY` clause and for JS-side sorting. However, it should not appear in the `json_build_object` output. The JS `buildSchemaTree` function will read `sortOrder` (from a non-displayed SQL alias) to sort children correctly, then the property can be stripped or simply not included in the final tree output.

Approach: include `sort_order` as `"sortOrder"` in the `json_build_object` so it's available to `buildSchemaTree` for sorting, but the tree builder already controls final output shape — it just needs to use `sortOrder` instead of `order` in its sort comparator.

### Minimal query changes
Only touch the lines that reference `character->>'order'` and `state->>'order'`. The CTE structure, joins, and all other fields remain unchanged.

## Risks / Trade-offs

**[No risk]** — This is a straightforward field rename from JSONB extraction to column reference. The column already exists and is populated by the migration.
