## Why

The schema API endpoint in `play/server.js` reads character and state `order` from the JSONB payload (`character->>'order'`, `state->>'order'`), but this field has been moved to the `sort_order` column. The query returns stale/null order values and the response still exposes `order` as a field, which is no longer part of the payload schema.

## What Changes

- Update the SQL query in `play/server.js` to use the `sort_order` column instead of the JSONB `order` field for sorting characters and states
- Remove `order` from the `json_build_object` output for characters and states (no longer displayed)
- Update the `buildSchemaTree` JS sort to use the column-sourced sort order instead of the JSONB `order` property

## Capabilities

### New Capabilities

_(none)_

### Modified Capabilities

_(none — this is a server query fix in the play directory, no spec-level behavior changes)_

## Impact

- **Code**: `play/server.js` — `SCHEMA_QUERY` SQL and `buildSchemaTree` function
- **API response**: Characters and states will no longer include an `order` field; they will be correctly sorted by the `sort_order` column
