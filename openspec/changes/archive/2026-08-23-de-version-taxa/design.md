## Context

`taxa` (`postgresql/create_new.sql`, Layer 3 ledger) is today versioned like every other entity
table in the schema: `preceded_by_id`/`succeeded_by_id` columns, `install_version_triggers('taxa')`
(installing `place_in_lineage()` + `handle_new_version()` + an auto-created partial `permid` head
index), and six hand-added `taxa_head_*_idx` partial indexes (`WHERE succeeded_by_id IS NULL`).
`rebuild_taxa()` relies on that trigger machinery: it only ever `INSERT`s rows for permids whose
derived output is new or different, and the `handle_new_version()` trigger does the "close out the
old head" work (setting `succeeded_by_id` on the prior row) as a side effect. `assert_taxa_invariant()`
compares `derive_taxa(NULL)` against `taxa WHERE succeeded_by_id IS NULL`. See proposal.md for why
this is being removed.

## Goals / Non-Goals

**Goals:**
- `taxa` becomes a plain table: one row per permid, no succession columns, `UNIQUE (permid)`.
- `rebuild_taxa()` becomes an explicit upsert with the same externally-visible contract (returns a
  count of changed rows; a no-op re-derivation touches nothing; provenance columns still populated).
- `assert_taxa_invariant()` compares against all of `taxa` (there is no other subset to compare).
- Six `taxa_head_*_idx` indexes lose their now-nonexistent-column predicate and their `_head_`
  naming (misleading once there's no "head" to distinguish from history).

**Non-Goals:**
- No change to any other table's versioning regime (`name_opinions`, `assignment_opinions`,
  `validity_opinions`, `taxon_annotations`, or the generic `install_version_triggers()` /
  `place_in_lineage()` / `handle_new_version()` machinery itself).
- No change to `derive_taxa()`'s logic — it already returns a plain result set; only its consumer
  (`rebuild_taxa()`) changes how it lands that result set into `taxa`.
- No backfill or export of the historical `taxa` versions that exist in any already-deployed
  database before this change ships — see Migration Plan.

## Decisions

**Single `INSERT ... ON CONFLICT (permid) DO UPDATE ... WHERE <changed>` for `rebuild_taxa()`,
not a two-CTE UPDATE+INSERT pair.** Alternative considered: a `WITH d AS (...), upd AS (UPDATE ...
FROM d RETURNING ...), ins AS (INSERT ... SELECT FROM d WHERE NOT EXISTS (...) RETURNING ...) SELECT
count(upd)+count(ins)`. Both are correct (a CTE referenced by two data-modifying statements is
never inlined by Postgres, so `derive_taxa(NULL)` still runs exactly once either way — same
performance property the current append-only version relies on). `ON CONFLICT` is chosen because
it's the idiomatic single-statement form, needs one `GET DIAGNOSTICS` instead of summing two
`RETURNING` counts, and reads closer to "upsert" than a hand-rolled two-statement split. The `DO
UPDATE ... WHERE t.col IS DISTINCT FROM EXCLUDED.col OR ...` guard is required, not optional:
without it, `ON CONFLICT DO UPDATE` would touch (and count) every existing row on every
`rebuild_taxa()` call even when nothing changed, breaking the "no-op re-derivation changes nothing"
scenario. Postgres's own `ROW_COUNT`/command-tag semantics already exclude conflict rows whose `DO
UPDATE ... WHERE` evaluates false, so the guard alone is sufficient — no separate diffing step
needed.

**Keep the surrogate `id bigint IDENTITY PRIMARY KEY`; add `UNIQUE (permid)` alongside it, rather
than making `permid` itself the primary key.** This is the smaller diff and keeps `taxa`'s column
shape parallel to every sibling table in the file (all of which have a surrogate `id` PK). Nothing
in this change is motivated by wanting `permid` as the literal primary key, and no other table's FK
points at `taxa.id` (confirmed by repo-wide search) or would need to, so this is a non-decision in
practice — noted only because it was considered and rejected as unnecessary scope.

**Drop the `WHERE succeeded_by_id IS NULL` predicate and rename away from `taxa_head_*_idx`,
rather than leaving the (now-always-true-if-it-compiled, but actually now invalid since the column
is gone) predicate in place.** The predicate must go because the column is being dropped; the
rename (`taxa_head_original_idx` → `taxa_original_idx`, etc.) goes with it because "head" is
versioning vocabulary — keeping it on a table that no longer has history would misdescribe what the
index is for. The `UNIQUE (permid)` constraint added above supplies the exact-permid lookup that
`install_version_triggers()`'s auto-created head index used to provide, so no explicit index needs
to be hand-added for that case.

**Document the reversal as an annotation on D8 in `docs/classic-taxa-opinions.md`, not a new
D12 entry.** Checked the file's own history: after the D1–D11 batch (2026-07-31), later revisions
(2026-08-17/18/19) did not extend the numbering — they annotated the affected existing entry in
place with a `⚠ Superseded [in part], DATE` line pointing forward to the authoritative current
source (see D7's annotation, pointing at the migration-mapping doc). This change follows that exact
convention: D8's text stays as the historical record of what was decided and why; a short
annotation is appended pointing at this change (and, after archive, at
`openspec/specs/taxa-opinions/spec.md`'s "Versioning regimes are applied correctly per table"
requirement) as where the current, superseding behavior lives.

## Risks / Trade-offs

- **Loss of point-in-time reconstruction.** This is the entire point of the change (per the
  proposal), not an incidental side effect, but it's worth being explicit: after this ships, there
  is no way to ask "what did the ledger say about permid P as of transaction T" — only "what does
  `derive_taxa()` say right now." Layer 1 opinions remain fully versioned, so *what was asserted,
  when, by whom* is still fully recoverable; what's lost is the pre-computed, per-version *result*
  of running derivation against each historical opinion state. Mitigation: none needed unless this
  capability turns out to be wanted later, in which case it can be reconstructed by re-running
  `derive_taxa()` against a snapshot of Layer 1 as of any given time (opinions carry `created_at`
  and their own succession columns), just not as a pre-materialized cache.
- **Already-deployed databases lose their existing `taxa` history at migration time.** → See
  Migration Plan: this schema has no production deployment yet (per repo state, `create_new.sql` is
  the from-scratch DDL run against an empty database for the full migration), so there is no live
  history to lose in practice. If that ever changes before this ships, the superseded rows would
  need an explicit export first.

## Migration Plan

`create_new.sql` is applied to an empty database (no live deployment exists yet), so there is no
`ALTER TABLE` / data-migration step: the table is simply defined without the succession columns
from the start. Task breakdown (tasks.md) is a direct edit of `postgresql/create_new.sql` plus the
`docs/classic-taxa-opinions.md` annotation — no rollback beyond `git revert`, since nothing is
deployed to roll back in place.
