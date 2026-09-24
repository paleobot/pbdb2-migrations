# payload-schema-variants Specification

## Purpose
Derive every payload schema in use (`db`, `in-create`, `patch-guard`, `out`) from one annotated source per entity (`payloadSchemas/*.schema.js`), and split and merge payloads between the API shape and their storage (jsonb, columns, child rows) using the same annotations (`x-storage`, `readOnly`, `x-create`) and named codecs. PATCH follows merge-then-validate (`payloadSchemas/DESIGN_NOTES.md`).
## Requirements
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

### Requirement: The codec context is loaded per selection and applied purely
`loadCodecContext(pg, sources, selection, reuse)` SHALL return a `Map` from each source's table name to
`{ byKey, byValue }` lookup maps, both populated from one read per source.

A source declaring `versioned: true` SHALL be read with its superseded rows excluded, so that both `byKey` and
`byValue` are built from lineage heads only. On such a table many rows share one permid and `value → key` is
not a function; only the head restriction makes it one. Excluding superseded rows from `byKey` as well is
deliberate: foreign keys into a versioned table always denote the head, so nothing is lost, and a stored id
that does not resolve is a violated invariant that SHALL surface as a throw rather than resolve quietly.

`reuse` SHALL be an already-loaded context that seeds the result, and a source whose table it already holds
SHALL NOT be read again. Each call SHALL return a new `Map`, so that one batch's selection never accumulates
into the next one's.

`selection` SHALL name, per source, the column being restricted on and the values to restrict to, so that the
table is read by `WHERE <column> = ANY($1)` rather than in full. The restriction SHALL be expressible in
either direction: on the source's `key` column, which is what `merge` needs when it starts from a stored
column, and on its `value` column, which is what `split` needs when it starts from a payload — resolving a
permid to a `refs.id`, for instance, restricts on `permid`. A source omitted from `selection` SHALL be read
in full.

A source whose table is in the `dictionaries` schema SHALL be read once per run, in full, and SHALL NOT be
restricted per batch: these are curated vocabularies, and `dictionaries.roles` holds six rows. For every other
source the caller SHALL decide: one it can build a selection for SHALL be restricted per batch, so that
iterating a large table never loads more of a looked-up table than the batch references; one it cannot SHALL
be pre-loaded once for the run. Size is not the criterion — a lookup table is what is loaded, and it is
routinely far smaller than the number of rows citing it.

`split` and `merge` SHALL perform no I/O. A caller SHALL be able to supply a hand-built `Map` in place of a
loaded one, so that codecs are testable without a database, as `applyEnums` already is.

A codec SHALL throw, naming the codec and the unresolved value, when the context lacks a mapping it needs.

#### Scenario: Selection restricts an entity source
- **WHEN** the audit resolves a batch of 5,000 rows against the `persons` source
- **THEN** one query reads only the `persons` ids appearing in that batch

#### Scenario: Restriction in the value direction
- **WHEN** a caller is about to `split` payloads naming references by permid
- **THEN** it may select on the source's `value` column, and `refs` is read by `WHERE permid = ANY($1)`

#### Scenario: One read serves both directions
- **WHEN** a batch is merged and then split back
- **THEN** no second query is issued for the return direction, because the read that populated `byKey` populated `byValue`

#### Scenario: Dictionary source is not batched
- **WHEN** an audit of 275,554 collections runs in 5,000-row batches against a source in `dictionaries`
- **THEN** that source is read once for the run and passed to each batch as `reuse`, not read once per batch

#### Scenario: Versioned source resolves to the head
- **WHEN** a permid is held by both a superseded ref and its head
- **THEN** the context maps that permid to the head's `id`, and the superseded row appears in neither map

#### Scenario: Unversioned source is not filtered
- **WHEN** a source does not declare `versioned`
- **THEN** no succession filter is applied, and a source such as `persons` resolves by its `UNIQUE` permid alone

#### Scenario: Selection columns follow the annotations
- **WHEN** `codecKeyColumns(personSource)` is called
- **THEN** it maps `dictionaries.roles` to `role_id` and `persons` to `authorizer_person_id`, the columns `x-storage` names for the two codecs

#### Scenario: Tests resolve from fixtures
- **WHEN** a test calls `split(personSource, payload, fixtureContext)` with no database connection
- **THEN** it returns the same result a loaded context would produce

#### Scenario: Missing mapping
- **WHEN** `merge` is given a `role_id` absent from the context
- **THEN** it throws naming `roleName` and that id

#### Scenario: Context absent entirely
- **WHEN** `split` is called on a source whose codecs declare sources and no `ctx` is given
- **THEN** it throws rather than silently dropping the property

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
The `personPermid` codec SHALL declare the source `{ table: "persons", key: "id", value: "permid" }`, without
`versioned`, because `persons` holds no succession lineage.

On split it SHALL map the payload's `authorizer` permid to that person's `id` in
`columns.authorizer_person_id`. On merge it SHALL map `columns.authorizer_person_id` to that person's
`permid`. An absent `authorizer` on split SHALL emit no column.

Resolving a permid to an `id` is exact rather than approximate, and two separate facts make it so. On
`persons`, which is unversioned, `permid` is `NOT NULL UNIQUE`, so at most one row bears it and the reverse
direction is a function. That reasoning does not transfer: on a versioned table every version shares one
permid, `UNIQUE` is absent by design, and it is the head restriction of the requirement above that makes the
reverse direction a function. What `swing_fks_to_new_version()` provides is the forward direction — it keeps
every foreign key pointing at the lineage head, so a stored id always denotes the head on either kind of table.

#### Scenario: Permid to id
- **WHEN** a person payload names an `authorizer` whose permid belongs to `persons.id = 1106`
- **THEN** `columns.authorizer_person_id` is `1106`

#### Scenario: Id to permid
- **WHEN** a stored row has `authorizer_person_id = 1106`
- **THEN** the merged payload's `authorizer` is that person's `permid`, and no `persons.id` appears in the payload

#### Scenario: Unknown permid
- **WHEN** a payload names an `authorizer` permid held by no person
- **THEN** `split` throws naming `personPermid` and that permid

### Requirement: A shared ajv factory registers the annotations
`createAjv()` SHALL return an ajv instance for draft 2019-09 with `allErrors: true` and `strict: true`, except `strictRequired: false`. `x-create` merges as an `allOf` entry whose `required` names properties defined on the parent node, which that check rejects. `x-enumFrom`, `x-storage`, `x-create`, and `x-variant` (the root marker `deriveVariant` sets) SHALL be registered as annotation keywords, so that every variant compiles in strict mode. The converted migrations and the audit SHALL obtain their validators from `createAjv()`.

#### Scenario: Strict compile succeeds
- **WHEN** each variant of each converted entity is resolved and compiled with `createAjv()`
- **THEN** compilation succeeds without unknown-keyword errors

### Requirement: The reference source defines its publication types once
`payloadSchemas/reference.schema.js` SHALL define its publication types in a single table, `PUBLICATION_TYPES`,
mapping each type name to the fields that type allows and the fields it requires on create. Every rule that
depends on the set of types SHALL be generated from that table:

- `publicationType` SHALL carry an inline `enum` equal to the table's keys, in table order.
- The source's `properties` SHALL declare every field any type allows, at the top level. No property SHALL
  be declared inside a conditional.
- `x-create` SHALL hold one conditional per type,
  `if: { properties: { publicationType: { const: <type> } }, required: ["publicationType"] }`, whose `then`
  requires that type's required fields and restricts the object's keys with
  `propertyNames: { enum: [<shared fields>, <that type's fields>] }`.

The `required` inside each `if` is load-bearing: without it, an object with no `publicationType` would satisfy
every `if` at once.

A type MAY be declared unrestricted, in which case its conditional carries no `propertyNames`. `other` SHALL be
unrestricted and SHALL require nothing beyond the base and `x-create` requirements every type shares, because
it is the catch-all for publications no other type describes.

The types, their allowed fields beyond the shared ones, and their create-time required fields SHALL be:

| type | allowed | required on create |
|---|---|---|
| `journal article` | `journalTitle`, `journalVolume`, `journalNumber` | `journalTitle`, `journalVolume` |
| `standalone book` | `bookType`, `publisher`, `publicationCity` | `publisher`, `authors`, `pages` |
| `serial monograph` | `publisher`, `publicationCity`, `seriesTitle`, `seriesVolume`, `editors` | `seriesTitle`, `seriesVolume`, `publisher`, `authors`, `pages` |
| `article in edited collection` | `bookTitle`, `publisher`, `editors`, `publicationCity` | `bookTitle`, `authors`, `publisher`, `editors`, `pages` |
| `edited collection` | `publisher`, `editors`, `publicationCity` | `publisher`, `editors`, `pages` |
| `unpublished` | `description` | `authors`, `description` |
| `other` | every declared field | — |

The shared fields are `permid`, `legacyIDs`, `publicationType`, `title`, `authors`, `publicationYear`, `pages`,
`doi`, `language` and `comments`. Base `required` SHALL be `publicationType` and `publicationYear`; `title` SHALL
be required by `x-create` only, because stored refs without a title are legitimate history.

`permid` SHALL carry `x-storage: { column: "permid" }` and `readOnly`. `legacyIDs` SHALL be `readOnly`.
`authorizer_person_id` and `enterer_person_id` SHALL NOT be exposed as payload fields.

The source SHALL carry no hand-written description of per-type fields; the table is the documentation.

#### Scenario: The enum follows the table
- **WHEN** `referenceSource` is inspected at `publicationType`
- **THEN** its `enum` equals the keys of `PUBLICATION_TYPES`, and it carries no `x-enumFrom`

#### Scenario: Stored legacy extras validate at rest
- **WHEN** a stored journal article carrying `publisher: "Elsevier BV"` is validated against the `db` variant
- **THEN** it passes, because `db` declares every field and applies no per-type rule

#### Scenario: A client is told which field its type forbids
- **WHEN** a create body `{ publicationType: "journal article", title, publicationYear, journalTitle, journalVolume, publisher: "Elsevier BV" }` is validated against `in-create`
- **THEN** it fails with a `propertyNames` error naming `publisher`

#### Scenario: Create-time required fields per type
- **WHEN** a create body of type `serial monograph` omits `seriesVolume`
- **THEN** `in-create` rejects it naming `seriesVolume`, and the `db` variant accepts the same object

#### Scenario: Serial monograph may name editors
- **WHEN** a complete `serial monograph` create body carries `editors: "S. G. Lucas and M. Morales"`
- **THEN** it passes `in-create`

#### Scenario: Other allows every declared field
- **WHEN** a create body of type `other` carries `publisher`, `publicationCity`, `editors` and `journalTitle`
- **THEN** it passes `in-create`, and an undeclared key is still rejected by `unevaluatedProperties`

#### Scenario: Missing type satisfies no conditional
- **WHEN** a create body omits `publicationType`
- **THEN** `in-create` rejects it for the missing base `required` field, and no type's `then` is applied

#### Scenario: Title is required on create only
- **WHEN** a stored ref with no `title` is validated against `db`, and the same object as a create body against `in-create`
- **THEN** `db` accepts it and `in-create` rejects it naming `title`

#### Scenario: Book type is allowed where it belongs
- **WHEN** a complete `standalone book` create body carries `bookType: "Ph.D. thesis"`
- **THEN** it passes `in-create`, and the same field on a `journal article` fails with a `propertyNames` error naming `bookType`

### Requirement: The authority source
`authoritySource` SHALL declare exactly these root properties:

| property | schema | annotations |
|---|---|---|
| `permid` | string | `readOnly`, `x-storage: { column: "permid" }` |
| `legacyIDs` | object with `oldpbdbIDs`: array of strings | `readOnly` |
| `reference` | string: the permid of the authority's reference | `x-storage: { column: "reference_id", codec: "referencePermid" }` |
| `citation` | string | |
| `descriptors` | array of strings | |
| `year` | string, `maxLength: 4` | |
| `publishedInReference` | boolean | |

Base `required` SHALL be `citation`, `publishedInReference` and `reference`. Because `reference` is an
`x-storage` property, the `db` variant SHALL neither declare nor require it, and SHALL require only `citation`
and `publishedInReference`, as the legacy schema did.

`x-create` SHALL constrain `year`, when present, to `pattern: "^[0-9]{4}$"`, declared with `type: "string"` so
that the `in-create` variant compiles in strict mode. `year` SHALL NOT be required on create. The `db` variant
SHALL carry no pattern on `year`: the 1,299 migrated scenario ④ authorities store `year: "0"` and 898 store
none, and both are legitimate history.

`citation` SHALL carry no constraint on its value. The scenario ④ sentinel `"authority unknown"` SHALL be
valid in every variant.

Every jsonb key SHALL keep the name and shape the authorities migration writes. `legacyIDs.oldpbdbIDs` stays a
plural array, because dedup merges several `taxon_no`s into one authority.

`authorizer_person_id` and `enterer_person_id` SHALL NOT be exposed as payload fields.

#### Scenario: Stored payload validates at rest
- **WHEN** `{ legacyIDs: { oldpbdbIDs: ["478544", "478546"] }, citation: "Brazidec and Perrichot 2022", descriptors: ["Brazidec", "Perrichot"], year: "2022", publishedInReference: true }` is validated against `db`
- **THEN** it passes, with no `reference` and no `permid` present

#### Scenario: Sentinel payload validates at rest
- **WHEN** `{ legacyIDs: { oldpbdbIDs: ["12"] }, citation: "authority unknown", descriptors: [], year: "0", publishedInReference: false }` is validated against `db`
- **THEN** it passes

#### Scenario: Legacy requirements carried over
- **WHEN** a payload omitting `citation`, or omitting `publishedInReference`, or with `year: "19690"`, or with an undeclared key, is validated against `db`
- **THEN** it fails

#### Scenario: Reference required on create
- **WHEN** a create body with `citation` and `publishedInReference` but no `reference` is validated against `in-create`
- **THEN** it fails naming `reference`

#### Scenario: Four-digit year on create
- **WHEN** create bodies otherwise valid carry `year: "0"`, `year: "abc"` and `year: "1969"`
- **THEN** `in-create` rejects the first two and accepts the third

#### Scenario: Year optional on create
- **WHEN** a create body `{ reference, citation: "authority unknown", descriptors: [], publishedInReference: false }` omits `year`
- **THEN** `in-create` accepts it

#### Scenario: Patch guard blocks the read-only fields
- **WHEN** the `patch-guard` variant is derived
- **THEN** it rejects exactly `permid` and `legacyIDs` as keys

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

