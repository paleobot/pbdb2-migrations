## REMOVED Requirements

### Requirement: Match enterer persons to existing PostgreSQL records by name
**Reason**: Person matching and insertion is now handled by `migrate-pbot-persons.js`. The refs script assumes persons are already present in the `persons` table.
**Migration**: Run `migrate-pbot-persons.js` before `migrate-pbot-refs.js`.

### Requirement: Insert new person records for unmatched enterers
**Reason**: Person insertion is now handled by `migrate-pbot-persons.js`.
**Migration**: Run `migrate-pbot-persons.js` before `migrate-pbot-refs.js`.

### Requirement: Update ORCID on matched existing persons
**Reason**: ORCID backfill is now handled by `migrate-pbot-persons.js`.
**Migration**: Run `migrate-pbot-persons.js` before `migrate-pbot-refs.js`.

### Requirement: Persons identity sequence reset
**Reason**: Identity sequence management for persons is now handled by `migrate-pbot-persons.js`.
**Migration**: Run `migrate-pbot-persons.js` before `migrate-pbot-refs.js`.

## MODIFIED Requirements

### Requirement: Resolve enterer person from ENTERED_BY relationship
The script SHALL select the `ENTERED_BY` relationship with `type = 'CREATE'` to identify the enterer Person for each Reference. If no relationship has `type = 'CREATE'`, the script SHALL fall back to the relationship with the earliest `timestamp`.

The script SHALL then look up the enterer's PG `persons.id` by querying the `persons` table using the enterer's name (`lower(given_name) = lower(given)` AND `lower(family_name) = lower(surname)`). If no matching person is found, the script SHALL log a warning and skip the reference.

#### Scenario: Single CREATE entry
- **WHEN** a Reference has one ENTERED_BY with `type = 'CREATE'`
- **THEN** that entry's Person is used as the enterer

#### Scenario: Multiple entries including CREATE
- **WHEN** a Reference has ENTERED_BY entries with types `['EDIT', 'CREATE', 'EDIT']`
- **THEN** the entry with `type = 'CREATE'` is selected

#### Scenario: No CREATE entry — fallback to earliest
- **WHEN** a Reference has ENTERED_BY entries with types `[null, 'EDIT']` and timestamps `['2022-08-25T21:53:10.904Z', '2023-07-20T15:28:04.733Z']`
- **THEN** the entry with timestamp `2022-08-25T21:53:10.904Z` is selected and a warning is logged

#### Scenario: Enterer person found in persons table
- **WHEN** the resolved enterer has `given = 'Ellen'`, `surname = 'Currano'` and a PG person with `given_name = 'Ellen'`, `family_name = 'Currano'` exists
- **THEN** the PG person's `id` is used as `enterer_person_id`

#### Scenario: Enterer person not found in persons table
- **WHEN** the resolved enterer has `given = 'Unknown'`, `surname = 'Person'` and no PG person matches
- **THEN** the reference is skipped and a warning is logged with the PBot reference `pbotID` and the unmatched enterer name

### Requirement: Verification and logging
The script SHALL log: start time, number of references fetched, number skipped (pbdbid), number of references upserted, number of references skipped due to missing enterer, and end time with elapsed duration. The script SHALL verify the final count of PBot-sourced references in PG matches the expected count.

#### Scenario: Successful run logging
- **WHEN** the migration completes successfully
- **THEN** the log includes fetch count, skip count, upsert count, verification result, and elapsed time

#### Scenario: Count mismatch
- **WHEN** the number of PBot references upserted does not match the expected count
- **THEN** a warning is logged with both counts
