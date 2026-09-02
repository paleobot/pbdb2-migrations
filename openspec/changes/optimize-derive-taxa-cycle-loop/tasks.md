## 1. Baseline capture

- [x] 1.1 Ran the current (unmodified) `derive_taxa(NULL)` against `pg_play` and captured its full output
      (all columns, every row — 517,284 rows) into a persistent `_opt_baseline_taxa_pre` table for later
      SQL-level diffing (a full client-side JSON dump hit Node's string-length limit at this scale).
- [x] 1.2 Captured `_dtu_excluded_opinions` (4 cuts: opinions 54371/212959/446208/914634, con_reps
      identified) into `_opt_baseline_cuts_pre`.
- [x] 1.3 Recorded baseline timing server-side (`clock_timestamp()`/`RAISE NOTICE`, one round trip, no
      client/network overhead): 5 iterations, ~83.6s loop + ~17.3s `_dtu_path` + ~1.6s final ≈ 115.6s total
      (13.1s prereq chain + loop/path/final), matching the ~115.5s wall-clock figure from earlier profiling.

## 2. Implement the incremental recompute

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

## 3. Verify correctness

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

## 4. Verify performance

- [x] 4.1 Timed the modified `derive_taxa(NULL)` with the same server-side technique as the baseline —
      confirmed the mechanism: `_dtu_assign`/`_dtu_node` dropped from ~10.7s (iteration 1, full build,
      unavoidable) to **~0.005-0.01s** on every incremental iteration (2-5) — `_dtu_peel`'s ~7-8s/iteration
      (untouched, out of scope) is now the entire per-iteration cost on incremental passes.
- [x] 4.2 Total: loop+path+final dropped from ~102.5s to ~69.3s; full `derive_taxa(NULL)` (including the
      ~13.1s prereq chain, unaffected) dropped from ~115.6s to ~82.5s — a **~33s (~29%) reduction**, close
      to (slightly under) the ~38s predicted in `proposal.md`; the gap is explained by natural run-to-run
      variance in `_dtu_peel`'s cost (7.05-8.44s observed across iterations) rather than any flaw in the
      optimization itself.

## 5. Close out

- [x] 5.1 Added inline comments at the `IF affected_con_rep IS NULL` branch point and the cut-selection
      query describing the incremental recompute, why it's safe (mirroring design.md's "Why the
      single-con_rep recompute is safe"), and that `_dtu_peel`/`walk_single` are deliberately untouched.
- [x] 5.2 Wrote memory documenting: the corrected understanding that the validity-veto fix cost only ~5s
      (not ~90s — the ~110s baseline was pre-existing from the taxa-tables-rework merge), this change's
      mechanism and measured ~33s/~29% improvement, and the corrected proposal claim (derive_linnaean()/
      derive_taxa_clades() share this loop shape too, unassessed, candidate follow-up).
- [ ] 5.3 Report final numbers to the maintainer and confirm before archiving.
- [ ] 5.4 Archive this OpenSpec change once the maintainer confirms the implementation matches these
      artifacts.
