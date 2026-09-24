## Context

`derive_taxa()` (`postgresql/create_new.sql`) has two places that currently treat validity status as an
absolute pre-filter, computed once and never revisited: `_dtu_linmeta`'s `eligible` CTE excludes any permid
whose winning `validity_opinions` row has `bars_candidacy = true` (today, only `nomen nudum`) from the
lineage-level accepted-spelling contest before ranking even happens; concept-level senior selection
(`_dtu_con_winner`/`_dtu_conmeta`) does not consult validity at all today. See `proposal.md` for the
Triceratops finding, and for why a validity *pre-filter* (the first fix attempted this session) regressed
Majungasaurus, Coelophysis, and dozens of other well-known genera whose invalidating opinions are decades
old and never formally reversed in `validity_opinions` — the reversal signal lives implicitly in continued
use elsewhere in the ledger, not as a competing validity opinion.

## Goals / Non-Goals

**Goals:**
- Replace both pre-filters with a single, shared **end-of-selection veto**: rank normally, ignoring
  validity; check the provisional winner; evict and rerank only if the winner's invalidating opinion truly
  outranks any sign elsewhere in the ledger that the name is still in legitimate use.
- Apply this identically to `nomen dubium`, `nomen nudum`, and `nomen vanum` via one dictionary flag
  (`invalidates`), per the confirmed ICZN reasoning that dubium/vanum are the same category and Classic's
  nomen-nudum tagging can't be trusted to have followed the Code's own availability test strictly.
- Leave the *existing* ranking criteria unmodified for any lineage/concept with no invalidated candidate —
  the veto must never touch a case validity was never a factor in. This is the key lesson from both
  rejected attempts this session: modifying the core tiebreak (reordering priority ahead of evidence)
  unconditionally is what caused real regressions against evidenced cases like Cathartidae/Vulturidae. (A
  narrower, conditional reordering turned out to still be necessary for concepts the veto genuinely
  narrows — see Decisions.)

**Non-Goals:**
- Not touching `_dtu_assign`/classification pooling, the unranked-clade exclusion, or the rank-cardinality
  exclusion.
- Not building a logging mechanism for veto evictions in this change (see Open Questions).
- Not counting assignment (classification) opinions as a reversal signal — confirmed with the user that
  placing a taxon in a hierarchy doesn't imply anyone resolved its dubious status; only root/name-class
  opinions on the permid itself and concept-class opinions *targeting* it (something else deferring to it)
  count.
- Not re-running the source migration — this only touches `derive_taxa()` and the dictionary seed.

## Decisions

**One `invalidates` boolean, not two (`bars_candidacy` retired).** Since both consumers now use the exact
same veto mechanism, and `nomen dubium`/`nomen nudum`/`nomen vanum` all receive identical treatment, a
single column is simpler than the two-column split attempted earlier in this session (which existed only
because that design still needed to distinguish "bars lineage candidacy absolutely" from "bars concept
seniority absolutely" — a distinction that no longer exists once both are veto-based).

**The veto is a static, one-pass determination, not an eviction loop.** Originally planned as a
per-lineage/per-concept eviction loop mirroring the existing containment-cycle-breaking loop's shape
(`<<cycle_break>> LOOP ... EXIT WHEN ...`) — each iteration recomputes the current top-ranked candidate,
checks it, evicts it if it fails the veto, and repeats until an iteration evicts nothing. **Built, tested
live, and rejected**: a reactive loop only ever inspects whoever is *currently* winning under criteria
(a)-(d), and Triceratops's own shape defeats it — Tatankaceratops (never invalidated) already wins the
concept outright without ever losing to Agathaumas or Monoclonius, so the loop never inspects either of
them, never sees that Agathaumas's disqualifying edge targets an invalidated lineage, and the concept
still resolves incorrectly. The fix must identify *all* invalidated candidates independent of any ranking
outcome, not just whoever the ranking currently surfaces.

Replaced with a static, one-pass determination computed directly from the raw ledger, before any ranking
happens: for every permid, compare its winning `validity_opinions` rating against the best of (a) its own
canonical introducing edge and (b) `_dtu_concept_target_best` (the best live, non-negating `concept`-class
opinion naming its lineage as target). This yields `_dtu_permid_invalidated` (a static per-permid boolean)
and `_dtu_lin_all_invalidated`/`_dtu_con_all_invalidated` (aggregate escape-hatch flags, per lineage/concept,
for the case where every member is invalidated). None of these depend on `_dtu_linmeta`/`_dtu_conmeta`'s
ranking output — they are pure functions of `_dtu_permid_edge`/`_dtu_valid`/`_dtu_concept_target_best`, so
there is no iteration to bound and no risk of the reactive loop's blind spot. `_dtu_linmeta`'s `eligible`
CTE and `_dtu_conmeta`'s `ranked` CTE then simply filter/deprioritize using these precomputed tables in a
single pass. `con_sources` (criterion (a)'s disqualifying-edge check) excludes edges whose target lineage
is in `_dtu_lin_invalidated` (unless the target concept is fully consumed by the escape hatch), for the
same reason as originally planned: deferring to an excluded lineage isn't a genuine deferral.

**Priority is conditionally promoted ahead of the mechanical tiebreak — found necessary during
verification, not part of the original plan.** Excluding invalidated candidates alone does not fix
Triceratops: once Agathaumas/Monoclonius are excluded, the survivors (Triceratops/Avaceratops/
Brachyceratops) tie on criterion (a) and fall through to criterion (b)'s `evidence DESC, yr DESC, id DESC`
mechanical tiebreak — the exact same recency-biased shape that caused the original bug, recurring one
level down, and it still picks the wrong (more recently opined, not actually senior) survivor. Fix: added
`_dtu_con_has_invalidated` (concepts where the veto excludes *some but not all* members — the only concepts
whose candidate pool is genuinely narrowed) and, only for those concepts, reordered the `ranked` CTE to
sort by criterion (c) (`original_yr ASC`, i.e. priority) ahead of criterion (b)'s mechanical tuple, instead
of after it. Concepts with zero invalidated members (Cathartidae/Vulturidae, Dipterus, Anthocyrtis) keep
the original (b)-before-(c) order untouched. The shipped `ranked` ORDER BY, in both `derive_taxa()` and
`derive_linnaean()`:

```sql
ranked AS MATERIALIZED (
    SELECT c.con_rep, c.lin_rep,
           row_number() OVER (PARTITION BY c.con_rep ORDER BY
               (li.lin_rep IS NULL OR aic.con_rep IS NOT NULL) DESC,      -- validity exclusion
               (cs.jr IS NULL) DESC,                                     -- (a) sink preference
               CASE WHEN hic.con_rep IS NOT NULL
                    THEN lm.original_yr END ASC NULLS LAST,              -- (c) promoted iff narrowed
               lm.acc_ev DESC, lm.acc_yr DESC NULLS LAST, lm.acc_id DESC, -- (b) mechanical tiebreak
               CASE WHEN hic.con_rep IS NULL
                    THEN lm.original_yr END ASC NULLS LAST,              -- (c) original position otherwise
               lm.original_permid ASC) AS rn                             -- (d)
    FROM _dtu_con c
    JOIN _dtu_linmeta lm ON lm.lin_rep = c.lin_rep
    LEFT JOIN con_sources cs ON cs.jr = c.lin_rep
    LEFT JOIN _dtu_lin_invalidated li ON li.lin_rep = c.lin_rep
    LEFT JOIN _dtu_con_all_invalidated aic ON aic.con_rep = c.con_rep
    LEFT JOIN _dtu_con_has_invalidated hic ON hic.con_rep = c.con_rep
)
```

**Counter-signal scope: root/name-class + concept-class-as-target only, not assignment.** Verified against
real data (Majungasaurus): its own root/name opinion is stuck at 1955, but a 2007 evidenced concept-class
opinion (`Majungatholus` synonymized into it) alone outranks the 1998 dubium opinions — assignment
opinions were not load-bearing for this case despite there being dozens of them (1955-2019); they were a
red herring from initially over-including plausible-looking supporting data. Classifying a taxon doesn't
imply anyone resolved doubt about its diagnosability, so assignment opinions are excluded from the
comparison on principled grounds, not just because this one case didn't need them.

**Never exclude below one candidate.** A lineage/concept must always resolve to *something* — this mirrors
the existing "exhausted lineage" graceful-degradation pattern for `never_accepted`, but validity alone can
never trigger full exhaustion under this design: `_dtu_lin_all_invalidated`/`_dtu_con_all_invalidated` are
escape hatches, not exclusions — once every member of a lineage/concept is invalidated, the veto stops
applying and normal ranking resumes among all members unfiltered (see the spec's "An exhausted lineage or
concept emits no rows" requirement).

## Risks / Trade-offs

- **[Risk, materialized]** A reactive eviction loop looked structurally simplest (parallel to the existing
  containment-cycle loop) but was actively wrong — it only inspects the currently-winning candidate and
  missed the Triceratops case entirely. → **Resolved**: replaced with the static, one-pass determination
  described above, verified by independently reconstructing the ranking from the persisted tables and
  confirming 100% agreement with the deployed output (0 mismatches across 474,598 concepts).
- **[Risk, materialized]** Excluding invalidated candidates alone was not sufficient — survivors could still
  tie into the same recency-biased mechanical tiebreak that caused the original bug. → **Resolved**: the
  conditional `_dtu_con_has_invalidated` priority promotion described above, scoped narrowly enough
  (719 concepts) to leave every concept with no invalidated member on its original ordering.
- **[Risk]** Performance: this is now the *third* significant addition to `derive_taxa()`'s cost profile
  (containment cycles, then this). → **Measured, not mitigated further**: `derive_taxa(NULL)` alone went
  from ~26s to 115.8s (~4.5x); the full `rebuild_taxa_full()` pipeline (which also runs the identically-fixed
  `derive_linnaean()`) went from ~14min to 59m4s (~4.2x). Confirmed acceptable with the maintainer as a
  batch/rebuild cost, not request-path latency; not optimized further in this change.
- **[Risk]** A permid could theoretically have a counter-signal opinion that is itself stale/superseded by
  yet another, later invalidating opinion, creating a genuine back-and-forth in the historical record. →
  **Mitigation**: out of scope for this change — the veto uses the *current winning* validity opinion only
  (already the highest-ranked one by the existing discipline), so this is no worse than how every other
  part of `derive_taxa()` already handles competing opinions.

## Migration Plan

Applied the dictionary column change and redeployed both `derive_taxa()` and `derive_linnaean()` to
`pg_play` directly (no source re-migration needed) — extended to `derive_linnaean()` beyond this change's
original scope after confirming live it has the identical `bars_candidacy` pre-filter bug shape, with the
maintainer's explicit go-ahead. Verified against both the in-memory temp tables and, after a full
`rebuild_taxa_full()` run, the actually-persisted `taxa`/`taxa_linnaean` tables. Then ported into
`postgresql/create_new.sql`, and dropped the now-fully-unused `bars_candidacy` column from `pg_play`. See
`tasks.md`.

## Open Questions

- Should veto exclusions be logged for human review, `cycle_cuts`-style? Doesn't change the outcome itself,
  safely deferrable to a follow-up.
- A fresh spot-check against `pg_classic`'s `taxon_trees` surfaced three unrelated mismatches (Allosaurus→
  "Antrodemus", Diplodocus→"Atlantaurus", Brontosaurus→"Atlantaurus"). Investigated and confirmed
  pre-existing and out of scope: none of the six names involved carry any nomenclatural status, and
  Allosaurus/Antrodemus have a genuine mutual, fully-unevidenced dispute (13 opinions one direction, 8 the
  other, spanning 1920-2004) — structurally identical to the already-accepted Anthocyrtis/Anthocyrtella
  case, i.e. the same "mechanical tiebreak is an unreliable senior-signal for genuine multi-way ties"
  weakness this change deliberately did not touch. Candidate for a separate future investigation.
