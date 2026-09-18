## ADDED Requirements

### Requirement: One annotated source per converted entity
`payloadSchemas/collection.schema.js` and `payloadSchemas/specimen.schema.js` SHALL each export a single annotated source schema describing the entity object as the API sees it. The object SHALL NOT be wrapped in a `{ collection }` or `{ specimen }` envelope. Neither file SHALL export a hand-maintained variant (`collectionMigrationSchema`, `completeCollectionProperties`, `createSchema`, `editSchema`, `patchSchema`, `getSchema`), fastify `response` blocks, or `getPropertiesForPubType`. Every variant SHALL be obtained through `deriveVariant`.

#### Scenario: No hand-maintained variants remain
- **WHEN** the two modules are imported
- **THEN** each exposes only its annotated source (plus optional non-schema helpers), and none of the listed names is exported

### Requirement: Annotation vocabulary
Sources SHALL use these annotations:
- `x-enumFrom`: defined by the payload-schema-enums capability.
- `x-storage` on a property: the property is not stored in the entity's jsonb. Its value is `{ column: <name> }`, `{ column: <name>, codec: <name> }`, or `{ table: <name>, codec: <name> }`.
- `readOnly: true` (standard JSON Schema) on a property: the value is server-assigned and accepted in no input. `readOnly` SHALL appear only on properties of the entity root, so that the root-level `patch-guard` covers every read-only field. Derivation SHALL throw if it finds `readOnly` at any deeper node.
- `x-create` on an object schema: a subschema applied at that node only in the `in-create` variant.

`readOnly` and `x-storage` SHALL be independent. For the collection and specimen sources:
- `permid` SHALL carry both.
- `legacyIDs` SHALL carry `readOnly` only.
- collection `location.coordinates.latitude` and `longitude` SHALL carry `x-storage: { column: "location", codec: "wgs84Point" }`.
- collection `references` SHALL carry `x-storage: { table: "additional_collection_refs", codec: "collectionReferences" }`.

#### Scenario: Read-only yet stored in jsonb
- **WHEN** the collection source is inspected at `legacyIDs`
- **THEN** it has `readOnly: true` and no `x-storage`

#### Scenario: Stored elsewhere yet writable
- **WHEN** the collection source is inspected at `location.coordinates.latitude`
- **THEN** it has `x-storage` naming the `location` column and the `wgs84Point` codec, and no `readOnly`

#### Scenario: Nested read-only rejected
- **WHEN** a source marks `location.scale` as `readOnly`
- **THEN** `deriveVariant` throws naming the path

### Requirement: Variants are derived by a pure function
`deriveVariant(source, variant)` SHALL accept `variant` ∈ {`db`, `in-create`, `patch-guard`, `out`}, return a new schema, and SHALL NOT modify `source`. It SHALL apply its rules recursively through `properties`, `items`, `allOf`, `anyOf`, `oneOf`, `if`, `then`, and `else`. Each variant SHALL have `$id` `https://pbdb2.example.com/schemas/<entity>.<variant>.json`. `db`, `in-create`, and `out` SHALL keep `unevaluatedProperties: false` at the entity root. Any other variant name SHALL throw.

#### Scenario: Source untouched
- **WHEN** all four variants are derived from the collection source
- **THEN** a deep comparison of the source before and after shows no change

#### Scenario: Unknown variant
- **WHEN** `deriveVariant(source, 'in-update')` is called
- **THEN** it throws listing the four valid variant names

### Requirement: The `db` variant describes the jsonb at rest
The `db` variant SHALL:
- remove every property carrying `x-storage`, and remove its name from any `required` list;
- keep `readOnly` properties that carry no `x-storage`;
- keep base `required` lists;
- drop every `x-create`;
- keep both resolved and inline enums.

#### Scenario: Column-backed fields absent
- **WHEN** the collection `db` variant is derived
- **THEN** it has no `permid`, `references`, `location.coordinates.latitude`, or `location.coordinates.longitude` property, yet keeps `location.coordinates.basis` and `altitude`

#### Scenario: Stored jsonb with a stored-elsewhere key fails
- **WHEN** a collection payload containing a top-level `permid` is validated against the `db` variant
- **THEN** validation fails on the unevaluated property

#### Scenario: Create-only rules not applied
- **WHEN** a collection payload with `admin0: "US"` and no `admin1` is validated against the `db` variant
- **THEN** validation passes

### Requirement: The `in-create` variant enforces create-time completeness
The `in-create` variant SHALL:
- remove every `readOnly` property and remove its name from any `required` list;
- keep `x-storage` properties;
- keep base `required` lists;
- merge each node's `x-create` into that node as an `allOf` entry.

For the collection source, `x-create` SHALL:
- at the root, require `context` and `references`;
- at `location.coordinates`, require `latitude` and `longitude`;
- at `ages.measurements[]`, require `error` and `method`;
- at `location.toponym.administrativeArea`, carry `if: { required: ["admin0"], properties: { admin0: { enum: ["US","CN","RU","AU","CA"] } } }, then: { required: ["admin1"] }`.

#### Scenario: Read-only field rejected on create
- **WHEN** a create payload includes `permid` or `legacyIDs`
- **THEN** validation fails on the unevaluated property

#### Scenario: admin1 required for listed countries
- **WHEN** a create payload has `location.toponym.administrativeArea: { admin0: "CA" }`
- **THEN** validation fails requiring `admin1`

#### Scenario: admin1 optional elsewhere
- **WHEN** a create payload has `location.toponym.administrativeArea: { admin0: "FR" }` and is otherwise complete
- **THEN** validation passes

### Requirement: The `patch-guard` variant screens a JSON Merge Patch body
The `patch-guard` variant SHALL be exactly `{ $id, type: "object", propertyNames: { not: { enum: [<names of the source's root readOnly properties>] } } }`. When the source has no `readOnly` properties, `propertyNames` SHALL be omitted.

PATCH follows merge-then-validate (`payloadSchemas/DESIGN_NOTES.md`):
1. the stored parts are `merge`d into a full document;
2. the patch is applied to it;
3. `readOnly` properties are removed;
4. the result is validated as a whole document;
5. it is `split` for writing.

Which variant validates the merged document is an API policy decision outside this change. No variant validates a patch body field by field.

The guard is needed because step 3 would otherwise silently hide a patch that tries to change a `readOnly` property.

#### Scenario: Ordinary patch passes the guard
- **WHEN** the patch `{ "location": { "scale": "outcrop" }, "akaName": null }` is checked against the collection `patch-guard`
- **THEN** validation passes

#### Scenario: Read-only key rejected
- **WHEN** the patch `{ "legacyIDs": { "oldpbdbID": "1" } }` or `{ "permid": "…" }` is checked
- **THEN** validation fails naming the property

#### Scenario: Non-object body rejected
- **WHEN** the patch body is `[]` or `"x"`
- **THEN** validation fails

#### Scenario: Stored-elsewhere fields are patchable
- **WHEN** the patch `{ "location": { "coordinates": { "latitude": 10, "longitude": 20 } } }` is checked
- **THEN** validation passes

### Requirement: The `out` variant describes a full response
The `out` variant SHALL:
- keep all properties, including `x-storage` and `readOnly` ones;
- keep base `required` lists;
- drop every `x-create`;
- remove `enum` from every schema that carries `x-enumFrom`, keeping the `x-enumFrom` annotation;
- keep inline enums.

#### Scenario: Dictionary value removed after storage
- **WHEN** a stored collection holds a `lithology` value that is no longer in `dictionaries.lithologies`, and its merged response is validated against `out`
- **THEN** validation passes

#### Scenario: Column-backed fields present
- **WHEN** the collection `out` variant is derived
- **THEN** it defines `permid`, `references`, `latitude`, and `longitude`

### Requirement: Split and merge are driven by `x-storage`
`split(source, payload)` SHALL return `{ jsonb, columns, children }`:
- `jsonb` is the payload with every `x-storage` property removed;
- `columns` maps column names to storage values;
- `children` maps child table names to arrays of rows.

`merge(source, { jsonb, columns, children })` SHALL be its inverse. A property with `x-storage.column` and no codec SHALL map one-to-one to that column. A codec SHALL receive all sibling properties that name it and produce one storage value or one set of child rows, and SHALL provide the inverse for `merge`.

For any payload valid against `in-create`, the `jsonb` returned by `split` SHALL be valid against `db`. For any stored row, `split(merge(row))` with `readOnly` properties removed SHALL equal the row after codec normalization.

#### Scenario: Split yields valid jsonb
- **WHEN** a payload valid against the collection `in-create` variant is split
- **THEN** the returned `jsonb` validates against the collection `db` variant

#### Scenario: Unknown codec
- **WHEN** a source names a codec absent from the registry
- **THEN** `split` and `merge` throw naming the codec

### Requirement: `wgs84Point` codec
The `wgs84Point` codec SHALL:
- map sibling `latitude` and `longitude` to the text `SRID=4326;POINT(<longitude> <latitude>)`;
- map both absent to a NULL column;
- throw when exactly one of the two is present.

On merge it SHALL accept the column as GeoJSON (as selected by `ST_AsGeoJSON(location)::json`) and emit `latitude = coordinates[1]` and `longitude = coordinates[0]`. A NULL column SHALL emit neither.

#### Scenario: Coordinates to geography text
- **WHEN** a payload has `latitude: 45.5, longitude: -110.25`
- **THEN** `columns.location` is `SRID=4326;POINT(-110.25 45.5)`

#### Scenario: Half a coordinate pair
- **WHEN** a payload has `latitude` but no `longitude`
- **THEN** `split` throws

### Requirement: `collectionReferences` codec
The `collectionReferences` codec SHALL, on split:
- sort `references[]` by numeric `order`;
- emit the first entry's `referenceID` as `columns.reference_id`;
- emit the remaining entries, in sequence, as `additional_collection_refs` rows carrying `reference_id`.

On merge it SHALL emit the primary reference with `order: "1"`, followed by child rows ordered by `additional_collection_refs.id` ascending with `order: "2"`, `"3"`, and so on. `referenceID` SHALL carry `refs.id` as a string.

#### Scenario: Order normalized on round trip
- **WHEN** a payload with references ordered `"1"` and `"5"` is split and merged back
- **THEN** the merged references carry orders `"1"` and `"2"` with the same `referenceID`s in the same sequence

#### Scenario: Primary goes to the column
- **WHEN** a payload's references are `[{ referenceID: "12", order: "2" }, { referenceID: "7", order: "1" }]`
- **THEN** `columns.reference_id` is `7` and one child row carries `reference_id` `12`

### Requirement: A shared ajv factory registers the annotations
`createAjv()` SHALL return an ajv instance for draft 2019-09 with `allErrors: true`, with `x-enumFrom`, `x-storage`, and `x-create` registered as annotation keywords, so that every variant compiles with `strict: true`. The converted migrations and the audit SHALL obtain their validators from `createAjv()`.

#### Scenario: Strict compile succeeds
- **WHEN** each variant of each converted entity is resolved and compiled with `createAjv()`
- **THEN** compilation succeeds without unknown-keyword errors
