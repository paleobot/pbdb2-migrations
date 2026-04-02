## Why

PBot contains morphological description schemas, characters, and states that need to be migrated into the new PostgreSQL database. These entities have no legacy MariaDB equivalent — they exist only in PBot's Neo4j/GraphQL system. The PostgreSQL tables (`schemas`, `characters`, `states`, `additional_schema_refs`) are already defined in `create_new.sql` and the JSONB payload schemas are in place, so the migration script is the remaining piece.

## What Changes

- New migration script to pull Schema, Character, and State data from the PBot GraphQL API and insert into PostgreSQL
- Schemas: resolve references (lowest-order → `reference_id`, others → `additional_schema_refs`), resolve enterer person, use default authorizer, map `partsPreserved` and `notableFeatures` case-insensitively to enum values, store authors with order in JSONB
- Characters: level-by-level bulk insert (top-level characters with `parent_schema_id` first, then sub-characters with `parent_character_id`), building a `pbotID → new_id` map at each level
- States: same level-by-level approach (top-level states with `parent_character_id` first, then sub-states with `parent_state_id`), set `quantitative = true` when PBot state name is "quantity"
- Orphan detection: any characters/states whose parents were never inserted are logged and skipped
- All entities store their PBot `pbotID` in `legacyIDs.pbotID` within the JSONB payload

## Capabilities

### New Capabilities
- `pbot-schema-migration`: Migration of PBot schemas, characters, and states into PostgreSQL, including reference resolution, person resolution, level-by-level hierarchical insert, and JSONB payload construction

### Modified Capabilities
<!-- None — existing migrations are unaffected -->

## Impact

- **Dependencies**: Requires `persons` and `refs` (including PBot refs) to be migrated first. PBot person `pbotID` values must exist in `persons` table for enterer resolution. PBot reference `pbotID` values must exist in `refs` table for reference resolution.
- **Tables written**: `schemas`, `additional_schema_refs`, `characters`, `states`
- **External systems**: PBot GraphQL API (`pbot.paleobiodb.org/graphql`) — requires JWT token for authenticated queries
- **Payload schemas**: `payloadSchemas/schema.schema.js`, `character.schema.js`, `state.schema.js` — migration output must conform to these
