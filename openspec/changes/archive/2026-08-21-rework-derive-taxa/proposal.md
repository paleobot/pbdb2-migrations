## Why

`derive_taxa()` in `postgresql/create_new.sql` predates several ledger-model decisions already recorded
in `docs/classic-taxa-opinions.md` §9.8.4.1/§9.8.4.2, and live inspection confirms it actually violates
requirements the `taxa-opinions` spec already states: it returns multiple rows per permid instead of
exactly one (spec: "derive_taxa() is total over minted permids"), and excludes never-accepted
misspellings by row rather than by permid, so a misspelling's own `root` row can still let it win the
accepted-spelling contest its introducing edge should have barred it from (spec: "Accepted spelling...
excluding subjects whose minting reason is never_accepted"). It also has no implementation at all for
the nomen-nudum candidacy bar, the empty-lineage/-concept cascade that bar creates, or a defined
tie-break for `original_permid` when a lineage has no unique root under root-only identity — all decided
in §9.8.4.2 but never written into the spec. This is tracked as the largest remaining piece of the
pbdb2 taxa/opinions redesign (`classic-taxa-opinions.md` §10.6, item B1) and blocks B4
(`migrate-taxa-opinions`) from being able to rely on `derive_taxa()` at all.

A second, related gap surfaced during review of the above: `derive_taxa()`'s lineage/concept
union-finds treat every current, non-removed `lineage`- or `concept`-class `name_opinions` edge as
unconditionally true and union all of them, with no per-subject ranking of competing edges — unlike
`assignment_opinions`/`validity_opinions`, which already run a ranked contest per subject. So a later,
better-evidenced opinion can never outrank or sever an earlier lineage/concept claim; the only way to
remove an edge from the graph is retraction, which is deliberately reserved for correcting transcription
errors, not adjudicating legitimate scientific disagreement. GitHub issue
[paleobot/pbdb2-dev#51](https://github.com/paleobot/pbdb2-dev/issues/51) names this as the general
gap — no equivalent to Classic's single ranked opinion pool per identity — via a concrete case: a 1990
opinion calls "Myliobatus" a misspelling of "Myliobatis" (a `lineage`-class edge); a 2020,
well-evidenced paper argues they are distinct genera, but has no way to win — it isn't a transcription
correction, so retraction doesn't apply, and even a competing lineage-class opinion from Myliobatus
would just add a second edge into the same unconditional union, not displace the first.

These two gaps were originally tracked as separate changes (`rework-derive-taxa` and
`contest-lineage-concept-edges`), but review found them touching the same `derive_taxa()` body closely
enough — including two independent edits to the same "Accepted spelling" requirement, and a ranking
primitive (`_dt_permid_edge`, below) that the second gap's fix can reuse rather than duplicate — that
keeping them apart risked one change's implementation going stale the moment the other's landed. They
are folded into this one change instead.

## What Changes

- Fix row fan-out: `derive_taxa()` returns exactly one row per minted permid (per the spec's existing
  totality requirement), with identity (`name`, `rank_id`, `authority_id`) pulled from a 1:1 lookup on
  that permid's own `root` row rather than from whichever introducing-edge row happens to join.
- Fix the `never_accepted` exclusion to be permid-scoped: computed from each permid's own canonical
  introducing edge (top-ranked among its candidates), not from a blanket per-row filter a permid's own
  `root` row can slip past.
- Add the nomen-nudum candidacy bar: a permid whose winning `validity_opinions` row is `nomen nudum`
  (`bars_candidacy = true`) is excluded from its lineage's accepted-spelling contest, symmetric with the
  never-accepted exclusion.
- Add the empty-lineage/empty-concept cascade the bar entails: candidacy filtering runs before
  concept-seniority ranking; a fully-barred would-be-senior lineage cedes seniority to the next
  most-senior lineage with an eligible candidate; a concept with no eligible lineage anywhere emits no
  `taxa` rows at all (a genuine terminal state, not an error).
- Define and implement a deterministic, topological tie-break for `original_permid`: the lineage node
  that is a lineage *target* but never a lineage *subject* (the sink of the "form of" chain), falling
  back to year-rank only for genuinely degenerate 0-/2-candidate components. The current
  earliest-year-root method is applied universally and is wrong now that every permid mints its own
  `root` row.
- Give lineage-class and concept-class edges a per-subject (or per-lineage, for concept-class) ranked
  contest, mirroring `assignment_opinions`: only the top-ranked current opinion (by the existing
  canonical `evidence DESC, pubyr DESC, id DESC` order) feeds each union-find. This resolves the
  "redirect" half of issue #51 — a later, higher-ranked opinion pointing a subject at a *different*
  target now displaces an earlier one — without a schema change to the union-find edges themselves.
- Add a `negates boolean` column to `name_opinions`, independent of `reason_id`, so a winning opinion
  can assert "no relationship at all," not just a different target — the open half of issue #51's
  "explicit negation mechanism, distinct from retraction" path. A negating row keeps the existing
  lineage/concept minting shape (a required target, for provenance) and reuses an ordinary, existing
  reason with reversed polarity (`reason = 'misspelling', negates = true` reads as "not a misspelling
  of [target]"); no new dictionary tokens are needed. See `design.md` Decision 6 for the fuller
  reasoning, including a rejected first draft that pinned `negates` to the dictionary and needed new
  tokens as a result.
- Extend the eligibility exclusion (never_accepted + nomen-nudum, above) with a third criterion: a
  permid's own canonical introducing edge having `negates = true` also excludes it from
  `accepted_spelling_permid` contention — a negating opinion asserts absence, not a spelling.
- Redefine `con_sources` (an input to the senior-lineage tie-break) from raw opinion existence to
  currently-active, winning concept edges — otherwise a lineage whose only concept-class opinion was
  outranked or successfully negated stays wrongly deprioritized by stale history.
- No change to retraction's meaning or scope: it remains reserved for transcription errors, not
  scientific disagreement.
- Not in scope: `dependency_closure` (the incremental-trigger scoping function, §9.6.4/B2) is a separate,
  adjacent function tracked for its own rework. `derive_taxa(seed := NULL)` (full recompute) is
  independent of it, so nothing here is blocked by leaving it untouched.

No running system or migrated data is affected: B4 hasn't started and nothing has ever called
`derive_taxa()` against real data, so this is completing/correcting unreleased Layer 2 logic, not
changing behavior anyone depends on.

## Capabilities

### New Capabilities

(none — this reworks requirements of an existing capability)

### Modified Capabilities

- `taxa-opinions`: `derive_taxa()`'s requirements change in nine ways — (1) the existing "total over
  minted permids" requirement gets scenarios covering the multi-introducing-edge case that currently
  violates it; (2) the existing "Accepted spelling" requirement's never-accepted exclusion is
  clarified/tightened to be explicitly permid-scoped, and gains nomen-nudum and negation exclusions;
  (3) a new requirement adds the nomen-nudum candidacy bar; (4) a new requirement adds the
  empty-lineage/empty-concept cascade; (5) the existing "Lineage grouping" requirement gains both an
  explicit, deterministic `original_permid` tie-break rule and a per-subject ranked-contest precondition
  before union-find; (6) the existing "Concept grouping" requirement gains an equivalent per-lineage
  ranked-contest precondition; (7) "name_opinions models typed edges with a minting shape" gains a
  root-rows-never-negate clause; (8) "Seniority tiebreak is total and deterministic" gains an explicit
  (and now correctly-defined) "never currently junior" criterion, formalizing previously-undocumented
  behavior this change makes load-bearing for the first time; (9) a new requirement adds the negation
  mechanism itself.

## Impact

- `postgresql/create_new.sql`: the `derive_taxa()` function body (~L5050-5298) is substantially
  rewritten. `name_opinions` gains a `negates boolean` column and the `name_opinion_shape` CHECK
  (~L4768-4772) gains a root-rows-never-negate clause — this change is **no longer function-only**;
  it includes one small, additive schema change alongside the function rewrite.
- `openspec/specs/taxa-opinions/spec.md`: gains the requirement changes above via a delta spec.
- No migration script changes — `derive_taxa()` has no consumers yet; this completes Layer 2 ahead of
  B4, it doesn't touch any `migrate-*.js` script.
- Adjacent, explicitly out of scope: `dependency_closure`'s own rework (tracked separately, §9.6.4/B2).
