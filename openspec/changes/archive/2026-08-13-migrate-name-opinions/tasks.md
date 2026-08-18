## 1. Preflight and resolution setup

- [x] 1.1 Create `migrate-name-opinions.js` (ESM) alongside the other `migrate-*.js` scripts, importing `mariadb`, `pg`, `closeAll` from `./db.js`, `uuidv7` from `./uuidv7.js`, `Ajv`, and `opinionAttributionSchema` from `./payloadSchemas/opinionAttribution.schema.js`.
- [x] 1.2 Resolve dictionary ids once at startup: `namechange_reasons.id WHERE reason='original'` (and confirm its `edge_class='root'`), `nomenclatural_statuses.id WHERE status='informal'`, and a Map of `taxonomy_ranks.taxonomy_rank → id`. Abort if any is missing.
- [x] 1.3 Preload current-head `authorities` (`succeeded_by_id IS NULL`) and build `Map<taxon_no(str) → {authority_id, reference_id, citation, descriptors, publishedInReference, year}>` by fanning out each row's `authority.legacyIDs.oldpbdbIDs`.

## 2. Per-row transforms

- [x] 2.1 Stream `authorities` from MariaDB selecting `taxon_no, taxon_name, taxon_rank, reference_no, authorizer_no, enterer_no` (streaming, not buffered).
- [x] 2.2 For each row, look up the resolution Map by `taxon_no`; if absent, skip-and-log (`taxon_no`, `reference_no`) and increment the skipped counter.
- [x] 2.3 Resolve `rank_id` from the rank Map, remapping `'informal' → 'unranked'`; abort on any unmapped `taxon_rank`.
- [x] 2.4 Resolve persons: `authorizer_no`/`enterer_no` as `persons.id` with the 0-sentinel fallback (0 → other; both 0 → 1).
- [x] 2.5 Build `attribution` `{citation, descriptors, publishedInReference}` from the resolved authority; compute `publication_year = parseInt(authority.year)` with `'0'`/absent → NULL.
- [x] 2.6 Validate the `attribution` wrapper against `opinionAttribution.schema.js`; on failure log `taxon_no` + payload and exit non-zero (before any insert).
- [x] 2.7 Mint one `uuidv7()`; accumulate a root `name_opinions` record: `permid`=`subject_permid`=minted uuid, `target_permid`=NULL, `reason_id`='original', `edge_class`='root', `objective`=NULL, `evidence`=false, `new_name`=`taxon_name`, `rank_id`, `authority_id`, `reference_id`, `attribution`, `publication_year`, `oldpbdb_taxon_no`=`taxon_no`, persons, `removed`=false.
- [x] 2.8 When `taxon_rank='informal'`, also accumulate a `validity_opinions` record sharing the name_opinion's `permid` as `subject_permid`: fresh `uuidv7()` permid, `nomenclatural_status_id`='informal', `targeted`=false, `target_permid`=NULL, `reference_id`/`attribution`/`publication_year`/persons mirrored from the name_opinion, `evidence`=false, `removed`=false.

## 3. Bulk insert

- [x] 3.1 Open a single Postgres transaction (`BEGIN`); batch-insert accumulated `name_opinions` rows (batch size ~1000, parameterized), then the 18 `validity_opinions` rows; `COMMIT`. Roll back on any error.
- [x] 3.2 Reset the identity sequences for `name_opinions` and `validity_opinions` via `setval(pg_get_serial_sequence(...), MAX(id))`.
- [x] 3.3 Log counters (`sourceRows, nameOpinionsInserted, validityInserted, informalCount, skipped`) and assert `nameOpinionsInserted + skipped == sourceRows`.

## 4. Verify

- [x] 4.1 Run the migration against the dev DB; confirm `name_opinions` = 517,284, `validity_opinions` = 18, skipped = 3.
- [x] 4.2 Spot-check a normal row (root shape: `target_permid` NULL, `new_name`/`rank_id` set, `subject_permid`=`permid`) and an `informal` row (name_opinion `rank_id`='unranked' + matching `validity_opinions` row with `targeted`=false).
- [x] 4.3 Confirm no constraint violations fired (minting-shape CHECK, both composite FKs, version-7 permid CHECK) and that the 3 skipped `taxon_no`s (242140/242141/242243) are absent.
