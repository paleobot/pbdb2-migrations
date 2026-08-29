## REMOVED Requirements

### Requirement: Emit a validity_opinions row for each informal-rank source row
**Reason**: Per updated maintainer instructions (2026-08-26), an informal `taxon_rank` is not a nomenclatural-status act and SHALL NOT produce a `validity_opinions` record. The status the prior design used (`'informal'`) was also dropped from `postgresql/create_new.sql`'s `nomenclatural_statuses` seed, and the `targeted` / `target_permid` columns it wrote no longer exist on `validity_opinions`.
**Migration**: The 18 `taxon_rank = 'informal'` source rows now migrate as ordinary root `name_opinions` rows at `rank_id = 'unranked'` (see "Resolve rank_id from taxonomy_ranks"), with no `validity_opinions` row. After this change, `migrate-authorities-opinions.js` writes only `name_opinions`; `validity_opinions` is populated solely by the opinions migration.

## MODIFIED Requirements

### Requirement: Skip and log rows with no resolvable authority
The script SHALL skip any source row whose `taxon_no` is absent from the resolution Map (its authority was itself skipped as an orphan ref during the authorities migration), logging the `taxon_no` and `reference_no`. Approximate count: 3 rows (all pointing at the dangling `reference_no = 42348`). Skipped rows produce no `name_opinions` row.

#### Scenario: Orphan authority
- **WHEN** a source row has `taxon_no = 242140`, whose authority was never created (dangling `reference_no = 42348`)
- **THEN** no `name_opinions` row is inserted for it and the script logs the `taxon_no` and `reference_no`

#### Scenario: Skip count accounted
- **WHEN** the script completes
- **THEN** the count of skipped rows plus inserted `name_opinions` rows equals the source row count (3 + 517,284 = 517,287)


### Requirement: Bulk insert is transaction-wrapped
The script SHALL wrap the bulk insert of all `name_opinions` rows in a single Postgres transaction (`BEGIN` … `COMMIT`). On any failure before `COMMIT`, Postgres SHALL roll back atomically, leaving `name_opinions` in its pre-run state with no manual cleanup required.

#### Scenario: Successful bulk insert
- **WHEN** all ~517,284 `name_opinions` rows insert without error
- **THEN** the transaction commits and `name_opinions` reflects the inserts

#### Scenario: Mid-insert failure rolls back atomically
- **WHEN** an unexpected error occurs after some rows have been inserted but before `COMMIT`
- **THEN** the transaction rolls back and no migrated rows remain in `name_opinions`

#### Scenario: Re-run after abort needs no manual cleanup
- **WHEN** a prior run aborted (pre-insert validation failure or mid-insert rollback)
- **THEN** re-running on the same source data produces the same result without a `TRUNCATE` step


### Requirement: Log counts and reconcile totals
The script SHALL log total source rows read, `name_opinions` inserted, informal-rank rows (rank-collapsed to `'unranked'`), and skipped orphan rows, and SHALL assert that inserted `name_opinions` plus skipped rows equals source rows read. It SHALL NOT reference `validity_opinions` in its counts.

#### Scenario: Final counts logged
- **WHEN** the script completes
- **THEN** it logs `{sourceRows, nameOpinionsInserted, informalCount, skipped}` and confirms `nameOpinionsInserted + skipped == sourceRows`
