## MODIFIED Requirements

### Requirement: One annotated source per converted entity
`payloadSchemas/collection.schema.js`, `payloadSchemas/specimen.schema.js`, `payloadSchemas/person.schema.js`, `payloadSchemas/reference.schema.js`, `payloadSchemas/authority.schema.js`, `payloadSchemas/schema.schema.js`, `payloadSchemas/character.schema.js` and `payloadSchemas/state.schema.js` SHALL each export a single annotated source schema describing the entity object as the API sees it. The object SHALL NOT be wrapped in a `{ collection }`, `{ specimen }`, `{ person }`,
`{ reference }`, `{ authority }`, `{ schema }`, `{ character }` or `{ state }` envelope. None of the eight files SHALL export a hand-maintained variant
(`collectionMigrationSchema`, `completeCollectionProperties`, `personSchema`, `referenceSchema`,
`authoritySchema`, `schemaSchema`, `characterSchema`, `stateSchema`, `createSchema`, `editSchema`, `patchSchema`, `getSchema`), fastify `response` blocks, or
`getPropertiesForPubType`. Every variant SHALL be obtained through `deriveVariant`.

#### Scenario: No hand-maintained variants remain
- **WHEN** the eight modules are imported
- **THEN** each exposes only its annotated source (plus optional non-schema helpers), and none of the listed names is exported

#### Scenario: Person source is not enveloped
- **WHEN** `payloadSchemas/person.schema.js` is imported
- **THEN** it exports `personSource`, whose `properties` are the person's own fields, and it does not export `personSchema`

#### Scenario: Reference source is not enveloped
- **WHEN** `payloadSchemas/reference.schema.js` is imported
- **THEN** it exports `referenceSource`, whose `properties` are the reference's own fields, with no `reference` wrapper and no `allowDuplicate`, and it does not export `referenceSchema` or `getSchema`

#### Scenario: Authority source is not enveloped
- **WHEN** `payloadSchemas/authority.schema.js` is imported
- **THEN** it exports `authoritySource` (and `default`), whose `properties` are the authority's own fields with no `authority` wrapper, and it does not export `authoritySchema`

#### Scenario: Schema source is not enveloped
- **WHEN** `payloadSchemas/schema.schema.js` is imported
- **THEN** it exports `schemaSource` (and `default`), whose `properties` are the schema's own fields with no `schema` wrapper, and it does not export `schemaSchema`

#### Scenario: Character and state sources are not enveloped
- **WHEN** `payloadSchemas/character.schema.js` and `payloadSchemas/state.schema.js` are imported
- **THEN** they export `characterSource` and `stateSource` respectively (each also as `default`), whose `properties` are the entity's own fields with no `character` or `state` wrapper, and neither exports `characterSchema` or `stateSchema`

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
- collection `references` SHALL carry `x-storage: { table: "additional_collection_refs", codec: "referenceList" }`.

For the person source:
- `permid` SHALL carry both, as on the other two.
- `legacyIDs` SHALL carry `readOnly` only.
- `totalHours` SHALL carry `readOnly` and `x-storage: { column: "total_hours" }`.
- `role` SHALL carry `x-storage: { column: "role_id", codec: "roleName" }` and no `readOnly`.
- `authorizer` SHALL carry `x-storage: { column: "authorizer_person_id", codec: "personPermid" }` and no `readOnly`.
- `active` SHALL carry `x-storage: { column: "active" }` and no `readOnly`.

For the schema source:
- `permid` SHALL carry both, as on collection and specimen.
- `legacyIDs` SHALL carry `readOnly` only.
- `references` SHALL carry `x-storage: { table: "additional_schema_refs", codec: "referenceList" }` and no `readOnly`.

For the character and state sources:
- `permid` SHALL carry both.
- `legacyIDs` SHALL carry `readOnly` only.
- state `quantitative` SHALL carry `x-storage: { column: "quantitative" }` and no `readOnly`.

`readOnly` marks a value the server assigns, not one only a privileged caller may set. `role`, `authorizer`
and `active` are settable by an authorized caller, and which callers those are is a route concern that JSON
Schema cannot express; marking them `readOnly` would make them unsettable by anyone, because `in-create`
removes them and `patch-guard` rejects them. The person source SHALL define no `password` property and no
`createdAt` property.

#### Scenario: Read-only yet stored in jsonb
- **WHEN** the collection source is inspected at `legacyIDs`
- **THEN** it has `readOnly: true` and no `x-storage`

#### Scenario: Stored elsewhere yet writable
- **WHEN** the collection source is inspected at `location.coordinates.latitude`
- **THEN** it has `x-storage` naming the `location` column and the `wgs84Point` codec, and no `readOnly`

#### Scenario: Nested read-only rejected
- **WHEN** a source marks `location.scale` as `readOnly`
- **THEN** `deriveVariant` throws naming the path

#### Scenario: Privileged but writable
- **WHEN** the person source is inspected at `role`, `authorizer` and `active`
- **THEN** none of them carries `readOnly`, and each carries `x-storage`

#### Scenario: Person read-only set
- **WHEN** the person `patch-guard` variant is derived
- **THEN** its `propertyNames.not.enum` is exactly `permid`, `legacyIDs` and `totalHours`

#### Scenario: Credentials are not a payload field
- **WHEN** the person source is inspected
- **THEN** it defines no `password` property, because credentials are handled by a separate flow, and no `createdAt` property, matching collection and specimen

## ADDED Requirements

### Requirement: The character source
`characterSource` SHALL declare exactly these root properties:

| property | schema | annotations |
|---|---|---|
| `permid` | string | `readOnly`, `x-storage: { column: "permid" }` |
| `legacyIDs` | object with `pbotID`: string | `readOnly` |
| `name` | string | |
| `definition` | string | |

Base `required` SHALL be `name` only. `definition` SHALL NOT be required in any variant, and SHALL NOT admit
`null`: a character without a definition omits the key.

`x-create` SHALL constrain `name` to `minLength: 1`, declared with `type: "string"` so that the `in-create`
variant compiles in strict mode. The `db` variant SHALL carry no length constraint on `name`.

The source SHALL declare no parent and no sibling order. `characters.parent_schema_id`,
`characters.parent_character_id` and `characters.sort_order` stay columns that no payload field maps to, until
the API decides whether a character is created on its own or within its schema's tree.

`authorizer_person_id` and `enterer_person_id` SHALL NOT be exposed as payload fields.

#### Scenario: Stored payloads validate at rest
- **WHEN** `{ legacyIDs: { pbotID: "c-1" }, name: "General Features", definition: "Position, attachement, organ" }` and `{ legacyIDs: { pbotID: "c-2" }, name: "Leaf attachment" }` are validated against `db`
- **THEN** both pass

#### Scenario: Null definition rejected
- **WHEN** `{ legacyIDs: { pbotID: "c-2" }, name: "Leaf attachment", definition: null }` is validated against `db`
- **THEN** it fails

#### Scenario: Legacy requirement carried over
- **WHEN** a payload omitting `name`, or with an undeclared key such as `order` or `parentCharacter`, is validated against `db`
- **THEN** it fails

#### Scenario: Non-empty name on create
- **WHEN** create bodies `{ name: "" }` and `{ name: "Leaf shape" }` are validated against `in-create`
- **THEN** the first is rejected and the second accepted

#### Scenario: Patch guard blocks the read-only fields
- **WHEN** the character `patch-guard` variant is derived
- **THEN** it rejects exactly `permid` and `legacyIDs` as keys

### Requirement: The state source
`stateSource` SHALL declare exactly these root properties:

| property | schema | annotations |
|---|---|---|
| `permid` | string | `readOnly`, `x-storage: { column: "permid" }` |
| `legacyIDs` | object with `pbotID`: string | `readOnly` |
| `name` | string | |
| `definition` | string | |
| `quantitative` | boolean | `x-storage: { column: "quantitative" }` |

`required`, `definition` and the create-time `name` rule SHALL be as on the character source.

`quantitative` SHALL NOT be required in any variant and SHALL NOT be `readOnly`. It is set by the client, and a
create body that omits it SHALL leave the column to its default, `false`: `split` emits no `quantitative`
column when the property is absent. It is independent of `name`; no variant ties it to the name `quantity`.

The source SHALL declare no parent, no sibling order and no measured value. `states.parent_character_id`,
`states.parent_state_id` and `states.sort_order` stay columns that no payload field maps to. A quantitative
value belongs to an observation of the state, not to the state.

`authorizer_person_id` and `enterer_person_id` SHALL NOT be exposed as payload fields.

#### Scenario: Stored payload validates at rest
- **WHEN** `{ legacyIDs: { pbotID: "s-1" }, name: "quantity", definition: "Midsection = middle 50% of lamina between apex and base (degrees)" }` is validated against `db`
- **THEN** it passes, with no `quantitative` present

#### Scenario: Quantitative lives in a column
- **WHEN** a payload carrying `quantitative: true` is validated against `db`
- **THEN** it fails on the undeclared key

#### Scenario: Quantitative is settable and optional on create
- **WHEN** create bodies `{ name: "length", quantitative: true }` and `{ name: "ovate" }` are validated against `in-create`
- **THEN** both pass

#### Scenario: Quantitative round-trips through its column
- **WHEN** a stored state with `quantitative = true` is merged
- **THEN** the payload carries `quantitative: true`, and splitting it back yields `columns.quantitative` equal to `true`

#### Scenario: Patch guard blocks the read-only fields
- **WHEN** the state `patch-guard` variant is derived
- **THEN** it rejects exactly `permid` and `legacyIDs` as keys, and accepts `{ quantitative: false }`
