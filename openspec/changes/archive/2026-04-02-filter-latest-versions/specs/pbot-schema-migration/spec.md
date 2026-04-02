## ADDED Requirements

### Requirement: Schema query returns only latest version of each entity
The schema API query SHALL return only the latest version of each entity (schema, character, state) by filtering for records where `succeeded_by_id IS NULL`. This ensures that when multiple versions of an entity exist (sharing the same `permid`), only the current version is included in query results.

#### Scenario: Schema with single version
- **WHEN** a schema has `permid = 'abc-123'` and `succeeded_by_id = NULL`
- **THEN** the schema is included in query results

#### Scenario: Schema with multiple versions
- **WHEN** a schema has `permid = 'abc-123'` with two rows: id=1 (`succeeded_by_id = 5`) and id=5 (`succeeded_by_id = NULL`)
- **THEN** only the row with id=5 is returned

#### Scenario: Character with multiple versions
- **WHEN** a character has `permid = 'char-456'` with two rows: id=7 (`succeeded_by_id = 42`) and id=42 (`succeeded_by_id = NULL`)
- **THEN** only the row with id=42 is included in the character tree

#### Scenario: State with multiple versions
- **WHEN** a state has `permid = 'state-789'` with two rows: id=10 (`succeeded_by_id = 33`) and id=33 (`succeeded_by_id = NULL`)
- **THEN** only the row with id=33 is included in the state tree

#### Scenario: Recursive tree walk unaffected
- **WHEN** the latest version of a character (id=42, `succeeded_by_id = NULL`) has child characters and states pointing to it via `parent_character_id = 42`
- **THEN** the recursive CTEs traverse those children normally without additional version filtering
