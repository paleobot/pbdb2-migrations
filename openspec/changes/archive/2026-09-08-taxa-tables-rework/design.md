## Context

`derive_taxa()`, `derive_taxa_clades()`, and `derive_clade_attachments()` (`postgresql/create_new.sql`)
already share one shape: build candidate assignment edges from `assignment_opinions` scoped to a
domain, pick one winner per concept by `ORDER BY evidence DESC, COALESCE(pubyr, ref.pubyr) DESC, id
DESC`, materialize a per-concept node table, then loop — rebuild the node table excluding
previously-cut opinions, find concepts whose own containment chain returns to themselves, cut the
single globally-weakest winning edge among this round's genuine cycle members, repeat until none
remain (bounded at 1000 iterations) — logging every cut to the shared `cycle_cuts` table keyed by
`source`. `derive_taxa()` layers a rank-cardinality tiebreak in front of this loop; `derive_taxa_clades()`
has no such tiebreak available (clade ranks don't discriminate) and instead breaks cycle-cut ties
toward edges borrowed via synonym-pooling (`is_senior = false`) before falling back to `opinion_id`.
Both derivations were built with only the loop they needed for the cycles their own domain actually
produces — `derive_taxa_clades()`'s loop, and the `is_senior` tiebreak within it, were each added after
a specific cycle was found in real `pg_play` data (Eukarya/Eumetazoa; Ornithopoda/Clypeodonta), not
speculatively. See [proposal.md](proposal.md) for why a fourth, combined derivation is wanted instead
of continuing to extend the three separately.

## Goals / Non-Goals

**Goals:**
- A single `derive_taxa()` that resolves Linnaean and clade `assignment_opinions`/`validity_opinions`/
  `name_opinions` together, producing one concept hierarchy with one `containing_concept_permid` per
  concept, regardless of which side of the rank boundary either endpoint falls on.
- Loop-break machinery robust enough that merging two previously-separated domains — which reopens
  cycle shapes neither `derive_taxa()` nor `derive_taxa_clades()` had to handle alone — doesn't require
  another live-data fire drill before it's trustworthy.

**Non-Goals:**
- Sharing SQL/helper logic between the new `derive_taxa()` and `derive_linnaean()`/
  `derive_taxa_clades()`. Per the proposal, the latter two stay byte-for-byte behaviorally unchanged;
  this design treats them as opaque, untouched dependencies, not refactor targets.
- Preserving single-derivation many-to-many containment. `taxa_attachments` continues to be the
  many-to-many record; the new `taxa` is a best-effort single-parent tree, same shape as today's `taxa`.
- Tuning the exact tiebreak thresholds to real data. This design proposes a starting rule order (see
  Decisions and Open Questions); empirical adjustment during implementation is expected.

## Decisions

**1. Independent, self-contained function — no shared helpers with the other three.**
The new `derive_taxa()` gets its own temp-table family (`_dtu_*`, for "derive taxa unified") rather than
parameterizing or extending `_dt_*`/`_dtc_*`. This matches existing precedent: `derive_taxa_clades()`
itself was written as an independently-prefixed parallel copy of `derive_taxa()`'s pattern rather than a
shared, parameterized version, when it was introduced. Alternative considered: factor the
candidate/winner/cycle-break loop into a shared parameterized function all three (four) derivations
call. Rejected — the user has explicitly asked that `taxa_linnaean`/`derive_linnaean()` and
`taxa_clades`/`derive_taxa_clades()` stay unchanged, and this repo's history shows each derivation's
loop has needed its own domain-specific tiebreak fix; a shared implementation would make each fix a
four-way behavior change instead of a one-way one.

**2. Candidate universe: raw opinions, no rank-boundary exclusion.**
The new `derive_taxa()` scans `name_opinions`/`assignment_opinions`/`validity_opinions` directly (the
same source tables `derive_linnaean()` and `derive_taxa_clades()` each scan), but omits the
ranked-vs-unranked exclusion filter both of those apply during concept-grouping and classification
pooling. Every candidate edge — Linnaean-Linnaean, clade-clade, and cross-boundary — competes in the
same winner-selection pass. This is what actually reunifies the two domains; composing from the
already-resolved `taxa_linnaean`/`taxa_clades`/`taxa_attachments` outputs was considered and rejected,
since re-deriving from raw opinions is what the proposal calls for ("resolves opinions together," not
"stitches together already-resolved tables") and avoids compounding each secondary table's own
rank-boundary assumptions into the combined result.

**3. Single-parent output; `taxa_attachments` remains the full record.**
Cross-boundary containment candidates that today are diverted to `clade_attachments` (soon
`taxa_attachments`) because they can't be single-parent are, in the new `derive_taxa()`, just more
candidates in the same per-concept `ORDER BY evidence DESC, yr DESC, id DESC` winner pick used for
same-domain candidates. The new `taxa` therefore picks one best edge even across the boundary, matching
the original `taxa`'s single-parent shape. Nothing is lost overall: `taxa_attachments` keeps deriving
the complete many-to-many picture independently; `taxa`'s single edge is a resolved simplification for
callers who need exactly one parent per concept.

**4. Two-layer cycle defense from the start: height-based rank-cardinality exclusion, then MST-style
weakest-edge cut loop.** Both defenses `derive_linnaean()` accumulated over time — a rank-cardinality
exclusion filter first (a containing lineage strictly finer than its subject is excluded from the
candidate pool entirely, so it never wins and never needs cutting), then the iterative cut-weakest-edge
loop as a safety net — are included from the first version of the new function, rather than starting
with one and adding the other after a cycle turns up in `pg_play` data. The existing exclusion filter in
`derive_linnaean()` compares `taxonomy_ranks.id` directly, which is only safe there because it never
evaluates a candidate touching `unranked`/`unranked clade` (excluded upstream by a separate filter this
design drops — decision 2). The new `derive_taxa()` has no such upstream exclusion to lean on, so its
version of this filter compares `taxonomy_ranks.height` instead (`NULL` for `unranked`/`unranked clade`,
monotonic with coarseness for every real rank — see the column's own comment in `create_new.sql`), and
treats either side having a `NULL` height as "no comparison possible, don't exclude" — i.e. unranked
lineages form their own cardinality tier that the finer/coarser check simply doesn't apply to, matching
`derive_taxa_clades()`'s own reasoning for why it has no rank-cardinality check at all. Rationale for
including both defenses from the start: the combined graph is strictly larger than either domain alone
(Linnaean ∪ clade ∪ every cross-boundary edge), so cycle shapes that were structurally impossible before
(the domains lived in different tables) are possible from the first run, not a later edge case.

**5. Cycle-cut tiebreak order: reuse `evidence ASC, yr ASC NULLS FIRST, is_senior ASC, opinion_id ASC`
unchanged.** `derive_linnaean()` and `derive_taxa_clades()` already use the identical weakest-edge
`ORDER BY` within their cut loops — rank-cardinality is not a cut-loop tiebreak in either; it operates
earlier, as a candidate-exclusion filter during classification pooling (decision 4), preventing a
rank-inverted edge from ever becoming a winning candidate in the first place. The new `derive_taxa()`
reuses the same cut-loop order verbatim rather than inventing a new composition — there is only one
existing precedent for the cut order, not two competing ones, so there is nothing to compose. What *is*
new is decision 4's height-based exclusion filter running over the merged candidate pool, including
edges that cross the rank boundary.

**6. Audit logging reclaims `source = 'taxa'`.**
`cycle_cuts` rows from the renamed Linnaean derivation move to `source = 'taxa_linnaean'` as part of the
rename in this same change; the new combined `derive_taxa()` writes its cuts under `source = 'taxa'`,
so the audit table's `source` values continue to name the table each row's cuts apply to.

**7. Cycle-member detection: iterative peeling, not the per-node bounded walk.** (Added after real-data
testing — see Risks.) `derive_linnaean()`/`derive_taxa_clades()` find genuine cycle members by walking
up from *every* non-root node to depth 10000, checking for a self-revisit. That's cheap when a broken
cycle is small and deep in the tree (their only real cases so far), but catastrophic once a broken
cycle sits at the *root* of a large subtree — confirmed against real `pg_play` data: dropping the rank
exclusions (decision 2) surfaces a genuine 3-concept cycle among basal unranked clades
(Eukarya/Proepitheliozoa/Euradiculata), and because it sits at the root of the entire eukaryote subtree,
~283,000 of ~357,000 concepts are its descendants — the per-node walk was on the order of 283,000 × 10000
row explorations and never finished in practice. `derive_taxa()` instead uses iterative peeling (Kahn's
algorithm run in reverse: repeatedly delete any node whose own parent isn't itself still present; the
fixed point is exactly "cycle member(s) plus everything permanently downstream," O(V) per round) — the
same approach already prototyped in `migration_exploration/testing/find-containment-cycle.js` for this
exact problem, just never adopted into a production derive function before now. A single bounded walk
from one arbitrary survivor is then enough to isolate that one cycle's actual members (every survivor's
parent is itself a survivor by the peeling invariant, so the walk is guaranteed to hit a repeat quickly).
Alternatives considered: raising the depth cap (doesn't help — the walk is already unbounded in practice
for a root-level cycle, since it re-explores from every descendant independently); deduplicating visited
nodes within the walk (would require rewriting the same per-node-walk shape derive_linnaean()/
derive_taxa_clades() use, more invasive than switching algorithms outright). This function only isolates
and cuts one cycle's weakest edge per iteration, not the global weakest across every simultaneously-
existing cycle the old walk found at once — correct either way since the loop already iterates to a
fixed point regardless, just possibly one more iteration per additional disjoint cycle.

**8. No GiST index on the new `taxa.classification_path`.** (Added after real-data testing — see Risks.)
Confirmed the depth-70 chains from decision 7 produce `classification_path` values up to 2,589
characters, which a GiST index page cannot hold (`rebuild_taxa()`'s upsert failed outright:
`failed to add item to index page in "taxa_path_idx"`). `taxa_linnaean` keeps its own GiST index
unchanged — its chains stay within Linnaean's ~15-20 real ranks, well under any page limit. For the new
`taxa`, the column and its data are kept, only the specialized index is dropped; ancestor/descendant
queries over the combined hierarchy's deep chains should recurse over `containing_concept_permid`
instead (the same pattern this function's own cycle detection already uses). Alternatives considered:
re-encoding path segments with a shorter identifier than the full UUID (would shrink paths enough to
fit, but diverges from how `taxa_linnaean` encodes its own path and needs a stable short-id mapping —
more invasive for a problem the recursive-query alternative already solves without touching the schema
further).

## Risks / Trade-offs

- [Merging two previously-separated domains reopens containment-cycle classes neither `derive_taxa()`
  nor `derive_taxa_clades()` was individually built to handle, and at a larger scale] → Mitigation:
  ship both defense layers (rank-cardinality + weakest-edge loop) from the first version instead of
  reactively, and keep logging every cut to `cycle_cuts` so cuts stay inspectable the way they are today.
- [Collapsing many-to-many cross-boundary attachments into a single-parent `taxa` loses the losing
  edges at the `taxa` level] → Mitigation: `taxa_attachments` remains the authoritative many-to-many
  record; document plainly that consumers needing every attachment must query `taxa_attachments`, not
  `taxa`.
- [Globally-weakest-edge cuts can occasionally produce a directionally "backwards" placement on close
  evidence ties — already an accepted caveat for `derive_taxa_clades()`'s clade-only cycles] → Accepted,
  consistent with existing precedent; the merged graph likely produces more such ties than either domain
  alone, simply because there are more candidate edges in play.
- [A third (fourth) independent copy of the candidate/winner/cycle-break SQL pattern increases
  maintenance surface — a future tiebreak fix to one derivation, like the recent pooled-candidate cut
  fix, won't automatically apply to the others] → Accepted trade-off, per the explicit decision (1) to
  leave `derive_linnaean()`/`derive_taxa_clades()` untouched rather than share code with the new function.
- [Confirmed, not hypothetical: `derive_taxa(NULL)` takes ~12 minutes (53 cut iterations) against the
  full real dataset, versus ~17s for `derive_linnaean()` alone] → The per-node bounded walk this
  function's cycle detection originally reused could not finish in practice at all once a broken cycle
  landed at the root of a large subtree (decision 7); switching to iterative peeling fixed correctness,
  but each of the 53 cut iterations still pays for rebuilding `_dtu_assign`/`_dtu_node` from a fresh full
  join over `assignment_opinions`, and peeling itself needed ~70 rounds per iteration for a long stretch
  before visible progress resumed. No further optimization attempted yet — flagged as an open question
  (does ~12 minutes for a full rebuild need to get faster, e.g. by not rebuilding the full candidate
  pool every single cut, or is that acceptable for a cold-path batch operation?) rather than silently
  decided.
- [Confirmed, not hypothetical: the same depth-70 chains broke `rebuild_taxa()`'s upsert outright — a
  GiST index page could not hold a 2,589-character `classification_path` value] → Fixed per decision 8:
  drop the GiST index on the new `taxa.classification_path` (column and data unaffected); ancestor/
  descendant queries over the combined hierarchy's deep chains recurse over `containing_concept_permid`
  instead of relying on an ltree containment index.

## Migration Plan

1. In `create_new.sql`: rename `taxa` → `taxa_linnaean`, `derive_taxa()` → `derive_linnaean()`,
   `rebuild_taxa()` → `rebuild_linnaean()`, their indexes/constraints, and their `cycle_cuts` source
   value (`'taxa'` → `'taxa_linnaean'`).
2. Rename `clade_attachments` → `taxa_attachments` and its indexes/constraints (function names
   `derive_clade_attachments()`/`rebuild_clade_attachments()` stay as-is per the proposal).
3. Add the new `taxa` table and `derive_taxa()`/`rebuild_taxa()` functions, with their own `_dtu_*` temp
   tables, writing `cycle_cuts` rows under the now-vacated `source = 'taxa'`.
4. Update `rebuild_taxa_full()` to build `taxa_linnaean` → `taxa_clades` → `taxa_attachments` → new
   `taxa`, last so its `cycle_cuts` rows are easiest to diff against the other three's during validation
   (the new `taxa` re-derives from raw opinions and doesn't structurally depend on the other three's
   output, but ordering it last keeps the validation step in (5) straightforward).
5. Rebuild `pg_play` from the updated `create_new.sql`, run `rebuild_taxa_full()` end to end, and sanity
   check `cycle_cuts` counts: expect the new `source = 'taxa'` cut count to be at or above the sum of
   `taxa_linnaean` + `taxa_clades` + `taxa_attachments` cuts, since the merged candidate pool is a
   superset. A materially lower count would indicate the merged pass is failing to find cycles it should.
6. No live production data depends on the current names yet (schema is still authored and validated in
   `create_new.sql`/`pg_play`, not run against a cut-over target) — rollback is reverting the SQL
   changes, not a data migration.

## Open Questions

- The tiebreak layering in Decision 5 (rank-cardinality → `is_senior` → `opinion_id`) is a starting
  hypothesis, not validated against real `pg_play` cycle data yet. Both `derive_taxa()`'s and
  `derive_taxa_clades()`'s own tiebreak rules were each refined more than once after seeing actual
  cycles in data (Eukarya/Eumetazoa, Ornithopoda/Clypeodonta); expect this design's ordering to need
  the same kind of empirical adjustment once implemented, without that adjustment changing the overall
  approach.
