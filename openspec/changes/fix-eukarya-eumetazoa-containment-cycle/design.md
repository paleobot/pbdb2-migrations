## Context

`_dt_con_winner` (concept-class/synonymy union-find edges) and `_dt_assign` (containment candidate
pooling) in `postgresql/create_new.sql` currently have no rank-based eligibility check at all — any
lineage, regardless of rank, can merge into any other via synonymy, and any lineage can be cited as a
container. `enumerate-containment-cycles.js` found 18 distinct cycles; `test-unranked-exclusion.js`
validated that excluding `unranked`(25)/`unranked clade`(24)-accepted lineages from both mechanisms —
checked via `_dt_linmeta.accepted_rank_id`, not the raw opinion's own subject/target permid — resolves 16
of them. See proposal.md for the full motivation and the two remaining, unrelated cycles
(`Elasmotheriini`/`-ina`, `Hyriidae`/`-inae`) tracked as a separate follow-up. `_dt_linmeta` (the
lineage-grouping stage) already runs before both `_dt_con_winner` and `_dt_assign` in the real pipeline,
so `accepted_rank_id` is available to both without reordering anything.

## Goals / Non-Goals

**Goals:**
- Exclude `unranked`/`unranked clade` lineages from the concept-class union-find and from the containment
  candidate pool, at the lineage-accepted-rank level (not the literal opinion's own subject/target
  permid — the naive permid-level version left a loophole, validated empirically: 18→4 vs. 18→2).
- Get `enumerate-containment-cycles.js` down to exactly the 2 known-remaining, unrelated cycles — not
  fewer (which would mean an over-broad filter masking something), not more (a regression).
- Quantify the fix's effect on currently-non-cyclic data before shipping, since this exclusion is global
  (every unranked-clade lineage, not just the 18 cycles' members) — see Risks below.

**Non-Goals:**
- Not root-causing or fixing the 2 remaining cycles (`Elasmotheriini`/`-ina`, `Hyriidae`/`-inae`) — pure
  Linnaean-rank pairs, a different bug, tracked as a separate follow-up per the proposal.
- Not touching lineage edges (`_dt_lin`, spelling variants) or `validity_opinions` — those are identity/
  spelling and nomenclatural-status relationships, not classification, and are unaffected by this change.
- Not changing `_dt_assign`'s self-reference exclusion (already shipped in
  `fix-dt-assign-containment-cycle`) — this layers on top of it, using the same "exclude before ranking,
  fall through to rootless if nothing remains" shape, not a different mechanism.
- Not attempting to make unranked-clade concepts *eligible again* under some narrower condition (e.g.
  "unless every alternative is also unranked") — the validated fix is a blanket exclusion; a narrower rule
  wasn't tested and isn't proposed here.

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

## Migration Plan

1. Implement the validated filter (from `test-unranked-exclusion.js`) in `derive-taxa-analyzed.sql`'s
   `_dt_con_winner` and `_dt_assign`, redeploy into `pg_play`.
2. Re-run `enumerate-containment-cycles.js` — confirm exactly 2 cycles remain
   (`Elasmotheriini`/`-ina`, `Hyriidae`/`-inae`), not more, not fewer.
3. Quantify blast radius on non-cyclic data: compare `containing_concept_permid` for every concept between
   the pre-unranked-fix pipeline (already has the `_dt_assign` self-reference fix) and the post-fix
   pipeline, restricted to concepts that were **not** downstream of any of the original 18 cycles. Report
   how many flip from a real container to `NULL`, and spot-check a sample.
4. Re-run `benchmark-derive-taxa.js`-style timing against `derive_taxa_analyzed(NULL)` — expect it to now
   complete (modulo the 2 remaining cycles still raising), confirming no unexpected performance cost from
   the added `_dt_linmeta` joins in `_dt_con_winner`/`_dt_assign`.
5. Port the identical change into `postgresql/create_new.sql`, redeploy the real `derive_taxa()` into
   `pg_play`, repeat steps 2-3 directly against it.
6. No data-at-rest migration, no schema change — same rollback story as the prior fix: revert the SQL text
   and redeploy if needed.
