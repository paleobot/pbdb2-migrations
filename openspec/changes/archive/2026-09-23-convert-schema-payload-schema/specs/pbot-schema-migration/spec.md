## MODIFIED Requirements

### Requirement: Map partsPreserved case-insensitively
The script SHALL map each PBot `partsPreserved` value to the enum values of `partsPreserved.items` in the `schemaSource` it has resolved with `resolveEnums`, which are the `name` values of `dictionaries.parts_preserved` ordered by `id`, using case-insensitive comparison. The script SHALL NOT hold its own copy of the list. Values that do not match any enum entry SHALL be logged as warnings and excluded from the array.

Valid enum values, as seeded: `root`, `shoot/axis/wood`, `leaf`, `pollen/spore`, `inflorescence/flower`, `infructescence/fruit`, `ovuliferous (seed) cone`, `staminate (pollen) cone`, `seed`, `cuticle`, `other`, `unknown`.

#### Scenario: Matching value with different case
- **WHEN** PBot returns `partsPreserved` containing `'Leaf'`
- **THEN** it is mapped to `'leaf'` in the JSONB array

#### Scenario: Unrecognized value
- **WHEN** PBot returns `partsPreserved` containing `'bark'`
- **THEN** `'bark'` is excluded from the array and a warning is logged

#### Scenario: Added dictionary value is mapped
- **WHEN** `dictionaries.parts_preserved` gains a row `bark` and PBot returns `partsPreserved` containing `'Bark'`
- **THEN** it is mapped to `'bark'`, and the payload validates, with no code change

### Requirement: Map notableFeatures case-insensitively
The script SHALL map each PBot `notableFeatures` value to the enum values of `notableFeatures.items` in the `schemaSource` it has resolved with `resolveEnums`, which are the `name` values of `dictionaries.notable_features` ordered by `id`, using case-insensitive comparison. The script SHALL NOT hold its own copy of the list. Values that do not match any enum entry SHALL be logged as warnings and excluded from the array.

Valid enum values, as seeded: `cuticle/epidermal features`, `wood anatomy (secondary growth)`, `internal anatomy`, `trace fossils (e.g., insect damage)`.

#### Scenario: Matching value with different case
- **WHEN** PBot returns `notableFeatures` containing `'Internal Anatomy'`
- **THEN** it is mapped to `'internal anatomy'` in the JSONB array

#### Scenario: Unrecognized value
- **WHEN** PBot returns `notableFeatures` containing `'pith structure'`
- **THEN** `'pith structure'` is excluded from the array and a warning is logged

## ADDED Requirements

### Requirement: Validate every schema payload before any schema is inserted
Before fetching from PBot, the script SHALL resolve `schemaSource` (`payloadSchemas/schema.schema.js`) with
`resolveEnums` and compile its `db` variant with `createAjv`. After fetching schemas and before inserting any,
it SHALL build the `schema` jsonb for every fetched schema and validate each, as built, with no `{ schema }`
envelope. The object validated SHALL be the object later inserted into `schemas.schema`.

On any validation failure the script SHALL log the schema's `pbotID`, the payload and the ajv errors, and exit
non-zero before inserting any `schemas`, `additional_schema_refs`, `characters` or `states` row.

Every fetched schema SHALL be validated, including one the insert phase would then skip for an unresolved
enterer or primary reference.

Character and state payloads are not validated by this requirement.

#### Scenario: Valid payloads are inserted as built
- **WHEN** every fetched schema's payload validates against the `db` variant
- **THEN** the script inserts them exactly as validated, and the stored jsonb equals the validated object

#### Scenario: Invalid payload aborts before any insert
- **WHEN** a fetched schema's author has no `order`, so its built payload carries `order: 0`
- **THEN** the script logs that schema's `pbotID`, the payload and the error, exits non-zero, and `schemas`, `additional_schema_refs`, `characters` and `states` are all still empty

#### Scenario: A schema later skipped is still validated
- **WHEN** a fetched schema has no resolvable enterer and its payload is invalid
- **THEN** the script exits non-zero on the validation failure rather than skipping the schema
