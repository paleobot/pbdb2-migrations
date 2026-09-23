## MODIFIED Requirements

### Requirement: One annotated source per converted entity
`payloadSchemas/collection.schema.js`, `payloadSchemas/specimen.schema.js`, `payloadSchemas/person.schema.js`, `payloadSchemas/reference.schema.js` and `payloadSchemas/authority.schema.js` SHALL each export a single annotated source schema describing the entity object as the API sees it. The object SHALL NOT be wrapped in a `{ collection }`, `{ specimen }`, `{ person }`,
`{ reference }` or `{ authority }` envelope. None of the five files SHALL export a hand-maintained variant
(`collectionMigrationSchema`, `completeCollectionProperties`, `personSchema`, `referenceSchema`,
`authoritySchema`, `createSchema`, `editSchema`, `patchSchema`, `getSchema`), fastify `response` blocks, or
`getPropertiesForPubType`. Every variant SHALL be obtained through `deriveVariant`.

#### Scenario: No hand-maintained variants remain
- **WHEN** the five modules are imported
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

## ADDED Requirements

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
`{ table: "refs", key: "id", value: "permid", versioned: true }`, the same source `collectionReferences`
declares.

On split it SHALL map the payload's `reference` permid to that reference's head `id` in the column
`x-storage` names. On merge it SHALL map that column's id to the reference's `permid` as `reference`. An absent
`reference` on split SHALL emit no column, and a NULL column on merge SHALL emit no property.

Ids SHALL be keyed as strings, as in `collectionReferences`, because `refs.id` is a bigint that node-postgres
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
