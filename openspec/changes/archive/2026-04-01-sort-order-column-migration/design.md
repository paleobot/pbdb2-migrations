## Context

The `characters` and `states` tables in `create_new.sql` now have a `sort_order integer` column. The payload schemas (`character.schema.js`, `state.schema.js`) have the `order` property commented out and use `unevaluatedProperties: false`, meaning any `order` key in the JSONB would fail validation.

The migration script `migrate-pbot-schemas.js` currently puts the PBot `order` value into the JSONB payload and does not populate the `sort_order` column.

## Goals / Non-Goals

**Goals:**
- Route PBot's `order` field into the `sort_order` column on `characters` and `states`
- Remove `order` from the character and state JSONB payloads so they conform to the payload schemas

**Non-Goals:**
- Adding a NOT NULL constraint on `sort_order` (may revisit later)
- Changing the DDL or payload schemas (already correct)
- Modifying the GraphQL queries (still need to fetch `order`)

## Decisions

### Extract order from JSONB builders, pass as separate value
The `buildCharacterJsonb` and `buildStateJsonb` functions currently parse and embed `order` in the returned JSONB object. Instead, these functions should stop including `order` in the JSONB. The `order` value should be parsed to an integer at the call site and passed directly to the INSERT query as the `sort_order` parameter.

**Alternative considered:** Have the builder return a tuple `{ jsonb, sortOrder }`. Rejected as unnecessary indirection for a simple extraction — cleaner to just handle it inline at the call site.

### Keep GraphQL queries unchanged
The Character and State GraphQL queries already fetch `order`. No changes needed there — the field is still the source of truth, it just gets routed to a different destination.

## Risks / Trade-offs

**[Null order values]** → PBot characters/states may have `order = null`. The column is nullable, so these will insert as `NULL`. This is acceptable per the decision to leave `sort_order` nullable for now.
