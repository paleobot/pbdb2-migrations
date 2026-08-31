## 1. Baseline (must run before any edit)

- [x] 1.1 On the current (pre-rename) localhost database, capture per-`edge_class` row counts from `name_opinions` to `openspec/changes/rename-edge-class-lineage-to-name/baseline-edge-class-counts.txt`
- [x] 1.2 RESOLVED (two-database diff; see baseline file) — Run `derive_taxa()` and dump `(permid, original_permid, accepted_spelling_permid, concept_permid)` ordered by `permid` to a baseline file; record the row count
- [x] 1.3 RESOLVED — Confirm both baseline files are non-empty and the derive dump row count matches the count of minted (root) permids

## 2. Schema — both SQL files together (Decision 6)

- [x] 2.1 In `postgresql/create_new.sql` L135, change the `namechange_reasons_edge_class_check` CHECK to `edge_class IN ('root', 'name', 'concept')`
- [x] 2.2 In `postgresql/create_new.sql` L142–147, change `edge_class` to `'name'` on the six seed rows `correction`, `reranked`, `recombination`, `assignment`, `misspelling`, `historical misspelling`; leave `reason`, `description`, and `never_accepted` untouched, and leave `original` (`'root'`) and the four `'concept'` rows untouched
- [x] 2.3 In `postgresql/create_new.sql` L4778, change the `name_opinion_shape` CHECK branch to `edge_class = 'name'`; the branch's predicate (`target_permid IS NOT NULL AND new_name IS NULL AND rank_id IS NULL`) is unchanged
- [x] 2.4 In `reset-opinions.sql` L52, L59–64, and L148, apply the identical three edits (CHECK, six seed rows, shape CHECK) — this file carries its own copy and is not an include
- [x] 2.5 Diff the `namechange_reasons` block and the `name_opinion_shape` CHECK between the two files and confirm they are token-identical

## 3. Schema — derive_taxa() predicates

- [x] 3.1 In `postgresql/create_new.sql` L5108, change `_dt_edge_cand`'s filter to `AND n.edge_class IN ('root','name')`
- [x] 3.2 In `postgresql/create_new.sql` L5160, change `_dt_lin_winner`'s filter to `WHERE edge_class = 'name'`
- [x] 3.3 Confirm `derive_taxa_clades()` and `rebuild_taxa_clades()` need no change (they filter only on `'concept'`)
- [x] 3.4 Verify no other executable SQL reads `edge_class` — no index predicate, generated column, or view references it

## 4. Schema comments (vocabulary rule, Decision 3)

- [x] 4.1 Update the `namechange_reasons` header comment (L84–128): the enum line `edge_class ('root' | 'lineage' | 'concept')` and the "Both tokens are 'lineage'-class and never_accepted" note become `'name'`
- [x] 4.2 Update the `name_opinions` header and CHECK comments (L4659–4782): the enum at L4665, the reason-selects-grouping note at L4708–4709, and the shape table at L4774 become `'name'`
- [x] 4.3 Update the comment above L5108 to state explicitly that root rows are also name-shaped but mint identity rather than assert a relationship, so the enum reads as {mint, name-relationship, concept-relationship} (Decision 2 mitigation)
- [x] 4.4 Review every other "lineage" in `create_new.sql` against the vocabulary rule and leave the derived-component uses alone — `_dt_lin*`, `_dtc_lineage`, `_dtc_permid_lineage`, `place_in_lineage()`, "name-lineage", "the lineage union-find", "a lineage's accepted spelling"
- [x] 4.5 Apply the same comment pass to `reset-opinions.sql` (L107, L139, L144)

## 5. Migration script

- [x] 5.1 In `src/opinions-migration/migrate-opinions.js` L141, L143, L145, change the `reasonId(token, 'lineage')` dictionary lookups to `'name'`
- [x] 5.2 In `src/opinions-migration/migrate-opinions.js` L334 and L362, change the emitted `edgeClass: 'lineage'` to `'name'`
- [x] 5.3 Rename the internal summary bucket key from `'lineage'` to `'name'` (the `rec(pair, 'lineage')` calls and the `t.lineage` read), so the run summary's output-type label matches the `edge_class` the rows carry
- [x] 5.4 Update the file's comments and skip-log messages that call the second output a "lineage edge"/"lineage backfill" to "name edge"/"name backfill" (L6, L48, L51, L61, L71, L83–84, and the `logSkip` strings at L272, L327, L331, L345, L351, L355, L360); rename the `lineageAttempted`/`lineageToken` locals to `nameAttempted`/`nameToken` for consistency
- [x] 5.5 Confirm `migrate-authorities-opinions.js` needs no change (writes only `'root'`)

## 6. Live tests

- [x] 6.1 In `src/opinions-migration/tests/run-migration.js`, change the four `edge_class` literals to `'name'` (L77 DELETE, L132 no-target assertion, L147 historical-misspelling assertion, L157 count) and rename the `dbLineage`/`wLineage` locals and the check labels
- [x] 6.2 CORRECTED — leave `src/opinions-migration/tests/run-reference-handlers.js` untouched. It is cross-check apparatus, not a live test: it builds the reference DB by running the 48 `migration_exploration/opinions/` handlers, which are cruft and still emit `edge_class: 'lineage'`. Pointing its L149 count at `'name'` would query a reference DB populated by those unchanged handlers and silently report 0. Consequence, accepted and out of scope: after this change the cross-check apparatus no longer runs at all, because the reference DB is a template clone of the primary and the cruft handlers' `'lineage'` writes now violate the renamed CHECK and composite FK
- [x] 6.3 Add an assertion that `SELECT COUNT(*) FROM name_opinions WHERE edge_class = 'lineage'` is 0 and that `namechange_reasons` has exactly three distinct `edge_class` values
- [x] 6.4 Confirm `tests/cross-check-*.js` are left untouched (out of scope per the proposal)

## 7. Specs and docs

- [x] 7.1 CORRECTED — do NOT hand-apply. `openspec archive` updates main specs from the delta itself (`archive: "Archive a completed change and update main specs"`); hand-editing `openspec/specs/taxa-opinions/spec.md` now would double-apply. The delta at `specs/taxa-opinions/spec.md` carries the requirement rename and the ten→eleven token correction and is validated
- [x] 7.2 CORRECTED — do NOT hand-apply; deferred to `openspec archive` (see 7.1). Delta at `specs/taxa-clades/spec.md` is written and validated
- [x] 7.3 CORRECTED — do NOT hand-apply; deferred to `openspec archive` (see 7.1). Delta at `specs/opinions-migration/spec.md` carries the three requirement renames and is validated
- [x] 7.4 Update `docs/classic-taxa-opinions.md` — the `edge_class = 'lineage'` literal at L1686, the union-find description at L1065, and the Way-2 discussion at L1625–1632 — applying the vocabulary rule to §9's prose
- [x] 7.5 Update `docs/taxa-opinions-migration-mapping.md` — the `edge_class` row at L706, the reason/edge_class table at L493, and the shape line at L186
- [x] 7.6 Update `payloadSchemas/mappings/opinions.md` — the `edge_class = lineage` references at L42 and L81, and the "lineage backfill" prose at L41–59, L110

## 8. Verification

- [x] 8.1 Grep the live surface for any surviving quoted `'lineage'` literal (excluding `migration_exploration/`, `taxa-opinions-draft.sql`, and `tests/cross-check-*`) and confirm zero hits
- [x] 8.2 Review the `postgresql/create_new.sql` diff and confirm no change lands outside the five value sites, the two derive predicates, and the intended comments — specifically that no `_dt_lin*`, `_dtc_lineage`, or `place_in_lineage` identifier was touched
- [x] 8.3 Run `create_new.sql` end-to-end on an empty database and confirm it builds clean
- [x] 8.4 Run `reset-opinions.sql`, then `migrate-opinions.js`, and confirm the run reconciles (written + skipped == read for every output type)
- [x] 8.5 Run `tests/run-migration.js` and `tests/run-reference-handlers.js`; all checks pass
- [x] 8.6 Compare per-`edge_class` counts against the 1.1 baseline: `'name'` equals the old `'lineage'` count, `'root'` and `'concept'` unchanged, `'lineage'` absent
- [x] 8.7 Run `derive_taxa()` and diff against the 1.2 baseline — `original_permid`, `accepted_spelling_permid`, and `concept_permid` must match for every permid, with no permid added or dropped. Any difference blocks the change
- [x] 8.8 Run `openspec validate rename-edge-class-lineage-to-name` and confirm it passes
