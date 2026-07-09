## REMOVED Requirements

### Requirement: Use PBot pbotID as permid
**Reason**: Permids are now generated as UUIDv7 for consistency and index-locality benefits; the external pbotID is no longer used as the primary permanent identifier.
**Migration**: The PBot `pbotID` remains available in the `reference` JSONB at `legacyIDs.pbotID` (unchanged), which is the key used for cross-entity lookups and idempotency. No pbotID data is lost.

### Requirement: Idempotent upsert on permid
**Reason**: With generated UUIDv7 permids, a re-run produces a new permid each time, so `ON CONFLICT (permid)` would never match and would duplicate every reference. Idempotency must key on the stable `legacyIDs.pbotID` instead.
**Migration**: Replaced by "Idempotent upsert on legacyIDs.pbotID".

## ADDED Requirements

### Requirement: Generate UUIDv7 permid
The script SHALL generate a fresh UUIDv7 (via the shared UUIDv7 helper) as the `permid` for each PBot reference. The script SHALL NOT use the reference's `pbotID` as the permid.

#### Scenario: permid assignment
- **WHEN** a PBot Reference with `pbotID = 'ec4353ee-467a-43cc-8383-524bd63987a7'` is inserted
- **THEN** the resulting `refs` row has a generated UUIDv7 `permid` (not `ec4353ee-...`), and the JSONB still contains `legacyIDs.pbotID = 'ec4353ee-467a-43cc-8383-524bd63987a7'`

### Requirement: Idempotent upsert on legacyIDs.pbotID
The script SHALL make re-runs idempotent by keying on the reference's stable `legacyIDs.pbotID` rather than on `permid`. If a `refs` row already exists whose `reference->'legacyIDs'->>'pbotID'` matches the incoming PBot reference, the script SHALL update the `reference_type_id`, `authorizer_person_id`, `enterer_person_id`, `reference`, and `removed` columns while preserving the existing `id` and `permid`. A new row (with a newly generated permid) SHALL be inserted only when no such existing row is found.

#### Scenario: First run
- **WHEN** no `refs` row has `reference->'legacyIDs'->>'pbotID'` equal to the incoming pbotID
- **THEN** a new row is inserted with a freshly generated UUIDv7 permid

#### Scenario: Re-run preserves permid and id
- **WHEN** a `refs` row already exists with `reference->'legacyIDs'->>'pbotID'` equal to the incoming pbotID
- **THEN** that row is updated in place and its existing `permid` and `id` are preserved (no duplicate row, no new permid)

#### Scenario: Target table name
- **WHEN** the script executes INSERT/UPDATE statements
- **THEN** the target table is `refs` (not `"references"`)
