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

**Extended to `derive_linnaean()` and `derive_taxa_clades()`**: both share the identical
`_dtu_assign`/`_dtu_node`-full-rebuild-per-iteration loop shape (as `_dt_assign`/`_dt_node` and
`_dtc_assign`/`_dtc_node` respectively) — this was originally flagged as an unassessed, separately-scoped
follow-up when this change first shipped for `derive_taxa()` alone; the maintainer has since asked for it
to be folded in here rather than deferred.

**A second, far larger problem found while extending to `derive_linnaean()`**: `derive_linnaean()` and
`derive_taxa_clades()` don't use `derive_taxa()`'s iterative-peeling cycle-detection algorithm at all — they
use an older approach (`_dt_cycle_members`/`_dtc_cycle_members`) that walks from *every* node with a
container up to depth 10000, checking each one for a self-revisit, every single loop iteration. The
existing code comment already flagged this as "a suspected further pathology in its own right if many
nodes feed into a real cycle... left as originally written here since replacing it is a separate question
from this loop" — but nobody had ever actually measured how bad it could get. Measured live: this single
step took **57 minutes 14 seconds** on `derive_linnaean(NULL)`'s first iteration alone (out of a ~57m36s
total run) — dwarfing everything else in this change, including the redundant-rebuild cost this change set
out to fix. This is now folded into scope: replace the walk-from-every-node approach with the same
peel-then-isolate algorithm `derive_taxa()` already uses, which restricts the expensive walk to only the
(provably identical, but typically far smaller) set of nodes that could possibly be cycle members.

## What Changes

- After the loop's first (necessarily full) iteration, `_dtu_assign`/`_dt_assign`/`_dtc_assign` and
  `_dtu_node`/`_dt_node`/`_dtc_node` are no longer rebuilt from scratch each iteration, in all three
  functions (`derive_taxa()`, `derive_linnaean()`, `derive_taxa_clades()`). Instead, only the specific
  `con_rep`(s) whose previous winning candidate was the opinion just excluded are recomputed (typically
  exactly one), and the assign/node tables are updated in place for those rows only — leaving every other
  concept's row untouched between iterations.
- `derive_linnaean()`/`derive_taxa_clades()`'s cycle-member detection is changed from a walk starting at
  *every* node with a container to the same peel-then-isolate shape `derive_taxa()` already uses: build a
  survivor set via cheap iterative anti-join deletion (nodes whose own container isn't itself still
  present get pruned to a fixed point), then only walk from nodes in that survivor set. This is
  behavior-preserving, not a heuristic: a genuine cycle member's own container is always another cycle
  member, so it can never be pruned by this process — every real cycle member is provably a survivor, the
  walk just no longer wastes time starting from the (usually vast majority of) nodes that can't possibly be
  one.
- Full-graph re-verification of *whether any cycle still exists* is **not** changed in any of the three:
  each function still re-derives its survivor set from scratch every iteration, since replacing one
  concept's winning edge can introduce a genuinely new path anywhere reachable from it, and this codebase
  has already rejected localized/heuristic cycle checks once (see `fix-eukarya-eumetazoa-containment-cycle`'s
  MST-weakest-link rejection). Only the redundant, unrelated-to-cycle-detection rebuild work (first bullet)
  and the wasted walk-from-non-cycle-candidate work (second bullet) are removed.
- No output of any of the three functions changes. This is a pure performance change, verified per function
  by confirming byte-identical output on the full dataset, plus identical `cycle_cuts`/exclusion records
  (same opinions excluded, in the same order).

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
(none — this changes an implementation detail of `derive_taxa()`'s internal cycle-breaking loop, not any
externally-observable behavior described in `openspec/specs/taxa-opinions/spec.md`. No requirement's
wording changes; the function's inputs, outputs, and selection rules are unaffected.)

## Impact

- **Affected code**: `postgresql/create_new.sql`'s `derive_taxa()`, `derive_linnaean()`, and
  `derive_taxa_clades()` — each function's own `<<cycle_break>> LOOP` body only.
- **Affected data**: none — `pg_play`'s persisted tables (`taxa`, `taxa_linnaean`, `taxa_clades`,
  `taxa_attachments`) are identical before and after, confirmed via `assert_taxa_invariant()`/
  `assert_linnaean_invariant()`/`assert_taxa_clades_invariant()` and full self-consistency diffs.
- **Measured results, `derive_taxa()`** (incremental assign/node recompute only — no cycle-detection
  algorithm change needed here, it already used iterative peeling): `_dtu_assign`/`_dtu_node` dropped from
  ~9-10s/iteration to ~0.01s/iteration on every incremental pass; overall `derive_taxa(NULL)`
  ~115.6s → ~82.5s (~33s, ~29% faster).
- **Measured results, `derive_linnaean()`** (both fixes: incremental assign/node recompute, plus
  peel-restricted cycle-member detection replacing the walk-from-every-node approach): the walk-from-
  every-node step alone measured **57 minutes 14 seconds** on the unfixed code's first iteration — after
  both fixes, the full `derive_linnaean(NULL)` call (1 real cut + 1 confirming pass) completes in
  **~1042.8s (~17.4 minutes)**, a ~3.3x improvement. `assert_linnaean_invariant()` confirms zero divergence
  from the persisted `taxa_linnaean` table.
- **Measured results, `derive_taxa_clades()`** (both fixes applied, but its own graph — ~2,525 clade-rank
  taxa — was always small enough that the walk-from-every-node pathology never mattered in practice):
  `derive_taxa_clades(NULL)` ~3.0s (3 cuts), materially unchanged from before this change (~3.5s).
  `assert_taxa_clades_invariant()` confirms zero divergence; `rebuild_taxa_clades()` is a clean no-op
  (`changed = 0`).
