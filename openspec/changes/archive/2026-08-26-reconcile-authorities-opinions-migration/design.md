## Context

`migrate-name-opinions.js` mints the root `name_opinions` rows from classic `authorities`. Its `name_opinions` write path is already compatible with `postgresql/create_new.sql`; only its `validity_opinions` write path drifted from that authority (a dropped `'informal'` status token and the removed `targeted` / `target_permid` columns). Updated instructions make that path unnecessary: informal-rank authorities become ordinary root rows at rank `'unranked'`, with no validity record. This is a small, mechanical reconciliation — a rename plus deleting one code path — carrying no architectural decisions. It exists as its own change only because it must land before `create-opinions-migration`, whose opinion migration reads the root permids this script produces.

## Goals / Non-Goals

**Goals:**
- Rename `migrate-name-opinions.js` → `migrate-authorities-opinions.js` (the name reflects reality: it reads `authorities`, not `opinions`).
- Delete the entire `validity_opinions` emission path so the script runs cleanly against the reset `create_new.sql` tables and writes only `name_opinions`.
- Preserve every other behavior byte-for-byte, including the `informal → 'unranked'` rank collapse.

**Non-Goals:**
- No change to `postgresql/create_new.sql` or `reset-opinions.sql` (the `name_opinions` insert is already schema-compatible; `negates` defaults to `false`).
- No change to how `validity_opinions` is populated elsewhere — that becomes solely `create-opinions-migration`'s job.
- No re-modelling of "informal" as any status or reason; it is captured only by `rank_id = 'unranked'`.

## Decisions

- **Delete, don't fix, the validity path.** The two drift points (`'informal'` status lookup, `targeted`/`target_permid` insert columns) both live inside the `validity_opinions` emission. Since instructions remove that emission entirely, deleting the path resolves both without a targeted schema fix. Removed pieces: the `'informal'` status lookup, the `validityOpinions` accumulator, the per-informal-row emission, the validity insert block, and the `validity_opinions` identity-sequence reset.
- **Keep `informalCount` as an informational counter.** The 18 informal-rank rows still warrant a logged count (they are rank-collapsed), even though they no longer emit a second row — useful for verification against the ~18 rows the prior design produced.
- **Rename via `git mv`** to preserve history; update in-repo references to the old filename (callers/harness/package scripts) in the same change.
- **Purpose-line touch-up.** The `name-opinions-migration` spec's `## Purpose` sentence still describes the informal-validity emission; because delta specs only reach `### Requirement:` blocks, this is corrected by hand as a task step, not via the delta.

## Risks / Trade-offs

- **Stale references to the old filename** would break callers after the rename. → Grep the repo for `migrate-name-opinions` and update every hit as part of the change.
- **Cross-check divergence (deferred, not this change):** the Aurora `pbdb2_migration_test` reference may still hold the 18 informal `validity_opinions` rows from the old design; `create-opinions-migration`'s Aurora cross-check must treat their absence in the new run as a known-intentional difference. Recorded here so it is not mistaken for a regression.
