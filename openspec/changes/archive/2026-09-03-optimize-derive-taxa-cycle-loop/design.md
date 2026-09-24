## Context

Three functions in `postgresql/create_new.sql` — `derive_taxa()`, `derive_linnaean()`,
`derive_taxa_clades()` — each have their own `<<cycle_break>> LOOP` with the identical redundant shape,
every iteration:
1. `DROP`/`CREATE TEMP TABLE` the assign table (`_dtu_assign`/`_dt_assign`/`_dtc_assign`) — a full rebuild
   from `assignment_opinions`, joined against that function's own lineage/concept/linmeta/conmeta tables,
   ranking each concept's candidate containing opinions and picking the winner per `con_rep`.
2. `DROP`/`CREATE TEMP TABLE` the node table (`_dtu_node`/`_dt_node`/`_dtc_node`) — a full rebuild joining
   conmeta to the just-rebuilt assign table, producing one row per concept with its
   `containing_concept_permid`.
3. Full-graph cycle detection: `derive_taxa()` uses iterative anti-join peeling (`_dtu_peel`, up to ~70
   rounds observed) then a bounded walk (`walk_single`) to isolate one cycle; `derive_linnaean()`/
   `derive_taxa_clades()` instead use a single recursive CTE walk from *every* node up to depth 10000
   (`_dt_cycle_members`/`_dtc_cycle_members`) to find all cycle members at once. Either way, if a cycle
   survives, the loop cuts its single weakest edge and repeats.

Profiled live (server-side timing, no client round-trip artifacts) for `derive_taxa()`: steps 1+2 cost
~9-10s per iteration; step 3 costs ~7-8s per iteration; the current dataset needs 5 iterations. Steps 1+2
recompute ~500K unchanged rows to reflect a single opinion exclusion each time — see `proposal.md` for the
full numbers.

**A second, much larger problem found while extending this change to `derive_linnaean()`:** its walk-from-
every-node cycle detection (`_dt_cycle_members`) took **57 minutes 14 seconds** on the first loop iteration
alone, measured live via an instrumented diagnostic run (capped at 15 iterations for safety) — this dwarfs
the ~9-10s/iteration redundant-rebuild cost by roughly three orders of magnitude and is now the dominant
target of this change for `derive_linnaean()`/`derive_taxa_clades()`. The existing code comment already
named this as a suspected risk ("a suspected further pathology in its own right if many nodes feed into a
real cycle... left as originally written here since replacing it is a separate question from this loop")
but its actual magnitude had never been measured before this investigation.

## Goals / Non-Goals

**Goals:**
- Eliminate the redundant full rebuild of the assign/node tables on iterations after the first, in all
  three functions, replacing it with a targeted single-`con_rep` recompute + `UPDATE`, using each
  function's own exact ranking logic scoped down to just that row.
- Replace `derive_linnaean()`'s/`derive_taxa_clades()`'s walk-from-every-node cycle-member detection with
  the same peel-then-isolate shape `derive_taxa()` already uses (see Decisions for the correctness proof
  that this is behavior-preserving, not a heuristic).
- Preserve all three functions' output byte-for-byte, and each one's exclusion-log cut sequence exactly
  (same opinions, same order) — this is a pure performance change.

**Non-Goals:**
- Not changing whether any function re-verifies for a surviving cycle from scratch every iteration
  (`_dtu_peel`/`walk_single`'s existing shape in `derive_taxa()`; the newly-added `_dt_peel`/`_dtc_peel` in
  the other two). Replacing one concept's winning edge can introduce a path through arbitrary other parts
  of the graph (the new edge might point anywhere), so re-deriving the survivor set from scratch every
  iteration is still required for correctness — see Decisions below for why a localized/incremental check
  across iterations is unsafe. This remains the majority of each loop's remaining cost after this change
  and is explicitly out of scope.
- Not touching `_dtu_path`/`_dt_path`'s recursive classification-path walk or `derive_taxa_clades()`'s
  final assembly join — none depend on iteration count, no incremental opportunity from this change's
  approach.
- Not touching each function's other rank-based/self-reference exclusion conditions in the `cand` CTE
  (they differ slightly per function — see Decisions) beyond copying them verbatim into the scoped
  recompute query.

## Decisions

**The same incremental principle applies to all three functions, with each one's own `cand` eligibility
conditions copied verbatim** — they are not identical across functions:
- `derive_taxa()`: no unranked exclusion (by design, so clade names can cross-link with Linnaean
  containment), height-based rank-cardinality check.
- `derive_linnaean()`: excludes unranked/unranked-clade lineages entirely (`accepted_rank_id NOT IN (24,
  25)` on both sides), rank-*id*-based (not height-based) cardinality check.
- `derive_taxa_clades()`: no rank-cardinality check at all (every clade lineage is unranked/unranked-clade,
  so there is no finer/coarser tier to compare — see that function's own header comment), and its
  containing-side joins are plain `JOIN`s rather than `LEFT JOIN`s (both sides of a clade-to-clade
  containment edge must themselves resolve as clade lineages, enforced by the join itself).

**`derive_linnaean()`'s and `derive_taxa_clades()`'s cut-selection queries need the same `con_rep` capture
added.** Unlike `derive_taxa()` (already extended in this change's first phase), their existing queries
only `SELECT a.winning_assignment_opinion_id INTO cut_opinion_id` — extending both to also capture `a.con_rep
INTO ... affected_con_rep` is the same one-line change applied a second and third time.

**`derive_linnaean()`/`derive_taxa_clades()`'s cycle-member detection is restricted to the peeled survivor
set, not changed to a different algorithm.** The walk that checks "does this node's own containment chain
eventually return to itself" is kept exactly as-is — same recursive CTE, same depth-10000 bound, same final
self-match condition — but its FROM/JOIN targets are changed from the full node table to a newly-added
`_dt_peel`/`_dtc_peel` (built and pruned to a fixed point exactly like `derive_taxa()`'s `_dtu_peel`: start
with every node that has a container, then iteratively delete any node whose own container isn't itself
still present, until nothing more can be removed).

*Correctness proof this changes nothing observable:* a genuine cycle member's own container is, by
definition, another member of the same cycle (the loop is mutually self-supporting all the way around) —
and every node with a container starts in the peel set on round 0, including every cycle member. Peeling
only ever removes a node whose container is ABSENT from the current set; since a cycle member's container
is always ANOTHER cycle member (which satisfies "has a container" and is therefore also present), no cycle
member's removal condition is ever satisfied, at any round. So every genuine cycle member is provably a
permanent survivor. Conversely, a node's walk from itself can only ever traverse OTHER genuine cycle members
once it enters a cycle (following "container" around a closed loop never exits it into merely-downstream
territory), so restricting the walk's own internal JOIN targets to the survivor set doesn't change which
path a cycle member's walk takes either. The set of nodes whose walk satisfies the self-match condition —
`_dt_cycle_members`'s/`_dtc_cycle_members`'s final output — is therefore identical whether the walk
considers the full node table or just the survivor set; only the amount of wasted work considering
provably-ineligible nodes changes. This is the same algorithm `derive_taxa()` already uses for its own
cycle-detection, applied here to speed up an existing check without altering its result.

**Only the assign/node tables become incremental; each function's own cycle-detection step stays a full
rebuild every iteration.**
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

**Control flow:** the loop body's assign/node construction is guarded by `IF affected_con_rep IS NULL THEN
<full build> ELSE <targeted recompute> END IF` — guarding on `affected_con_rep IS NULL` rather than `iter =
1` directly expresses "do we have a specific row to recompute, or must we build fresh," and
`affected_con_rep` is naturally `NULL` on the very first pass (declared, no initializer). Uses the
`affected_con_rep`/`cut_opinion_id` captured at the end of the *previous* iteration; the full-graph
cycle-detection step onward is unchanged and runs unconditionally every iteration as today. This exact
shape (implemented and verified for `derive_taxa()`) is what gets mirrored into `derive_linnaean()` and
`derive_taxa_clades()`, with `_dt_`/`_dtc_` table names and each function's own `cand` conditions in place
of `derive_taxa()`'s.

## Risks / Trade-offs

- **[Risk]** The incremental recompute query must stay in exact lockstep with the full-build query's logic
  (same eligibility conditions, same tiebreak order) — a future edit to one that isn't mirrored to the other
  would silently reintroduce a correctness bug only the incremental path exhibits. → **Mitigation**: keep
  both queries directly adjacent in the source with a comment cross-referencing each other; the verification
  plan (see `tasks.md`) diffs full output against a byte-identical baseline specifically to catch this class
  of drift, not just spot-checks.
- **[Risk]** Each function's own full-graph cycle-detection step remains the dominant remaining per-iteration
  cost — this change does not address it, so total savings per function are bounded by the redundant
  assign/node rebuild work eliminated, not the full loop cost. → **Accepted**: explicitly scoped out in
  Non-Goals; a genuine incremental-cycle-detection follow-up would be a separate, much larger change.
- **[Risk]** Performance characteristics depend on how many loop iterations the *current* data needs (5 for
  `derive_taxa()`). `derive_linnaean()`'s and `derive_taxa_clades()`'s own iteration counts on the current
  dataset were unknown before this change's baseline-capture step; if either needs substantially more
  iterations than `derive_taxa()`, the fixed per-iteration cycle-detection cost (unaffected by this change)
  could dominate their runtimes more than it does `derive_taxa()`'s. → **Accepted**: out of scope to address
  further here; `tasks.md` records the actual counts found.
- **[Risk]** `derive_linnaean()`/`derive_taxa_clades()`'s cycle-member detection (`_dt_cycle_members`/
  `_dtc_cycle_members`, a bounded recursive walk from every node) is a different algorithm from
  `derive_taxa()`'s iterative peeling, with its own noted pathology (walking from every node up to depth
  10000, flagged as "a suspected further issue in its own right" in the existing code comment if many nodes
  feed into one real cycle) — this change does not touch that algorithm either way, so any pre-existing
  slowness there is inherited, not introduced or fixed. → **Accepted**: explicitly out of scope, same as the
  `derive_taxa()` cycle-detection Non-Goal.

## Migration Plan

Build and verify directly against the real functions in `postgresql/create_new.sql`, tested via `pg_play`
redeploys (trivially revertible) — same approach used successfully for `fix-nomen-dubium-concept-seniority`
and for `derive_taxa()` earlier in this same change. No schema changes, no data migration: this touches only
the bodies of three functions, one at a time. `derive_taxa()` is already done (implemented, committed,
verified). `derive_linnaean()` and `derive_taxa_clades()` follow the identical pattern, each verified
independently before moving to the next: byte-identical output on the full dataset, an identical exclusion
sequence, and (where the affected table is `taxa_linnaean`/`taxa_clades`) the corresponding
`assert_*_invariant()` passing clean — before considering each a safe drop-in replacement.
