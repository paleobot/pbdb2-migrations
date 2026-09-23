## RENAMED Requirements

- FROM: `### Requirement: `collectionReferences` codec`
- TO: `### Requirement: `referenceList` codec`

## MODIFIED Requirements

### Requirement: One annotated source per converted entity
`payloadSchemas/collection.schema.js`, `payloadSchemas/specimen.schema.js`, `payloadSchemas/person.schema.js`, `payloadSchemas/reference.schema.js`, `payloadSchemas/authority.schema.js` and `payloadSchemas/schema.schema.js` SHALL each export a single annotated source schema describing the entity object as the API sees it. The object SHALL NOT be wrapped in a `{ collection }`, `{ specimen }`, `{ person }`,
`{ reference }`, `{ authority }` or `{ schema }` envelope. None of the six files SHALL export a hand-maintained variant
(`collectionMigrationSchema`, `completeCollectionProperties`, `personSchema`, `referenceSchema`,
`authoritySchema`, `schemaSchema`, `createSchema`, `editSchema`, `patchSchema`, `getSchema`), fastify `response` blocks, or
`getPropertiesForPubType`. Every variant SHALL be obtained through `deriveVariant`.

#### Scenario: No hand-maintained variants remain
- **WHEN** the six modules are imported
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

### Requirement: Split and merge are driven by `x-storage`
`split(source, payload, ctx)` SHALL return `{ jsonb, columns, children }`:
- `jsonb` is the payload with every `x-storage` property removed;
- `columns` maps column names to storage values;
- `children` maps child table names to arrays of rows.

`merge(source, { jsonb, columns, children }, ctx)` SHALL be its inverse. A property with `x-storage.column`
and no codec SHALL map one-to-one to that column. A codec SHALL receive all sibling properties that name it
and produce one storage value or one set of child rows, and SHALL provide the inverse for `merge`. `ctx` is
the codec context defined below; it SHALL be optional, and a codec that declares no sources SHALL ignore it.

For any payload valid against `in-create`, the `jsonb` returned by `split` SHALL be valid against `db`. For
any stored row, `split(merge(row))` with `readOnly` properties removed SHALL equal the row after codec
normalization.

#### Scenario: Split yields valid jsonb
- **WHEN** a payload valid against the collection `in-create` variant is split
- **THEN** the returned `jsonb` validates against the collection `db` variant

#### Scenario: Unknown codec
- **WHEN** a source names a codec absent from the registry
- **THEN** `split` and `merge` throw naming the codec

#### Scenario: Context-free codecs are unaffected
- **WHEN** a collection payload is split and merged with no `ctx` argument
- **THEN** `wgs84Point` and `referenceList` behave exactly as before

### Requirement: A codec declares the lookup sources it needs
A codec that cannot be computed from the payload alone SHALL declare a `sources` array. Each entry SHALL be
`{ table: <qualified name>, key: <column>, value: <column> }`, naming a table to read and the two columns
that form the mapping, and MAY carry `versioned: true` to declare that the table holds a succession lineage.
`x-storage` SHALL NOT carry the lookup's table or columns: the annotation keeps the three forms the annotation
vocabulary defines, and the codec is what knows its own source.

`collectCodecSources(source)` SHALL walk the source's `x-storage` codecs and return the union of their
declared sources, with duplicates removed.

`codecKeyColumns(source)` SHALL return, per looked-up table, the `x-storage` columns whose values are that
source's keys, so that a caller reading rows in batches can build its selection by following the annotations
rather than by naming the columns itself. A codec whose `x-storage` names a child table rather than a column
contributes nothing, and a caller SHALL read such a source in full rather than per batch.

When a property carries both `x-enumFrom` and a codec declaring a source in the `dictionaries` schema, the
two SHALL name the same table. Source validation SHALL throw naming the property when they do not, because
the accepted values and the stored key would otherwise be free to drift apart.

#### Scenario: Sources collected from the source schema
- **WHEN** `collectCodecSources(personSource)` is called
- **THEN** it returns the `dictionaries.roles` and `persons` entries declared by `roleName` and `personPermid`, each once

#### Scenario: Annotation carries no lookup detail
- **WHEN** the person source is inspected at `role`
- **THEN** its `x-storage` is exactly `{ column: "role_id", codec: "roleName" }`

#### Scenario: Enum and codec disagree
- **WHEN** a property carries `x-enumFrom: { table: "genders", column: "name" }` and a codec declaring `dictionaries.roles`
- **THEN** source validation throws naming that property

#### Scenario: A child-table codec offers no key columns
- **WHEN** `codecKeyColumns(collectionSource)` is called
- **THEN** it returns no entry for `refs`, because `referenceList` is annotated `{ table, codec }` and the refs a batch cites live both in `collections.reference_id` and in the child rows

### Requirement: `referenceList` codec
The `referenceList` codec SHALL declare the source
`{ table: "refs", key: "id", value: "permid", versioned: true }`.

It maps a `references[]` array to the parent row's `reference_id` column plus rows of the child table that
the property's `x-storage` names. It SHALL NOT name any entity or child table itself: collection annotates it
with `additional_collection_refs`, schema with `additional_schema_refs`, and the foreign key from a child row
back to its parent is supplied by the caller that reads or writes the child rows, not by the codec.

On split it SHALL:
- sort `references[]` by numeric `order`;
- resolve the first entry's `referenceID` permid to that reference's head `id` and emit it as `columns.reference_id`;
- resolve the remaining entries' permids and emit them, in sequence, as rows of the `x-storage` child table carrying `reference_id`.

On merge it SHALL emit the primary reference with `order: "1"`, followed by child rows ordered by the child
table's `id` ascending with `order: "2"`, `"3"`, and so on, mapping each stored `reference_id` back to that
reference's `permid`.

`referenceID` SHALL carry a reference's permid, not `refs.id`. This project exposes permids rather than
internal ids. The storage topology is unchanged by the codec: the primary occupies the parent's `reference_id`,
the rest are child rows, and those rows have no order column, so order is re-derived on merge.

An unresolvable permid on split, or an unresolvable `reference_id` on merge, SHALL throw naming
`referenceList` and the value.

The codec was named `collectionReferences` while collection was its only caller. No codec by that name SHALL
remain in the registry.

#### Scenario: Order normalized on round trip
- **WHEN** a payload with references ordered `"1"` and `"5"` is split and merged back
- **THEN** the merged references carry orders `"1"` and `"2"` with the same `referenceID`s in the same sequence

#### Scenario: Primary goes to the column
- **WHEN** a payload's references are `[{ referenceID: "<permid-B>", order: "2" }, { referenceID: "<permid-A>", order: "1" }]` and those permids belong to `refs.id` 7 and 12 respectively
- **THEN** `columns.reference_id` is `7` and one child row carries `reference_id` `12`

#### Scenario: Merge yields permids
- **WHEN** a stored collection has `reference_id = 7` and one child row with `reference_id = 12`
- **THEN** the merged payload's `references[]` carries those two references' permids, and no `refs.id` appears anywhere in the payload

#### Scenario: Child table follows the annotation
- **WHEN** a schema payload with two references is split
- **THEN** the second reference is emitted as a row of `additional_schema_refs`, and nothing is emitted for `additional_collection_refs`

#### Scenario: Superseded reference is never cited
- **WHEN** the ref at `id = 7` is superseded by a new version sharing its permid
- **THEN** splitting a payload naming that permid yields the new head's `id`, not `7`

#### Scenario: Unknown reference permid
- **WHEN** a payload names a `referenceID` permid held by no reference
- **THEN** `split` throws naming `referenceList` and that permid

#### Scenario: Old name is gone
- **WHEN** a source names the codec `collectionReferences`
- **THEN** `split` and `merge` throw naming it as an unknown codec

### Requirement: `referencePermid` codec
The `referencePermid` codec SHALL declare the source
`{ table: "refs", key: "id", value: "permid", versioned: true }`, the same source `referenceList`
declares.

On split it SHALL map the payload's `reference` permid to that reference's head `id` in the column
`x-storage` names. On merge it SHALL map that column's id to the reference's `permid` as `reference`. An absent
`reference` on split SHALL emit no column, and a NULL column on merge SHALL emit no property.

Ids SHALL be keyed as strings, as in `referenceList`, because `refs.id` is a bigint that node-postgres
returns as a string.

An unresolvable permid on split, or an unresolvable id on merge, SHALL throw naming `referencePermid` and the
value.

Because the codec is annotated with a `column`, `codecKeyColumns` SHALL map `refs` to that column for a source
using it, so that a batched caller can select `refs` by the ids its rows hold.

#### Scenario: Permid to id
- **WHEN** an authority payload names a `reference` whose permid belongs to the head ref at `refs.id = 7`
- **THEN** `columns.reference_id` is `"7"`

#### Scenario: Id to permid
- **WHEN** a stored authority has `reference_id = 7`
- **THEN** the merged payload's `reference` is that ref's `permid`, and no `refs.id` appears in the payload

#### Scenario: Superseded reference resolves to the head
- **WHEN** the ref at `id = 7` is superseded by a new version sharing its permid
- **THEN** splitting a payload naming that permid yields the new head's `id`, not `7`

#### Scenario: Unknown reference permid
- **WHEN** a payload names a `reference` permid held by no reference
- **THEN** `split` throws naming `referencePermid` and that permid

#### Scenario: Key column for batched selection
- **WHEN** `codecKeyColumns(authoritySource)` is called
- **THEN** it maps `refs` to `reference_id`

## ADDED Requirements

### Requirement: The schema source
`schemaSource` SHALL declare exactly these root properties:

| property | schema | annotations |
|---|---|---|
| `permid` | string | `readOnly`, `x-storage: { column: "permid" }` |
| `legacyIDs` | object with `pbotID`: string | `readOnly` |
| `references` | array, `minItems: 1`, of `{ referenceID: string, order: string }` with both required | `x-storage: { table: "additional_schema_refs", codec: "referenceList" }` |
| `title` | string | |
| `year` | string, `maxLength: 4` | |
| `purpose` | string | |
| `authors` | array, `minItems: 1`, of `{ familyName: string, givenName: string, order: integer ≥ 1 }` | |
| `acknowledgments` | string | |
| `partsPreserved` | array of strings | items `x-enumFrom: { table: "parts_preserved", column: "name" }` |
| `notableFeatures` | array of strings | items `x-enumFrom: { table: "notable_features", column: "name" }` |

Base `required` SHALL be `title`, `year` and `references`. Because `references` is an `x-storage` property,
the `db` variant SHALL neither declare nor require it, and SHALL require only `title` and `year`, as the
legacy schema did.

`x-create` SHALL constrain `year` to `pattern: "^[0-9]{4}$"`, declared with `type: "string"` so that the
`in-create` variant compiles in strict mode. The `db` variant SHALL carry no pattern on `year`.

Every jsonb key SHALL keep the name and shape the PBot schema migration writes. The source SHALL declare no
character or state tree: whether the API creates a schema's characters and states in the same call is not
decided, and the stored jsonb holds none. The commented-out `$defs` and `schemaDefinition` sketches MAY remain
in the file as comments.

`authorizer_person_id` and `enterer_person_id` SHALL NOT be exposed as payload fields.

#### Scenario: Stored payload validates at rest
- **WHEN** `{ legacyIDs: { pbotID: "p-1" }, title: "Fungi Morphology", year: "2023", purpose: "…", authors: [{ order: 1, givenName: "Claire", familyName: "Cleveland" }], partsPreserved: ["leaf"] }` is validated against the resolved `db` variant
- **THEN** it passes, with no `references` and no `permid` present

#### Scenario: Legacy requirements carried over
- **WHEN** a payload omitting `title`, or omitting `year`, or with `year: "20230"`, or with `authors: []`, or with an author `order: 0`, or with an undeclared key, is validated against `db`
- **THEN** it fails

#### Scenario: Dictionary values enforced
- **WHEN** a payload with `partsPreserved: ["bark"]` or `notableFeatures: ["pith structure"]` is validated against the resolved `db` variant
- **THEN** it fails, because neither value is in its dictionary table

#### Scenario: References required on create
- **WHEN** a create body with `title` and `year` but no `references`, or with `references: []`, is validated against `in-create`
- **THEN** it fails

#### Scenario: Reference item needs its permid
- **WHEN** a create body carries `references: [{ order: "1" }]`
- **THEN** `in-create` rejects it for the missing `referenceID`

#### Scenario: Four-digit year on create
- **WHEN** create bodies otherwise valid carry `year: "0"`, `year: "abc"` and `year: "2023"`
- **THEN** `in-create` rejects the first two and accepts the third

#### Scenario: Patch guard blocks the read-only fields
- **WHEN** the `patch-guard` variant is derived
- **THEN** it rejects exactly `permid` and `legacyIDs` as keys

#### Scenario: No tree in the payload
- **WHEN** the schema source is inspected
- **THEN** it declares no `characters`, `states` or `schemaDefinition` property and no `$defs`
