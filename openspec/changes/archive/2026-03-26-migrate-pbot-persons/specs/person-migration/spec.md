## REMOVED Requirements

### Requirement: PBot enterer persons can be inserted with auto-generated IDs
**Reason**: PBot person insertion is now handled by the dedicated `migrate-pbot-persons.js` script (see `pbot-person-migration` capability), not inline during refs migration.
**Migration**: Run `migrate-pbot-persons.js` after `migrate-persons.js` and before `migrate-pbot-refs.js`.

### Requirement: ORCID can be updated on existing persons
**Reason**: ORCID backfill is now handled by `migrate-pbot-persons.js` as part of its match cascade logic, not as a side effect of refs migration.
**Migration**: The `pbot-person-migration` spec defines ORCID normalization and backfill requirements.
