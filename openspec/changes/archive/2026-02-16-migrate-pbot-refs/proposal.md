## Why

The existing refs migration (`migrate-refs.js`) brings references from the legacy MariaDB database into PostgreSQL. However, the PBot system (pbot.paleobiodb.org) has 167 Reference nodes entered directly through its GraphQL API that are not present in MariaDB. Of these, 136 are PBot-only references (no `pbdbid` linking them back to MariaDB). These need to be migrated into the PostgreSQL `references` table — along with any associated Person records not already in the `persons` table — to provide a complete reference dataset in the new system.

## What Changes

- New migration script `migrate-pbot-refs.js` that fetches Reference nodes from the PBot GraphQL API and inserts them into PostgreSQL
- Skips the 31 PBot references that have a `pbdbid` (already migrated from MariaDB)
- Resolves the `ENTERED_BY` relationship on each Reference to identify the enterer Person
- Matches enterer persons against existing PostgreSQL `persons` records by name; inserts new person records for unmatched enterers
- Updates ORCID values on matched existing persons where PBot has ORCID data and PostgreSQL does not
- Uses PBot `pbotID` (UUID) as the `permid` for each migrated reference
- Uses Douglas Meredith (person id=1106) as `authorizer_person_id` for all PBot-sourced references
- Builds the `reference` JSONB column from PBot Reference fields and the `authoredBy` relationship

## Capabilities

### New Capabilities
- `pbot-refs-migration`: Migration of PBot GraphQL Reference nodes (and their enterer Persons) into the PostgreSQL `references` and `persons` tables

### Modified Capabilities
- `person-migration`: New persons from PBot will be inserted into `persons` table using auto-generated IDs; existing matched persons will have their ORCID updated if PBot provides one

## Impact

- **New file**: `migrate-pbot-refs.js` — standalone script, does not modify existing migration scripts
- **PostgreSQL `persons` table**: Up to 17 new person records inserted; up to 9 existing records updated with ORCID values
- **PostgreSQL `references` table**: Up to 136 new reference records inserted
- **External dependency**: Requires network access to `https://pbot.paleobiodb.org/graphql`
- **No MariaDB dependency**: This script reads only from the PBot GraphQL API, not MariaDB
