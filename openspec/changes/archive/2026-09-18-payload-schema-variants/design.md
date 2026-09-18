## Context

`payloadSchemas/` holds one JavaScript module per entity. Each exports a JSON Schema (draft 2019-09, compiled by ajv). The migration scripts validate each built jsonb payload against these schemas before writing. How the schemas look today:

- **Enums** are either hardcoded arrays (collection 18, specimen 7) or empty `enum: []` stubs. `migrate-collections.js` fills the stubs at startup with `loadDicts()` + `hydrateSchema()`, which mutates the imported module object in place. `test-collections-transforms.js` fills the same stubs with its own fixtures.
- **Variants** are written by hand:
  - `collection.schema.js` has `collectionProperties` (the base) and `completeCollectionProperties`, a `structuredClone` edited by path assignments that add `references`, `latitude`/`longitude`, and stricter `required` lists.
  - It then exports `collectionSchema` (the API envelope around the complete properties) and `collectionMigrationSchema` (the base properties).
  - `specimen.schema.js` exports only the envelope. `migrate-specimens.js` strips `$schema`/`$id`/`examples`/`response` before compiling and validates `{ specimen }`.
- **Envelopes.** The exported schemas wrap the entity (`{ collection: {...}, allowDuplicate }`) and carry fastify route metadata (`response`, `examples`). What the jsonb column actually stores is the inner object. The migrations wrap the payload only to satisfy the envelope.
- **Latent bug.** The admin1-required `if`/`then` in `completeCollectionProperties` is attached at `location.administrativeArea`. The real path is `location.toponym.administrativeArea`, so the rule has never applied, even in the strict schema.
- **Columns outside the jsonb.**
  - `collections`: `permid`, `location geography`, `reference_id` (primary reference), plus child rows in `additional_collection_refs` (no order column).
  - `specimens`: `permid`, `reference_id`, `collection_id`, `name_opinions_permid`.

The API that will consume these schemas does not exist yet and will probably live in another repository. Schemas stay in this repository for now (proposal).

## Goals / Non-Goals

**Goals:**
- One annotated source per converted entity (collection, specimen). Every variant is generated from it and nothing is maintained by hand next to it.
- A declarative way (`x-enumFrom`) to take an enum from a `dictionaries` table, resolved by one generic resolver with a pure core that can be tested without a DB.
- Split/merge between an API-shaped payload and its storage (jsonb + columns + child rows), driven by the same annotations.
- The migrations validate the derived `db` variant and produce exactly today's totals: 275,554 collections, 371,774 additional refs, 167,150 specimens.
- An audit that checks every stored row against the `db` variant, run by the runner at the end.

**Non-Goals:**
- DB-level validation (a plv8 CHECK). It is deferred; see Decision 10.
- Converting person, reference, schema, character, state, authority, or opinionAttribution schemas. The last two have no enums and nothing stored outside the jsonb, and their migrations are untouched.
- API routes, envelopes, response schemas, and how references and taxa are identified in the API (id vs. permid).
- Fixing or renaming dictionary values (e.g. `hydroflouric`). Seeds reproduce the current enums exactly.
- Redesigning the placeholder objects still waiting for the combined pass (`ages.intervals`, `environment`, `paleontology` on collections). Their enums stay inline, apart from `preservation.modes`, which shares a table with specimens.
- Tightening nested objects with `unevaluatedProperties: false`. Only the entity root has it today, and that doesn't change here.

## Decisions

### 1. Module layout: tooling lives beside the schemas

```
payloadSchemas/
  collection.schema.js        ← annotated source (rewritten)
  specimen.schema.js          ← annotated source (rewritten)
  lib/
    ajv.js                    ← createAjv(): draft-2019 ajv with x-* keywords registered
    enums.js                  ← collectEnumSources / loadEnums / applyEnums / resolveEnums
    variants.js               ← deriveVariant(source, variant)
    storage.js                ← split / merge
    codecs.js                 ← named codec registry
  tests/
    fixtures/legacy-enums.json
    *.test.js
src/audit-payloads.js         ← non-migration script (layout spec allows src/ root)
```

Rationale: the tooling moves together with the schemas when they go to a shared package, so it goes in `payloadSchemas/lib/` and not `src/lib/`. The migration-script-layout rule "shared utilities live in `src/lib/`" covers migration helpers, and this tooling is schema infrastructure that the migrations happen to use. Alternative considered: `src/lib/payload-schemas/`. Rejected because it would split the schema package across two roots before it is extracted.

### 2. `x-enumFrom` shape and resolver

```js
institutionCode: { type: "string", "x-enumFrom": { table: "institution_codes", column: "code" } }
```

- `table` names a table in the `dictionaries` postgres schema. The resolver adds the schema, so a source cannot reference other schemas. `table` and `column` must match `/^[a-z_][a-z0-9_]*$/` and are always quoted as identifiers.
- The resolver loads each distinct `(table, column)` once with `SELECT col FROM dictionaries.tbl WHERE col IS NOT NULL ORDER BY id`, then removes duplicates in JS, keeping the first occurrence. That keeps the seed order, which future UIs can use.
- A resolved array that is empty throws, naming the table and column. Nothing is compiled after that.
- The resolver writes `enum` next to `x-enumFrom` on a deep clone and never mutates the imported source. Keeping `x-enumFrom` in the output leaves it self-describing.
- There is no `where` filter. Nothing needs one yet: the admin1 rule uses an inline country list (Decision 5). Adding it later is backward compatible.
- The API is split into pure and I/O parts: `collectEnumSources(schema)` → list; `loadEnums(pg, sources)` → `Map`; `applyEnums(schema, map)` → resolved clone; plus the convenience `resolveEnums(pg, schema)`. Tests call `applyEnums` with fixture maps. This replaces the stub-filling in `test-collections-transforms.js`.

Alternatives considered:
- Keep one hydrate function per schema. That is the status quo; it doesn't scale and mutates shared module state.
- Resolve inside Postgres (a SQL function that builds the schema). Premature while the resolved schemas are consumed only in node.

### 3. Which enums use a dictionary table

The test from the proposal: use a table if curators would extend the vocabulary without a code change. Keep it inline if it is a closed set that code depends on.

| Entity | Path | Values | Decision | Table.column |
|---|---|---|---|---|
| collection | `context.collectionMethods[]` | 21 | table (new) | `collection_methods.name` |
| collection | `location.toponym.administrativeArea.admin0` | ISO | table (existing) | `admin0.iso` |
| collection | `…administrativeArea.admin1` | ISO | table (existing) | `admin1.iso` |
| collection | `location.toponym.maritimeArea` | IHO | table (existing) | `maritime.iho_name` |
| collection | `location.coordinates.basis` | 5 | table (new) | `coordinate_bases.name` |
| collection | `location.coordinates.altitude.unit` | 2 | inline: unit conversion depends on it | |
| collection | `location.scale` | 6 | table (new) | `geographic_scales.name` |
| collection | `lithofacies[].lithology` | 54 | table (new) | `lithologies.name` |
| collection | `lithofacies[].adjectives[]` | 70 | table (new) | `lithology_adjectives.name` |
| collection | `lithofacies[].lithification` | 4 | inline: ordinal, closed | |
| collection | `stratigraphy.scale` | 5 | inline: mirrors the `stratonyms` keys | |
| collection | `ages.measurements[].unit` | 3 | inline: age conversion depends on it | |
| collection | `ages.measurements[].method` | 23 | table (new) | `dating_methods.name` |
| collection | `ages.measurements[].measurementType` | 3 | inline: closed | |
| collection | `environment.name`, `environment.tectonicSetting` | 75, 14 | inline for now: placeholder object; revisit in the combined pass | |
| collection | `paleontology.preservation.modes[]` | 37 | table (shared) | `preservation_modes.name` |
| collection | `paleontology.sizeClasses[]` | 3 | inline: placeholder, closed | |
| specimen | `type` | 3 | inline: nomenclatural type status, rules will depend on it | |
| specimen | `identifiers.institutionCode` | 60 | table (new) | `institution_codes.code` |
| specimen | `paleontology.preservationModes[]` | 37 | table (shared) | `preservation_modes.name` |
| specimen | `paleontology.coverage`, `side`, `sex`, `measurementSource` | 2/13/3/5 | inline: closed | |

This adds eight new tables: `collection_methods`, `coordinate_bases`, `geographic_scales`, `lithologies`, `lithology_adjectives`, `dating_methods`, `preservation_modes`, `institution_codes`. `preservation_modes` is shared: collection `paleontology.preservation.modes` and specimen `preservationModes` hold identical 37-value lists today, so one table serves both.

Table shape follows the existing dictionaries: `id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, <col> text NOT NULL UNIQUE`. No description column yet; it can be added later without touching the resolver. Seeds are inserted in the order of the current arrays and preserve every literal, including the embedded quotes in lithology values such as `"siliciclastic"`.

Any inline enum can move to `x-enumFrom` later by adding a table. No other change is needed.

### 4. Annotation vocabulary

| Annotation | Placed on | Meaning |
|---|---|---|
| `x-enumFrom` | a string schema | Enum from a dictionaries table (Decision 2). |
| `x-storage` | a property | The property is not stored in the jsonb. `{ column: "<col>", codec?: "<name>" }` or `{ table: "<child table>", codec: "<name>" }`. |
| `readOnly` (standard) | a property | Server-assigned; accepted in no input variant. |
| `x-create` | any object schema | A subschema applied to that node only in `in-create` (extra `required`, conditional rules). |

`x-create` replaces the `x-requiredOn` idea in the proposal. One annotation covers both the extra `required` lists and conditional rules like admin1, and create is the only variant that needs extra rules.

`readOnly` and `x-storage` are independent:
- `permid`: `readOnly` + `x-storage: { column: "permid" }`.
- `legacyIDs`: `readOnly` only. It stays in the jsonb, so it stays in `db`, but clients cannot write it.
- `latitude`/`longitude`: `x-storage` only. They are writable but live in a column.

### 5. Variant derivation rules

`deriveVariant(source, variant)` is pure and returns a new schema. It recurses through `properties`, `items`, `allOf`/`anyOf`/`oneOf`, and `if`/`then`/`else`.

| Rule | `db` | `in-create` | `out` |
|---|---|---|---|
| `x-storage` properties | removed (and dropped from `required`) | kept | kept |
| `readOnly` properties | kept unless also `x-storage` | removed (and dropped from `required`) | kept |
| base `required` | kept | kept | kept |
| `x-create` | dropped | merged into the node as `allOf: [x-create]` | dropped |
| enums from `x-enumFrom` | resolved | resolved | **not enforced**: `enum` removed, `x-enumFrom` kept as documentation |
| inline enums | kept | kept | kept |
| root | `unevaluatedProperties: false` | same | same |

Removing a property from `properties` is enough to reject it in input. These three variants keep `unevaluatedProperties: false` at the entity root, so an unknown or read-only property fails validation.

**PATCH: merge first, then validate, plus a small guard.** Following `payloadSchemas/DESIGN_NOTES.md`, there is no field-by-field patch schema. The API:
1. `merge`s the stored parts into a full document;
2. applies the JSON Merge Patch;
3. removes `readOnly` properties;
4. validates the whole result;
5. `split`s it for writing.

This catches cross-field rules a patch-only check cannot. For example, a patch setting `admin0: "CA"` on a record without `admin1` is caught by the merged validation.

The notes' bare `{ type: "object" }` guard isn't quite enough. Step 3 would silently hide a patch that tries to change `legacyIDs` or `permid`. So a fourth, tiny variant, `patch-guard`, is derived: `{ type: "object", propertyNames: { not: { enum: [<root readOnly names>] } } }`. To make that complete, `readOnly` is allowed only on root properties, and derivation throws if it finds one deeper. Which variant validates the merged document is the open policy question below.

An earlier draft had a nullable, all-optional `in-patch` variant. It was dropped for the reasons the notes give: a lot of machinery that catches nothing the merged validation doesn't.

Output variants don't enforce dictionary enums so that a value later removed from a dictionary can't make a stored row produce a response that violates its own documented schema.

`$id` per variant: `https://pbdb2.example.com/schemas/<entity>.<variant>.json`. Variants describe the entity object only, with no envelope. API envelopes, `response` blocks, and `examples` are removed from `payloadSchemas/` and become API route concerns.

Admin1 rule, now placed at the correct node:

```js
administrativeArea: {
  ..., required: ["admin0"],
  "x-create": {
    if:   { required: ["admin0"], properties: { admin0: { enum: ["US","CN","RU","AU","CA"] } } },
    then: { required: ["admin1"] }
  }
}
```

The inline country list is a policy rule, not a vocabulary. It gets `required` in `if` to avoid the JSON Schema pitfall where an `if` is vacuously true when `admin0` is absent.

### 6. Split / merge and codecs

- `split(source, payload)` walks the annotated source against an input payload and returns `{ jsonb, columns: { [col]: value }, children: { [table]: rows[] } }`.
- `merge(source, { jsonb, columns, children })` is the inverse.
- Properties with `x-storage` and no codec map one-to-one to a column.
- A codec receives every sibling property that names it and returns one storage value, or one set of child rows.

Initial codecs:
- **`wgs84Point`**: `{ latitude, longitude }` ↔ `collections.location`.
  - Split produces EWKT `SRID=4326;POINT(<lng> <lat>)`, which a geography column accepts as text.
  - Merge expects the column selected as `ST_AsGeoJSON(location)::json` and reads `coordinates: [lng, lat]`. Parsing EWKB in node is avoided.
  - If only one of the pair is present, `split` fails. The absence of both yields a NULL column.
- **`collectionReferences`**: `references[]` ↔ `collections.reference_id` + `additional_collection_refs` rows.
  - `additional_collection_refs` has no order column, so the codec normalizes. Split sorts by `order`, sends the first to `reference_id` and the rest to child rows in sequence. Merge emits the primary as order `"1"` and child rows as `"2"…` by ascending `additional_collection_refs.id`.
  - A round trip is stable only after normalization; the tests assert exactly that.
  - `referenceID` carries `refs.id` as a string, matching the current schema's `type: "string"`. Whether the API should expose permids is an open question and does not affect the codec contract.

Specimen gets only `permid` (readOnly + column) in this change. Its other column links (`reference_id`, `collection_id`, `name_opinions_permid`) get no API fields until the API is designed.

The migrations do **not** start calling `split`: they build jsonb and columns directly, as their specs describe. Only the tests and the audit's round-trip mode use split and merge.

### 7. Migrations validate the derived `db` variant

- `migrate-collections.js`: delete `hydrateSchema`. Keep `loadDicts` for its lookup maps (name → ISO normalization), since that is transformation logic, not schema logic. Validate with `createAjv().compile(await resolveEnums(pg, deriveVariant(collectionSource, 'db')))` on the unwrapped payload.
- `migrate-specimens.js`: same, replacing the envelope-stripping and `{ specimen }` wrapping.
- `test-collections-transforms.js`: `applyEnums` with its existing DB-free fixture values.

Using the `db` variant keeps today's migration leniency: base `required` only, and no admin1 rule. That rule was already removed from `collectionMigrationSchema` and never applied in the strict schema.

### 8. Payload audit

`src/audit-payloads.js` (a non-migration script at the `src/` root):
- Has a registry of `{ entity, table, column, source }` for the converted entities.
- Resolves each `db` variant once, then reads **all rows**, not just current heads, with keyset pagination on `id` in batches (no new dependency).
- Validates `row[column]` and tallies results per entity, split into current heads (`succeeded_by_id IS NULL`) and superseded versions.
- Prints a summary with violation counts and the first N offending `id`s with ajv errors. It writes the same content as a report beside itself, per the layout spec, and exits non-zero on any violation.
- Options: `--entity <name>` (repeatable; default all), `--sample <n>`, and `--round-trip`. For every head row, round-trip mode runs merge → validate against `out` → remove readOnly → split, and asserts the jsonb and column values are identical to the stored row.

Runner: after the last selected step succeeds, `run-migrations.js` spawns the audit as a child process, like the steps, and treats a non-zero exit as a run failure. The audit is scoped like postconditions: one `--entity` for each audited entity whose table a selected step writes (`collections` → `collection`, `specimens` → `specimen`). `--entity` is therefore repeatable.

- A run whose steps write no audited table, e.g. `--only persons`, doesn't spawn the audit, and the log says so.
- There is no flag to skip or widen the audit: the runner spec forbids flags that bypass a verification, and the scope is fully determined by the selection.
- To audit the whole database independently of a run, invoke `node src/audit-payloads.js` directly.

Alternative considered: SQL-only checks in the runner's predicate vocabulary. Rejected because they can't express the schema, and the point is one validator.

### 9. Dictionary seed fidelity

Before any schema file is rewritten, every array that becomes `x-enumFrom` is snapshotted into `payloadSchemas/tests/fixtures/legacy-enums.json`. A test compares each new table's `ORDER BY id` values to its snapshot, both membership and order. That turns "seeds reproduce the current enums exactly" from a promise into a check. The snapshot is kept after the change as the historical baseline.

### 10. Deferred: plv8 CHECK

Recorded so this can be picked up without re-exploring. pg_jsonschema is unavailable on Aurora (not in the extension list; no PL/Rust for pg_tle). plv8 **is** available.

The design would be:
1. Ajv standalone compiles the resolved `db` variant into dependency-free JS.
2. esbuild bundles ajv's small runtime helpers into it.
3. The result becomes `CREATE FUNCTION validate_<entity>_db(jsonb) LANGUAGE plv8 IMMUTABLE`.
4. A CHECK constraint uses that function. Regenerating after a dictionary change is `CREATE OR REPLACE`, then `DROP`/`ADD CONSTRAINT … NOT VALID`, then `VALIDATE CONSTRAINT`.

Because the enums are compiled in, the function is honestly immutable. This change keeps the path open: the `db` variant is the exact input that step would need.

Revisit when any of these holds:
- a writer other than the API gets DB write access;
- the audit reports violations in practice;
- the database is required to be self-describing.

## Risks / Trade-offs

- [A seeded dictionary value differs from the legacy enum, by typo, case, or a lost embedded quote] → the snapshot test (Decision 9) fails before any migration runs. A full re-run plus audit catches anything that gets past it.
- [Dictionary edits orphan stored values: the jsonb stores labels, and no foreign key protects them] → the audit detects it. The dictionary rule becomes "append freely; rename or delete only with a data migration". This is documented in the dictionaries section of `create_new.sql`.
- [Derivation-rule bugs let a variant accept too much or too little] → unit tests per rule and variant, using small synthetic sources; plus the corpus round trip, which runs on real data.
- [Merge-then-validate returns errors in terms of the merged document, not the patch the client sent] → acceptable. Paths still point at the offending field. The API can translate them if clients need it.
- [`collectionReferences` normalizes order, so an API client's non-contiguous orders ("1", "5") come back as "1", "2"] → documented codec behavior. A real order column is an API-era schema decision.
- [The out variant drops dictionary enums, so API docs show open strings] → `x-enumFrom` stays in the output for doc generators to render as "values from dictionaries.X".
- [Tooling at `payloadSchemas/lib/` departs from the "`src/lib/`" convention] → justified in Decision 1. A follow-up extraction to a shared package removes the tension.

## Migration Plan

1. Snapshot legacy enums (Decision 9) before editing schema files.
2. Add the dictionary tables and seeds to `create_new.sql`, and the lib modules and tests.
3. Rewrite `collection.schema.js` and `specimen.schema.js` as annotated sources. Remove `collectionMigrationSchema`, `completeCollectionProperties`, and the envelopes, `response` blocks, and ghosted `createSchema`/`editSchema`/`getPropertiesForPubType` scaffolding in those two files.
4. Point the two migrations and the transform test at the `db` variant.
5. Add `src/audit-payloads.js` and the runner hook.
6. Verify on localhost with `node src/run-migrations.js --createdb`, a full run (the dictionaries changed, so rebuild; don't patch):
   - identical totals (275,554 / 371,774 / 167,150 and the other steps' known counts);
   - the audit reports 0 violations;
   - `audit-payloads.js --round-trip` passes.

Rollback: a revert of the change. The DB effect is additive (new dictionary tables), and the stored jsonb is unchanged, so no data needs to move back.

## Open Questions

None of these blocks this change: none alters a requirement in its specs. Each item says when it should be decided and what would change.

- **Which variant validates the merged PATCH document.** It matters for migrated rows with gaps, such as a missing `scale`, `error`/`method`, or `admin1`:

  | Policy | Legacy row with gaps, typo fix | New gap introduced |
  |---|---|---|
  | merged vs. `in-create` (DESIGN_NOTES as written) | rejected until the gaps are filled | rejected |
  | merged vs. `db` | accepted | accepted, so edits can make records worse |
  | ratchet: vs. `db` always, plus vs. `in-create` if the stored row already passed it | accepted | rejected if the row was complete |

  The ratchet costs one extra validation and means an edit never makes a record less complete.
  - *Decide:* during API design.
  - *Would change:* API code only. All three policies use variants this change provides.
- **Reference identity in the API: `refs.id` vs. `refs.permid` in `references[].referenceID`.** Permid is the likely answer.
  - *Decide:* during API design.
  - *Would change:* the `collectionReferences` codec only (an id↔permid lookup). Schemas, derivation rules, and the audit are unaffected. The codec uses `refs.id` until then, matching what the migrations write.
- **An `admin1_required` flag column on `dictionaries.admin0` instead of the inline five-country list.**
  - *Decide:* when the policy list needs to grow or be edited by curators.
  - *Would change:* the one `x-create` rule on `administrativeArea` would read from a table.
- **Nested `unevaluatedProperties: false`.** Unknown keys inside nested objects are currently accepted in every variant.
  - *Decide:* as a separate change, once the API's strictness requirements are known.
  - *Would change:* the source schemas. The audit can first check whether existing data would pass.
