## Why

The authorities migration currently skips-and-logs ~16,606 legacy rows (scenario ④: `ref_is_authority != 'YES'` AND empty `author1last`) because they carry no discernible authorship. Dropping them loses the taxon→reference linkage and the legacy `taxon_no`s entirely. We would rather retain these names with an explicit "unknown authority" sentinel so nothing is silently lost.

## What Changes

- **BREAKING** (reverses a prior requirement): Scenario ④ is no longer skipped. It is migrated with sentinel values instead of logged-and-dropped.
- For scenario ④ rows, build the `authority` payload as:
  - `citation`: `"authority unknown"`
  - `year`: `"0"` (string sentinel; schema types `year` as string, maxLength 4)
  - `descriptors`: `[]`
  - `publishedInReference`: `false` (consistent with `ref_is_authority != 'YES'`)
  - `legacyIDs.oldpbdbIDs`: `[taxon_no]`, subject to the same dedup/merge as every other scenario
- Scenario ④ rows now flow through the existing ref-lookup, person-resolution, dedup, validation, and bulk-insert pipeline like scenarios ①/②/③.
- Rework the run counters and the end-of-run sanity assertion so scenario ④ contributes to survivors/merges rather than to a skip bucket.

Measured against the current source + target: all 16,606 scenario-④ rows resolve to a current-head ref (zero orphans, zero `reference_no = 0`). After dedup they collapse to **1,299 survivor authority rows** across 1,299 distinct references (15,307 merges). Net table effect: 161,768 → 163,067 authority rows.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `authorities-migration`: The "Log scenario ④ rows without migrating" requirement is replaced by a "Migrate scenario ④ rows with sentinel authority" requirement; the classification table's scenario ④ action changes from Skip to Migrate; the counter/accounting requirement is updated to drop the `scenario4Skipped` term from the sanity assertion.

## Impact

- **Source (MariaDB `pbdb_archive`)**: `authorities` table — the scenario ④ partition (`ref_is_authority != 'YES'` AND `TRIM(author1last) = ''`), 16,606 rows.
- **Target (PostgreSQL)**: `authorities` table — +1,299 rows. `reference_id` is `NOT NULL`; all scenario ④ rows satisfy it (no orphans), so no NOT NULL risk.
- **Code**: `migrate-authorities.js` — remove the scenario ④ early-`continue`, add a scenario ④ branch in `buildAuthorityPayload`, and update counters + the sanity assertion in `main()`.
- **Data integrity**: No taxon rows are dropped for lack of authorship; the `"authority unknown"` / `"0"` sentinel is positively distinguishable from real citations (which always begin with an author surname) and from empty/absent year.
