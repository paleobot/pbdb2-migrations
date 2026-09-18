## 1. Mapping and schema corrections

- [x] 1.1 In `payloadSchemas/mappings/specimens.md`, replace "use the house rule" on both person rows with the repository's established term and trigger: "If 0, apply the 0-sentinel fallback (`resolvePersons` in `src/lib/identity.js`): the non-zero of the pair substitutes for the zero one; if both are 0, use person 1." The columns are `NOT NULL DEFAULT 0` and never null, so "blank or null" matches nothing.
- [x] 1.2 In the same file, fix the one remaining lowercase `oldpbdbid` on the `reference_id` row to `oldpbdbID`, matching the other four rows.
- [x] 1.3 In `payloadSchemas/specimen.schema.js`, fix `examples[0]`, which currently fails `ajv` validation against its own schema three ways: change `preservationModes: ["compression"]` to a real enum member (`["adpression"]`), rename `specimenNumber` to `identifiers`, and remove the unevaluated `provenance` key.
- [x] 1.4 Verify the corrected example validates: compile `specimenSchema` with `Ajv2019` and assert `examples[0]` passes.

## 2. Target table

- [x] 2.1 Apply the `specimens` DDL from `postgresql/create_new.sql` to the localhost target database, confirming the applied table carries the corrected foreign keys (`collection_id` → `collections`, `preceded_by_id`/`succeeded_by_id` → `specimens`) and not the earlier `refs` copies.
- [x] 2.2 Confirm `install_version_triggers('specimens')` ran and the `permid` UUIDv7 CHECK constraint is present.

## 3. Source extraction

- [x] 3.1 Create `src/specimens-migration/migrate-specimens.js` with the standard module shape: `src/lib/` imports, `main()` guarded behind `import.meta.url === \`file://${process.argv[1]}\``.
- [x] 3.2 Write the streaming source query: `specimens` LEFT JOIN `occurrences` on `occurrence_no` (for `collection_no` and the occurrence's `reference_no`) LEFT JOIN `collections` on the occurrence's `collection_no` (for `museum`, `pres_mode`), ordered by `specimen_no ASC`, selecting only the columns the spec lists.
- [x] 3.3 Confirm the query returns 167,150 rows and that `specelt_no`, `modifier_no`, `updater_no`, `upload`, `upload_id`, `created`, `modified`, `updated` are not selected.
- [x] 3.4 Add a single `isUnset(v)` helper treating `0`, `null` and `undefined` alike, and use it for every legacy foreign-key test. Do not inline one-sided null checks.

## 4. Foreign-key resolution

- [x] 4.1 Load the PostgreSQL lookup maps at startup via `loadReferenceIdMap` and `loadNamePermidMap` from `src/lib/identity.js`, plus a collections map keyed on `collection->'legacyIDs'->>'oldpbdbID'` where `succeeded_by_id IS NULL`.
- [x] 4.2 Resolve the audit pair by calling `resolvePersons` from `src/lib/identity.js`; do not reimplement the 0-sentinel rule locally.
- [x] 4.3 Resolve `reference_id` from `specimens.reference_no`, falling back to the joined occurrence's `reference_no` when unset. Abort with the `specimen_no` and both legacy numbers logged if neither resolves.
- [x] 4.4 Resolve `collection_id` through the joined occurrence; a `collection_no` that resolves to no migrated collection yields NULL plus an anomaly, and does not abort.
- [x] 4.5 Resolve `name_opinions_permid` from `taxon_no` only. Do not consult `occurrences.taxon_no`. Abort if a non-zero `taxon_no` fails to resolve.
- [x] 4.6 Write `oldpbdb_occurrence_no` from `occurrence_no`, converting unset to NULL.

## 5. Payload construction

- [x] 5.1 Build identity: `specimen.name` = `pbdb_classic:${specimen_no}`, `specimen.legacyIDs.oldpbdbID` = `String(specimen_no)`.
- [x] 5.2 Build `specimen.type` from `is_type`, omitting the key when the value is `''` or null — the one column where `''` occurs (8,453 rows) and where writing it through would fail validation.
- [x] 5.3 Build `specimen.identifiers.catalogNumber` from `specimen_id` verbatim, omitting when null. No parsing or normalising.
- [x] 5.4 Build `specimen.identifiers.institutionCode` from the joined `museum`: first member of the SET when multi-valued, `'none specified'` when there is no value or no collection. The key is never absent.
- [x] 5.5 Build `specimen.paleontology.preservationModes` by splitting the joined `pres_mode` SET on `,`; omit the key entirely when there is no value or no collection.
- [x] 5.6 Build the remaining `specimen.paleontology` fields verbatim from `specimens_measured`, `specimen_coverage`, `specimen_side`, `sex`, `specimen_part`, `measurement_source`, `magnification`, omitting null keys and passing malformed `magnification` values through unrepaired.
- [x] 5.7 Build `specimen.notes` from `comments`, omitting when null.
- [x] 5.8 Generate `permid` per row with `src/lib/uuidv7.js`.

## 6. Validation and writing

- [x] 6.1 Compile `specimenSchema` at startup and validate every built payload before any write; on failure log the `specimen_no`, errors, and payload, then abort.
- [x] 6.2 Insert in batches, following the batching and progress-logging style of `src/collections-migration/migrate-collections.js`.
- [x] 6.3 Record anomalies to a ledger under `src/specimens-migration/` using `src/lib/anomaly-log.js`; never write artifacts to the repository root.
- [x] 6.4 Write a run summary reporting source count, migrated count, the occurrence/taxon/both split, reference-fallback count, person-sentinel count, `'none specified'` count, and null-`name_opinions_permid` count.

## 7. Verify against the source data

- [x] 7.1 Run the migration standalone against localhost and confirm 167,150 rows in `specimens`.
- [x] 7.2 Confirm the exclusive split: 144,690 occurrence-only, 21,392 taxon-only, 1,068 with both set (145,758 rows carry an occurrence in total).
- [x] 7.3 Confirm `name_opinions_permid` is null on exactly 144,690 rows.
- [x] 7.4 Confirm the 11 zero-reference rows resolved through the occurrence fallback, spot-checking `specimen_no` 51257 → legacy reference 11407 and 139454 → 48558.
- [x] 7.5 Confirm `specimen_no` 67161 and 67162 both carry `authorizer_person_id = 1` and `enterer_person_id = 1`.
- [x] 7.6 Confirm `specimen_no` 20612 has `collection_id` NULL and that exactly one orphaned-collection anomaly was recorded.
- [x] 7.7 Confirm no row has `specimen->>'type' = ''` and that 94,310 rows have no `type` key.
- [x] 7.8 Confirm 118,878 rows carry `identifiers.institutionCode = 'none specified'` and 48,272 carry a real code. (Planned as 118,877: that figure came from an INNER join and so omitted `specimen_no` 20612, whose occurrence names a nonexistent collection and which therefore has no museum either.)
- [x] 7.9 Confirm 143,207 rows have a `preservationModes` array and 23,943 have no such key. (Off by one from the plan for the same reason as 7.8.)

## 8. Runner integration

- [x] 8.1 Add the `specimens` step to `STEPS` in `src/run-migrations.js` at position 10, entry point `src/specimens-migration/migrate-specimens.js`, env group `['PG', 'MARIADB']`, `writes: ['specimens']`, `firstWriterOf: ['specimens']`.
- [x] 8.2 Add its preconditions: `specimens` empty, `collections` non-empty, `name_opinions` non-empty, at least one `refs` row with `reference->'legacyIDs'->>'oldpbdbID'`.
- [x] 8.3 Verify `--only specimens` and `--from specimens` both address the step, and that `--list` shows ten steps.
- [x] 8.4 Run the full pipeline from a clean database and confirm all ten steps pass, with the nine preceding totals unchanged and `specimens` at 167,150. (All ten passed; every MariaDB-derived total reproduced exactly. `refs` is +2 against the pre-rebuild baseline — entirely PBot-side, 237 `pbotID` refs vs 235, because `pbot-refs` reads the live PBot API; the `oldpbdbID` count is identical at 93,705.)

## 9. Documentation

- [x] 9.1 Update `src/README.txt` with the specimens migration and its position in the run order.
- [x] 9.2 When syncing specs, update the `migration-runner` spec's **Purpose** paragraph from "nine migrations" to "ten" — the delta covers requirements only, and the Purpose text is not reachable through a MODIFIED requirement.
