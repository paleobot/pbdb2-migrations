## 1. Heads-only sources

- [x] 1.1 Accept an optional `versioned: true` on a codec source in `payloadSchemas/lib/storage.js`'s `checkSource`, leaving `{ table, key, value }` valid as it stands (D1)
- [x] 1.2 Make `loadCodecContext` add `WHERE succeeded_by_id IS NULL` when reading a `versioned` source, composing correctly with a `selection` restriction on either column
- [x] 1.3 Build both `byKey` and `byValue` from the head rows only, so an unresolvable stored id throws rather than resolving quietly (D1)
- [x] 1.4 Unit-test from a fake `pg`: a versioned source issues the succession filter, an unversioned one does not, and the filter survives being combined with a selection

## 2. `collectionReferences` carries permids

- [x] 2.1 Declare the source `{ table: "refs", key: "id", value: "permid", versioned: true }` on the codec in `payloadSchemas/lib/codecs.js`
- [x] 2.2 Resolve each `referenceID` permid to a head `id` on split — the primary into `columns.reference_id`, the rest into child rows — keeping the existing sort-by-order and primary/children topology untouched (D3)
- [x] 2.3 Map each stored `reference_id` back to its permid on merge, keeping the re-derived `"1"`, `"2"`, `"3"` ordering by ascending child id
- [x] 2.4 Throw naming `collectionReferences` and the offending value on an unresolvable permid or `reference_id`
- [x] 2.5 Update the `referenceID` description in `payloadSchemas/collection.schema.js`, which currently reads "Reference unique identifier", to say it carries a permid; change nothing structural, and leave `x-storage` as `{ table, codec }` (D2)
- [x] 2.6 Unit-test both directions from a hand-built fixture `Map` with no database, including the unknown-permid and unknown-id throws
- [x] 2.7 Unit-test the superseded case from a fixture whose rows include a superseded version sharing a permid with its head, asserting the head's id — this is the only test that exercises what the change is for, since no migrated ref has a second version

## 3. Audit pre-loads refs

- [x] 3.1 Partition the round trip's codec sources three ways in `src/audit-payloads.js`: `dictionaries` and any source `codecKeyColumns` gives no columns for are pre-loaded into the per-run context; the rest are selected per batch (D2)
- [x] 3.2 Confirm person still batches its `persons` source and collection pre-loads `refs`, and that `codecKeyColumns` is left unchanged
- [x] 3.3 Confirm the collection round trip passes the context to both `merge` and `split`, and that `roundTripDifferences` still compares `reference_id` and the child rows against what is stored

## 4. Verification

- [x] 4.1 `npm test` — all suites pass
- [x] 4.2 `node src/audit-payloads.js --round-trip` — zero violations and zero differences across collection, specimen and person
- [x] 4.3 Confirm `refs` is read once for the collection run, not 56 times, by counting the queries the audit issues against it
- [x] 4.4 Confirm every collection's rebuilt `references[]` resolves to the same `refs` rows it cites today: the permids merge produces map back to the stored `reference_id` and child `reference_id`s for all 275,554 collections
- [x] 4.5 Confirm no migration, DDL or stored-data change was needed (D4) — `git diff` touches no file under `src/*-migration/` and no `postgresql/`

## 5. Specs

- [x] 5.1 Confirm the two delta specs match what was implemented, amending them if implementation revealed anything different
- [x] 5.2 Run `openspec validate expose-reference-permids`
- [x] 5.3 Sync deltas into `openspec/specs/` via `/opsx:sync` or at archive time
