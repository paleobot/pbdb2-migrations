## Context

The `buildAuthors()` function in `migrate-refs.js` constructs author objects as `{ surname, givenName }`. The API schema in `reference.schema.js` now expects `{ familyName, givenName }`.

## Goals / Non-Goals

**Goals:**
- Rename `surname` → `familyName` in all author object literals in `buildAuthors()`

**Non-Goals:**
- Changing any author mapping logic or data values
- Updating `reference.schema.js` (already done by user)

## Decisions

### 1. Simple key rename

Use `replace_all` to rename `surname` to `familyName` in the 6 object literals within `buildAuthors()`. No logic changes needed — only the property name changes.

## Risks / Trade-offs

- **Re-run required**: Existing jsonb data in PostgreSQL still has `surname`. The migration must be re-run to update the stored jsonb. The script is idempotent, so this is safe.
