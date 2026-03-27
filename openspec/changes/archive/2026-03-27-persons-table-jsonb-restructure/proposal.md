## Why

The `persons` table currently stores person attributes (name, email, orcid, country, institution, gender) as flat columns, while other core entities like `refs` store their domain data in a JSONB column validated by a payload schema. Moving person attributes into a `person` JSONB column aligns the persons table with this pattern, simplifies the DDL, enables the same schema-driven validation approach used for references, and provides a natural place to store legacy IDs (`oldpbdbID`, `pbotID`) for traceability.

## What Changes

- **BREAKING**: The `persons` table DDL is restructured. Columns `given_name`, `family_name`, `middle`, `email`, `orcid`, `country_code`, `institution` are removed as flat columns and become properties of a `person jsonb NOT NULL` column.
- **BREAKING**: The `gender_id` FK to `dictionaries.genders` is removed from the table. Gender is now a string property (`gender`) in the JSONB, with values matching the `dictionaries.genders` enum (`Male`, `Female`, `Other`, `Anonymous`). The `dictionaries.genders` table is retained for future API validation use.
- Legacy IDs are now stored in the JSONB under `legacyIDs: { oldpbdbID, pbotID }`, mirroring the pattern used in the reference JSONB.
- `migrate-persons.js` must be updated to build a `person` JSONB object instead of inserting flat columns. The `gender_id` dictionary lookup is replaced by a direct gender string mapping. `legacyIDs.oldpbdbID` is set to the `person_no` value.
- `migrate-pbot-persons.js` must be updated to build a `person` JSONB object. The `gender_id` dictionary lookup is removed. `legacyIDs.pbotID` is set to the PBot `pbotID`. The match cascade queries must be updated to query JSONB fields (e.g., `person->>'email'` instead of `email`).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `person-migration`: All field mapping requirements change from flat column inserts to JSONB construction. Gender mapping changes from FK lookup to string value. Legacy ID storage is added.
- `pbot-person-migration`: All field mapping, match cascade queries, and backfill updates change from flat columns to JSONB paths. Gender changes from FK to string. Legacy ID storage is added.

## Impact

- **DDL**: `postgresql/create_new.sql` — persons table restructured (already done)
- **Schema**: `payloadSchemas/person.schema.js` — defines the JSONB structure (already done)
- **Migration scripts**: `migrate-persons.js` and `migrate-pbot-persons.js` must be rewritten to target the new structure
- **Downstream scripts**: `migrate-pbot-refs.js` queries `persons` by name for enterer lookup — these queries must be updated to use JSONB paths
- **Dependencies**: The `@countrystatecity/countries` package is still needed for PBDB country mapping (now writes to JSONB `countryCode` instead of flat `country_code`)
