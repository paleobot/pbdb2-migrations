## Why

The `name_opinions` and `validity_opinions` tables exist (schema from `taxa-opinions`) but hold no data. Every taxonomic name in classic PBDB lives in the legacy `authorities` table (517,287 rows); each is a name-as-spelled that must become a root `name_opinions` edge before any of the derived taxonomy can be rebuilt. This change performs that first, foundational load — the naming acts — from which lineage/concept/assignment opinions will later hang.

## What Changes

- Add a migration script `migrate-name-opinions.js` that reads every row of legacy `authorities` and writes one **root** `name_opinions` edge per row, following the "Classic authorities to name_opinions migration" mapping in `payloadSchemas/mappings/authorities-opinions.md`.
- For each row: mint a `permid` (uuidv7) used as both `permid` and `subject_permid` (self, root); `target_permid = NULL`; `reason_id`/`edge_class` = `original`/`root`; `evidence = false`; `objective = NULL`; `new_name = taxon_name`; `rank_id` resolved from `dictionaries.taxonomy_ranks`; `oldpbdb_taxon_no = taxon_no`; `removed = false`.
- Resolve `authority_id`, `reference_id`, `attribution`, and `publication_year` from the **new** `authorities` record whose `authority.legacyIDs.oldpbdbIDs` contains the row's `taxon_no`, via an in-memory Map (the `refMap` pattern from `migrate-authorities.js`) — no DB-side GIN index needed.
- Map the **18** `taxon_rank = 'informal'` rows to `rank_id = 'unranked'` on the name_opinion, and additionally emit one `validity_opinions` row each (`nomenclatural_status_id = 'informal'`, `targeted = false`, `target_permid = NULL`, `evidence = false`).
- Skip-and-log the **3** rows whose legacy `reference_no` (42348, a dangling pointer absent from old `refs`) produced no new `authorities` record — consistent with how `migrate-authorities.js` already handled them.
- Persons: resolve `authorizer_no`/`enterer_no` directly as `persons.id` with the 0-as-NULL fallback carried over from `migrate-authorities.js`.

## Capabilities

### New Capabilities
- `name-opinions-migration`: Loads legacy `authorities` into `name_opinions` as root (minting) edges, with the `informal`-rank subset also emitting `validity_opinions` rows.

### Modified Capabilities
<!-- None. The taxa-opinions schema is unchanged; this change only populates it. -->

## Impact

- **Source (MariaDB)**: `authorities` (read-only stream; columns `taxon_no, taxon_name, taxon_rank, reference_no, authorizer_no, enterer_no`).
- **Target (PostgreSQL)**: writes `name_opinions` (~517,284 rows) and `validity_opinions` (18 rows). Reads new `authorities`, `refs` (indirectly), `persons`, and the dictionaries `taxonomy_ranks`, `namechange_reasons`, `nomenclatural_statuses`.
- **Prerequisites**: the persons, refs, and authorities migrations must already be applied (they are). Depends on `create_new.sql` having the opinion tables and dictionary seed rows (`namechange_reasons.'original'`, `nomenclatural_statuses.'informal'`).
- **New file**: `migrate-name-opinions.js` (ESM, alongside the other `migrate-*.js` scripts).
- **Data integrity**: 1:1 with legacy rows except the 3 dangling-ref skips; each `NOT NULL` target column has a source; composite FKs `(reason_id, edge_class)` and `(nomenclatural_status_id, targeted)` are satisfied by construction. No transformation of the anomalous `_old`/coordinate/timestamp fields is in scope.
