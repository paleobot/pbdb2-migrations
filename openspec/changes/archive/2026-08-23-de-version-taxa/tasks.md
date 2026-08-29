## 1. `taxa` table DDL (`postgresql/create_new.sql`)

- [x] 1.1 Remove `preceded_by_id bigint REFERENCES taxa("id")` and `succeeded_by_id bigint REFERENCES taxa("id")` from the `taxa` table definition.
- [x] 1.2 Add `UNIQUE (permid)` to the `taxa` table definition (one row per permid, not one live head among several).
- [x] 1.3 Remove the `SELECT install_version_triggers('taxa');` call.
- [x] 1.4 Rewrite the comment block above the `taxa` table (currently explaining why it's versioned despite being pure `derive()` output, including the C2 deferred-optimization note about the inert FK swing) to describe the current design: a plain, non-versioned, `UNIQUE (permid)` ledger upserted in place by `rebuild_taxa()`. Drop the now-moot C2 note (there is no swing to optimize away once `install_version_triggers()` isn't called).

## 2. `taxa` indexes

- [x] 2.1 Rename and rewrite the six `taxa_head_*_idx` indexes as plain (non-partial) indexes: `taxa_original_idx`, `taxa_accepted_spelling_idx`, `taxa_concept_idx`, `taxa_containing_idx`, `taxa_path_idx`, `taxa_name_idx` — same columns, same index types (`gist` for `classification_path`), no `WHERE succeeded_by_id IS NULL` predicate.
- [x] 2.2 Update the comment above these indexes (currently "`taxa_permid_head_idx` is created by `install_version_triggers()`. These are the additional head-only indexes...") to reflect that permid uniqueness now comes from the `UNIQUE (permid)` constraint added in 1.2, not an auto-created head index.

## 3. `rebuild_taxa()`

- [x] 3.1 Replace the append-only diff-insert body with a single `INSERT INTO taxa (...) SELECT ... FROM derive_taxa(NULL) ON CONFLICT (permid) DO UPDATE SET <all derived columns> = EXCLUDED.<col> WHERE <at least one derived column IS DISTINCT FROM the corresponding EXCLUDED column>`, per design.md's Decisions section.
- [x] 3.2 Confirm `GET DIAGNOSTICS changed = ROW_COUNT` still reports the correct count immediately after the `INSERT ... ON CONFLICT` statement (rows inserted + rows whose `DO UPDATE ... WHERE` guard matched; rows skipped by the guard are correctly excluded per Postgres's own semantics).
- [x] 3.3 Update the function's header comment ("cold path: derive(all) → diff → append new ledger heads") to describe the upsert behavior instead of "append new ledger heads."

## 4. `assert_taxa_invariant()`

- [x] 4.1 Change the `heads AS (SELECT * FROM taxa WHERE succeeded_by_id IS NULL)` CTE to select from all of `taxa` directly (no `succeeded_by_id` filter — the column no longer exists).
- [x] 4.2 Update the function's header comment ("derive(all) ≡ current ledger heads") to say "derive(all) ≡ the current `taxa` rows" instead of "heads."

## 5. Documentation

- [x] 5.1 In `docs/classic-taxa-opinions.md`, append a `⚠ Superseded, 2026-08-23.` annotation to the existing D8 entry, following the same convention used for D7's superseded annotation — pointing forward at `openspec/changes/de-version-taxa/` (and, once archived, at `openspec/specs/taxa-opinions/spec.md`'s "Versioning regimes are applied correctly per table" requirement) as the current, authoritative source. Leave D8's original text in place.

## 6. Verification

- [x] 6.1 Apply the edited `postgresql/create_new.sql` to a scratch/empty PostgreSQL database end-to-end (e.g. `pg_play`, matching how prior `derive_taxa()`/`rebuild_taxa()` changes were validated) and confirm it succeeds with no errors. Adapted: `pg_play` (`claude_play`) already holds the real, fully-migrated dataset (515,543 `taxa` rows, `preceded_by_id`/`succeeded_by_id` confirmed all-`NULL` — no version history existed to lose), so instead of a destructive full DDL re-run, the equivalent `ALTER TABLE`/index/trigger changes and the two rewritten functions were applied in place, by explicit user choice (see conversation). All statements ran with no errors.
- [x] 6.2 Load a fixture (or the full-migration) opinion set, run `rebuild_taxa()`, then `assert_taxa_invariant()`, and confirm the invariant holds. Ran against the existing full-migration dataset: `assert_taxa_invariant()` passed (32.5s) before any `rebuild_taxa()` call, confirming `derive_taxa(NULL)` still agrees with the migrated `taxa` rows under the new (non-versioned) comparison.
- [x] 6.3 Run `rebuild_taxa()` a second time with no intervening opinion changes and confirm it reports `0` changed rows (the no-op scenario from the spec delta). Ran twice back-to-back: both calls returned `changed = 0`, confirming the `ON CONFLICT ... DO UPDATE ... WHERE` guard correctly skips already-matching rows.
- [x] 6.4 Spot-check that `\d taxa` shows no `preceded_by_id`/`succeeded_by_id` columns, a `UNIQUE` constraint on `permid`, and the six renamed plain indexes. Confirmed via `information_schema`/`pg_indexes`/`pg_constraint`/`pg_trigger` on `pg_play`: columns match the new DDL exactly, `taxa_permid_key UNIQUE (permid)` present, all six indexes present with the new names and no partial predicate, no version triggers remain, row count unchanged at 515,543.
