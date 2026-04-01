## Why

The `sort_order` column was added to the `characters` and `states` PostgreSQL tables, and the `order` property was removed from their JSONB payload schemas. However, the PBot schema migration script (`migrate-pbot-schemas.js`) still writes `order` into the JSONB payloads and does not populate the new `sort_order` column — so migrated data loses ordering information silently.

## What Changes

- Remove `order` from the JSONB builders (`buildCharacterJsonb`, `buildStateJsonb`) in `migrate-pbot-schemas.js`
- Extract the PBot `order` value and pass it as the `sort_order` column in the character and state INSERT statements

## Capabilities

### New Capabilities

_(none — this is a fix to an existing migration script)_

### Modified Capabilities

- `pbot-schema-character-state-migration`: The migration must populate the `sort_order` column from PBot's `order` field instead of embedding it in the JSONB payload.

## Impact

- **Code**: `migrate-pbot-schemas.js` — `buildCharacterJsonb`, `buildStateJsonb`, and their corresponding INSERT queries
- **Data**: Characters and states will have `sort_order` populated correctly; JSONB payloads will no longer contain the `order` field
- **Validation**: JSONB payloads will conform to the payload schemas (`character.schema.js`, `state.schema.js`), which have `order` commented out and `unevaluatedProperties: false`
