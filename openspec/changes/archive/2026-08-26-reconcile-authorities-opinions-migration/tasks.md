## 1. Rename the script

- [x] 1.1 `git mv migrate-name-opinions.js migrate-authorities-opinions.js` (preserve history)
- [x] 1.2 Update in-repo prose references to the old filename to the new name: `openspec/specs/synonymy-opinions-migration/spec.md` (line ~211), `docs/taxa-opinions-migration-mapping.md` (lines ~208, ~686). Leave `migration_exploration/DESIGN.md` as a frozen historical artifact (note only; it is out of scope for edits per `create-opinions-migration`).
- [x] 1.3 Confirm nothing imports the module: `grep -rn "migrate-name-opinions" --include=*.js .` returns no hits (the script runs standalone; its exported `buildAttribution` / `parsePublicationYear` are not imported elsewhere). No `package.json` script references it.

## 2. Remove the validity_opinions emission

- [x] 2.1 Delete the `'informal'` status lookup and its fail-fast block (resolve of `dictionaries.nomenclatural_statuses WHERE status = 'informal'`, `informalStatusId`)
- [x] 2.2 Delete the `validityOpinions` accumulator array and the per-informal-row emission block (the `if (src.taxon_rank === 'informal')` push into `validityOpinions`)
- [x] 2.3 Delete the `validity_opinions` bulk-insert block and the `validity_opinions` identity-sequence `setval` reset
- [x] 2.4 Keep the `informal → 'unranked'` rank collapse in rank resolution (unchanged); keep `informalCount` incremented as an informational counter only
- [x] 2.5 Update the completion logging and reconciliation to reference only `name_opinions`: log `{sourceRows, nameOpinionsInserted, informalCount, skipped}` and assert `nameOpinionsInserted + skipped == sourceRows`; remove any `validity_opinions` count/log
- [x] 2.6 `node --check migrate-authorities-opinions.js`

## 3. Correct the spec Purpose line (delta cannot reach it)

- [x] 3.1 Hand-edit `openspec/specs/name-opinions-migration/spec.md` `## Purpose` (line ~4): remove the "…the 18 `informal`-rank rows additionally emit a `validity_opinions` row (status `informal`)" clause; optionally note the migrating script is now `migrate-authorities-opinions.js`. (This is separate from the delta, which only reaches `### Requirement:` blocks.)

## 4. Validate end-to-end (against the reset tables)

- [x] 4.1 Reset the target with `reset-opinions.sql` (drops + recreates the 3 opinion tables and the 3 dictionaries from `create_new.sql`); confirm `dictionaries.namechange_reasons` has 11 rows and `nomenclatural_statuses` has 4
- [x] 4.2 Run `node migrate-authorities-opinions.js` against the localhost `pg`; confirm it completes without the prior `'informal'`-lookup fatal and without any `validity_opinions` insert error
- [x] 4.3 Confirm reconciliation holds (`nameOpinionsInserted + skipped == sourceRows`, ~517,284 + 3 == 517,287) and that **`SELECT COUNT(*) FROM validity_opinions` is 0** (no rows written by this script)
- [x] 4.4 Spot-check one of the 18 `taxon_rank = 'informal'` sources: its root `name_opinions` row has `rank_id` = the `'unranked'` id, `edge_class = 'root'`, `subject_permid = permid`, and there is **no** `validity_opinions` row for that `subject_permid`
- [x] 4.5 Spot-check a normal root row (e.g. a `genus`): `target_permid IS NULL`, `new_name`/`rank_id` set, `oldpbdb_taxon_no` = source `taxon_no`, `negates = false`

## 5. Close out

- [x] 5.1 Run `openspec validate reconcile-authorities-opinions-migration --strict` and resolve any issues
- [x] 5.2 Archive with `openspec archive reconcile-authorities-opinions-migration` once the maintainer confirms the implementation matches these artifacts — this syncs the delta into `openspec/specs/name-opinions-migration/spec.md`
- [ ] 5.3 Only after this change is done: proceed to `create-opinions-migration` (its opinion migration reads the root permids this script produces)
