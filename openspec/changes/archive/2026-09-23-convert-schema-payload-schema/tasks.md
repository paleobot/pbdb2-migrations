## 1. The codec rename

- [x] 1.1 In `payloadSchemas/lib/codecs.js`, rename `collectionReferences` to `referenceList`: the constant, the `lookup` name in both directions, the `codecs` registry entry, and the comment above it (describe the parent's `reference_id` and the `x-storage` child table rather than `collections.reference_id`). Behavior unchanged (D2)
- [x] 1.2 Update collection's `references` annotation in `payloadSchemas/collection.schema.js` to `codec: "referenceList"`, and the `referencePermid` comment that mentions the old name
- [x] 1.3 Update `payloadSchemas/tests/storage.test.js`: the test source's annotation, test names and the error-message regexes; add a test that an `additional_schema_refs` annotation emits child rows under that table only, and that a source naming `collectionReferences` throws as an unknown codec
- [x] 1.4 `grep -rn collectionReferences` outside `openspec/changes/archive` returns only the delta specs of this change

## 2. The schema source

- [x] 2.1 Rewrite `payloadSchemas/schema.schema.js` as `schemaSource` (and `default`): no envelope, `$id .../schema.json`, `unevaluatedProperties: false`, and a header comment in the style of `authority.schema.js` covering `references` and the deferred character/state tree (D1)
- [x] 2.2 Declare the ten properties with the annotations in the `payload-schema-variants` spec, carrying the legacy constraints over unchanged (`year` `maxLength: 4`; `authors` `minItems: 1` with integer `order` `minimum: 1`); `references` items require both `referenceID` and `order`
- [x] 2.3 Replace the inline `partsPreserved` and `notableFeatures` enums with `x-enumFrom` on their `items` (D4)
- [x] 2.4 Set base `required` to `title`, `year`, `references`; add `x-create: { properties: { year: { type: "string", pattern: "^[0-9]{4}$" } } }` (D3)
- [x] 2.5 Keep the commented-out `$defs` and `schemaDefinition` below the source, under a comment saying they sketch the one-call tree API and are not part of the payload (D7)
- [x] 2.6 Add `parts_preserved.name` and `notable_features.name` to `payloadSchemas/tests/fixtures/legacy-enums.json`, copied from the inline arrays before they are removed; run `payloadSchemas/tests/dictionary-seeds.test.js` against localhost `pbdb`
- [x] 2.7 Add `schema` to `payloadSchemas/tests/sources.test.js`: the module exports only `schemaSource` and `default`; every variant compiles in strict mode; `patch-guard` blocks exactly `permid` and `legacyIDs`; `db` declares neither `permid` nor `references` and requires only `title` and `year`; no `characters`, `states`, `schemaDefinition` or `$defs`
- [x] 2.8 Unit-test the spec scenarios: a stored payload passes `db`; missing `title`, missing `year`, `year: "20230"`, `authors: []`, author `order: 0` and an undeclared key fail `db`; `partsPreserved: ["bark"]` and `notableFeatures: ["pith structure"]` fail; `in-create` requires `references` (non-empty, items with `referenceID`) and rejects `year` `"0"` and `"abc"` while accepting `"2023"`

## 3. PBot schemas migration

- [x] 3.1 In `src/pbot-schemas-migration/migrate-pbot-schemas.js`, resolve `schemaSource` with `resolveEnums` and compile its `db` variant with `createAjv()` before the first PBot fetch (D5)
- [x] 3.2 Remove `PARTS_PRESERVED_ENUMS` and `NOTABLE_FEATURES_ENUMS`; build the two case-insensitive maps from the resolved source's `partsPreserved.items.enum` and `notableFeatures.items.enum`, keeping the normalization and the warn-and-drop behavior (D4)
- [x] 3.3 After fetching schemas, build every payload and validate each; on failure log the `pbotID`, payload and ajv errors and exit non-zero before any insert. The insert loop uses the payloads already built (D5)
- [x] 3.4 Confirm `src/tests/pbot-schemas-summary.test.js` still passes and the summary lines the runner parses are unchanged

## 4. Audit and runner

- [x] 4.1 Add a `schema` entry to `REGISTRY` in `src/audit-payloads.js`, after `authority`: table `schemas`, column `schema`, source `schemaSource`, `versioned: true`, columns `['permid', 'reference_id']`, children `[{ table: 'additional_schema_refs', fk: 'schema_id', columns: ['id', 'reference_id'] }]`; update the pre-load comment to name `referenceList` and schema (D6)
- [x] 4.2 Update `src/tests/audit-payloads.test.js`: default entity list, the unknown-entity message, `parseArgs` accepts `schema`, and the registry's versioned flags
- [x] 4.3 Update `src/tests/run-migrations-audit.test.js`: the full run audits six entities ending in `schema`; `--only pbot-schemas` audits `schema`; `--only authority-opinions` still audits nothing
- [x] 4.4 Confirm `src/run-migrations.js` needs no code change; update the audited-entity list in `src/README.txt`

## 5. Notes

- [x] 5.1 Reword the `$defs` sentence in the `payloadSchemas/lib/variants.js` header: `$defs`/`$ref` are not followed, and are needed only if the API creates a schema's character/state tree in one call (D7)
- [x] 5.2 Reword the same note in `payloadSchemas/DESIGN_NOTES.md` ("$defs must live inside body")

## 6. Verification

- [x] 6.1 `npm test`: all suites pass
- [x] 6.2 With `PBOT_TOKEN` set, run the full pipeline into a side database: `PG_DATABASE=pbdb_schema_verify node src/run-migrations.js --createdb`. Every step's postconditions pass, `pbot-schemas` validates every schema payload and reports no skips, and the runner's audit is clean for all six entities. If a live PBot schema fails validation, stop and bring it to the user rather than loosening `db`
- [x] 6.3 On the side database, `node src/audit-payloads.js --round-trip`: zero violations and zero differences for all six entities; schema reports every row checked
- [x] 6.4 Compare `schemas` between the side database and localhost `pbdb`, matched on `legacyIDs.pbotID`: counts, jsonb, and cited refs (primary and additional, compared by the refs' `legacyIDs`, since ids and permids are regenerated). Report any difference and whether PBot edits explain it
- [x] 6.5 With the user's go-ahead, drop `pbdb_schema_verify`. Localhost `pbdb` is left as it is: no DDL or stored jsonb changed

## 7. Specs

- [x] 7.1 Confirm the five delta specs match what was implemented, amending them if implementation revealed anything different
- [x] 7.2 Run `openspec validate convert-schema-payload-schema --strict`
- [x] 7.3 Sync deltas into `openspec/specs/` via `/opsx:sync` or at archive time
