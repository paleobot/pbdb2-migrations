## MODIFIED Requirements

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
- **THEN** it returns no entry for `refs`, because `collectionReferences` is annotated `{ table, codec }` and the refs a batch cites live both in `collections.reference_id` and in the child rows

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

### Requirement: `collectionReferences` codec
The `collectionReferences` codec SHALL declare the source
`{ table: "refs", key: "id", value: "permid", versioned: true }`.

On split it SHALL:
- sort `references[]` by numeric `order`;
- resolve the first entry's `referenceID` permid to that reference's head `id` and emit it as `columns.reference_id`;
- resolve the remaining entries' permids and emit them, in sequence, as `additional_collection_refs` rows carrying `reference_id`.

On merge it SHALL emit the primary reference with `order: "1"`, followed by child rows ordered by
`additional_collection_refs.id` ascending with `order: "2"`, `"3"`, and so on, mapping each stored
`reference_id` back to that reference's `permid`.

`referenceID` SHALL carry a reference's permid, not `refs.id`. This project exposes permids rather than
internal ids, and a collection's citation of a reference is the last converted payload field still carrying
one. The storage topology is unchanged: the primary still occupies `collections.reference_id`, the rest are
still `additional_collection_refs` rows, and those rows still have no order column, so order is still
re-derived on merge.

An unresolvable permid on split, or an unresolvable `reference_id` on merge, SHALL throw naming
`collectionReferences` and the value.

#### Scenario: Order normalized on round trip
- **WHEN** a payload with references ordered `"1"` and `"5"` is split and merged back
- **THEN** the merged references carry orders `"1"` and `"2"` with the same `referenceID`s in the same sequence

#### Scenario: Primary goes to the column
- **WHEN** a payload's references are `[{ referenceID: "<permid-B>", order: "2" }, { referenceID: "<permid-A>", order: "1" }]` and those permids belong to `refs.id` 7 and 12 respectively
- **THEN** `columns.reference_id` is `7` and one child row carries `reference_id` `12`

#### Scenario: Merge yields permids
- **WHEN** a stored collection has `reference_id = 7` and one child row with `reference_id = 12`
- **THEN** the merged payload's `references[]` carries those two references' permids, and no `refs.id` appears anywhere in the payload

#### Scenario: Superseded reference is never cited
- **WHEN** the ref at `id = 7` is superseded by a new version sharing its permid
- **THEN** splitting a payload naming that permid yields the new head's `id`, not `7`

#### Scenario: Unknown reference permid
- **WHEN** a payload names a `referenceID` permid held by no reference
- **THEN** `split` throws naming `collectionReferences` and that permid

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
