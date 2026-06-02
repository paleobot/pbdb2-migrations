## 1. Script Setup

- [x] 1.1 Create `migrate-authorities.js` (ESM) with MariaDB + PostgreSQL pool imports, env var validation (`PG_*`, `MARIADB_*`), and constants (source table, batch size, dedup-Map initial capacity hint)
- [x] 1.2 Import `authoritySchema` from `payloadSchemas/authority.schema.js` and set up an `ajv` instance with `unevaluatedProperties` support (Draft 2019-09); compile the validator once at module load
- [x] 1.3 Add a small `decodeEntities()` helper (HTML entity decode for `&#NNN;`, `&amp;`, `&lt;`, `&gt;`, `&quot;`, `&apos;`); reuse an existing lib if one is already in `node_modules`, otherwise inline

## 2. Lookup Pre-loads

- [x] 2.1 Pre-load the legacy `reference_no` → new `refs.id` map: query `SELECT id, reference->'legacyIDs'->>'oldpbdbID' AS legacy FROM refs WHERE succeeded_by_id IS NULL`; build a `Map<string, number>` keyed by the legacy id as string
- [x] 2.2 ~~Pre-load the legacy `person_no` → new `persons.id` map~~ — not needed: `persons.id == legacy person_no` by construction (`migrate-persons.js`), and persons isn't versioned. Use `authorizer_no`/`enterer_no` directly, same as `migrate-refs.js`.

## 3. Pure Transforms (no DB; unit-testable in `play/`)

- [x] 3.1 Implement `classifyScenario({ ref_is_authority, author1last })` returning one of `'①' | '②' | '③' | '④'` per the spec's classification table; treat whitespace-only `author1last` as empty
- [x] 3.2 Implement `buildDescriptorsFromFields({ author1last, author2last, otherauthors })` for scenarios ②/③: for each field, `decodeEntities` → split on `/[,;:&]/` → trim → drop empties → drop literal `'et al.'`; concat into one array preserving order
- [x] 3.3 Implement `buildDescriptorsFromRef(refAuthors)` for scenario ①: `refAuthors.map(a => a.familyName)`; returns `[]` when `refAuthors` is empty
- [x] 3.4 Implement `buildCitationFromFields({ author1last, author2last, otherauthors, pubyr })` per the scenario ②/③ formula; result is trimmed (handles empty `pubyr`)
- [x] 3.5 Implement `buildCitationFromRef({ refAuthors, publicationYear })` per the scenario ① formula (1/2/3+ author rules, empty year, zero authors); result is trimmed
- [x] 3.6 Implement `buildAuthorityPayload(srcRow, scenario, refData)` that assembles the full `authority` jsonb (`legacyIDs.oldpbdbIDs: [String(taxon_no)]`, `publishedInReference`, `citation`, `descriptors`, optional `year`); omit `year` when empty rather than emitting empty string
- [x] 3.7 Implement `dedupKey(authority, reference_id)` returning a canonical string `JSON.stringify([reference_id, citation, year ?? '', descriptors])`; same input always produces same output

## 4. Stream, Classify, Aggregate

- [x] 4.1 Open the source query: `SELECT taxon_no, ref_is_authority, author1last, author2last, otherauthors, pubyr, reference_no, authorizer_no, enterer_no FROM authorities ORDER BY taxon_no ASC`; stream rows (do not buffer the full result set)
- [x] 4.2 For each source row, look up the new `reference_id` from the pre-loaded map; if missing, increment orphan counter, log `{taxon_no, reference_no}`, and continue (do not insert)
- [x] 4.3 For each source row, resolve `authorizer_person_id` / `enterer_person_id` from the person map with the 0-sentinel fallback (when one is 0, use the other's value); same logic as `migrate-refs.js:175-181`
- [x] 4.4 Classify the scenario via `classifyScenario()`; for ④, increment counter, log `taxon_no`, continue (no insert)
- [x] 4.5 For ② and ③, build descriptors via `buildDescriptorsFromFields` and citation via `buildCitationFromFields`; set `publishedInReference` (`true` for ②, `false` for ③); year = `pubyr` (omit if empty)
- [x] 4.6 For ①, fetch the linked ref's `reference->'authors'` and `reference->'publicationYear'` (one query per distinct `reference_id`, cached for the run); build descriptors via `buildDescriptorsFromRef` and citation via `buildCitationFromRef`; set `publishedInReference: true`; year = ref's `publicationYear` (omit if empty)
- [x] 4.7 Validate the constructed authority payload against the compiled ajv validator **before** touching the dedup Map; on failure, log `{taxon_no, errors, payload}` and `process.exit(1)` — no DB writes have occurred at this point
- [x] 4.8 Compute `dedupKey(authority, reference_id)`; if absent from the Map, store `{authority, reference_id, authorizer_person_id, enterer_person_id, source_taxon_no}` (the survivor's full insert payload); if present, append `String(taxon_no)` to the survivor's `authority.legacyIDs.oldpbdbIDs` and increment the merge counter and log the merge

## 5. Bulk Insert (transaction-wrapped)

- [x] 5.1 Acquire a single PG client from the pool; begin a transaction with `BEGIN`
- [x] 5.2 Iterate the dedup Map values; for each, generate a fresh `randomUUID()` for `permid` and execute the `INSERT INTO authorities (permid, authorizer_person_id, enterer_person_id, authority, reference_id)` statement; batch into chunks (e.g. 1000 rows) for throughput
- [x] 5.3 On any error inside the transaction (FK violation, constraint error, unexpected exception), execute `ROLLBACK`, log the error with context, release the client, and `process.exit(1)`
- [x] 5.4 On successful completion of all inserts, `COMMIT` and release the client
- [x] 5.5 Reset the `authorities` identity sequence to `MAX(id) + 1` after commit, matching the pattern in `migrate-refs.js`

## 6. Logging and Counters

- [x] 6.1 Track counters during the run: `sourceRows`, `scenario1`, `scenario2`, `scenario3`, `scenario4Skipped`, `orphanRefSkipped`, `survivorsInserted`, `mergesAbsorbed`
- [x] 6.2 Emit per-event warnings in the `console.warn` style of `migrate-refs.js` for: scenario ④ skips, orphan-ref skips, dedup merges
- [x] 6.3 Print a summary block at end of run: counts above plus elapsed time and final row count from `SELECT COUNT(*) FROM authorities`
- [x] 6.4 Sanity check: assert `survivorsInserted + mergesAbsorbed + scenario4Skipped + orphanRefSkipped == sourceRows`; warn loudly if not

## 7. Verification

- [x] 7.1 Dry-run the pure transforms in `play/` against a representative sample of source rows (one for each scenario, plus edge cases: empty pubyr, HTML entity in name, fused author, scenario ① with 0-author ref, scenario ① with 1/2/3+ authors); confirm citation strings and descriptors match expectations
- [x] 7.2 Run the full migration end-to-end against a non-production target; verify summary counters: source rows ≈ 517,287; scenario ④ ≈ 16,606; orphan-ref ≈ 3; survivors ≈ 140K
- [x] 7.3 Spot-check 5–10 inserted rows across scenarios: confirm `publishedInReference`, `citation`, `descriptors`, `year`, and `legacyIDs.oldpbdbIDs` (length-1 for non-merged, length-many for merged)
- [x] 7.4 Verify dedup merge correctness: pick a known multi-`taxon_no` authority, confirm `oldpbdbIDs` contains all source `taxon_no`s sorted ascending, and confirm the survivor's chosen `authorizer_person_id`/`enterer_person_id` came from the smallest-`taxon_no` source row
