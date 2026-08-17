## 1. Scaffolding and preloads

- [x] 1.1 Create `migrate-assignment-opinions.js` (ESM) alongside the other `migrate-*.js` scripts, importing `mariadb`, `pg`, `closeAll` from `db.js`, `uuidv7`, and the ajv validator for `opinionAttribution.schema.js`
- [x] 1.2 Preload the name-identity Map: query `SELECT oldpbdb_taxon_no, permid FROM name_opinions WHERE succeeded_by_id IS NULL AND oldpbdb_taxon_no IS NOT NULL` into `Map(Number(oldpbdb_taxon_no) → permid)`
- [x] 1.3 Preload the reference Map: `reference_no (int) → refs.id` from `refs` current heads via `reference->'legacyIDs'->>'oldpbdbID'`
- [x] 1.4 Compile the `opinionAttribution.schema.js` validator once for the in-memory validation pass

## 2. Source read (scoped)

- [x] 2.1 Stream the MariaDB `opinions` rows matching `status='belongs to' AND spelling_reason='original spelling'`, selecting `opinion_no, child_spelling_no, parent_spelling_no, basis, pubyr, ref_has_opinion, reference_no, authorizer_no, enterer_no, author1last, author2last, otherauthors`
- [x] 2.2 Log the starting in-scope count and process rows in streaming fashion (do not buffer the full result set)

## 3. Per-row transform and classification

- [x] 3.1 Resolve `subject_permid` from the name Map keyed by `child_spelling_no`; if absent, skip with reason `child_spelling_unresolved`
- [x] 3.2 Resolve `containing_permid`: if `parent_spelling_no` is 0/NULL skip with reason `parent_spelling_zero`; else look up the name Map and skip with `parent_spelling_orphan` if absent
- [x] 3.3 If `child_spelling_no = parent_spelling_no`, skip with reason `self_reference` (do not attempt the insert)
- [x] 3.4 Resolve `reference_id` from the reference Map; if absent, skip with reason `orphan_reference`
- [x] 3.5 Set `evidence = (basis === 'stated with evidence')`, `questioned = false`, `removed = false`
- [x] 3.6 Resolve persons: `authorizer_no`/`enterer_no` as `persons.id` with the 0-sentinel fallback (0 → other; both 0 → 1)
- [x] 3.7 Apply the second-hand rule: when `ref_has_opinion === 'YES'` set `publication_year = null` and omit `attribution`; else set `publication_year = parseInt(pubyr)` (null when empty) and build `attribution` from the author fields via `buildCitationFromFields`/`buildDescriptorsFromFields` (imported from `migrate-authorities.js`), `publishedInReference = false`
- [x] 3.7a For second-hand rows with blank `author1last`, use the `{ citation: 'authority unknown', descriptors: [], publishedInReference: false }` sentinel and collect the record for the review CSV
- [x] 3.7b Write the collected unknown-authorship records to `unknown-authority-assignment-opinions.csv` (215 rows) for domain-expert review
- [x] 3.8 Mint a fresh `uuidv7()` `permid` for each retained row
- [x] 3.9 Accumulate skips into per-bucket counters and a sample/full log

## 4. Validation and insert

- [x] 4.1 Validate every constructed `attribution` against `opinionAttribution.schema.js` during the in-memory build; on failure log the `opinion_no` + payload and exit non-zero before any DB write
- [x] 4.2 Bulk-insert all retained rows into `assignment_opinions` in batches inside a single `BEGIN … COMMIT` transaction
- [x] 4.3 On any error before commit, roll back atomically (no manual cleanup needed)

## 5. Reconciliation and reporting

- [x] 5.1 Assert the invariant `inserted + skipped == in-scope`; if it fails, report the discrepancy and exit non-zero without committing
- [x] 5.2 Log final counts: in-scope read, inserted, and skipped broken down by the five buckets (expected 743,381 inserted / 331 skipped as of 2026-08-14)
- [x] 5.3 Reset the `assignment_opinions` id sequence to `MAX(id)` after insert (as in `migrate-name-opinions.js`)

## 6. Verification

- [x] 6.1 Run the script against the dev database and confirm the reconciliation invariant holds and the skip breakdown matches `failing-assignment-opinions.csv`
- [x] 6.2 Spot-check several inserted edges: resolve a source `opinion_no`'s `child_spelling_no`/`parent_spelling_no` back to their `name_opinions` permids and confirm they match the inserted `subject_permid`/`containing_permid`
- [x] 6.3 Confirm no `assignment_opinions` row violates `assignment_not_self` and every `reference_id`/`subject_permid`/`containing_permid` is non-null
