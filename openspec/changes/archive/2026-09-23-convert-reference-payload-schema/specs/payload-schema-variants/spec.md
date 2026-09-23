## MODIFIED Requirements

### Requirement: One annotated source per converted entity
`payloadSchemas/collection.schema.js`, `payloadSchemas/specimen.schema.js`, `payloadSchemas/person.schema.js` and `payloadSchemas/reference.schema.js` SHALL each export a single annotated source schema describing the entity object as the API sees it. The object SHALL NOT be wrapped in a `{ collection }`, `{ specimen }`, `{ person }` or
`{ reference }` envelope. None of the four files SHALL export a hand-maintained variant
(`collectionMigrationSchema`, `completeCollectionProperties`, `personSchema`, `referenceSchema`, `createSchema`,
`editSchema`, `patchSchema`, `getSchema`), fastify `response` blocks, or `getPropertiesForPubType`. Every
variant SHALL be obtained through `deriveVariant`.

#### Scenario: No hand-maintained variants remain
- **WHEN** the four modules are imported
- **THEN** each exposes only its annotated source (plus optional non-schema helpers), and none of the listed names is exported

#### Scenario: Person source is not enveloped
- **WHEN** `payloadSchemas/person.schema.js` is imported
- **THEN** it exports `personSource`, whose `properties` are the person's own fields, and it does not export `personSchema`

#### Scenario: Reference source is not enveloped
- **WHEN** `payloadSchemas/reference.schema.js` is imported
- **THEN** it exports `referenceSource`, whose `properties` are the reference's own fields, with no `reference` wrapper and no `allowDuplicate`, and it does not export `referenceSchema` or `getSchema`

## ADDED Requirements

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
