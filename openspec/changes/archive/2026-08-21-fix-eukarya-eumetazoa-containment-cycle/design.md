## Context

`_dt_con_winner` (concept-class/synonymy union-find edges) and `_dt_assign` (containment candidate
pooling) in `postgresql/create_new.sql` currently have no rank-based eligibility check at all — any
lineage, regardless of rank, can merge into any other via synonymy, and any lineage can be cited as a
container. `_dt_assign`'s senior-lineage branch (`sl.lin_rep = cm.senior_lin`) in particular has **no
rank check of any kind** today; only the separate equal-rank-borrowing branch checks rank, and only for
equality. `enumerate-containment-cycles.js` found 18 distinct cycles. Two independent gaps explain all 18:

1. **Unranked/unranked-clade participation** (16 of 18 cycles) — `test-unranked-exclusion.js` validated
   that excluding `unranked`(25)/`unranked clade`(24)-accepted lineages from `_dt_con_winner` and
   `_dt_assign` — checked via `_dt_linmeta.accepted_rank_id`, not the raw opinion's own subject/target
   permid — resolves these 16.
2. **Rank inversion** (the remaining 2: `Elasmotheriini`/`Elasmotheriina`, `Hyriidae`/`Hyriinae`) — both
   involve only ordinary Linnaean ranks, so gap 1's fix never touches them. `test-rank-cardinality.js`
   validated that excluding an `_dt_assign` candidate when the containing lineage's accepted rank is
   *finer* than the subject's resolves both, with a smaller blast radius (0.06%) than gap 1's own fix
   (0.26%) — see Decisions below for why, and for two rejected alternatives.

`_dt_linmeta` (the lineage-grouping stage) already runs before both `_dt_con_winner` and `_dt_assign` in
the real pipeline, so `accepted_rank_id` is available to both without reordering anything, for either fix.

## Goals / Non-Goals

**Goals:**
- Exclude `unranked`/`unranked clade` lineages from the concept-class union-find and from the containment
  candidate pool, at the lineage-accepted-rank level (not the literal opinion's own subject/target
  permid — the naive permid-level version left a loophole, validated empirically: 18→4 vs. 18→2).
- Exclude rank-inverted candidates from `_dt_assign`'s pool (containing lineage finer-ranked than subject
  lineage), permitting equal rank, at the lineage-accepted-rank level.
- Get `enumerate-containment-cycles.js` down to **zero** cycles — not fewer (impossible, but would
  indicate a bug in the check itself), not more (a regression from either fix).
- Quantify each fix's effect on currently-non-cyclic data before shipping, since both exclusions are
  global (every unranked-clade lineage, or every rank-inverted candidate, not just the 18 cycles'
  members) — see Risks below.

**Non-Goals:**
- Not touching lineage edges (`_dt_lin`, spelling variants) or `validity_opinions` — those are identity/
  spelling and nomenclatural-status relationships, not classification, and are unaffected by this change.
- Not changing `_dt_assign`'s self-reference exclusion (already shipped in
  `fix-dt-assign-containment-cycle`) — both fixes here layer on top of it, using the same "exclude before
  ranking, fall through to rootless if nothing remains" shape, not a different mechanism.
- Not attempting to make unranked-clade concepts *eligible again* under some narrower condition (e.g.
  "unless every alternative is also unranked") — the validated fix is a blanket exclusion; a narrower rule
  wasn't tested and isn't proposed here.
- Not applying the rank-cardinality check to `_dt_con_winner` (concept-class/synonymy edges) — only
  `_dt_assign` (containment). Synonymy is not inherently a coarser-to-finer relationship the way
  containment is, so "rank cardinality" isn't a meaningful constraint there; not tested and not proposed.
- Not building a general graph-based cycle-detection-and-repair mechanism (considered and rejected — see
  Decisions: an MST-style weakest-evidence-link approach was prototyped and can preserve the *wrong* edge
  on evidence ties, producing a technically acyclic but taxonomically backwards result).

## Decisions

**Filter on `_dt_linmeta.accepted_rank_id`, not the raw opinion's own subject/target permid rank.**
Validated by direct A/B test: filtering by the literal permid cited in each `name_opinions`/
`assignment_opinions` row got 18→4; filtering by the *lineage's* accepted rank got 18→2. The gap is a
concept whose senior/accepted spelling is unranked but whose winning opinion happens to cite a different,
non-unranked lineage-mate as subject — a permid-level check misses this because it's checking the wrong
thing (a specific spelling variant) instead of the thing that actually matters (what the lineage as a
whole is accepted as).
- *Alternative considered:* filter by the *concept's* accepted rank (post-merge) instead of the lineage's.
  Rejected because `_dt_con_winner` runs *before* concepts exist — filtering its own candidate edges by a
  property computed *from* those edges is circular. Lineage-level rank is available beforehand (from
  `_dt_linmeta`, which only depends on `_dt_lin`) and is the right level: a concept-class edge is fundamentally
  between two *lineages*, and each lineage's accepted rank is already a stable, prior fact by the time
  `_dt_con_winner` runs.

**Apply the exclusion in both `_dt_con_winner` and `_dt_assign`, not just one.** Validated necessary:
excluding only from `_dt_assign` would not have fixed the original `Eukarya`/`Eumetazoa` cycle at all,
since its containment edges were legitimate direct placements (`via_senior_lineage = true`) — the actual
break was in the concept-class merge. Some of the other 17 cycles, conversely, did involve unranked
concepts winning through `_dt_assign`'s equal-rank borrowing branch. Both mechanisms needed the fix; ran
the experiment both ways (see memory) before committing to applying it to both.

**Reuse the existing rootless-on-exhaustion shape, don't add a new outcome.** When an unranked-clade
lineage's own placement candidate is excluded and nothing else remains, or when every candidate available
to *contain* some other concept turns out to be unranked and gets excluded, the result is
`containing_concept_permid = NULL` — the same fallback `_dt_assign`'s self-reference fix already
established and that the "asserted rootless" (`parent_spelling_no = 0`) case already used. No new
semantics to design; this is a straightforward extension of an already-shipped pattern.

**Validate against `derive_taxa_analyzed()` first, same order as the prior fix.** Port
`test-unranked-exclusion.js`'s validated filter into `derive-taxa-analyzed.sql`, redeploy into `pg_play`,
re-run `enumerate-containment-cycles.js` to confirm exactly 2 cycles remain, then port the identical
change into `_dt_con_winner`/`_dt_assign` in `postgresql/create_new.sql`.

**Rank cardinality: exclude on inversion, permit equality — four approaches compared empirically.**
Prompted by asking why rank cardinality (a container must not be finer-ranked than what it contains)
isn't already a hard rule. Four candidate fixes for the 2 remaining cycles were built and measured against
the same blast-radius methodology as the unranked fix (compare before/after `containing_concept_permid`
for every concept **not** downstream of any of the original 18 cycles):

| Approach | Blast radius | Fixes both cycles? | Verdict |
|---|---|---|---|
| Spelling-rank consistency (exclude a candidate whose own cited spelling's rank differs from its lineage's *current* accepted rank) | 10.6% (38,091 / 359,576) | Yes | **Rejected** — rerank history (a lineage having multiple historical ranks) is common and mostly benign; this punishes all of it, not just the pathological cases. |
| MST-style weakest-evidence-link cycle breaking (detect real cycles, drop the lowest-evidence/pubyr/id edge per cycle, iterate) | ~0 (2 opinions excluded) | Yes, but unreliably | **Rejected** — on an evidence/pubyr tie (exactly the `Elasmotheriini`/`Elasmotheriina` case), the choice of which edge to drop is arbitrary; one run left `Hyriidae` (family) contained by its own subfamily `Hyriinae` — acyclic but taxonomically backwards. |
| Rank cardinality, strict (`containing.accepted_rank_id > subject.accepted_rank_id` required) | 0.68% (2,421 / 357,439) | Yes | **Rejected** — breaks common, apparently-legitimate equal-rank containment (one genus placed within another). |
| **Rank cardinality, non-strict (`containing.accepted_rank_id >= subject.accepted_rank_id` required)** | **0.06% (220 / 357,439)** | **Yes** | **Adopted** — smaller footprint than the unranked fix itself (0.26%), and — unlike MST — targets the actual violation (a genuine inversion) rather than an evidence tiebreak, so it reliably keeps the correct edge. |

The adopted rule: `_dt_assign` excludes a candidate when `ccm.accepted_rank_id IS NOT NULL AND
ccm.accepted_rank_id < lm.accepted_rank_id` (containing lineage strictly finer than subject lineage).
Uses the same `lm`/`ccm` (`_dt_linmeta`) joins `_dt_assign` already has for the unranked-rank and
self-reference exclusions — no new joins.
- *Why permit equal rank:* the strict-inequality version's blast radius was dominated by genus-contained-
  by-genus placements (e.g. `Cyclomactra` under `Mactra`) that are evidently a normal, if informal, PBDB
  convention outside the dedicated equal-rank-borrowing branch — not bugs. Only a true inversion (finer
  containing coarser) is the actual anomaly both remaining cycles exhibit.
- *Why this didn't need graph-based cycle detection:* both remaining cycles turned out to be *local*
  violations — a single containment edge's own two endpoints, compared directly, already reveal the
  problem (subject coarser than container) without needing to trace any multi-edge path. This is why a
  static per-candidate filter suffices here, same as the unranked-rank fix, even though the earlier
  spelling-rank-consistency attempt (also local, but comparing the wrong two things) failed.

## Risks / Trade-offs

- **[Risk] This is a blanket exclusion, not scoped to the 18 cycles — it affects every unranked-clade
  lineage in the dataset, including ones that were never part of a cycle.** Quantified directly: **23,100
  of 927,497 live `assignment_opinions` rows (≈2.5%)** name an unranked/unranked-clade concept as
  container, and **6,254** have an unranked/unranked-clade subject. Every one of those placements either
  disappears (subject side: that lineage's own direct placement is excluded) or falls through to a
  different candidate/rootless (containing side). This is a large blast radius relative to the 18 cycles
  it was found from. → **Mitigation:** this is the direct, expected consequence of the stated position
  that unranked ranks are intrinsically outside Linnaean containment — not a side effect to work around,
  but the actual shape of the fix. Still, ship it with eyes open: task 2 below quantifies exactly how many
  *currently-non-cyclic* concepts newly become rootless (as opposed to concepts that were already
  downstream of one of the 18 cycles and would have become rootless anyway), so the maintainer sees the
  real number before this is considered done, not just the cycle count.
- **[Risk] `classification_path` changes for every concept whose path used to route through an
  unranked-clade concept**, even outside the 18 cycles, since that ancestor now resolves to `NULL` instead
  of continuing upward. → **Mitigation:** inherent to the fix's premise (unranked-clade concepts were
  never legitimate Linnaean path segments); flagged for the same task 2 quantification, not a separate
  concern.
- **[Risk] Two-hop rank chains** (a Linnaean-ranked concept whose *only* placement is via an unranked-clade
  intermediate, which is now excluded, and which has no other candidate) become rootless even though they
  are not unranked themselves and were not part of any cycle. → **Mitigation:** same as above — this is
  exactly the "falls through to rootless" outcome the design intends when no genuine alternative exists;
  worth spot-checking a sample in task 2 to confirm this is the common shape of the 2.5%, not something
  stranger.
- **[Risk] Measured performance regression: ~17s → ~26s (≈53% slower) for a full `derive_taxa(NULL)`**,
  most likely from the two new `_dt_linmeta` joins added to `_dt_con_winner` (checked on every
  concept-class candidate edge, a large table) plus `_dt_assign`'s rank comparison. → **Mitigation**: not
  optimized here — 26s absolute is still trivial next to the original 30+ minute bug this whole
  investigation started from, and `derive_taxa()`/`rebuild_taxa()` are used for batch rebuilds, not
  per-request latency. Flagged for the maintainer's awareness, not treated as blocking; worth
  reinvestigating with the same `MATERIALIZED`/index-tuning approach as the original performance fix if
  the corpus grows enough that 26s becomes material.
- **[Risk] The rank-cardinality exclusion could reject a genuinely valid future case** where a coarser
  taxon really is (per some future opinion) contained by a finer one — e.g. if paleontological practice
  ever treats that as legitimate the way equal-rank genus-in-genus containment is. → **Mitigation**: the
  0.06% measured blast radius, spot-checked, showed only genuine inversions (e.g. `Diodontoidea`
  superfamily under `Tetraodontidae` family) — no evidence of a legitimate coarser-under-finer pattern in
  the current dataset; if one is ever found, it would need its own carve-out, the same way equal-rank
  borrowing already is one.

## Migration Plan

1. Implement the validated unranked-rank filter (from `test-unranked-exclusion.js`) in
   `derive-taxa-analyzed.sql`'s `_dt_con_winner` and `_dt_assign`, redeploy into `pg_play`.
2. Implement the validated rank-cardinality filter (from `test-rank-cardinality.js`, non-strict `>=`
   version) in the same `derive-taxa-analyzed.sql`'s `_dt_assign`, redeploy into `pg_play`.
3. Re-run `enumerate-containment-cycles.js` — confirm **zero** cycles remain.
4. Quantify blast radius on non-cyclic data for each fix independently: compare `containing_concept_permid`
   for every concept between the pre-fix pipeline (self-reference exclusion only) and each post-fix
   pipeline, restricted to concepts that were **not** downstream of any of the original 18 cycles. Report
   how many flip from a real container to `NULL` or to a different container, and spot-check a sample for
   each.
5. Re-run `benchmark-derive-taxa.js`-style timing against `derive_taxa_analyzed(NULL)` — expect it to now
   **complete successfully** (no remaining cycles), confirming no unexpected performance cost from the
   added `_dt_linmeta` comparisons.
6. Port both changes into `postgresql/create_new.sql`, redeploy the real `derive_taxa()` into `pg_play`,
   repeat steps 3-5 directly against it.
7. No data-at-rest migration, no schema change — same rollback story as the prior fix: revert the SQL text
   and redeploy if needed.
