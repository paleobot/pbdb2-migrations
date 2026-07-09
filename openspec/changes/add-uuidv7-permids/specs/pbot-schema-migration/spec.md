## REMOVED Requirements

### Requirement: Use PBot pbotID as permid
**Reason**: Schema/character/state permids are now generated as UUIDv7 for consistency and index-locality benefits; the external pbotID is no longer used as the permid.
**Migration**: The PBot `pbotID` remains available in each entity's JSONB at `legacyIDs.pbotID` (unchanged), which is the key used for cross-entity lookups (`lookupRefByPbotID`, parent resolution). No pbotID data is lost.

## ADDED Requirements

### Requirement: Generate UUIDv7 permid
The script SHALL generate a fresh UUIDv7 (via the shared UUIDv7 helper) as the `permid` for each PBot Schema, Character, and State. The script SHALL NOT use the entity's `pbotID` as the permid. The PBot `pbotID` SHALL remain in the entity JSONB at `legacyIDs.pbotID`.

#### Scenario: Schema permid assignment
- **WHEN** a PBot Schema with `pbotID = 'abc-123'` is inserted
- **THEN** the resulting `schemas` row has a generated UUIDv7 `permid` (not `abc-123`), and the `schema` JSONB contains `legacyIDs.pbotID = 'abc-123'`

#### Scenario: Character permid assignment
- **WHEN** a PBot Character with `pbotID = 'char-bbb'` is inserted
- **THEN** the resulting `characters` row has a generated UUIDv7 `permid`, and the `character` JSONB contains `legacyIDs.pbotID = 'char-bbb'`

#### Scenario: State permid assignment
- **WHEN** a PBot State with `pbotID = 'state-ccc'` is inserted
- **THEN** the resulting `states` row has a generated UUIDv7 `permid`, and the `state` JSONB contains `legacyIDs.pbotID = 'state-ccc'`

#### Scenario: Parent resolution unaffected
- **WHEN** characters and states are inserted level-by-level using parent pbotID-to-id maps
- **THEN** parent resolution continues to work because it keys on the entity's pbotID (from the fetched PBot data / `legacyIDs.pbotID`), not on `permid`
