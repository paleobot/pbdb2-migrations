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

**Explicitly out of scope, follow-up:** 2 of the 18 cycles (`Elasmotheriini`/`Elasmotheriina`,
`Hyriidae`/`Hyriinae`) involve **only** ordinary Linnaean ranks — no unranked/unranked-clade concept is
involved at all, so this fix will not touch them. They are a different, not-yet-root-caused bug and are
tracked as a follow-up rather than blocking this change. This change's own goal is "18 → 2," not "18 → 0."

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `taxa-opinions`: the concept-grouping requirement gains an eligibility exclusion for
  `unranked`/`unranked clade` lineages (they cannot participate in concept-class synonymy merges used for
  containment purposes), and the classification-pooling requirement gains the analogous exclusion for
  containment candidates. The cycle-termination requirement is clarified: a cycle arising purely from an
  unranked-clade lineage's synonymy/containment participation no longer reaches the guard; a genuine
  cycle among ordinarily-ranked concepts (like the 2 remaining) still raises.

## Impact

- `postgresql/create_new.sql` — `_dt_con_winner` (concept-class union-find candidate edges) and
  `_dt_assign` (containment candidate edges), both filtered by `_dt_linmeta.accepted_rank_id`.
- `pg_play` — redeploy after the fix; re-run `enumerate-containment-cycles.js` to confirm exactly the 2
  known-remaining cycles survive, not a surprise regression to more or fewer.
- `migration_exploration/testing/` — `test-unranked-exclusion.js` is the validated prototype; promote its
  approach into `derive-taxa-analyzed.sql` first (same validation order as `fix-dt-assign-containment-cycle`),
  then port to `create_new.sql`.
- Independent of `fix-dt-assign-containment-cycle` (already archived, ported into `create_new.sql`) — this
  fix layers on top of it, not instead of it.
- The 2 remaining cycles (`Elasmotheriini`/`-ina`, `Hyriidae`/`-inae`) are tracked as a separate follow-up,
  not part of this change's scope.
