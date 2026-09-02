## Context

`derive_taxa()`'s `<<cycle_break>> LOOP` (`postgresql/create_new.sql`) currently does, every iteration:
1. `DROP`/`CREATE TEMP TABLE _dtu_assign` — a full rebuild from `assignment_opinions` (~900K rows), joined
   against `_dtu_lin`/`_dtu_con`/`_dtu_conmeta`/`_dtu_linmeta`, ranking each concept's candidate containing
   opinions and picking the winner per `con_rep`.
2. `DROP`/`CREATE TEMP TABLE _dtu_node` — a full rebuild joining `_dtu_conmeta` to the just-rebuilt
   `_dtu_assign`, producing one row per concept with its `containing_concept_permid`.
3. `_dtu_peel` — an iterative anti-join deletion over the full `_dtu_node` graph (up to ~70 rounds observed)
   to find whether any cycle survives, then (if so) `walk_single` isolates one cycle and cuts its weakest
   edge into `_dtu_excluded_opinions`, and the loop repeats.

Profiled live (server-side timing, no client round-trip artifacts): step 1+2 cost ~9-10s per iteration; step
3 costs ~7-8s per iteration; the current dataset needs 5 iterations. Steps 1+2 recompute ~500K unchanged
rows to reflect a single opinion exclusion each time — see `proposal.md` for the full numbers.

## Goals / Non-Goals

**Goals:**
- Eliminate the redundant full rebuild of `_dtu_assign`/`_dtu_node` on iterations after the first, replacing
  it with a targeted single-`con_rep` recompute + `UPDATE`, using the exact same ranking logic scoped down
  to just that row.
- Preserve `derive_taxa()`'s output byte-for-byte, and `_dtu_excluded_opinions`'s cut sequence exactly
  (same opinions, same order) — this is a pure performance change.

**Non-Goals:**
- Not changing `_dtu_peel`/`walk_single`'s full-graph cycle detection. Replacing one concept's winning edge
  can introduce a path through arbitrary other parts of the graph (the new edge might point anywhere), so
  global re-verification is still required for correctness every iteration — see Decisions below for why a
  localized check is unsafe. This is the majority of the loop's remaining cost after this change and is
  explicitly out of scope.
- Not touching `_dtu_path`'s recursive classification-path walk (~17s, runs once regardless of iteration
  count) or the final assembly join (~1.6s) — neither depends on iteration count, no incremental opportunity
  from this change's approach.
- Not touching `derive_linnaean()` or `derive_taxa_clades()`'s own (differently-shaped) cycle-breaking
  loops — profiling only measured `derive_taxa()`'s cost; whether those have the same redundancy is
  unassessed and out of scope here.

## Decisions

**Only `_dtu_assign`/`_dtu_node` become incremental; `_dtu_peel` stays a full rebuild every iteration.**
Alternative considered: seed `_dtu_peel` from the previous iteration's survivor set, on the theory that
excluding an opinion can only shrink reachability. Rejected: the excluded opinion isn't simply removed —
the affected `con_rep` gets a **replacement** winning edge (whatever the next-best candidate is), which can
point at a completely different concept than before. A replacement edge can introduce new reachability
paths that didn't exist previously, so the previous iteration's survivor set is not a safe superset of the
new one. Full re-verification is the only sound option without a much larger investment in genuine
incremental cycle detection (a substantially harder algorithmic problem, and not what this change is
about) — matching the precedent already set by `fix-eukarya-eumetazoa-containment-cycle`'s explicit
rejection of MST/localized cycle-breaking heuristics in favor of a globally-correct check.

**Why the single-`con_rep` recompute is safe:** `_dtu_node.containing_concept_permid` for any given `con_rep`
is a pure function of that `con_rep`'s own `_dtu_assign` row (via `_dtu_conmeta`'s fixed, never-changing
`concept_permid`/`senior_lin`/`concept_rank_name`) — never of any *other* row's state. Only the `con_rep`
whose previously-winning opinion was just excluded can possibly have a different winner after this
iteration's exclusion; every other `con_rep`'s candidate pool and ranking are completely unaffected by one
more row being added to `_dtu_excluded_opinions`. This is also directly evidenced by the loop's own design:
`cut_opinion_id` (and thus the affected `con_rep`) is already selected as a single row via `ORDER BY ...
LIMIT 1` on the weakest edge among cycle members — capturing that `con_rep` alongside `cut_opinion_id` costs
nothing extra.

**Recompute query, scoped to one `con_rep`:** identical `cand` logic to the current full build (same
`assignment_opinions` join, same `sl.lin_rep = cm.senior_lin OR (concept_rank_name <> 'species' AND
accepted_rank_id = concept_rank_id)` eligibility, same self-reference and rank-cardinality exclusions, same
`NOT EXISTS (... _dtu_excluded_opinions ...)` filter), but joined through `_dtu_conmeta cm ON cm.con_rep =
affected_con_rep` instead of scanning every `con_rep`, and `ORDER BY evidence DESC, yr DESC NULLS LAST, id
DESC LIMIT 1` in place of the `row_number() OVER (PARTITION BY con_rep ...)` window (no partitioning needed
once already scoped to one row). Two outcomes:
- A new winning opinion is found → `UPDATE _dtu_assign`/`_dtu_node` for that one `con_rep` with the new
  `winning_assignment_opinion_id`/`containing_con_rep`(or `containing_concept_permid`)/`evidence`/`yr`/
  `is_senior`.
- No eligible candidate remains (the concept becomes rootless) → `DELETE FROM _dtu_assign WHERE con_rep =
  affected_con_rep`, `UPDATE _dtu_node SET containing_concept_permid = NULL, winning_assignment_opinion_id =
  NULL, evidence = NULL, yr = NULL, is_senior = NULL WHERE con_rep = affected_con_rep`.

**No index/ANALYZE maintenance needed for incremental iterations.** A single-row `UPDATE`/`DELETE` on an
already-indexed temp table doesn't need `CREATE INDEX`/`ANALYZE` repeated (Postgres maintains indexes
incrementally; the planner's statistics for a ~500K-row table are unaffected by one row changing) — dropping
those two statements from every iteration after the first is itself a small additional saving.

**Control flow:** the loop body's `_dtu_assign`/`_dtu_node` construction is guarded by `IF iter = 1 THEN
<full build> ELSE <targeted recompute> END IF`, using the `affected_con_rep`/`cut_opinion_id` captured at
the end of the *previous* iteration. `_dtu_peel` onward is unchanged and runs unconditionally every
iteration as today.

## Risks / Trade-offs

- **[Risk]** The incremental recompute query must stay in exact lockstep with the full-build query's logic
  (same eligibility conditions, same tiebreak order) — a future edit to one that isn't mirrored to the other
  would silently reintroduce a correctness bug only the incremental path exhibits. → **Mitigation**: keep
  both queries directly adjacent in the source with a comment cross-referencing each other; the verification
  plan (see `tasks.md`) diffs full output against a byte-identical baseline specifically to catch this class
  of drift, not just spot-checks.
- **[Risk]** `_dtu_peel`'s full-graph re-verification remains the dominant remaining cost (~35-40s across 5
  iterations) — this change does not address it, so total savings are bounded by the ~38s of redundant
  `_dtu_assign`/`_dtu_node` work identified, not the full ~78s loop cost. → **Accepted**: explicitly scoped
  out in Non-Goals; a genuine incremental-cycle-detection follow-up would be a separate, much larger change.
- **[Risk]** Performance characteristics depend on how many loop iterations the *current* data needs (5
  today). If the underlying opinions change enough to need many more iterations, the fixed ~7-8s/iteration
  `_dtu_peel` cost (unaffected by this change) could still dominate total runtime. → **Accepted**: out of
  scope; noted for anyone revisiting this later.

## Migration Plan

Build and verify directly against the real `derive_taxa()` in `postgresql/create_new.sql`, tested via
`pg_play` redeploys (trivially revertible) — same approach used successfully for
`fix-nomen-dubium-concept-seniority`. No schema changes, no data migration: this touches only the body of
one function. Verification (see `tasks.md`) confirms byte-identical `derive_taxa(NULL)` output and an
identical `_dtu_excluded_opinions`/`cycle_cuts` sequence before considering this safe to treat as a drop-in
replacement.
