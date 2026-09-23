## Why

`payloadSchemas/schema.schema.js` is still in the pre-`payload-schema-variants` form. It wraps the object in a
`{ schema }` envelope, lists `partsPreserved` and `notableFeatures` inline under a
`//TODO: pull from dictionaries.*` although both dictionary tables exist, and cannot see
`schemas.reference_id` (NOT NULL) or the `additional_schema_refs` rows, so a schema does not name the
references it was published in. Nothing validates the stored payloads: `migrate-pbot-schemas.js` never imports
the schema, and `schemas` is not audited.

It was held back on the belief that it needs `$defs`/`$ref` support in `deriveVariant`. It does not. The
`$defs` block and `schemaDefinition` are commented out. They sketch an API in which one call creates a schema
with its whole character/state tree, and whether pbdb2 offers that, or separate schema, character and state
routes as PBot's client effectively did, is an API design question not yet decided. The jsonb at rest is flat
either way, so the conversion goes now and the tree question stays with the API design.

## What Changes

- **`schema.schema.js` becomes `schemaSource`**, an annotated source with no envelope. Every variant is
  derived. `permid` is `x-storage: { column: "permid" }` and `readOnly`; `legacyIDs` is `readOnly`.
- **Every jsonb key keeps its name and shape**: `legacyIDs.pbotID`, `title`, `year`, `purpose`,
  `acknowledgments`, `authors[]` (`familyName`, `givenName`, `order`), `partsPreserved[]`, `notableFeatures[]`.
  The stored jsonb does not change.
- **`references[]` is exposed**, following collections: the first entry is `schemas.reference_id`, the rest
  are `additional_schema_refs` rows, each named by the reference's permid. It is required, with at least one
  entry, because the column is NOT NULL.
- **`collectionReferences` is renamed `referenceList`.** Schema is its second caller. The codec already takes
  its child table from `x-storage`, so only the name and its error messages change; collection's behavior is
  unchanged.
- **`partsPreserved` and `notableFeatures` use `x-enumFrom`** (`dictionaries.parts_preserved.name`,
  `dictionaries.notable_features.name`). The seeds already hold exactly the inline values, in order; both join
  the seed-fidelity snapshot.
- **`year` is strict on create only**, as for authority: `db` keeps `maxLength: 4`; `x-create` requires four
  digits.
- **`migrate-pbot-schemas.js` validates every built schema payload** against the `db` variant, before it
  inserts any schema, and takes its case-insensitive enum maps from the resolved source instead of two
  hard-coded lists.
- **The audit covers `schema`**: a versioned `REGISTRY` entry with `additional_schema_refs` as a child table,
  round trip included. The `pbot-schemas` step therefore starts auditing `schema`.
- **The `$defs` notes are corrected**: `variants.js` and `DESIGN_NOTES.md` say `$defs` support is needed only
  if the API creates whole character/state trees in one call, not before `schema.schema.js` can be converted.
- **Not exposed:** `authorizer_person_id` and `enterer_person_id`, as on every converted entity.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `payload-schema-variants`: `schema.schema.js` joins the converted sources; the schema source's fields,
  annotations, required lists and create-time `year` rule are specified; `collectionReferences` is renamed
  `referenceList`, and every requirement that names it is updated.
- `payload-schema-enums`: `partsPreserved` and `notableFeatures` are table-backed, and
  `dictionaries.parts_preserved` / `dictionaries.notable_features` join the seed-fidelity snapshot.
- `payload-audit`: `schema` is an audited, versioned entity whose round trip rebuilds `references[]` from the
  column and the child rows, with `refs` pre-loaded as for collection; the codec rename is carried through.
- `pbot-schema-migration`: schema payloads are validated against the `db` variant of `schemaSource` before
  any insert, and the enum mappings follow the dictionary tables.
- `migration-runner`: the `pbot-schemas` step audits `schema`, and a full run audits six entities.

## Impact

**Source and target**: the source is the PBot GraphQL API, not MariaDB, so no legacy MariaDB table, type
mapping, 0-as-NULL pattern or `anomaly-report.md` anomaly is involved. Target tables: `schemas` (8 rows on
localhost `pbdb`, all heads), `additional_schema_refs` (1 row), and `dictionaries.parts_preserved` /
`dictionaries.notable_features` (read only). `characters` and `states` are untouched.

**Payload schemas**: `payloadSchemas/schema.schema.js` (rewritten), `payloadSchemas/lib/codecs.js` (rename),
`payloadSchemas/collection.schema.js` (codec name), `payloadSchemas/lib/variants.js` and
`payloadSchemas/DESIGN_NOTES.md` (notes), `payloadSchemas/tests/` (sources, storage, fixture).

**Migrations**: `src/pbot-schemas-migration/migrate-pbot-schemas.js` (validation and enum maps; fetch, skip
rules, reference resolution and inserts are unchanged).

**Audit and runner**: `src/audit-payloads.js` (`REGISTRY`, a comment), `src/README.txt`, and the audit and
runner tests. `src/run-migrations.js` needs no code change.

**Database**: no DDL change, and the stored jsonb is unchanged, so localhost `pbdb` needs no rebuild.
Verification runs the full pipeline, with `PBOT_TOKEN`, into a side database.

**Risk to data integrity**: low, and it points the other way from a normal migration change. The migration now
rejects payloads it used to insert unchecked, so a PBot record that was quietly accepted could stop the step.
The side-DB run against live PBot is what shows whether any does. The `db` variant must also not be looser
than the old schema: `title` and `year` stay required, `year` stays at most four characters, `authors` keeps
`minItems: 1` and `order ≥ 1`, and the two enums stay closed to the same values.
