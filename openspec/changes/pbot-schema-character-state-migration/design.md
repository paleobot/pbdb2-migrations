## Context

PBot stores morphological description schemas, characters, and states in a Neo4j graph database, exposed via a GraphQL API at `pbot.paleobiodb.org/graphql`. These entities have no legacy MariaDB equivalent. The target PostgreSQL tables (`schemas`, `characters`, `states`, `additional_schema_refs`) are defined in `create_new.sql`, and JSONB payload schemas exist in `payloadSchemas/`.

The `persons` and `refs` tables (including PBot-sourced records with `legacyIDs.pbotID`) have already been migrated and are available for FK resolution.

Existing PBot migration scripts (`migrate-pbot-refs.js`, `migrate-pbot-persons.js`) establish the patterns: standalone PG-only script, GraphQL fetch, person/reference resolution via pbotID lookup, default authorizer constant, and JSONB payload construction.

## Goals / Non-Goals

**Goals:**
- Migrate all PBot schemas, characters, and states into PostgreSQL
- Resolve all FK relationships (persons, refs, parent schemas/characters/states) using pbotID lookups
- Populate `additional_schema_refs` for secondary references
- Set `quantitative` column on states where PBot state name is "quantity"
- Detect and log orphan characters/states that cannot be linked to a parent
- Conform all JSONB payloads to the payload schemas

**Non-Goals:**
- Migrating `CharacterInstance` data or the `value` field for quantitative states (future work)
- Maintaining reference order values on schemas (only used to determine primary vs. additional)
- Migrating from legacy MariaDB (no schema/character/state data exists there)
- Validating PBot data quality beyond what's needed for insertion

## Decisions

### Single script file
Follow the established pattern: one `migrate-pbot-schemas.js` file that handles schemas, characters, and states in sequence. Schemas must be inserted before characters, and characters before states, so a single script with sequential phases is the natural fit.

**Alternative considered:** Separate scripts per entity. Rejected because the ordering dependency means they'd always run together, and a single script can share the pbotID lookup maps.

### GraphQL query structure
Use three separate GraphQL queries — one each for Schema, Character, and State — rather than a single deeply nested query. This keeps each query manageable and avoids fetching the entire tree in one shot.

For Schema, fetch: `pbotID`, `title`, `year`, `purpose`, `acknowledgments`, `partsPreserved`, `notableFeatures`, `references` (with order and pbotID), `authoredBy` (Person nodes with names and order), `enteredBy` (with Person pbotID and timestamps).

For Character, fetch: `pbotID`, `name`, `definition`, `order`, parent relationship (schema pbotID or parent character pbotID), `enteredBy`.

For State, fetch: `pbotID`, `name`, `definition`, `order`, parent relationship (character pbotID or parent state pbotID), `enteredBy`.

Note: The exact GraphQL field names and relationship shapes need to be verified against the live API. PBot's Neo4j-backed GraphQL may use relationship-type syntax (e.g., `characterOf`, `stateOf`) for parent links.

### Level-by-level insertion for characters and states
Instead of recursively walking the tree per-schema, insert characters in levels:
1. All characters whose parent is a schema (resolve `parent_schema_id` via schema pbotID map)
2. All characters whose parent is a character from the previous level (resolve `parent_character_id` via character pbotID map)
3. Repeat until no more characters to insert

Same approach for states (level 0 parents are characters, level 1+ parents are states).

This satisfies the CHECK constraints at every insert, avoids recursive code, and naturally filters orphans — anything left after all levels are exhausted is an orphan.

**Alternative considered:** Temporarily dropping CHECK constraints for bulk insert. Rejected because level-by-level is straightforward and provides orphan detection as a side effect.

### Reference resolution on schemas
Query all references associated with each schema, with their order values. Sort by order ascending. The first (lowest order) reference becomes `schemas.reference_id`. All remaining references become rows in `additional_schema_refs`. Order values are not stored.

Lookup: match each reference's pbotID against `refs.ref->'legacyIDs'->>'pbotID'` to get the PostgreSQL `refs.id`.

### Person resolution
Same pattern as `migrate-pbot-refs.js`:
- Resolve enterer from PBot's `enteredBy` relationship, preferring the `CREATE` type entry, falling back to earliest timestamp
- Look up the enterer's pbotID in the `persons` table via `persons.person->'legacyIDs'->>'pbotID'`
- Use a hardcoded default authorizer (person ID 1106, same constant as refs migration)

### partsPreserved and notableFeatures mapping
PBot may return these as relationship nodes or string arrays. In either case, map each value case-insensitively to the enum values defined in `schema.schema.js`. Log a warning for any value that doesn't match an enum entry.

### Quantitative states
Set `states.quantitative = true` when the PBot state's `name` field equals "quantity" (case-insensitive comparison). No `value` field is stored in the state JSONB — that belongs to the CharacterInstance layer.

### permid
Use PBot's `pbotID` as the `permid` value for all three entities, consistent with the PBot refs migration pattern.

## Risks / Trade-offs

**[GraphQL field names unknown]** → The exact field names and relationship structures in PBot's GraphQL API for Schema, Character, and State haven't been verified. Mitigation: run exploratory queries against the API before finalizing the script. The script structure won't change, only field name mappings.

**[partsPreserved/notableFeatures format unknown]** → May be string arrays or relationship nodes in PBot. Mitigation: handle both cases (if array of strings, map directly; if array of objects, extract the name/type field).

**[Deep nesting]** → If character or state hierarchies are very deep, the level-by-level loop runs many passes. Mitigation: log the depth at each level. In practice this is unlikely to be more than 2-3 levels.

**[Missing enterer]** → A schema/character/state might have no `enteredBy` entries. Mitigation: log a warning and fall back to the default authorizer person as enterer (same as refs migration fallback pattern).

**[Enum mismatch]** → PBot values for partsPreserved or notableFeatures might not match the PostgreSQL enum values. Mitigation: case-insensitive matching with warning log for unmatched values. Unmatched values are skipped from the array rather than failing the insert.
