## MODIFIED Requirements

### Requirement: One annotated source per converted entity
`payloadSchemas/collection.schema.js`, `payloadSchemas/specimen.schema.js` and `payloadSchemas/person.schema.js` SHALL each export a single annotated source schema describing the entity object as the API sees it. The object SHALL NOT be wrapped in a `{ collection }`, `{ specimen }` or
`{ person }` envelope. None of the three files SHALL export a hand-maintained variant
(`collectionMigrationSchema`, `completeCollectionProperties`, `personSchema`, `createSchema`, `editSchema`,
`patchSchema`, `getSchema`), fastify `response` blocks, or `getPropertiesForPubType`. Every variant SHALL be
obtained through `deriveVariant`.

#### Scenario: No hand-maintained variants remain
- **WHEN** the three modules are imported
- **THEN** each exposes only its annotated source (plus optional non-schema helpers), and none of the listed names is exported

#### Scenario: Person source is not enveloped
- **WHEN** `payloadSchemas/person.schema.js` is imported
- **THEN** it exports `personSource`, whose `properties` are the person's own fields, and it does not export `personSchema`

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

For the person source:
- `permid` SHALL carry both, as on the other two.
- `legacyIDs` SHALL carry `readOnly` only.
- `totalHours` SHALL carry `readOnly` and `x-storage: { column: "total_hours" }`.
- `role` SHALL carry `x-storage: { column: "role_id", codec: "roleName" }` and no `readOnly`.
- `authorizer` SHALL carry `x-storage: { column: "authorizer_person_id", codec: "personPermid" }` and no `readOnly`.
- `active` SHALL carry `x-storage: { column: "active" }` and no `readOnly`.

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
- **THEN** `wgs84Point` and `collectionReferences` behave exactly as before

## ADDED Requirements

### Requirement: A codec declares the lookup sources it needs
A codec that cannot be computed from the payload alone SHALL declare a `sources` array. Each entry SHALL be
`{ table: <qualified name>, key: <column>, value: <column> }`, naming a table to read and the two columns
that form the mapping. `x-storage` SHALL NOT carry the lookup's table or columns: the annotation keeps the
three forms the annotation vocabulary defines, and the codec is what knows its own source.

`collectCodecSources(source)` SHALL walk the source's `x-storage` codecs and return the union of their
declared sources, with duplicates removed.

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

### Requirement: The codec context is loaded per selection and applied purely
`loadCodecContext(pg, sources, selection)` SHALL return a `Map` from each source's table name to
`{ byKey, byValue }` lookup maps, both populated from one read per source.

`selection` SHALL name, per source, the column being restricted on and the values to restrict to, so that the
table is read by `WHERE <column> = ANY($1)` rather than in full. The restriction SHALL be expressible in
either direction: on the source's `key` column, which is what `merge` needs when it starts from a stored
column, and on its `value` column, which is what `split` needs when it starts from a payload — resolving a
permid to a `persons.id`, for instance, restricts on `permid`. A source omitted from `selection` SHALL be read
in full.

A source whose table is in the `dictionaries` schema SHALL be read once per run, in full, and SHALL NOT be
restricted per batch: these are curated vocabularies, and `dictionaries.roles` holds six rows. Every other
source SHALL be read per selection, so that a caller iterating a large table in batches never loads more of a
looked-up table than the batch references.

`split` and `merge` SHALL perform no I/O. A caller SHALL be able to supply a hand-built `Map` in place of a
loaded one, so that codecs are testable without a database, as `applyEnums` already is.

A codec SHALL throw, naming the codec and the unresolved value, when the context lacks a mapping it needs.

#### Scenario: Selection restricts an entity source
- **WHEN** the audit resolves a batch of 5,000 rows against the `persons` source
- **THEN** one query reads only the `persons` ids appearing in that batch

#### Scenario: Restriction in the value direction
- **WHEN** a caller is about to `split` payloads naming authorizers by permid
- **THEN** it may select on the source's `value` column, and `persons` is read by `WHERE permid = ANY($1)`

#### Scenario: One read serves both directions
- **WHEN** a batch is merged and then split back
- **THEN** no second query is issued for the return direction, because the read that populated `byKey` populated `byValue`

#### Scenario: Dictionary source is not batched
- **WHEN** an audit of 275,554 collections runs in 5,000-row batches against a source in `dictionaries`
- **THEN** that source is read once for the run, not once per batch

#### Scenario: Tests resolve from fixtures
- **WHEN** a test calls `split(personSource, payload, fixtureContext)` with no database connection
- **THEN** it returns the same result a loaded context would produce

#### Scenario: Missing mapping
- **WHEN** `merge` is given a `role_id` absent from the context
- **THEN** it throws naming `roleName` and that id

#### Scenario: Context absent entirely
- **WHEN** `split` is called on a source whose codecs declare sources and no `ctx` is given
- **THEN** it throws rather than silently dropping the property

### Requirement: `roleName` codec
The `roleName` codec SHALL declare the source `{ table: "dictionaries.roles", key: "id", value: "name" }`.

On split it SHALL map the payload's `role` name to that row's `id` in `columns.role_id`. On merge it SHALL
map `columns.role_id` to that row's `name`. An absent `role` on split SHALL emit no column, leaving the
default to the caller.

The payload carries the role's name and never its id, because this project exposes permids rather than
internal ids, and `dictionaries.roles` has no permid; an id would also be meaningless to a client without a
roles route.

#### Scenario: Name to id
- **WHEN** a person payload has `role: "Authorizer"` and `dictionaries.roles` holds that name at `id = 3`
- **THEN** `columns.role_id` is `3`

#### Scenario: Id to name
- **WHEN** a stored row has `role_id = 6`
- **THEN** the merged payload has `role: "Person"`

#### Scenario: Unknown role name
- **WHEN** a payload has `role: "Curator"` and no such row exists
- **THEN** `split` throws naming `roleName` and `'Curator'`

### Requirement: `personPermid` codec
The `personPermid` codec SHALL declare the source `{ table: "persons", key: "id", value: "permid" }`.

On split it SHALL map the payload's `authorizer` permid to that person's `id` in
`columns.authorizer_person_id`. On merge it SHALL map `columns.authorizer_person_id` to that person's
`permid`. An absent `authorizer` on split SHALL emit no column.

Resolving a permid to an `id` is exact rather than approximate: `persons.permid` is `NOT NULL UNIQUE`, and on
versioned tables `swing_fks_to_new_version()` keeps every foreign key pointing at the lineage head, so an id
and a permid name the same row in both directions.

#### Scenario: Permid to id
- **WHEN** a person payload names an `authorizer` whose permid belongs to `persons.id = 1106`
- **THEN** `columns.authorizer_person_id` is `1106`

#### Scenario: Id to permid
- **WHEN** a stored row has `authorizer_person_id = 1106`
- **THEN** the merged payload's `authorizer` is that person's `permid`, and no `persons.id` appears in the payload

#### Scenario: Unknown permid
- **WHEN** a payload names an `authorizer` permid held by no person
- **THEN** `split` throws naming `personPermid` and that permid
