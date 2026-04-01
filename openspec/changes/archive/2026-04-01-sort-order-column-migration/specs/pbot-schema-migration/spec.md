## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: Populate sort_order column for characters
The script SHALL parse the PBot Character's `order` field as an integer and insert it into the `sort_order` column of the `characters` table. When `order` is null or not present, `sort_order` SHALL be NULL.

#### Scenario: Character with order value
- **WHEN** a PBot Character has `order = 3`
- **THEN** the `characters` row has `sort_order = 3`

#### Scenario: Character with null order
- **WHEN** a PBot Character has `order = null`
- **THEN** the `characters` row has `sort_order = NULL`

### Requirement: Populate sort_order column for states
The script SHALL parse the PBot State's `order` field as an integer and insert it into the `sort_order` column of the `states` table. When `order` is null or not present, `sort_order` SHALL be NULL.

#### Scenario: State with order value
- **WHEN** a PBot State has `order = 2`
- **THEN** the `states` row has `sort_order = 2`

#### Scenario: State with null order
- **WHEN** a PBot State has `order = null`
- **THEN** the `states` row has `sort_order = NULL`
