## Context

`_dt_assign` (`postgresql/create_new.sql:5406-5433`) pools `assignment_opinions` candidates per concept
(`con_rep`) in a `cand` CTE, ranks them per `con_rep` in `win` (`evidence DESC, yr DESC NULLS LAST,
opinion_id DESC`, `row_number() = 1` wins), and only *afterward* — in the final `SELECT` — resolves the
winner's `containing_permid` to a concept (`containing_con_rep`), by joining `_dt_lin`/`_dt_con`. Nothing
in `cand`/`win` ever compares a candidate's resolved containing concept back to its own `con_rep`, so a
self-referential candidate can win outright. `_dt_node` then does `LEFT JOIN _dt_assign a ON a.con_rep =
cm.con_rep` — a concept with **zero** rows in `_dt_assign` already surfaces as
`containing_concept_permid = NULL` today (this is how the existing `parent_spelling_no = 0` /
"asserted rootless" case already flows through, per `belongs-to/*.js`'s handling), so rootless-on-exclusion
requires no new machinery, only making `_dt_assign` produce zero rows for a fully-excluded concept.

Both known sub-patterns (71/73 pre-synonymy citations, 2/73 rank-change same-lineage self-references — see
[[containment-cycle-open-problem]]) are the same shape at the `_dt_assign` level: a candidate whose
`containing_permid` resolves to the subject's own concept. One mechanical fix covers both; see
proposal.md for the full data characterization.

`pg_play` holds real, full-migration data and is the only environment that reproduces this (fixture-scale
tests don't have enough real opinions to hit it). `migration_exploration/testing/` already has the
diagnostic scripts that found and characterized this (`find-containment-cycle.js`,
`diagnose-containment-self-loops.js`, `diagnose-same-lineage-self-loops.js`) and
`derive-taxa-analyzed.sql`, a test-only `derive_taxa_analyzed()` copy for trying fixes without touching
the real function first — see [[derive-taxa-performance-fix]] for the established pattern of using it.

## Goals / Non-Goals

**Goals:**
- Make `_dt_assign` exclude any candidate whose `containing_permid` resolves to the subject's own
  concept, for both sub-patterns, before ranking — not just detect it after the fact.
- Preserve existing ranking behavior and output for every concept that has at least one
  non-self-referential candidate (i.e. this is invisible to the 99.98%+ of concepts unaffected today).
- Get a full `derive_taxa(NULL)` to complete against `pg_play`'s real data with zero containment-cycle
  errors and zero concepts stuck unable to reach a tree root because of a self-loop.

**Non-Goals:**
- Not touching the cycle guard's own algorithm (the `walk` CTE's from-every-node depth-10000 search) —
  that's a separate, already-flagged performance question, out of scope here (see
  [[derive-taxa-performance-fix]]'s "one still-open, separate note").
- Not changing `belongs-to/rank-change.js`, `belongs-to/misspelling.js`, or any other migration-layer
  handler — they already resolve `containing_permid` from `parent_spelling_no` correctly and already skip
  the pathological case at the single-opinion level. This fix is entirely inside `derive_taxa()`'s own
  pooling logic, consistent with [[migration-vs-derive-boundary]] (ranking/selecting opinions is
  `derive_taxa()`'s job, not the migration layer's).
- Not building a persistent anomaly log for excluded candidates. `derive_taxa()` SHALL NOT write to any
  table (existing spec requirement) — auditing which candidates were excluded is a diagnostic-tooling
  concern (below), not a new DB-persisted mechanism.
- Not re-litigating whether Classic's underlying opinions (the pre-synonymy citation, the rank-change
  pair) are themselves curatorially "correct" — out of scope; this fix only changes how `derive_taxa()`
  computes a result in their presence.

## Decisions

**Filter in `cand`, before `win`'s `row_number()`, not after.** Add the same `_dt_lin`/`_dt_con`
resolution the final `SELECT` already performs for the winner — but inside `cand`, per candidate — and
exclude a row when its resolved containing `con_rep` equals its own `cm.con_rep`. This makes exclusion
compose correctly with ranking: whatever remains competes by the unchanged `ORDER BY`, and if a concept's
*entire* candidate set was self-referential, `cand`/`win` simply produce zero rows for it — no special-case
branch needed, `_dt_node`'s existing `LEFT JOIN` already turns "no row" into `NULL`.
  - *Alternative considered:* filter after ranking (if the `rn = 1` winner is self-referential, fall back
    to `rn = 2`, etc.). Rejected — doesn't generalize (a concept could have several self-referential
    candidates ranked ahead of the one genuine candidate, requiring an arbitrary-depth fallback), whereas
    filtering before ranking handles any depth for free.
  - *Alternative considered:* fix it at the migration layer (skip inserting the offending
    `assignment_opinions` row). Rejected — the ambiguity is inherently about *ranking* (which candidate
    should win when one is self-referential), which is `derive_taxa()`'s responsibility per
    [[migration-vs-derive-boundary]]; the migration layer has no way to know a row will end up
    self-referential without re-implementing derive's own union-find and ranking.

**Resolve `containing_permid = NULL` candidates as non-self-referential (unchanged from today).** A
`LEFT JOIN` from `containing_permid` to `_dt_lin`/`_dt_con` yields `NULL con_rep` for these, which never
equals a real `cm.con_rep`, so they're never excluded by this change — they continue to compete and, if
they win, continue to produce `containing_concept_permid = NULL` exactly as today. This is deliberate:
"asserted rootless" (Classic said no parent) and "self-referential, excluded" end up at the same `NULL`
outcome, and that conflation is accepted (see Risks below), not newly introduced by this fix.

**Validate against `derive_taxa_analyzed()` first, then port to the real function.** Same order as
[[derive-taxa-performance-fix]]: edit `derive-taxa-analyzed.sql`'s copy, redeploy it into `pg_play` via
the established `node -e` pattern, confirm with the diagnostic scripts, and only then apply the identical
change to `_dt_assign` in `postgresql/create_new.sql` and redeploy the real function.

**Replace the inline `KNOWN GAP` comment (lines 5391-5404) with a description of the fix**, following the
same per-CTE "why" comment convention used for the `_dt_linmeta` `MATERIALIZED` fix — not a struck-through
decision-log entry (that convention is for the markdown docs, not inline SQL).

## Risks / Trade-offs

- **[Risk]** Excluding a self-referential candidate and finding nothing left loses the record of *why* a
  concept is rootless — was it Classic asserting no parent, or a self-referential opinion getting
  excluded? `_dt_assign` (and thus `winning_assignment_opinion_id`) has no row either way. → **Mitigation:**
  accepted; this matches the existing "asserted rootless" precedent, which has the same property today.
  If this ever needs auditing, `diagnose-containment-self-loops.js`-style tooling can re-run the
  pre-exclusion candidate set for any given concept — the underlying `assignment_opinions` rows aren't
  deleted, only excluded from this one function's ranking.
- **[Risk]** A future, non-legacy self-referential assignment opinion (e.g. a genuine data-entry mistake
  in a post-migration Classic-equivalent workflow) would now silently resolve to rootless instead of
  eventually surfacing via the containment-cycle guard. → **Mitigation:** accepted for this migration-time
  fix; the guard still raises loudly for any *multi-concept* cycle, which is the more likely shape of a
  real ongoing-operations mistake (a direct self-assignment is a narrower, already-rare pattern in the
  live counts — 73 out of ~472,805 concepts, all traced to migration-era legacy opinions). If this becomes
  an operational concern later, the diagnostic scripts here can be scheduled as a periodic health check.
- **[Risk]** Adding the `_dt_lin`/`_dt_con` resolution inside `cand` duplicates joins the final `SELECT`
  already does for the winner, adding some cost to the `_dt_assign` step (currently ~4.1s of the ~17s full
  pipeline, per the [[derive-taxa-performance-fix]] benchmark). → **Mitigation:** the same joins, on the
  same (already filtered-down, per-candidate) row count, just performed earlier and with `MATERIALIZED`
  applied per the established pattern; re-run `benchmark-derive-taxa.js` after the change to confirm no
  meaningful regression before considering this done.

## Migration Plan

1. Implement the fix in `derive-taxa-analyzed.sql`'s `derive_taxa_analyzed()`, redeploy into `pg_play`.
2. Re-run `find-containment-cycle.js`, `diagnose-containment-self-loops.js`,
   `diagnose-same-lineage-self-loops.js` — expect zero self-loops and zero unresolved-to-root concepts.
3. Re-run `benchmark-derive-taxa.js` — confirm the ~17s full-derive-all timing holds.
4. Re-run the existing pair-handler fixture test harness ([[opinions-validation-status]]) to confirm no
   regression on the 48 already-validated opinion pairs.
5. Port the identical change into `_dt_assign` in `postgresql/create_new.sql`, replace the `KNOWN GAP`
   comment, redeploy the real `derive_taxa()` into `pg_play`, and repeat steps 2-4 against it directly.
6. No data-at-rest migration and no schema change is involved — `derive_taxa()` reads opinions and writes
   nothing. Rollback, if ever needed, is reverting `_dt_assign`'s SQL text in `create_new.sql` and
   redeploying; there is no forward data state to unwind.
