### Requirement: Fetch Schemas from PBot GraphQL API
The script SHALL fetch all Schema nodes from `https://pbot.paleobiodb.org/graphql` using a POST request with a Bearer token from the `PBOT_TOKEN` environment variable. The query SHALL retrieve schema scalar fields (`pbotID`, `title`, `year`, `purpose`, `acknowledgments`), `partsPreserved` and `notableFeatures` (as relationship nodes or string values), `references` (with `order` and Reference `pbotID`), `authoredBy` (with `order` and Person `given`, `surname`), and `enteredBy` (with `type`, `timestamp`, and Person `pbotID`).

#### Scenario: Successful fetch
- **WHEN** the script sends the GraphQL query with a valid Bearer token
- **THEN** all Schema nodes are returned with their full field set and relationships

#### Scenario: API unreachable
- **WHEN** the GraphQL endpoint is unreachable or returns an error
- **THEN** the script logs the error and exits with a non-zero exit code

### Requirement: Fetch Characters from PBot GraphQL API
The script SHALL fetch all Character nodes from the PBot GraphQL API. The query SHALL retrieve `pbotID`, `name`, `definition`, `order`, parent relationship (the pbotID of the parent Schema or parent Character), and `enteredBy` (with `type`, `timestamp`, and Person `pbotID`).

#### Scenario: Successful fetch
- **WHEN** the script sends the Character GraphQL query
- **THEN** all Character nodes are returned with parent relationship information

### Requirement: Fetch States from PBot GraphQL API
The script SHALL fetch all State nodes from the PBot GraphQL API. The query SHALL retrieve `pbotID`, `name`, `definition`, `order`, parent relationship (the pbotID of the parent Character or parent State), and `enteredBy` (with `type`, `timestamp`, and Person `pbotID`).

#### Scenario: Successful fetch
- **WHEN** the script sends the State GraphQL query
- **THEN** all State nodes are returned with parent relationship information

### Requirement: Resolve enterer person from enteredBy relationship
The script SHALL resolve the enterer for each Schema, Character, and State using the same pattern as the PBot refs migration: select the `enteredBy` relationship with `type = 'CREATE'`, falling back to the earliest `timestamp`. The enterer's PBot `pbotID` SHALL be looked up in the `persons` table via `person->'legacyIDs'->>'pbotID'`.

If no matching person is found, the script SHALL log a warning and skip the record.

#### Scenario: CREATE entry exists
- **WHEN** a record has an enteredBy entry with `type = 'CREATE'`
- **THEN** that entry's Person pbotID is used to look up the enterer

#### Scenario: No CREATE entry — fallback to earliest timestamp
- **WHEN** a record has no `type = 'CREATE'` entry but has multiple enteredBy entries
- **THEN** the entry with the earliest timestamp is selected and a warning is logged

#### Scenario: Enterer person not found
- **WHEN** the resolved enterer's pbotID does not match any person in the persons table
- **THEN** the record is skipped and a warning is logged

### Requirement: Set authorizer_person_id to default
The script SHALL set `authorizer_person_id = 1106` (Douglas Meredith) for all PBot-sourced schema, character, and state records.

#### Scenario: Authorizer assignment
- **WHEN** any PBot record is inserted into PostgreSQL
- **THEN** the `authorizer_person_id` column is set to 1106

### Requirement: Use PBot pbotID as permid
The script SHALL use each entity's PBot `pbotID` as the `permid` column value in PostgreSQL.

#### Scenario: permid assignment
- **WHEN** a PBot Schema has `pbotID = 'abc-123'`
- **THEN** the resulting `schemas` row has `permid = 'abc-123'`

### Requirement: Resolve schema references by order
The script SHALL resolve all references associated with each Schema. References SHALL be sorted by their `order` value ascending. The reference with the lowest order SHALL become the `schemas.reference_id` column value. All remaining references SHALL be inserted as rows in `additional_schema_refs`.

Each reference's PBot `pbotID` SHALL be looked up in the `refs` table via `ref->'legacyIDs'->>'pbotID'` to get the PostgreSQL `refs.id`.

#### Scenario: Schema with one reference
- **WHEN** a PBot Schema has one reference with `order = 1` and `pbotID = 'ref-aaa'`
- **THEN** `schemas.reference_id` is set to the `refs.id` matching `ref-aaa`, and no rows are added to `additional_schema_refs`

#### Scenario: Schema with multiple references
- **WHEN** a PBot Schema has references with orders `[3, 1, 2]` and pbotIDs `['ref-ccc', 'ref-aaa', 'ref-bbb']`
- **THEN** `schemas.reference_id` is set to the `refs.id` matching `ref-aaa` (lowest order), and `additional_schema_refs` gets rows for `ref-bbb` and `ref-ccc`

#### Scenario: Reference not found in refs table
- **WHEN** a Schema's reference pbotID does not match any row in the refs table
- **THEN** a warning is logged. If the unresolved reference was the primary (lowest order), the schema is skipped.

### Requirement: Build schema JSONB payload
The script SHALL construct the `schema` JSONB column from PBot Schema fields using the following mapping:

| PBot field | JSONB field | Notes |
|---|---|---|
| `pbotID` | `legacyIDs.pbotID` | Always |
| `title` | `title` | Required |
| `year` | `year` | Required |
| `purpose` | `purpose` | When non-null |
| `acknowledgments` | `acknowledgments` | When non-null |
| `partsPreserved` | `partsPreserved` | Array, case-insensitive enum mapping |
| `notableFeatures` | `notableFeatures` | Array, case-insensitive enum mapping |
| `authoredBy` | `authors` | Array of `{familyName, givenName, order}` |

#### Scenario: Full schema payload
- **WHEN** a PBot Schema has `title = 'Leaf Architecture'`, `year = '2020'`, `purpose = 'Angiosperm leaves'`, one author (Jud, Nathan, order 1), and `partsPreserved = ['leaf']`
- **THEN** the JSONB is `{ legacyIDs: { pbotID: '...' }, title: 'Leaf Architecture', year: '2020', purpose: 'Angiosperm leaves', authors: [{ familyName: 'Jud', givenName: 'Nathan', order: 1 }], partsPreserved: ['leaf'] }`

#### Scenario: Minimal schema payload
- **WHEN** a PBot Schema has only `title` and `year` with no optional fields
- **THEN** the JSONB contains only `legacyIDs`, `title`, and `year`

### Requirement: Map partsPreserved case-insensitively
The script SHALL map each PBot `partsPreserved` value to the enum values defined in `schema.schema.js` using case-insensitive comparison. Values that do not match any enum entry SHALL be logged as warnings and excluded from the array.

Valid enum values: `root`, `shoot/axis/wood`, `leaf`, `pollen/spore`, `inflorescence/flower`, `infructescence/fruit`, `ovuliferous (seed) cone`, `staminate (pollen) cone`, `seed`, `cuticle`, `other`, `unknown`.

#### Scenario: Matching value with different case
- **WHEN** PBot returns `partsPreserved` containing `'Leaf'`
- **THEN** it is mapped to `'leaf'` in the JSONB array

#### Scenario: Unrecognized value
- **WHEN** PBot returns `partsPreserved` containing `'bark'`
- **THEN** `'bark'` is excluded from the array and a warning is logged

### Requirement: Map notableFeatures case-insensitively
The script SHALL map each PBot `notableFeatures` value to the enum values defined in `schema.schema.js` using case-insensitive comparison. Values that do not match any enum entry SHALL be logged as warnings and excluded from the array.

Valid enum values: `cuticle/epidermal features`, `wood anatomy (secondary growth)`, `internal anatomy`, `trace fossils (e.g., insect damage)`.

#### Scenario: Matching value with different case
- **WHEN** PBot returns `notableFeatures` containing `'Internal Anatomy'`
- **THEN** it is mapped to `'internal anatomy'` in the JSONB array

#### Scenario: Unrecognized value
- **WHEN** PBot returns `notableFeatures` containing `'pith structure'`
- **THEN** `'pith structure'` is excluded from the array and a warning is logged

### Requirement: Insert characters level-by-level
The script SHALL insert characters in levels to satisfy FK constraints and detect orphans:

1. **Level 0**: Insert all characters whose parent is a Schema. Set `parent_schema_id` by looking up the parent Schema's pbotID in the schemas pbotID-to-id map. Set `parent_character_id = NULL`.
2. **Level 1+**: Insert all characters whose parent is a Character inserted in the previous level. Set `parent_character_id` from the characters pbotID-to-id map. Set `parent_schema_id = NULL`.
3. Repeat until no more characters are inserted in a level.
4. Any characters remaining after all levels are exhausted SHALL be logged as orphans and skipped.

#### Scenario: Top-level character
- **WHEN** a PBot Character's parent is a Schema with `pbotID = 'schema-aaa'`
- **THEN** the character is inserted at level 0 with `parent_schema_id` set to the id for `schema-aaa` and `parent_character_id = NULL`

#### Scenario: Sub-character
- **WHEN** a PBot Character's parent is another Character with `pbotID = 'char-bbb'` that was inserted at level 0
- **THEN** the character is inserted at level 1 with `parent_character_id` set to the id for `char-bbb` and `parent_schema_id = NULL`

#### Scenario: Orphan character
- **WHEN** a PBot Character's parent pbotID does not match any inserted schema or character after all levels complete
- **THEN** the character is logged as an orphan with its pbotID and parent pbotID, and is not inserted

#### Scenario: Depth logging
- **WHEN** characters are inserted at level N
- **THEN** the script logs the level number and count of characters inserted at that level

### Requirement: Build character JSONB payload
The script SHALL construct the `character` JSONB column from PBot Character fields:

| PBot field | JSONB field | Notes |
|---|---|---|
| `pbotID` | `legacyIDs.pbotID` | Always |
| `name` | `name` | Required |
| `definition` | `definition` | Required |

The `order` field SHALL NOT be included in the JSONB payload. It SHALL be routed to the `sort_order` column instead (see "Populate sort_order column for characters" requirement).

#### Scenario: Character payload excludes order
- **WHEN** a PBot Character has `name = 'Leaf shape'`, `definition = 'Overall shape of the leaf blade'`, `order = 3`
- **THEN** the JSONB is `{ legacyIDs: { pbotID: '...' }, name: 'Leaf shape', definition: 'Overall shape of the leaf blade' }` (no `order` field)

#### Scenario: Character without order
- **WHEN** a PBot Character has `name = 'Margin type'`, `definition = 'Type of leaf margin'`, `order = null`
- **THEN** the JSONB is `{ legacyIDs: { pbotID: '...' }, name: 'Margin type', definition: 'Type of leaf margin' }` (no `order` field)

### Requirement: Populate sort_order column for characters
The script SHALL parse the PBot Character's `order` field as an integer and insert it into the `sort_order` column of the `characters` table. When `order` is null or not present, `sort_order` SHALL be NULL.

#### Scenario: Character with order value
- **WHEN** a PBot Character has `order = 3`
- **THEN** the `characters` row has `sort_order = 3`

#### Scenario: Character with null order
- **WHEN** a PBot Character has `order = null`
- **THEN** the `characters` row has `sort_order = NULL`

### Requirement: Insert states level-by-level
The script SHALL insert states in levels, following the same pattern as characters:

1. **Level 0**: Insert all states whose parent is a Character. Set `parent_character_id` from the characters pbotID-to-id map. Set `parent_state_id = NULL`.
2. **Level 1+**: Insert all states whose parent is a State inserted in the previous level. Set `parent_state_id` from the states pbotID-to-id map. Set `parent_character_id = NULL`.
3. Repeat until no more states are inserted in a level.
4. Any states remaining after all levels are exhausted SHALL be logged as orphans and skipped.

#### Scenario: Top-level state
- **WHEN** a PBot State's parent is a Character with `pbotID = 'char-aaa'`
- **THEN** the state is inserted at level 0 with `parent_character_id` set to the id for `char-aaa` and `parent_state_id = NULL`

#### Scenario: Sub-state
- **WHEN** a PBot State's parent is another State with `pbotID = 'state-bbb'` that was inserted at level 0
- **THEN** the state is inserted at level 1 with `parent_state_id` set to the id for `state-bbb` and `parent_character_id = NULL`

#### Scenario: Orphan state
- **WHEN** a PBot State's parent pbotID does not match any inserted character or state after all levels complete
- **THEN** the state is logged as an orphan and is not inserted

### Requirement: Set quantitative flag from state name
The script SHALL set the `quantitative` column to `true` when the PBot State's `name` field equals `"quantity"` (case-insensitive comparison). All other states SHALL have `quantitative = false`.

#### Scenario: Quantitative state
- **WHEN** a PBot State has `name = 'quantity'`
- **THEN** the states row has `quantitative = true`

#### Scenario: Quantitative state — different case
- **WHEN** a PBot State has `name = 'Quantity'`
- **THEN** the states row has `quantitative = true`

#### Scenario: Non-quantitative state
- **WHEN** a PBot State has `name = 'ovate'`
- **THEN** the states row has `quantitative = false`

### Requirement: Build state JSONB payload
The script SHALL construct the `state` JSONB column from PBot State fields:

| PBot field | JSONB field | Notes |
|---|---|---|
| `pbotID` | `legacyIDs.pbotID` | Always |
| `name` | `name` | Required |
| `definition` | `definition` | Required |

The `order` field SHALL NOT be included in the JSONB payload. It SHALL be routed to the `sort_order` column instead (see "Populate sort_order column for states" requirement).

#### Scenario: State payload excludes order
- **WHEN** a PBot State has `name = 'ovate'`, `definition = 'Egg-shaped outline'`, `order = 2`
- **THEN** the JSONB is `{ legacyIDs: { pbotID: '...' }, name: 'ovate', definition: 'Egg-shaped outline' }` (no `order` field)

### Requirement: Populate sort_order column for states
The script SHALL parse the PBot State's `order` field as an integer and insert it into the `sort_order` column of the `states` table. When `order` is null or not present, `sort_order` SHALL be NULL.

#### Scenario: State with order value
- **WHEN** a PBot State has `order = 2`
- **THEN** the `states` row has `sort_order = 2`

#### Scenario: State with null order
- **WHEN** a PBot State has `order = null`
- **THEN** the `states` row has `sort_order = NULL`

### Requirement: Set default succession and removed fields
The script SHALL set `preceded_by_id = NULL`, `succeeded_by_id = NULL`, and `removed = false` for all PBot-sourced schemas, characters, and states.

#### Scenario: Default fields on schema
- **WHEN** a PBot Schema is inserted
- **THEN** `preceded_by_id = NULL`, `succeeded_by_id = NULL`, `removed = false`

#### Scenario: Default fields on character
- **WHEN** a PBot Character is inserted
- **THEN** `preceded_by_id = NULL`, `succeeded_by_id = NULL`, `removed = false`

#### Scenario: Default fields on state
- **WHEN** a PBot State is inserted
- **THEN** `preceded_by_id = NULL`, `succeeded_by_id = NULL`, `removed = false`

### Requirement: Auto-generate IDs and reset sequences
The script SHALL NOT set explicit `id` values. IDs SHALL be auto-generated by PostgreSQL identity sequences. After all insertions for each table, the script SHALL reset the identity sequence to `MAX(id)`.

#### Scenario: Sequence reset for schemas
- **WHEN** all schemas have been inserted
- **THEN** the script executes `SELECT setval(pg_get_serial_sequence('schemas', 'id'), (SELECT MAX(id) FROM schemas))`

#### Scenario: Sequence reset for characters
- **WHEN** all characters have been inserted
- **THEN** the script executes `SELECT setval(pg_get_serial_sequence('characters', 'id'), (SELECT MAX(id) FROM characters))`

#### Scenario: Sequence reset for states
- **WHEN** all states have been inserted
- **THEN** the script executes `SELECT setval(pg_get_serial_sequence('states', 'id'), (SELECT MAX(id) FROM states))`

### Requirement: Verification and logging
The script SHALL log: start time, counts fetched from PBot (schemas, characters, states), counts inserted into PostgreSQL for each table and level, counts of orphans detected, counts of skipped records (missing enterer, missing reference), and end time with elapsed duration.

#### Scenario: Successful run logging
- **WHEN** the migration completes successfully
- **THEN** the log includes fetch counts, insertion counts per table and level, orphan counts, skip counts, and elapsed time

#### Scenario: Orphan summary
- **WHEN** orphan characters or states are detected
- **THEN** the script logs each orphan's pbotID and unresolved parent pbotID, plus a summary count

### Requirement: Schema query returns only latest version of each entity
The schema API query SHALL return only the latest version of each entity (schema, character, state) by filtering for records where `succeeded_by_id IS NULL`. This ensures that when multiple versions of an entity exist (sharing the same `permid`), only the current version is included in query results.

#### Scenario: Schema with single version
- **WHEN** a schema has `permid = 'abc-123'` and `succeeded_by_id = NULL`
- **THEN** the schema is included in query results

#### Scenario: Schema with multiple versions
- **WHEN** a schema has `permid = 'abc-123'` with two rows: id=1 (`succeeded_by_id = 5`) and id=5 (`succeeded_by_id = NULL`)
- **THEN** only the row with id=5 is returned

#### Scenario: Character with multiple versions
- **WHEN** a character has `permid = 'char-456'` with two rows: id=7 (`succeeded_by_id = 42`) and id=42 (`succeeded_by_id = NULL`)
- **THEN** only the row with id=42 is included in the character tree

#### Scenario: State with multiple versions
- **WHEN** a state has `permid = 'state-789'` with two rows: id=10 (`succeeded_by_id = 33`) and id=33 (`succeeded_by_id = NULL`)
- **THEN** only the row with id=33 is included in the state tree

#### Scenario: Recursive tree walk unaffected
- **WHEN** the latest version of a character (id=42, `succeeded_by_id = NULL`) has child characters and states pointing to it via `parent_character_id = 42`
- **THEN** the recursive CTEs traverse those children normally without additional version filtering
