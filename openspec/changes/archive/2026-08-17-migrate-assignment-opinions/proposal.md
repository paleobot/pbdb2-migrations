## Why

The `assignment_opinions` table exists (schema from `taxa-opinions`) but holds no data. Classification — which taxon is contained by which higher taxon — lives in the legacy `opinions` table as `belongs to` statements. This change performs the first, cleanest slice of that load: the `belongs to` opinions whose child is cited under its original combination (`spelling_reason = 'original spelling'`), which assert containment without also performing a rename. From these `assignment_opinions` rows, `derive_taxa()` can begin reconstructing the classification tree.

## What Changes

- Add a migration script `migrate-assignment-opinions.js` that reads the in-scope subset of legacy `opinions` and writes one `assignment_opinions` row per qualifying row, following the "Classic opinions to assignment_opinions migration" mapping in `payloadSchemas/mappings/authorities-opinions.md`.
- **Scope filter**: `status = 'belongs to' AND spelling_reason = 'original spelling'` — 743,712 source rows. Non-original-spelling `belongs to` opinions (recombination, rank change, correction, misspelling, reassignment — 183,800 rows) are deliberately deferred to later slices that will emit both their `name_opinions` edges and their placements.
- For each qualifying row: mint a fresh `permid` (uuidv7); resolve `subject_permid`/`containing_permid` from `name_opinions.oldpbdb_taxon_no` = `child_spelling_no`/`parent_spelling_no` (original-only rows, where `permid ≡ subject_permid`); `reference_id` from `refs` legacy id; `evidence = (basis = 'stated with evidence')`; `questioned = false` (no classic source); `removed = false`; `publication_year`/`attribution` per the second-hand rule gated on `ref_has_opinion`.
- **Skip-and-log** the 331 rows that cannot satisfy the `NOT NULL`/`assignment_not_self` constraints, in five disjoint buckets (322 zero-parent, 6 orphan-parent, 1 orphan-reference, 1 unresolved-child, 1 self-reference), and enforce the reconciliation invariant `inserted (743,381) + skipped (331) == in-scope (743,712)`.
- Persons: resolve `authorizer_no`/`enterer_no` directly as `persons.id` (pinned) with the 0-as-NULL fallback carried from prior migrations; in scope the fallback never fires.

## Capabilities

### New Capabilities
- `assignment-opinions-migration`: Loads the `belongs to` + `original spelling` subset of legacy `opinions` into `assignment_opinions` as containment edges, with a skip-and-log policy and a counted reconciliation invariant.

### Modified Capabilities
<!-- None. The taxa-opinions schema is unchanged; this change only populates it. -->

## Impact

- **Source (MariaDB)**: `opinions` (read-only stream; columns `child_spelling_no, parent_spelling_no, status, spelling_reason, basis, pubyr, ref_has_opinion, reference_no, authorizer_no, enterer_no`, plus author fields for attribution). Joins against `refs`/`authorities`/`person` for validation only.
- **Target (PostgreSQL)**: writes `assignment_opinions` (~743,381 rows). Reads `name_opinions` (for `oldpbdb_taxon_no → permid`), `refs`, and `persons`.
- **Prerequisites**: the persons, refs, authorities, and **name-opinions** migrations must already be applied (they are). `create_new.sql` must have `assignment_opinions` with its `assignment_not_self` CHECK.
- **New file**: `migrate-assignment-opinions.js` (ESM, alongside the other `migrate-*.js` scripts).
- **Data integrity**: each `NOT NULL` target column has a source or the row is skipped; the `assignment_not_self` CHECK is pre-checked. Depends on the original-only resolution assumption (documented in the mapping): `oldpbdb_taxon_no` is carried only by root/original `name_opinions` rows, so the `subject_permid`/`containing_permid` lookup is unambiguous. The 322 zero-parent skips are an expected non-error outcome (classifications that assert no container), not data loss.
