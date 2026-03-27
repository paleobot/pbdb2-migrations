## Why

Both reference migration scripts have incorrect or missing field mappings for comments/notes/description and legacy IDs. PBDB's `comments` column is never migrated. PBot's `notes` field is ignored and `description` maps to the now-removed `notes` jsonb field. Both scripts store legacy IDs (`oldpbdbID`, `pbotID`) as top-level jsonb properties instead of nesting them under `legacyIDs` as the schema requires. Additionally, the PBot refs script resolves enterers by name when it could now use the more reliable `legacyIDs.pbotID` path in the persons table.

## What Changes

- **migrate-refs.js**: Add `comments` to the MariaDB SELECT query and map it to `jsonb.comments`. Nest `oldpbdbID` under `jsonb.legacyIDs` instead of top-level. Update target table name from `"references"` to `refs`.
- **migrate-pbot-refs.js**: Map PBot `notes` → `jsonb.comments`. Change PBot `description` mapping from `jsonb.notes` to `jsonb.description`. Nest `pbotID` under `jsonb.legacyIDs` instead of top-level. Replace name-based enterer lookup with `person->'legacyIDs'->>'pbotID'` lookup. Update target table name from `"references"` to `refs`.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `refs-migration`: Add `comments` column to source query and jsonb mapping. Nest `oldpbdbID` under `legacyIDs` object.
- `pbot-refs-migration`: Fix `notes`/`description` field mapping. Nest `pbotID` under `legacyIDs`. Replace name-based enterer lookup with `legacyIDs.pbotID` lookup.

## Impact

- **migrate-refs.js**: Modified source query (adds one column), modified `buildJsonb` function (adds `comments`, restructures `oldpbdbID`)
- **migrate-pbot-refs.js**: Modified `buildReferenceJsonb` function (fixes field mappings, restructures `pbotID`), modified enterer lookup query (uses jsonb path instead of name fields), simplified enterer resolution flow
- **reference.schema.js**: No changes needed (already has `comments` and `legacyIDs` in the correct structure)
- **PostgreSQL references table**: jsonb content changes — `legacyIDs` becomes a nested object, `comments` field populated where source data exists
