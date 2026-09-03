## Context

See [proposal.md](proposal.md) for motivation. This section records what live profiling against `pg_play`
(2026-09-03) found, since it changes the design from what the proposal's "What Changes" section guessed.

**Where `derive_taxa(seed)`'s ~318-340s actually goes** (instrumented run: a copy of `derive_taxa()`'s body
run as a `DO` block with `RAISE NOTICE` timing checkpoints after every `ANALYZE`, one real seed permid,
against `pg_play`):

| Stage | Time | % of total |
|---|---|---|
| Pre-loop setup (identity/edge-candidate scans, lineage union-find `_dtu_lin`, concept union-find `_dtu_con`, validity veto, `_dtu_linmeta`/`_dtu_conmeta`) | 14.8s | 4.6% |
| First-pass full `_dtu_assign`/`_dtu_node` build (join over ~900K `assignment_opinions`) | 7.6s | 2.4% |
| Classification cycle-breaking loop (53 cuts + 1 confirming pass = 54 iterations) | 286.2s | **89.8%** |
| `_dtu_path` (root→node `classification_path`, built for the whole tree) | 9.3s | 2.9% |
| Final assemble + filter by `seed` | <0.01s | ~0% |

This rules out the union-find hypothesis raised when this change was proposed (that `_dtu_lin`'s
"reach from every node" recursive CTE might be quadratic-in-component-size and thus the hidden cost) —
union-find costs a modest 5.3s combined. The overwhelming cost is the classification cycle-breaking loop,
and it is **completely independent of `seed`**: per its own code comments, "each function still re-derives
its survivor set from scratch every iteration" — the peel-to-fixed-point step re-scans the *entire*
~500K-node classification tree on every one of its 54 iterations, whether `seed` is one permid or `NULL`.
This also explains the `derive_taxa(NULL)` regression seen since this change's own benchmark work began
(~82.5s on old degenerate data, per `openspec/changes/archive/2026-09-03-optimize-derive-taxa-cycle-loop/proposal.md`
→ ~380s now): the real, merged-lineage dataset needs 53 concurrent cycle cuts, not the 4-5 that earlier
change's test data needed.

**Do the 53 cycles overlap?** A second live run (same technique, dumping `_dtu_excluded_opinions` after a
full un-seeded run) confirms yes. Example: concept `019ff8c0-96e6-748a-ad61-d479f5fa0283` is cut twice —
first as part of a 2-node cycle (partner `95e4...`), then, once its next-ranked candidate takes over, as
part of an unrelated 8-node cycle (7 different nodes). One 3-node cluster
(`019ff8c0-91fb-721b-b44c-5057070506f9` + 2 partners) is cut **14 separate times** before stabilizing.
This matters because it means a scoped algorithm cannot assume "at most one cut resolves the seed's own
ancestry" — see Decision 1.

**The exploitable structure**: `containing_concept_permid` is a single pointer per concept (a functional
graph) — walking it upward from any one node is O(depth), not O(tree size). And the correctness invariant
already established and shipped by `optimize-derive-taxa-cycle-loop` (archived; its own comment: "every
other concept's candidate pool and ranking are provably unaffected by one more row in
`_dtu_excluded_opinions`") means a con_rep's winning candidate depends *only* on its own eligible
`assignment_opinions` and the current exclusion set — never on any other con_rep's state, or on what order
cuts happen in. That invariant is what makes a walk-driven, seed-scoped traversal order provably converge
to the same answer as the existing arbitrary-order global loop.

## Goals

- Cut `derive_taxa(seed)` (and, by the same design, `derive_linnaean(seed)`/`derive_taxa_clades(permids)`)
  from ~5-6 minutes down to the low tens of seconds for a small `seed`, by removing the seed-independent
  global cycle-breaking loop, global `_dtu_path` build, and global first-pass `_dtu_assign`/`_dtu_node`
  build from the `seed IS NOT NULL` path.
- Byte-identical output vs. the corresponding rows of a full `derive_taxa(NULL)` call — including for seed
  permids whose ancestry passes through one of the currently-known overlapping/multi-round cycle clusters.
- `seed IS NULL` is untouched: same temp tables, same loop, same cost.

## Non-Goals

- Scoping the pre-loop union-find (`_dtu_lin`/`_dtu_con`) or `_dtu_linmeta`/`_dtu_conmeta` to the seed's
  neighborhood. A candidate `assignment_opinion` can target a lineage/concept anywhere in the graph, so its
  con_rep must already be resolvable — scoping this is a materially harder problem than scoping the cycle
  loop, and at 14.8s combined it isn't the dominant cost. Flagged as a follow-on if sub-second latency is
  ever required.
- True sub-second latency. This design targets low tens of seconds (a ~13-20x improvement), not sub-second.
- A caller-facing "recompute on opinion insert" trigger/API, or any persisted cross-call state — per
  proposal.md, `seed` stays `uuid[]` of permids to return, with no notion of "what changed since last call."
- Changing `derive_taxa(NULL)`'s behavior, cost, or the `rebuild_*()` functions — all three
  (`rebuild_taxa()`/`rebuild_linnaean()`/`rebuild_taxa_clades()`) call only the `NULL` path today
  (confirmed by inspection), so they are unaffected by this change either way.

## Decisions

### Decision 1: For `seed IS NOT NULL`, replace the global loop/path/assign/node builds with an on-demand upward walk per seed permid

Instead of building `_dtu_assign`/`_dtu_node` for all ~500K concepts and running the peel-based loop to a
*global* fixed point, the seed-scoped path:

1. Builds the pre-loop tables through `_dtu_conmeta` exactly as today (full-graph, unscoped — see
   Non-Goals).
2. For each seed permid, resolves its own con_rep, then walks **upward** one concept at a time via
   `containing_concept_permid`, resolving each visited con_rep's winning assignment on demand using the
   same single-con_rep candidate query the existing incremental "ELSE" branch already uses (added by
   `optimize-derive-taxa-cycle-loop`) — never building a bulk `_dtu_assign`/`_dtu_node` table.
3. Maintains a per-walk "visited" map (`con_rep -> step`). Reaching a `NULL` container means that seed's
   ancestry is fully resolved (path complete, acyclic, done). Revisiting an already-visited con_rep means
   the nodes between its first occurrence and now are a genuine cycle *within the seed's own ancestry*:
   compute the weakest edge among exactly those visited nodes' current winning candidates (same tiebreak
   order as the existing global walk: `evidence ASC, yr ASC NULLS FIRST, is_senior ASC,
   winning_assignment_opinion_id ASC`), record it in `_dtu_excluded_opinions`, re-resolve the newly-affected
   con_rep, and **restart the walk from the seed's own con_rep** — not from the cut point. This restart is
   required, not defensive-only: the live cycle dump shows a single cut can expose an entirely different,
   larger cycle involving previously-unvisited nodes (the `96e6...` case above), so the walk must be able
   to discover a second, disjoint-except-at-one-node cycle on its next pass.
4. Bounds retries with an iteration guard in the same style as the existing loop's (e.g. 1000 local cut
   attempts per seed permid) to catch non-convergence.
5. `classification_path` is assembled directly from the (now acyclic) walked chain, reversed — no separate
   recursive CTE over the whole tree needed.
6. Across multiple permids in one `seed` array, share a resolved-con_rep cache for the call so overlapping
   ancestries (e.g. two sibling species under the same genus) aren't re-walked redundantly.

**Alternatives considered:**

- *Persisted incremental union-find maintenance across calls* (track `lin_rep`/`con_rep` per permid
  between calls, patch them as opinions change, with real split/merge support): would get closer to
  sub-second, but requires a persisted "previous state" plus a way to know what changed since the last
  call (dirty tracking or a watermark on the three opinion tables) — a materially bigger, stateful
  redesign than this change's committed non-goal of no persisted cross-call state or new caller contract.
  The walk-based approach captures the dominant 92%+ of the cost with no persisted state at all.
- *Filter `_dtu_assign`'s candidate join by seed-reachability, keep the loop global*: doesn't address the
  actual cost driver — the loop's expense comes from the peel/verify step re-scanning `_dtu_node` every
  iteration (286s of 318s), not from the `_dtu_assign` build itself (7.6s). Filtering the build alone
  leaves the dominant cost untouched.
- *Keep the global loop but exit once the seed's own chain looks acyclic*: rejected — "does a cycle survive
  anywhere" is exactly what the expensive full-graph peel step computes; there's no cheaper way to check
  "just the seed's chain" without doing a walk equivalent to what this design already does, so a
  half-measure saves nothing.

### Decision 2: Apply the same design to `derive_linnaean()`/`derive_taxa_clades()`, profiling each independently before implementing

They share the unified peel-then-isolate cycle-loop shape (per `optimize-derive-taxa-cycle-loop`),
so the same walk-based redesign should apply directly. But `derive_taxa_clades()`'s graph is much smaller
(~2,525 clade-rank taxa, per that same change's own measurement) — its loop may already be cheap enough
that scoping isn't worth the added complexity/risk there. Task work should re-run the same instrumented-`DO`-block
profiling technique used in Context against each function before writing its scoped version, rather than
assuming the same ~90%-in-the-loop split holds everywhere.

Note: `derive_taxa_clades()`'s seed-equivalent parameter is named `permids`, not `seed` — a pre-existing
inconsistency this change should preserve, not rename (out of scope, not worth a signature churn here).

## Risks / Trade-offs

- **[Risk]** Overlapping/multi-round cycle clusters (confirmed live: up to 14 sequential cuts for one
  3-node cluster) could force many local walk-and-cut rounds for a seed permid whose ancestry passes
  through a heavily-tangled neighborhood → **Mitigation**: bounded by the iteration guard; even a
  worst-case ~15-round local resolution costs on the order of tens of single-con_rep-scale queries
  (milliseconds each) — nowhere near the full-graph loop's ~5.5s-per-iteration cost. Task work should
  specifically test a seed sitting inside one of the current tangled clusters (e.g. concept_permid
  `019ff8c0-91fb-721b-b44c-5057070506f9`'s cluster), not just an arbitrary/cycle-free permid.
- **[Risk]** This design leans on the "con_rep resolution is independent of other con_reps' state/order"
  invariant more heavily than the incremental fix that first established it (which only ever recomputed
  one con_rep per global iteration) → **Mitigation**: verification (see Migration Plan) must diff
  `derive_taxa(seed)` output against `derive_taxa(NULL)` filtered to the same permids across a battery of
  seeds chosen to hit every distinct cluster shape found in the live 53-cut dump, not just one permid.
- **[Risk]** Repeated single-con_rep queries (one per ancestor, plus retries) could carry more per-call
  query-planning overhead than one bulk join, eroding some of the win for unusually deep ancestries →
  **Mitigation**: walk length is bounded by taxonomic rank depth (tens of levels), not subtree size;
  measure during implementation and revisit only if profiling shows it matters.

## Migration Plan

Pure function-body change to `derive_taxa()`/`derive_linnaean()`/`derive_taxa_clades()` in
`postgresql/create_new.sql` — no schema or data migration, and (confirmed above) no changes needed to
`rebuild_taxa()`/`rebuild_linnaean()`/`rebuild_taxa_clades()`, since all three call only the `NULL` path.
Ship as a direct `CREATE OR REPLACE FUNCTION` replacement, consistent with how
`optimize-derive-taxa-cycle-loop` shipped. Rollback is a plain revert — no data to unwind.

**Validation before this is done:**

1. For a battery of seed permids — at least one with a fully cycle-free ancestry, one inside each distinct
   cluster shape from the live 53-cut dump (2-, 3-, 4-, 5-, 6-, and 8-node clusters all currently exist),
   and the previously rollback-tested scenario (that earlier session's live-tested *Rhombotrypella
   dvinensis* reassignment) — confirm `derive_taxa(seed)` output is byte-identical to the corresponding
   row(s) of `derive_taxa(NULL)`.
2. Confirm multi-element `seed` arrays (permids from unrelated parts of the tree; permids sharing a common
   ancestor) return correct, byte-identical rows for every element.
3. Time each seeded call; confirm low tens of seconds, not minutes.
4. Repeat 1-3 for `derive_linnaean(seed)` and `derive_taxa_clades(permids)` once each is implemented.
