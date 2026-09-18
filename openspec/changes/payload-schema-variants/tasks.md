## 1. Baseline and enum snapshot (before any schema file is edited)

- [ ] 1.1 Record the current localhost baseline from the last successful run in `src/run-migrations.log`: `collections` 275,554, `additional_collection_refs` 371,774, `specimens` 167,150, and the other steps' deltas.
- [ ] 1.2 Record a content fingerprint of the stored jsonb, keyed by legacy id so that regenerated permids don't affect it. For example, `md5(string_agg(collection::text, '|' ORDER BY (collection->'legacyIDs'->>'oldpbdbID')::int))` for collections and the equivalent for specimens. Save both hashes in the change directory as `baseline.md`.
- [ ] 1.3 Write `payloadSchemas/tests/fixtures/legacy-enums.json` from the current module objects, keyed by target `table.column` for the eight new tables: `collection_methods.name`, `coordinate_bases.name`, `geographic_scales.name`, `lithologies.name`, `lithology_adjectives.name`, `dating_methods.name`, `preservation_modes.name`, `institution_codes.code`. Assert while generating that collection `paleontology.preservation.modes` and specimen `preservationModes` are identical (37 values) before writing the single `preservation_modes` entry.
- [ ] 1.4 Check the snapshot counts: 21 / 5 / 6 / 54 / 70 / 23 / 37 / 60, with `'none specified'` first in `institution_codes.code`.

## 2. Dictionary tables

- [ ] 2.1 In `postgresql/create_new.sql`, after the `dictionaries.maritime` section, add the eight tables per the payload-schema-enums spec (`id` identity PK; `name`, or `code` for `institution_codes`, as `text NOT NULL UNIQUE`). Seed each in snapshot order, byte for byte, keeping embedded double quotes and `hydroflouric`. Add a header comment stating the rule: append freely; rename or delete only with a data migration.
- [ ] 2.2 Add `payloadSchemas/tests/dictionary-seeds.test.js`: for each snapshot key, query the table `ORDER BY id` and assert the values deep-equal the snapshot.
- [ ] 2.3 Add a `"test"` script to `package.json` that runs `node --test payloadSchemas/tests/ src/tests/`.

## 3. Schema tooling in `payloadSchemas/lib/`

- [ ] 3.1 `ajv.js`: `createAjv()` returns a draft-2019-09 Ajv with `allErrors: true` and `strict: true`, with `x-enumFrom`, `x-storage`, and `x-create` registered as annotation keywords.
- [ ] 3.2 `enums.js`:
  - `collectEnumSources`, `loadEnums`, `applyEnums`, and `resolveEnums`;
  - the identifier pattern and key checks; an `x-enumFrom` alongside a literal `enum` throws;
  - `ORDER BY id`, NULLs excluded, de-duplication keeping the first occurrence;
  - one query per pair; deep clone with `x-enumFrom` kept; throws on an empty or missing table or column.
- [ ] 3.3 `payloadSchemas/tests/enums.test.js`: cover every payload-schema-enums scenario with fixture maps (pure) plus one real-DB test of `loadEnums`.
- [ ] 3.4 `variants.js`: `deriveVariant(source, variant)` for `db`, `in-create`, `out`, and `patch-guard`, per design Decision 5.
  - Recurse through `properties`, `items`, `allOf`, `anyOf`, `oneOf`, `if`, `then`, and `else`.
  - Throw on an unknown variant and on `readOnly` below the root.
  - Set `$id` per entity and variant.
  - No `$defs`/`$ref` support yet; leave a comment noting that `schema.schema.js` will need it.
- [ ] 3.5 `payloadSchemas/tests/variants.test.js`: cover each variant's rules on small synthetic sources, including source immutability, `required` pruning when `x-storage` or `readOnly` properties are removed, `x-create` merged only in `in-create`, `out` dropping resolved enums while keeping inline ones, and `patch-guard` omitting `propertyNames` when there are no read-only properties.
- [ ] 3.6 `codecs.js`: the `wgs84Point` and `collectionReferences` codecs per the spec, each with `split` and `merge`.
- [ ] 3.7 `storage.js`: `split(source, payload)` and `merge(source, parts)`. Group sibling properties by codec; throw on an unknown codec.
- [ ] 3.8 `payloadSchemas/tests/storage.test.js`: cover every codec and split/merge scenario (EWKT text, half a coordinate pair, order normalization, primary reference to the column, unknown codec), plus a property test that `split` of a fixture valid against `in-create` yields jsonb valid against `db`.

## 4. Rewrite the collection and specimen sources

- [ ] 4.1 Rewrite `payloadSchemas/collection.schema.js` as a single annotated source:
  - `x-enumFrom` per the assignment table; inline enums unchanged;
  - `permid` (`readOnly` + `x-storage` column), `legacyIDs` (`readOnly`);
  - `latitude`/`longitude` (`x-storage` → `location` via `wgs84Point`), `references` (`x-storage` → `collectionReferences`);
  - root `x-create` requiring `context` and `references`; `x-create` on `coordinates` and `ages.measurements[]`; the admin1 `x-create` at `location.toponym.administrativeArea`.
  - Delete `completeCollectionProperties`, `collectionSchema`, `collectionMigrationSchema`, the envelopes, `response`, and `examples`.
- [ ] 4.2 Rewrite `payloadSchemas/specimen.schema.js` the same way: `institutionCode` and `preservationModes` use `x-enumFrom`, `permid` and `legacyIDs` as above. Delete the envelope, the ghosted `getSchema`/`patchSchema`/`editSchema`/`getPropertiesForPubType`, `response`, and `examples`. Move the single example into a test fixture.
- [ ] 4.3 `payloadSchemas/tests/sources.test.js`:
  - every variant of both entities resolves (fixture maps) and compiles under `createAjv()` in strict mode;
  - the admin1 Canada/France scenarios;
  - `in-create` rejects `permid`/`legacyIDs`;
  - `db` rejects a top-level `permid`;
  - the `patch-guard` scenarios;
  - the no-hand-maintained-exports scenario.
- [ ] 4.4 Search for other importers of the removed exports. Expected: only the three files in section 5. Any hit in `migration_exploration/` is left broken by policy.

## 5. Point the migrations at the `db` variant

- [ ] 5.1 `src/collections-migration/migrate-collections.js`: delete `hydrateSchema` and its call; keep `loadDicts` for the lookup maps. Build the validator once with `createAjv().compile(await resolveEnums(pg, deriveVariant(collectionSource, 'db')))` before streaming any MariaDB row. Validate the unwrapped payload instead of `{ collection: payload }`, keeping the existing failure logging.
- [ ] 5.2 `src/collections-migration/tests/test-collections-transforms.js`: replace the stub-filling with `applyEnums` over its existing DB-free fixture values, extended to the new dictionary pairs. Validate unwrapped payloads. The test passes.
- [ ] 5.3 `src/specimens-migration/migrate-specimens.js`: replace the envelope-stripping compile and `validate({ specimen })` with the resolved `db` variant and an unwrapped `validate(specimen)`.
- [ ] 5.4 Dry-run both migrations (`--dry-run`) against a database rebuilt from the new `create_new.sql`: zero validation failures, and resolution logs the expected enum sizes.

## 6. Payload audit

- [ ] 6.1 Create `src/audit-payloads.js`:
  - `main()` guarded for direct invocation;
  - a registry with `collection` (`collections.collection`) and `specimen` (`specimens.specimen`);
  - repeatable `--entity` (default all; an unknown name exits non-zero listing valid names before any read), and `--sample <n>` (default 10);
  - resolve and compile `db` once per entity, then keyset-paginate on `id` over all rows;
  - tally heads vs. superseded separately;
  - print the summary and sample, and write the report beside the script at `src/audit-payloads.log`;
  - exit 0 only if there are no violations and no resolution failures.
- [ ] 6.2 Add `--round-trip`: for head rows, select jsonb, `ST_AsGeoJSON(location)::json`, `reference_id`, and child refs ordered by id. Run merge → validate against `out` → remove readOnly → split, and compare to the stored values after codec normalization.
- [ ] 6.3 `src/tests/audit-payloads.test.js`: cover argument parsing, including repeated and unknown `--entity`.

## 7. Runner integration

- [ ] 7.1 In `src/run-migrations.js`, derive the audit entities from the selected steps' tables-written list (`collections` → `collection`, `specimens` → `specimen`). After the last selected step passes its postconditions:
  - if there is at least one entity, spawn `src/audit-payloads.js` with one `--entity` each, and treat a non-zero exit as a failed check named "audit";
  - if there are none, skip it.
  - Add no flag.
- [ ] 7.2 Extend the run-log block with the audited entities, audit timestamps, exit code, and per-entity rows checked and violations, or a line saying no audited tables were written.
- [ ] 7.3 Add to `src/tests/`: scope derivation for a full run (both entities), `--only specimens` (specimen only), `--only persons` (none), and `--from collections` (both).

## 8. Documentation

- [ ] 8.1 Update `payloadSchemas/DESIGN_NOTES.md`:
  - "one schema per resource" becomes "one annotated source per resource, with variants derived";
  - merge-then-validate kept, now with the `patch-guard` and the root-only `readOnly` rule;
  - the open policy table for which variant validates merged legacy rows;
  - note that the `$defs`-inside-`body` guidance applies to API route envelopes, and that `deriveVariant` needs `$defs`/`$ref` support before `schema.schema.js` is converted.
- [ ] 8.2 Update `src/README.txt` with the audit: it runs after the steps, is scoped to the tables they wrote, and can be run standalone with `node src/audit-payloads.js [--round-trip]`.

## 9. Verification on localhost

- [ ] 9.1 Rebuild from scratch with `dropdb`/`createdb`, then `node src/run-migrations.js --createdb`. The run succeeds, every step delta matches the baseline from 1.1, and the log shows the audit over `collection` and `specimen` with 0 violations.
- [ ] 9.2 Recompute the jsonb fingerprints from 1.2. Both match the baseline: this change must not alter stored payloads.
- [ ] 9.3 Run `npm test` (seed fidelity, enums, variants, storage, sources, audit arguments, runner scope, pbot-schemas summary) and `node src/collections-migration/tests/test-collections-transforms.js`. All pass.
- [ ] 9.4 Run `node src/audit-payloads.js --round-trip`. Every head collection and specimen round-trips with 0 differences.
- [ ] 9.5 Negative check: rename one `dictionaries.lithologies` value that migrated rows use. The audit exits non-zero and lists affected ids. Restore the value, and the audit exits 0 again.
- [ ] 9.6 Rollback check: note in `baseline.md` that reverting the change and rebuilding with `--createdb` restores the prior state. The jsonb is unchanged, and the new dictionary tables are purely additive.
