## Why

PBot persons are currently created inline during the PBot refs migration (`migrate-pbot-refs.js`), which couples person resolution with reference import, duplicates logic that belongs in the person migration domain, and references a `dictionaries.countries` table and `country_id` column that no longer exist (replaced by `country_code`). A dedicated PBot person migration script ensures persons are fully migrated before any PBot entity migration runs, follows the same pattern as the existing PBDB person migration, and eliminates the broken country handling.

## What Changes

- Create `migrate-pbot-persons.js` — a new migration script that fetches Person nodes from the PBot GraphQL API and upserts them into the PostgreSQL `persons` table.
- Only persons with a non-null email address are migrated (email is the minimum threshold for a meaningful record).
- Matching cascade against existing PG persons: ORCID first, then email (case-insensitive), then name (case-insensitive). Ambiguous name matches (multiple rows) are warned and skipped.
- On match: backfill ORCID and email on the existing PG record if currently null/empty.
- On no match: insert a new person with defaults (role=Person, gender=Anonymous, country_code=NULL, authorizer_person_id=1106, active=true).
- **BREAKING**: Remove the enterer/authorizer person resolution and insertion logic (approximately lines 263-381) from `migrate-pbot-refs.js` — this is the block that collects unique enterer persons from `enteredBy`, matches them to PG `persons` by name, inserts new persons, updates ORCIDs, and resets the identity sequence. That script will instead look up enterer/authorizer person IDs directly from the `persons` table, assuming this migration has already run. Note: the `authoredBy` → JSONB authors array logic in `buildReferenceJsonb` is unaffected — it builds author data from the GraphQL response without touching the `persons` table.

## Capabilities

### New Capabilities
- `pbot-person-migration`: Migration of PBot Person nodes into the PostgreSQL `persons` table, including match-cascade logic, ORCID normalization, and backfill of ORCID/email on matched records.

### Modified Capabilities
- `person-migration`: The existing requirements for PBot enterer person insertion (auto-generated IDs, ORCID updates) need to be moved/refactored to reflect that PBot persons now come from their own dedicated script rather than being created inline during refs migration.
- `pbot-refs-migration`: Remove person resolution/insertion responsibility. The script will assume persons are already present in the `persons` table and perform lookups only.

## Impact

- **New file**: `migrate-pbot-persons.js`
- **Modified file**: `migrate-pbot-refs.js` (remove ~120 lines of person handling, simplify to lookups)
- **Run order**: `migrate-persons.js` → `migrate-pbot-persons.js` → `migrate-pbot-refs.js` → `migrate-refs.js`
- **Dependencies**: Requires PG connection (no MariaDB). Uses PBot GraphQL API at `https://pbot.paleobiodb.org/graphql`.
- **Data**: PBot persons without email are intentionally excluded. Persons matched by ORCID or email may have their records enriched with backfilled fields.
