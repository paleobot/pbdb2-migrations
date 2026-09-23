## Context

`schema.schema.js` is 208 lines in the pre-`payload-schema-variants` form: a `{ schema }` envelope around nine
fields, of which the active ones are shown below. Roughly half the file is commented out: a `$defs` block
describing recursive `character` and `state` objects, and a `schemaDefinition` property that would have
carried the character tree. Nothing imports the file; `migrate-pbot-schemas.js` builds and inserts the jsonb
without validating it.

Measured on localhost `pbdb` (2026-09-23):

```
schemas                8 rows, all heads
├── legacyIDs.pbotID   8
├── title, year        8      year: all four digits (1989 … 2026)
├── purpose            6
├── acknowledgments    6
├── partsPreserved     6      arrays of dictionary values
├── authors            2      one item each, order 1
└── notableFeatures    2
additional_schema_refs 1 row  (the "Dicots Quantitative Schema: Summary" schema)

columns: permid, authorizer_person_id, enterer_person_id, reference_id (NOT NULL → refs),
         preceded_by_id / succeeded_by_id, removed, created_at

dictionaries.parts_preserved   12 rows = the inline partsPreserved enum, same order
dictionaries.notable_features   4 rows = the inline notableFeatures enum, same order
```

The migration fetches live from PBot GraphQL (`PBOT_TOKEN`), so counts can grow between runs.

Patterns reused from the five converted entities: an annotated source with derived variants; permids exposed
through codecs with declared lookup sources; versioned sources read from lineage heads only; the migration
builds the jsonb directly and validates it against `db` rather than going through `split()`; a create-only
`year` pattern in `x-create` (authority D3).

## Goals / Non-Goals

**Goals:**

- `schemaSource`, unenveloped, with every variant derived and every stored schema valid against `db`.
- A schema names its references, by permid, in the same shape collection uses.
- Dictionary-backed `partsPreserved` and `notableFeatures`, with one list of values rather than three.
- Every schema payload the migration writes is validated first, and `schemas` is audited, round trip included.
- Stored jsonb unchanged.

**Non-Goals:**

- **The character/state tree in the API.** Whether a client creates a schema's characters and states one per
  call (separate routes, as PBot's client effectively required) or as a whole tree in one call from a schemas
  route is undecided. Only the second needs `$defs`/`$ref` in `deriveVariant`. The commented-out `$defs` and
  `schemaDefinition` stay in the file as the sketch of that option, and the notes that call them a
  prerequisite for this conversion are corrected (D7).
- **Converting `character.schema.js` and `state.schema.js`.** They are the next change. It has its own
  questions: `definition` is null on 249 of 336 characters and 284 of 1,325 states, which their current
  schemas reject; the `parent_*` columns would need a self-referencing permid codec; and 73 states carry
  `quantitative`.
- **Linking `authors[]` to persons.** The items are plain `{ familyName, givenName, order }`, as stored.
- **Broadening the parts-preserved vocabulary.** `create_new.sql` notes it is plant-specific. That is a
  content question for curators; the table already allows it without a code change.
- **Adding `UNIQUE` to the two dictionary tables' `name`.** The dictionary tables created later have it; these
  two predate the convention. Resolution de-duplicates regardless, and adding it is DDL outside this change.
- Exposing `authorizer_person_id` / `enterer_person_id`.

## Decisions

### D1 — The source

```js
const schemaProperties = {
  permid:          { type: "string", readOnly: true, "x-storage": { column: "permid" } },
  legacyIDs:       { type: "object", readOnly: true, properties: { pbotID: { type: "string" } } },
  references:      { type: "array", minItems: 1, items: { referenceID, order },
                     "x-storage": { table: "additional_schema_refs", codec: "referenceList" } },
  title:           { type: "string" },
  year:            { type: "string", maxLength: 4 },
  purpose:         { type: "string" },
  authors:         { type: "array", minItems: 1, items: { familyName, givenName, order: integer ≥ 1 } },
  acknowledgments: { type: "string" },
  partsPreserved:  { type: "array", items: { type: "string", "x-enumFrom": { table: "parts_preserved", column: "name" } } },
  notableFeatures: { type: "array", items: { type: "string", "x-enumFrom": { table: "notable_features", column: "name" } } },
};

schemaSource = { …, properties: schemaProperties,
  required: ["title", "year", "references"],
  "x-create": { properties: { year: { type: "string", pattern: "^[0-9]{4}$" } } },
  unevaluatedProperties: false };
```

`references` items match collection's, `{ referenceID: string, order: string }` with both required, because
the same codec reads them. The commented `$defs` / `schemaDefinition` blocks are kept below
the source, with a comment pointing at the API decision.

**`references` goes in base `required`**, as `reference` does on authority: `db` prunes it, and `out` then
guarantees it, which every row satisfies since `schemas.reference_id` is NOT NULL. Collection requires
`references` only in `x-create`; that choice is not revisited here.

**Constraints carry over unchanged**: `title` and `year` required, `year` at most four characters, `authors`
with `minItems: 1` and integer `order ≥ 1`, the item fields untyped beyond `string`. The only additions are
`references` and the create-time `year` pattern.

### D2 — `collectionReferences` becomes `referenceList`

The codec already does what schema needs. It reads `references[]`, sends the lowest-order entry to
`columns.reference_id`, and emits the rest as rows of the child table named by `storage.table`; the foreign key
back to the parent row lives in the audit `REGISTRY` (`fk`), not in the codec. `additional_schema_refs` has no
order column either, and the migration inserts additional refs in PBot `order`, so rebuilding order from
ascending `id` holds for schemas too.

So the change is the name: `referenceList`, used in the `codecs` registry, the `lookup` error prefix and
collection's `x-storage`. Error messages change from `collectionReferences: …` to `referenceList: …`. The
comment above the codec stops naming `collections.reference_id` and describes "the parent's `reference_id`".

*Alternative considered: keep `collectionReferences` and annotate schema with it.* Rejected: this is the second
caller, and a codec named for one entity, applied to another, reads as a mistake.

*Alternative considered: a second codec for schemas.* Rejected: it would be a copy.

### D3 — `year`: loose at rest, four digits on create

The authority rule, unchanged: `db` keeps `maxLength: 4`; `x-create` adds
`properties: { year: { type: "string", pattern: "^[0-9]{4}$" } }` (the `type` is required by strict mode).
Unlike authority, `year` stays required in the base, as the legacy schema had it. Every stored year already
has four digits, so `db` could be strict, but keeping `db` descriptive of history and `x-create` normative is
the convention, and PBot data arrives through the `db` check.

### D4 — Enums from the dictionaries, one list

`partsPreserved.items` and `notableFeatures.items` carry `x-enumFrom` and no literal `enum`. Both seeds match
the inline arrays exactly, in order, so resolution changes no validation outcome;
`payloadSchemas/tests/fixtures/legacy-enums.json` gains `parts_preserved.name` and `notable_features.name` so
the seed-fidelity test pins that.

`migrate-pbot-schemas.js` currently holds a third copy of each list (`PARTS_PRESERVED_ENUMS`,
`NOTABLE_FEATURES_ENUMS`) for its case-insensitive mapping. It will build those maps from the resolved source
it already needs for validation (`resolved.properties.partsPreserved.items.enum`, likewise
`notableFeatures`). The mapping behavior is unchanged: lowercase, spaces around `/` collapsed, unmatched values
warned about and dropped. A curator adding a value to the table then makes it both mappable and valid, with no
code edit.

### D5 — The migration validates every schema payload before its first insert

At start, before fetching, the script compiles `deriveVariant(await resolveEnums(pg, schemaSource), 'db')` with
`createAjv()`. After fetching schemas and before the Phase 1 insert loop, it builds the jsonb for every fetched
schema and validates each. On any failure it logs the schema's `pbotID`, the payload and the ajv errors, and
exits non-zero with nothing inserted. The insert loop then uses the payloads already built.

Validating up front, rather than just before each insert, is what keeps a failure from leaving part of the
step written: the script has no transaction, and the runner's remedy for a failed step is a fresh database.
Payloads are validated even for schemas the loop later skips for a missing enterer or reference. A malformed
payload is a defect in either case, and eight schemas make the extra work immaterial.

Characters and states are not validated; their schemas are not converted.

### D6 — The audit registers `schema`

A `REGISTRY` entry after `authority`: table `schemas`, column `schema`, `schemaSource`, `versioned: true`,
columns `['permid', 'reference_id']`, children
`[{ table: 'additional_schema_refs', fk: 'schema_id', columns: ['id', 'reference_id'] }]`.

- `referenceList` is annotated `{ table, codec }`, so `codecKeyColumns` offers no key column for `refs` and the
  round trip pre-loads `refs` for the run, as for collection. The dictionary sources for the two enums are
  resolved by `resolveEnums`, not the codec context.
- `roundTripDifferences` compares children by `reference_id` for any child table, so it needs no change.
- The runner derives audited entities from `REGISTRY` and each step's `writes`; `pbot-schemas` writes
  `schemas`, so it starts auditing `schema` with no runner code change. A full run audits `collection`,
  `specimen`, `person`, `reference`, `authority`, `schema`.

### D7 — Correct the `$defs` notes

`variants.js` (header comment) and `DESIGN_NOTES.md` ("$defs must live inside body") say `deriveVariant` needs
`$defs`/`$ref` before `schema.schema.js` is converted. Both are reworded: `deriveVariant` does not follow
`$defs`/`$ref`, and needs to only if the API creates a schema's character/state tree in one call. The audit
comment and `src/README.txt` list of audited entities gain `schemas`.

## Risks / Trade-offs

- **[Live PBot data fails the new validation]** → Possible: the migration has never validated. The mapping
  already drops unknown enum values and the builder omits empty `purpose`/`acknowledgments`, so the likely
  failure is an `authors` item with a missing `order` (the builder writes `0`, which `order ≥ 1` rejects). The
  side-DB run is the check. A failure there is a finding to bring to the user, not a reason to loosen `db`.
- **[The rename breaks something that matches the old name]** → Only the codec registry, collection's
  annotation, tests and specs name it, and `grep` finds them all. Error text changes, and the storage tests that
  match it are updated.
- **[Verification can't be byte-identical]** → The side DB fetches PBot today, localhost fetched it earlier.
  The comparison is by `legacyIDs.pbotID` and reports added or changed schemas rather than requiring identity.
- **[`additional_schema_refs` order]** → The round trip compares child rows in id order against what `split`
  emits, so an inversion would show as a difference. With one child row today, it is thinly exercised; the
  collection round trip covers the same codec over 371,774 rows.

## Migration Plan

No DDL change and no stored jsonb change, so localhost `pbdb` needs no rebuild. Verification runs the full
pipeline into a side database with `PBOT_TOKEN` set:
`PG_DATABASE=pbdb_schema_verify node src/run-migrations.js --createdb`. It checks that every schema payload
validates in the step, that the runner's audit is clean for all six entities, that
`node src/audit-payloads.js --round-trip` reports zero differences, and that `schemas` matches localhost `pbdb`
by `legacyIDs.pbotID` (jsonb and cited refs), with any difference explained by PBot edits. The side database is
dropped afterwards, with the user's go-ahead.

Rollback is `git revert`: no data or schema change reaches any database.

## Open Questions

None.
