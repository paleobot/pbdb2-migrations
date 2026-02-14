## Why

The `reference.schema.js` payload schema was updated to use `familyName` instead of `surname` in the authors array items. The migration script `migrate-refs.js` still outputs `surname` in the jsonb `authors` array, creating a mismatch with the API schema.

## What Changes

- In `migrate-refs.js`, rename the `surname` key to `familyName` in all author objects built by `buildAuthors()`
- This affects 6 occurrences in the function where `{ surname: ... }` is constructed

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `refs-migration`: The author assembly requirement must specify `familyName` instead of `surname` in the authors array schema

## Impact

- **Modified file**: `migrate-refs.js` — rename `surname` → `familyName` in `buildAuthors()` return objects
- **Data impact**: All 93,705 references will have their jsonb `authors` array updated on next migration run (key rename only, values unchanged)
- **Downstream**: Aligns migration output with the API validation schema in `reference.schema.js`
- **No new dependencies**
