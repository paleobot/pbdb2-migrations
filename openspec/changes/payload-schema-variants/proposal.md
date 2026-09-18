## Why

The payload schemas in `payloadSchemas/` were shaped for migration and do not fit how a live PBDB2 instance will use them. The problems:

- Enums are hardcoded (collection has 18, specimen 7), or left as empty `enum: []` stubs that each script fills in its own way (`hydrateSchema()` in `migrate-collections.js`).
- The differences between what the jsonb column holds and what the API accepts or returns exist only in comments and in hand-edited copies (`collectionProperties` vs. `completeCollectionProperties`, `collectionSchema` vs. `collectionMigrationSchema`). They will drift.

The API will need variants built from the same source (create, response, and a PATCH guard), with enums taken from `dictionaries`. The shape stored in the database has to be derived from that source, not maintained next to it. Validation inside the database (plv8 running ajv) was considered and deferred: the API is expected to be the only writer, and an audit that runs after the fact covers the remaining risk for far less effort.

## What Changes

- **Enums from dictionaries.** A schema property can declare `"x-enumFrom": { table, column }` instead of a hardcoded or empty `enum`. A generic resolver reads the named `dictionaries` table and replaces the marker with a concrete `enum` before ajv compiles the schema. The resolver fails loudly when a resolved enum is empty. This replaces the per-script hydrate code and the `enum: []` stubs. The five-country list that makes `admin1` required is a create-time policy rule, not a vocabulary, so it stays inline.
- **Only open vocabularies move to dictionaries.** `x-enumFrom` is for vocabularies curators may extend without a code change, such as institution codes, preservation modes, collection methods, and countries/admin areas. Closed sets that code depends on stay as inline `enum`s in the schema source. Examples are `altitude.unit`, which unit conversion depends on, and `coverage`. The resolver leaves inline enums alone. They still appear in every variant, and any of them can be moved to `x-enumFrom` later without redesign. design.md classifies each enum on the converted entities.
- **New `dictionaries` tables** back the open-vocabulary enums of the entities converted in this change: collections and specimens. Each is seeded with exactly the values currently hardcoded, so existing migrated jsonb stays valid. Other entities (person, reference, schema) keep their hardcoded enums for now.
- **One annotated source per entity, generated variants.** Source schemas use `x-storage` (field lives in a column or child table, not the jsonb), the standard `readOnly` keyword (server-assigned; rejected in input), and `x-create` (a subschema, such as extra `required` fields or conditional rules, applied only when creating). A generator derives:
  - `db`: the jsonb at rest; `x-storage` fields removed; base `required` only.
  - `in-create`: all writable fields; base `required` plus create-only requirements.
  - `patch-guard`: a minimal check on a JSON Merge Patch body (an object with no read-only keys). PATCH follows merge-then-validate, per `payloadSchemas/DESIGN_NOTES.md`: the merged document is validated, not the patch.
  - `out`: all fields, including column-backed and read-only ones.
- **Split/merge.** Functions driven by `x-storage` split an input payload into a jsonb remainder plus column and child-table values, and merge them back on the way out. Named codecs (starting with `wgs84Point` for latitude/longitude ↔ `collections.location`) handle fields that don't map one-to-one.
- **Migration scripts validate against the derived `db` variant.** This replaces `collectionMigrationSchema` and the envelope-stripping in `migrate-specimens.js`.
- **BREAKING (internal):** `collectionMigrationSchema`, `completeCollectionProperties`, and the per-schema `createSchema`/`editSchema` scaffolding are removed from `payloadSchemas/` for the converted entities. Their consumers are the migration scripts in this repo, which are updated in the same change.
- **`payloadSchemas/DESIGN_NOTES.md` updated** to describe the annotated-source and variants model: merge-then-validate for PATCH, the `patch-guard`, and the open policy on which variant validates merged legacy rows.
- **Payload audit.** A standalone script validates every stored row of the converted entities' jsonb columns against the resolved `db` variant, reporting counts and offending ids. The migration runner calls it as a final verification after the last step.
- **Out of scope, written down:**
  - The plv8 CHECK constraint (ajv standalone compiled into a plv8 function). It is deferred, and design.md records the conditions for doing it: a second writer gets DB access, or the audit finds violations in practice.
  - Moving `payloadSchemas/` to a shared package for the API. The schemas stay in this repo for now.

## Capabilities

### New Capabilities
- `payload-schema-enums`: the `x-enumFrom` annotation, the resolver's contract (source tables restricted to `dictionaries`, failure on an empty enum, inline enums left alone), the rule for which enums use `x-enumFrom` (open vocabularies) and which stay inline (closed sets code depends on), and the requirement that the dictionary tables it reads hold the same values as the schemas' previous hardcoded enums.
- `payload-schema-variants`: the annotation vocabulary (`x-storage`, `readOnly`, `x-create`), how the `db`/`in-create`/`patch-guard`/`out` variants are derived from one source, and split/merge with named codecs, including the guarantee that splitting a valid input yields a jsonb remainder valid against `db`.
- `payload-audit`: validating stored jsonb against the resolved `db` variant, its report format and exit behavior.

### Modified Capabilities
- `collection-migration`: "Hydrate DB-driven enums before compiling the migration schema" and "Validate the stored jsonb against the lenient migration schema" become validation against the resolved `db` variant of the collection schema.
- `specimen-migration`: "Validate the payload before writing" targets the resolved `db` variant instead of `specimenSchema` with its envelope stripped.
- `migration-runner`: adds the payload audit as a final verification after the last step.

## Impact

- **Code:**
  - `payloadSchemas/collection.schema.js` and `payloadSchemas/specimen.schema.js` are rewritten as annotated sources.
  - New resolver, variant generator, and codec modules (location decided in design.md).
  - `src/collections-migration/migrate-collections.js` (its `hydrateSchema` is removed), `src/specimens-migration/migrate-specimens.js`, `src/collections-migration/tests/test-collections-transforms.js`, and `src/run-migrations.js` change.
  - New audit script.
- **Unchanged:** `authority.schema.js` and `opinionAttribution.schema.js` have no enums and no stored-elsewhere fields. The authorities, authority-opinions, name/assignment/synonymy opinions migrations keep validating as they do now.
- **Database:** new `dictionaries` tables in `postgresql/create_new.sql`, only for open vocabularies: for example institution codes, preservation modes, and collection methods, plus whichever borderline domain vocabularies design.md assigns to tables (collection geographic scale and coordinate basis). Closed sets get no tables. No change to the `collections`/`specimens` table definitions or their jsonb contents. No MariaDB source tables are read or remapped by this change.
- **Data integrity:**
  - If a new dictionary table is seeded with a value missing, misspelled, or different in case (e.g. the existing `'hydroflouric'` spelling), migration validation will abort, and the audit will flag already-migrated rows.
  - Seeds must reproduce the current enums exactly. Correcting a value is a separate data migration, not part of this change.
  - Verification: rerun the collections and specimens migrations, then the audit, and get the same row counts (275,554 collections, 167,150 specimens) with zero audit violations.
- **Dependencies:** none new. ajv (2019 draft) is already used.
