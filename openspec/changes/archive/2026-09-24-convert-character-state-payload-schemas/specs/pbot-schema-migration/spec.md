## RENAMED Requirements

- FROM: `### Requirement: Validate every schema payload before any schema is inserted`
- TO: `### Requirement: Validate every schema, character and state payload before any insert`

## MODIFIED Requirements

### Requirement: Build character JSONB payload
The script SHALL construct the `character` JSONB column from PBot Character fields:

| PBot field | JSONB field | Notes |
|---|---|---|
| `pbotID` | `legacyIDs.pbotID` | Always |
| `name` | `name` | Required |
| `definition` | `definition` | When non-null; omitted, not written as `null`, when PBot has none |

The `order` field SHALL NOT be included in the JSONB payload. It SHALL be routed to the `sort_order` column instead (see "Populate sort_order column for characters" requirement).

#### Scenario: Character payload excludes order
- **WHEN** a PBot Character has `name = 'Leaf shape'`, `definition = 'Overall shape of the leaf blade'`, `order = 3`
- **THEN** the JSONB is `{ legacyIDs: { pbotID: '...' }, name: 'Leaf shape', definition: 'Overall shape of the leaf blade' }` (no `order` field)

#### Scenario: Character without order
- **WHEN** a PBot Character has `name = 'Margin type'`, `definition = 'Type of leaf margin'`, `order = null`
- **THEN** the JSONB is `{ legacyIDs: { pbotID: '...' }, name: 'Margin type', definition: 'Type of leaf margin' }` (no `order` field)

#### Scenario: Character without definition
- **WHEN** a PBot Character has `name = 'Leaf attachment'` and `definition = null`
- **THEN** the JSONB is `{ legacyIDs: { pbotID: '...' }, name: 'Leaf attachment' }`, with no `definition` key

### Requirement: Build state JSONB payload
The script SHALL construct the `state` JSONB column from PBot State fields:

| PBot field | JSONB field | Notes |
|---|---|---|
| `pbotID` | `legacyIDs.pbotID` | Always |
| `name` | `name` | Required |
| `definition` | `definition` | When non-null; omitted, not written as `null`, when PBot has none |

The `order` field SHALL NOT be included in the JSONB payload. It SHALL be routed to the `sort_order` column instead (see "Populate sort_order column for states" requirement).

#### Scenario: State payload excludes order
- **WHEN** a PBot State has `name = 'ovate'`, `definition = 'Egg-shaped outline'`, `order = 2`
- **THEN** the JSONB is `{ legacyIDs: { pbotID: '...' }, name: 'ovate', definition: 'Egg-shaped outline' }` (no `order` field)

#### Scenario: State without definition
- **WHEN** a PBot State has `name = 'ovate'` and `definition = null`
- **THEN** the JSONB is `{ legacyIDs: { pbotID: '...' }, name: 'ovate' }`, with no `definition` key

#### Scenario: Quantitative stays out of the payload
- **WHEN** a PBot State has `name = 'quantity'`
- **THEN** `quantitative = true` is written to the column and the JSONB has no `quantitative` key

### Requirement: Validate every schema, character and state payload before any insert
Before fetching from PBot, the script SHALL resolve `schemaSource`, `characterSource` and `stateSource` with
`resolveEnums` and compile each `db` variant with `createAjv`. It SHALL then fetch all Schema, Character and
State nodes, and only then build and validate the jsonb of every fetched schema, character and state, as built,
with no envelope. The object validated SHALL be the object later inserted.

On any validation failure the script SHALL log the entity kind, its `pbotID`, the payload and the ajv errors,
and exit non-zero before inserting any `schemas`, `additional_schema_refs`, `characters` or `states` row.

Every fetched record SHALL be validated, including one the insert phases would then skip for an unresolved
enterer or primary reference, or leave out as an orphan.

Parent resolution, level-by-level insertion, orphan detection, `sort_order`, `quantitative` and the summary
lines SHALL be unchanged by the reordering.

#### Scenario: Valid payloads are inserted as built
- **WHEN** every fetched payload validates against its `db` variant
- **THEN** the script inserts them exactly as validated, and each stored jsonb equals its validated object

#### Scenario: Invalid schema payload aborts before any insert
- **WHEN** a fetched schema's author has no `order`, so its built payload carries `order: 0`
- **THEN** the script logs that schema's `pbotID`, the payload and the error, exits non-zero, and `schemas`, `additional_schema_refs`, `characters` and `states` are all still empty

#### Scenario: Invalid state payload aborts before any insert
- **WHEN** a fetched State has `name = null`
- **THEN** the script logs that state's `pbotID`, the payload and the error, exits non-zero, and no schema, character or state has been inserted

#### Scenario: A record later skipped is still validated
- **WHEN** a fetched schema has no resolvable enterer, or a fetched character would be an orphan, and its payload is invalid
- **THEN** the script exits non-zero on the validation failure rather than skipping the record
