## MODIFIED Requirements

### Requirement: Resolve person FKs with zero-sentinel fallback
The script SHALL use `authorizer_no` and `enterer_no` directly as `persons.id` values (the `src/persons-migration/migrate-persons.js` migration inserted persons with `id = person_no`, so legacy and new ids are identical; no lookup map is required). When `authorizer_no=0` or `enterer_no=0` (MariaDB sentinel for "missing"), the script SHALL substitute the other field's value. When both are 0, the script SHALL fall back to `person_no=1`. Same fallback as `migrate-refs.js`. Approximate count: 1 row with `authorizer_no=0`, 1 with `enterer_no=0`.

#### Scenario: Both populated
- **WHEN** a source row has `authorizer_no=5`, `enterer_no=7`
- **THEN** `authorizer_person_id` resolves from person_no=5 and `enterer_person_id` resolves from person_no=7

#### Scenario: authorizer_no=0 fallback
- **WHEN** a source row has `authorizer_no=0`, `enterer_no=7`
- **THEN** both `authorizer_person_id` and `enterer_person_id` resolve from person_no=7

#### Scenario: enterer_no=0 fallback
- **WHEN** a source row has `authorizer_no=5`, `enterer_no=0`
- **THEN** both `authorizer_person_id` and `enterer_person_id` resolve from person_no=5
