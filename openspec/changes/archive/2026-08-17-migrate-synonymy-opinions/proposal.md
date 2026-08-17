## Why

The `name_opinions` table holds the root/original naming acts (from the authorities migration) but none of the *concept* edges — the opinions that say "this name is a junior synonym of that name." Those live in the legacy `opinions` table as `subjective synonym of` / `objective synonym of` statements. This change performs the cleanest slice of that load: the synonymy opinions whose junior name is cited under its original spelling (`spelling_reason = 'original spelling'`), which assert a synonymy relationship without also performing a rename. From these `name_opinions` concept rows, `derive_taxa()` can begin collapsing synonymous names onto a single concept.

## What Changes

- Add a migration script `migrate-synonymy-opinions.js` that reads the in-scope subset of legacy `opinions` and writes one `name_opinions` **concept** row per qualifying row, following the "Classic opinions synonymy opinions (original spellings) migration" mapping in `payloadSchemas/mappings/authorities-opinions.md`.
- **Scope filter**: `(status = 'subjective synonym of' OR status = 'objective synonym of') AND spelling_reason = 'original spelling'` — 48,839 source rows (47,687 subjective + 1,152 objective). Synonymy opinions cited under a *non-original* spelling are deferred to later slices that will emit both their `name_opinions` lineage edge and their concept edge.
- For each qualifying row: mint a fresh `permid` (uuidv7); resolve `subject_permid` (junior) / `target_permid` (senior) from `name_opinions.oldpbdb_taxon_no` = `child_spelling_no` / `parent_spelling_no` (original-only rows, where `permid ≡ subject_permid`); set the constant concept-row shape `reason_id = 'junior synonym'`, `edge_class = 'concept'`, and `new_name = rank_id = authority_id = oldpbdb_taxon_no = NULL` (required by `name_opinion_shape`); set `objective = (status = 'objective synonym of')`; `evidence = (basis = 'stated with evidence')`; `removed = false`; `reference_id` from `refs` legacy id; `publication_year` / `attribution` per the second-hand rule gated on `ref_has_opinion`.
- **Skip-and-log** the 17 rows that cannot satisfy the `NOT NULL` / `name_opinion_not_self` / `name_opinion_shape` constraints, in five disjoint buckets (7 self_reference, 6 child_spelling_unresolved, 4 orphan_reference, 0 parent_spelling_zero, 0 parent_spelling_orphan), and enforce the reconciliation invariant `inserted (48,822) + skipped (17) == in-scope (48,839)`.
- Persons: resolve `authorizer_no` / `enterer_no` directly as `persons.id` (pinned) with the 0-as-NULL fallback carried from prior migrations; in scope the fallback never fires.

## Capabilities

### New Capabilities
- `synonymy-opinions-migration`: Loads the synonymy (`subjective`/`objective synonym of`) + `original spelling` subset of legacy `opinions` into `name_opinions` as `concept` edges, with a skip-and-log policy and a counted reconciliation invariant.

### Modified Capabilities
<!-- None. The taxa-opinions schema is unchanged; this change only populates it. -->

## Impact

- **Source (MariaDB)**: `opinions` (read-only stream; columns `child_spelling_no, parent_spelling_no, status, spelling_reason, basis, pubyr, ref_has_opinion, reference_no, authorizer_no, enterer_no`, plus author fields for attribution). Joins against `refs`/`name_opinions` for resolution only.
- **Target (PostgreSQL)**: writes `name_opinions` (~48,822 concept rows). Reads `name_opinions` (for `oldpbdb_taxon_no → permid`), `refs`, and `persons`.
- **Prerequisites**: the persons, refs, authorities, and **name-opinions** (root) migrations must already be applied (they are). `create_new.sql` must have `name_opinions` with its `name_opinion_shape`, `name_opinion_not_self`, and composite `(reason_id, edge_class)` FK. The `namechange_reasons` dictionary must contain `('junior synonym', 'concept')`.
- **New file**: `migrate-synonymy-opinions.js` (ESM, alongside the other `migrate-*.js` scripts), plus a `failing-synonymy-opinions.csv` enumeration of the 17 skips.
- **Data integrity**: each `NOT NULL` target column has a source or the row is skipped; `name_opinion_not_self` and the concept branch of `name_opinion_shape` are pre-checked. Depends on the original-only resolution assumption (documented in the mapping): `oldpbdb_taxon_no` is carried only by root/original `name_opinions` rows, so the `subject_permid`/`target_permid` lookup is unambiguous. This slice writes concept rows into the *same table* it reads root rows from, but resolution reads only current heads preloaded before any insert, so the two never interfere.
