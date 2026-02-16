## MODIFIED Requirements

### Requirement: Insert Unknown country dictionary entry
The migration script SHALL insert an entry into `dictionaries.countries` with abbreviation `'XX'` and full_name `'Unknown'` if one does not already exist. This entry is used as the default `country_id` for migrated persons.

#### Scenario: Unknown country does not exist
- **WHEN** the migration runs and no row with abbreviation `'XX'` exists in `dictionaries.countries`
- **THEN** a new row is inserted with abbreviation `'XX'` and full_name `'Unknown'`

#### Scenario: Unknown country already exists
- **WHEN** the migration runs and a row with abbreviation `'XX'` already exists in `dictionaries.countries`
- **THEN** the existing row is used and no duplicate is created

## ADDED Requirements

### Requirement: PBot enterer persons can be inserted with auto-generated IDs
When PBot enterer persons are inserted by the pbot-refs-migration script, they SHALL use PostgreSQL auto-generated identity IDs rather than explicit IDs. The `persons` identity sequence SHALL be reset to `MAX(id)` after insertion.

#### Scenario: Auto-generated person ID
- **WHEN** a new PBot enterer person is inserted without an explicit `id`
- **THEN** the PostgreSQL identity sequence assigns the next available integer ID

#### Scenario: No collision with existing IDs
- **WHEN** the persons identity sequence is at 1306 and a new person is inserted
- **THEN** the new person receives id=1307 or higher

### Requirement: ORCID can be updated on existing persons
Existing person records MAY have their `orcid` field updated when a trusted external source (such as PBot) provides an ORCID value and the current PG value is NULL or empty. The ORCID value SHALL be normalized by stripping the `https://orcid.org/` URL prefix if present.

#### Scenario: ORCID updated from PBot
- **WHEN** PG person id=1053 has `orcid = NULL` and a PBot source provides `orcid = 'https://orcid.org/0000-0002-5242-8573'`
- **THEN** PG person id=1053 is updated with `orcid = '0000-0002-5242-8573'`

#### Scenario: Existing ORCID not overwritten
- **WHEN** PG person already has a non-null, non-empty `orcid` value
- **THEN** the existing ORCID is preserved
