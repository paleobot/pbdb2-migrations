## 1. Baseline capture (derive_taxa())

- [x] 1.1 Ran the current (unmodified) `derive_taxa(NULL)` against `pg_play` and captured its full output
      (all columns, every row — 517,284 rows) into a persistent `_opt_baseline_taxa_pre` table for later
      SQL-level diffing (a full client-side JSON dump hit Node's string-length limit at this scale).
- [x] 1.2 Captured `_dtu_excluded_opinions` (4 cuts: opinions 54371/212959/446208/914634, con_reps
      identified) into `_opt_baseline_cuts_pre`.
- [x] 1.3 Recorded baseline timing server-side (`clock_timestamp()`/`RAISE NOTICE`, one round trip, no
      client/network overhead): 5 iterations, ~83.6s loop + ~17.3s `_dtu_path` + ~1.6s final ≈ 115.6s total
      (13.1s prereq chain + loop/path/final), matching the ~115.5s wall-clock figure from earlier profiling.

## 2. Implement the incremental recompute (derive_taxa())

- [x] 2.1 Added `affected_con_rep uuid` and the single-row recompute variables (`new_opinion_id`,
      `new_containing_permid`, `new_containing_con_rep`, `new_evidence`, `new_yr`, `new_is_senior`) to
      `derive_taxa()`'s `DECLARE` block.
- [x] 2.2 Extended the cut-selection query to also select `a.con_rep INTO ... affected_con_rep` alongside
      `cut_opinion_id`.
- [x] 2.3 Wrapped the `_dtu_assign`/`_dtu_node` `DROP`/`CREATE TEMP TABLE` block in
      `IF affected_con_rep IS NULL THEN <unchanged full build> ELSE <targeted recompute> END IF` — guarding
      on `affected_con_rep IS NULL` rather than `iter = 1`, since it directly expresses "do we have a
      specific row to recompute or must we build fresh," and `affected_con_rep` is naturally `NULL` on the
      very first pass.
- [x] 2.4 Added the `ELSE` branch: single-`con_rep` recompute query (identical `cand` logic, scoped via
      `cm.con_rep = affected_con_rep`, `ORDER BY ... LIMIT 1` in place of the window function), followed by
      `UPDATE`/`DELETE` on `_dtu_assign` and the corresponding `UPDATE` on `_dtu_node`, both scoped to
      `WHERE con_rep = affected_con_rep`. Handles both outcomes: a new winner found, or none remaining
      (concept becomes rootless).
- [x] 2.5 Confirmed the recompute query's `cand` logic is copied verbatim from the full-build query (same
      self-reference exclusion, rank-cardinality/inversion check, `NOT EXISTS` against
      `_dtu_excluded_opinions`) — not retyped, to avoid drift.
- [x] 2.6 Redeployed the modified `derive_taxa()` to `pg_play` — compiled cleanly.

## 3. Verify correctness (derive_taxa())

- [x] 3.1 Diffed the modified run's full output against the task 1.1 baseline via `EXCEPT` both directions
      (517,284 rows each side) — **0 differences**.
- [x] 3.2 Diffed `_dtu_excluded_opinions` against the task 1.2 baseline via `EXCEPT` both directions —
      **0 differences**: identical opinions, concept_permids, and cycle_members.
- [x] 3.3 Ran `SELECT rebuild_taxa();` (`changed = 0`, confirming the persisted `taxa` table was already
      consistent — expected, since output is byte-identical) and `SELECT assert_taxa_invariant();` — passed
      with zero divergence.
- [x] 3.4 Spot-checked Cotylosauria, Temnospondyli, and Ferae directly in the persisted `taxa` table —
      values present and consistent; the exhaustive full-table diff (3.1) already confirms these match
      exactly, this was a direct sanity look.

## 4. Verify performance (derive_taxa())

- [x] 4.1 Timed the modified `derive_taxa(NULL)` with the same server-side technique as the baseline —
      confirmed the mechanism: `_dtu_assign`/`_dtu_node` dropped from ~10.7s (iteration 1, full build,
      unavoidable) to **~0.005-0.01s** on every incremental iteration (2-5) — `_dtu_peel`'s ~7-8s/iteration
      (untouched, out of scope) is now the entire per-iteration cost on incremental passes.
- [x] 4.2 Total: loop+path+final dropped from ~102.5s to ~69.3s; full `derive_taxa(NULL)` (including the
      ~13.1s prereq chain, unaffected) dropped from ~115.6s to ~82.5s — a **~33s (~29%) reduction**, close
      to (slightly under) the ~38s predicted in `proposal.md`; the gap is explained by natural run-to-run
      variance in `_dtu_peel`'s cost (7.05-8.44s observed across iterations) rather than any flaw in the
      optimization itself.

## 5. Extend to derive_linnaean()/derive_taxa_clades(): the incremental recompute

- [x] 5.1 Applied the identical `derive_taxa()` pattern (§2) to `derive_linnaean()` (`_dt_assign`/`_dt_node`,
      `_dt_excluded_opinions`) and `derive_taxa_clades()` (`_dtc_assign`/`_dtc_node`,
      `_dtc_excluded_opinions`) — same `affected_con_rep`/`new_*` variables, same `IF affected_con_rep IS
      NULL` guard, same cut-selection query extension to capture `con_rep`. Each function's own `cand`
      eligibility conditions copied verbatim (they differ per function — see `design.md` Decisions):
      `derive_linnaean()` has the unranked/unranked-clade exclusion and a rank-*id*-based cardinality check;
      `derive_taxa_clades()` has neither (INNER JOINs on the containing side enforce clade-only membership
      structurally instead), and resolves `containing_con_rep` directly in its own `cand` CTE rather than via
      a separate `containing_permid` → `_dt_con` join.
- [x] 5.2 Added `peeled_count integer` to `derive_taxa_clades()`'s `DECLARE` block (needed for §6's peeling
      loop; `derive_linnaean()` already had it, reused for its own cycle-breaking loop elsewhere in that
      function).

## 6. Discovery: the walk-from-every-node cycle-detection pathology

- [x] 6.1 While preparing to baseline-capture `derive_linnaean()`/`derive_taxa_clades()` the same way as
      `derive_taxa()` (§1), the unmodified `derive_linnaean(NULL)` call ran well past the ~2 minutes
      `derive_taxa()` took, with no sign of stalling (confirmed genuinely on-CPU server-side via
      `pg_stat_activity.wait_event IS NULL`, not a dropped-connection artifact).
- [x] 6.2 Built an instrumented diagnostic copy of `derive_linnaean()` (as an anonymous `DO $$ ... $$` block,
      one round trip, `RAISE NOTICE`/`clock_timestamp()` per phase, capped at 15 iterations for safety) to
      get real per-phase timing without waiting indefinitely for an unknown-duration full run.
      **Found: `_dt_cycle_members`'s walk-from-every-node-up-to-depth-10000 recursive CTE took 57 minutes 14
      seconds on the first iteration alone**, out of a 57m36s total — the existing code comment already
      named this as a suspected risk ("a suspected further pathology... if many nodes feed into a real
      cycle") but its actual magnitude had never been measured. This dwarfs the redundant-rebuild cost this
      change originally targeted by roughly three orders of magnitude and was folded into scope (maintainer
      confirmed: "Fix it too, same change").

## 7. Fix: peel-restrict the cycle-member walk

- [x] 7.1 Proved the fix is behavior-preserving before implementing it (see `design.md` Decisions, "genuine
      cycle member's own container is always another cycle member" — provably never pruned by iterative
      peeling, and a cycle member's own walk never exits into merely-downstream territory) — this is the
      same peel-then-isolate algorithm `derive_taxa()` already uses, applied to speed up an existing check
      without changing its result, not a new heuristic.
- [x] 7.2 Added `_dt_peel`/`_dtc_peel` construction (iterative anti-join deletion to a fixed point,
      structurally identical to `derive_taxa()`'s `_dtu_peel`) immediately before each function's
      `_dt_cycle_members`/`_dtc_cycle_members` construction.
- [x] 7.3 Changed `_dt_cycle_members`'s/`_dtc_cycle_members`'s recursive CTE to source from the new peel
      table instead of the full node table, in both the base case and the recursive JOIN targets — the walk
      logic itself (depth-10000 bound, self-match condition) is otherwise unchanged.
- [x] 7.4 Redeployed both modified functions to `pg_play` — compiled cleanly.

## 8. Verify correctness and performance (derive_linnaean(), derive_taxa_clades())

- [x] 8.1 Ran the fixed `derive_linnaean(NULL)`: **1042.8s (~17.4 minutes)**, down from the unfixed ~57m36s
      (~3.3x faster) — 1 real cut, 1 confirming pass (matching the diagnostic run's finding exactly).
- [x] 8.2 Ran `SELECT assert_linnaean_invariant();` against the fixed function — **passed, zero divergence**
      from the persisted `taxa_linnaean` table (built by the *old*, unfixed code during this session's
      earlier `rebuild_taxa_full()` run) — this is the byte-for-byte old-vs-new correctness proof, obtained
      without needing to re-run the unfixed ~57-minute baseline to completion a second time. (One run's
      timing measurement for this step was contaminated by a machine-sleep interruption during the wait —
      confirmed no orphaned server-side backend afterward — but the *result*, zero divergence, is
      independent of that and stands.)
- [x] 8.3 Ran the fixed `derive_taxa_clades(NULL)`: **3.0s** (3 cuts) — materially unchanged from its
      pre-fix ~3.5s, as expected: its own graph (~2,525 clade-rank taxa) was always small enough that the
      walk-from-every-node pathology never mattered there in practice; the fix still applies for
      consistency and future-proofing. `SELECT assert_taxa_clades_invariant();` passed, zero divergence.
      `SELECT rebuild_taxa_clades();` confirmed a clean no-op (`changed = 0`).
- [x] 8.4 Did not re-run `rebuild_linnaean()` to confirm a no-op the same way — `assert_linnaean_invariant()`
      (§8.2) already proves byte-identical output against the persisted table, which is the stronger and
      more direct check; re-running would only re-pay the ~17-minute cost for a strictly weaker
      confirmation.

## 9. Close out

- [x] 9.1 Added inline comments at each function's `IF affected_con_rep IS NULL` branch point and
      cut-selection query describing the incremental recompute and why it's safe; added comments at each
      new `_dt_peel`/`_dtc_peel` construction describing the peel-restriction correctness proof (mirroring
      `design.md`'s Decisions).
- [x] 9.2 Updated memory documenting: the corrected understanding that the validity-veto fix cost only ~5s
      (not ~90s), the redundant-rebuild fix's ~29% improvement to `derive_taxa()`, and — the dominant
      finding — the 57-minute walk-from-every-node pathology in `derive_linnaean()`/`derive_taxa_clades()`
      and its ~3.3x fix.
- [ ] 9.3 Report final numbers to the maintainer and confirm before archiving.
- [ ] 9.4 Archive this OpenSpec change once the maintainer confirms the implementation matches these
      artifacts.
