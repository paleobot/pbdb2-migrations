## Why

`derive_taxa()`'s classification cycle-breaking loop (`<<cycle_break>> LOOP` in `postgresql/create_new.sql`)
fully rebuilds `_dtu_assign` (a full scan/join over all ~900K `assignment_opinions`) and `_dtu_node` (a full
rebuild over all ~500K concepts) on **every** loop iteration, even though only one concept's winning
assignment candidate actually changes per iteration (the one whose edge was just excluded). Profiled live
against `pg_play`: the current dataset needs 5 iterations (4 real cuts + 1 confirming pass) to reach an
acyclic state, and `_dtu_assign`+`_dtu_node`'s repeated full rebuilds cost ~9-10s per iteration — about 38s
of the function's current ~115.6s total, out of proportion to the single-row change each iteration actually
makes. (For context: this cost is independent of and predates the `fix-nomen-dubium-concept-seniority`
validity-veto work — a direct pre/post comparison confirmed that fix costs only ~5s; the ~110s baseline
already existed in the prior `postgresql/create_new.sql` revision, from the taxa-tables-rework merge.)

## What Changes

- After the loop's first (necessarily full) iteration, `_dtu_assign` and `_dtu_node` are no longer rebuilt
  from scratch each iteration. Instead, only the specific `con_rep`(s) whose previous winning candidate was
  the opinion just excluded are recomputed (typically exactly one), and `_dtu_assign`/`_dtu_node` are updated
  in place for those rows only — leaving every other concept's row untouched between iterations.
- The cycle-detection step itself (`_dtu_peel`'s full-graph iterative peeling, and the `walk_single` cycle
  isolation) is **not** changed: it must still re-verify the whole graph each iteration, since replacing one
  concept's winning edge can introduce a genuinely new path anywhere reachable from it, and this codebase
  has already rejected localized/heuristic cycle checks once (see `fix-eukarya-eumetazoa-containment-cycle`'s
  MST-weakest-link rejection). Only the redundant, unrelated-to-cycle-detection rebuild work is removed.
- No output of `derive_taxa()` changes. This is a pure performance change, verified by confirming the
  optimized function's output is byte-identical to the current function's output on the full dataset, plus
  identical `cycle_cuts` records (same opinions excluded, in the same order).

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
(none — this changes an implementation detail of `derive_taxa()`'s internal cycle-breaking loop, not any
externally-observable behavior described in `openspec/specs/taxa-opinions/spec.md`. No requirement's
wording changes; the function's inputs, outputs, and selection rules are unaffected.)

## Impact

- **Affected code**: `postgresql/create_new.sql`'s `derive_taxa()` function only (the `<<cycle_break>> LOOP`
  body). Correction found during implementation: `derive_linnaean()` and `derive_taxa_clades()` DO share
  this same `_dtu_assign`/`_dtu_node`-full-rebuild-per-iteration loop shape (contrary to this proposal's
  original claim) — whether they have the same redundancy-driven cost is unassessed; this change touches
  `derive_taxa()` only, and a parallel fix for the other two would be a natural, separately-scoped follow-up.
- **Affected data**: none — `pg_play`'s persisted tables (`taxa`, `taxa_linnaean`, `taxa_clades`,
  `taxa_attachments`) are expected to be identical before and after, confirmed via
  `assert_taxa_invariant()` and a full self-consistency diff.
- **Performance target**: reduce `derive_taxa(NULL)`'s current ~115.6s wall time by roughly the ~38s of
  redundant `_dtu_assign`/`_dtu_node` rebuild work identified during profiling (down to roughly ~78s),
  without touching the ~35-40s of inherently-necessary full-graph cycle re-verification or the ~17s
  `_dtu_path` recursive walk (both out of scope for this change).
  **Measured result**: `_dtu_assign`/`_dtu_node` dropped from ~9-10s/iteration to ~0.01s/iteration on every
  incremental pass, as intended; total loop+path+final time dropped from ~102.5s to ~69.3s
  (server-side-timed, no client round-trip inflation), for an overall `derive_taxa(NULL)` reduction of
  ~115.6s → ~82.5s (~33s, ~29%) — close to, if slightly under, the ~38s prediction (peel timing has some
  natural run-to-run variance).
