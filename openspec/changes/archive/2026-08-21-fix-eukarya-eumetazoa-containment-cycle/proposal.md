## Why

While verifying the (now-archived) `fix-dt-assign-containment-cycle` change, fixing the 73 direct
self-referential concepts there unmasked a **different, much larger** class of containment cycle that was
previously hidden behind them. A systematic enumeration (`enumerate-containment-cycles.js`) found **18
distinct cycles** spanning the whole tree of life, from domain-level (`Eukarya`) down to
family/subfamily-level clades across unrelated groups (mammals, reptiles, fish, insects, mollusks). Unlike
the `_dt_assign` pooling gap, most of these are not a bug in assignment-opinion pooling — the raw
containment opinions are frequently legitimate, direct, non-cyclical placements
(`via_senior_lineage = true` for most cycle members). The actual mechanism is in the **concept-class
(synonymy) union-find**: a cladistic `unranked clade`/`unranked`-ranked lineage gets merged, via an
ordinary synonym-of opinion, into the same concept as a name that is *also*, separately and legitimately,
positioned somewhere in that lineage's own containment ancestry — folding a descendant's concept back
into one of its own ancestors.

This blocks **every** `derive_taxa()`/`derive_taxa_analyzed()` call against `pg_play`'s real data, scoped
seed or not — not just `derive_taxa(NULL)` — so no derivation currently succeeds at all against
production-scale data. See the `eukarya-eumetazoa-containment-cycle` memory for the full trace and the
validated fix experiment.

## What Changes

**Root cause and fix are now validated** (`test-unranked-exclusion.js`): `unranked`/`unranked clade` are
cladistic ranks that don't belong in Linnaean containment or synonymy positioning at all. Excluding any
candidate concept-class (synonymy) or assignment (containment) edge where either side's **lineage**
resolves to an `unranked`/`unranked clade` accepted rank — checked via `_dt_linmeta.accepted_rank_id`, not
the raw opinion's own subject/target permid (a permid-level check leaves a loophole where a concept's
senior spelling is unranked but the specific lineage-mate an opinion cites isn't) — takes the cycle count
from 18 down to 2.

- `_dt_con_winner`'s concept-class edge candidates exclude any edge where either lineage's accepted rank
  is `unranked`/`unranked clade`. This is the fix that actually matters for the original
  `Eukarya`/`Eumetazoa` cycle, since its containment edges were legitimate direct placements — the
  synonymy merge was the bug.
- `_dt_assign`'s containment edge candidates exclude any edge where the subject's or the containing
  permid's lineage accepted rank is `unranked`/`unranked clade`. Needed for the cycles where an unranked
  concept was genuinely on the containment side, not just the synonymy side.
- Lineage edges (`_dt_lin`, spelling variants) and `validity_opinions` are deliberately **not** touched —
  those represent identity/spelling and nomenclatural status, not classification. An unranked-clade name
  still needs correct lineage/spelling grouping; it's only excluded from claiming a spot in the Linnaean
  containment/synonymy hierarchy itself.
- A concept excluded down to no remaining candidates resolves the same way the `_dt_assign` self-reference
  fix already established: rootless (`NULL`), not an error — consistent with existing precedent.

**The 2 remaining cycles are now also resolved, by a second, independent fix in the same change.**
`Elasmotheriini`/`Elasmotheriina` and `Hyriidae`/`Hyriinae` involve **only** ordinary Linnaean ranks — no
unranked/unranked-clade concept is involved — so the exclusion above never touches them. Both were traced
to a gap the unranked fix doesn't address: `_dt_assign`'s senior-lineage branch
(`sl.lin_rep = cm.senior_lin`) has **no rank check of any kind** — nothing stops a coarser-ranked lineage
from being asserted as contained by a finer-ranked one. Both remaining cycles are exactly that: a rank
*inversion* (a family placed inside its own subfamily's merged concept; a tribe and its own subtribe
citing each other reciprocally), not a rank-*category* violation.

**Second fix, validated** (`test-rank-cardinality.js`): exclude an `_dt_assign` candidate when the
containing lineage's accepted rank is *finer* than the subject lineage's accepted rank
(`ccm.accepted_rank_id < lm.accepted_rank_id` is disqualifying; equal rank is allowed, since equal-rank
containment — e.g. one genus loosely containing another — is common and legitimate in this data). This
took the remaining 2 cycles to 0, with a **0.06% blast radius (220 of 357,439 concepts)** — smaller than
the unranked fix's own 0.26%. A stricter version (disallowing equal rank too) also fixed both cycles but
had a 0.68% blast radius, breaking common, legitimate equal-rank genus-in-genus placements; the
equal-rank-permitting version is the one this change adopts. Two other approaches were tried and rejected:
a "spelling-rank consistency" rule (10.6% blast radius — too blunt, since rerank/multi-rank-spelling
history is common and mostly benign) and MST-style weakest-evidence-link cycle breaking (small footprint,
but can preserve the *wrong* edge on evidence ties — it left `Hyriidae` backwards-contained by its own
subfamily in one run). See the `eukarya-eumetazoa-containment-cycle` memory for the full comparison.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `taxa-opinions`: the concept-grouping requirement gains an eligibility exclusion for
  `unranked`/`unranked clade` lineages (they cannot participate in concept-class synonymy merges used for
  containment purposes). The classification-pooling requirement gains **two** exclusions: the
  unranked/unranked-clade one, and a rank-cardinality one (a candidate is excluded when the containing
  lineage's accepted rank is finer than the subject's). The cycle-termination requirement is clarified: a
  cycle arising purely from unranked-clade participation, or purely from a rank inversion, no longer
  reaches the guard; a genuine cycle among concepts of compatible rank still raises.

## Impact

- `postgresql/create_new.sql` — `_dt_con_winner` (concept-class union-find candidate edges) and
  `_dt_assign` (containment candidate edges), filtered by `_dt_linmeta.accepted_rank_id` twice over: once
  for the unranked/unranked-clade category exclusion, once for the rank-cardinality (finer-contains-coarser)
  exclusion.
- `pg_play` — redeploy after both fixes; re-run `enumerate-containment-cycles.js` to confirm **zero**
  cycles remain.
- `migration_exploration/testing/` — `test-unranked-exclusion.js` and `test-rank-cardinality.js` are the
  two validated prototypes; promote both into `derive-taxa-analyzed.sql` first (same validation order as
  `fix-dt-assign-containment-cycle`), then port to `create_new.sql`.
- Independent of `fix-dt-assign-containment-cycle` (already archived, ported into `create_new.sql`) — both
  fixes here layer on top of it, not instead of it.
- With both fixes in place, a full `derive_taxa(NULL)` should complete against `pg_play`'s real data with
  zero containment-cycle errors for the first time — the goal `fix-dt-assign-containment-cycle` itself
  could not reach.
