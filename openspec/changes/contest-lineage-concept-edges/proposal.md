## Why

`derive_taxa()`'s lineage/concept union-finds (`lin_undir`/`con_undir` in `postgresql/create_new.sql`
~L5094-5157) treat every current, non-removed lineage- or concept-class `name_opinions` edge as
unconditionally true and union all of them, with no per-subject ranking of competing edges — unlike
`assignment_opinions`/`validity_opinions`, which already run a ranked contest per subject. Multiple
competing lineage-class opinions about one subject are normal under root-only identity
(`rework-derive-taxa`'s own Context section: "competing recombination/misspelling/rank-change claims are
normal, not anomalous"), but today they don't compete — every one of them is honored as a union-find
edge, so adding a later, better-evidenced opinion never outranks an earlier one; it only merges more
permids together. The only way to remove an edge from the graph is retraction, which the design
deliberately reserves for correcting transcription errors, not adjudicating legitimate scientific
disagreement (`postgresql/create_new.sql` ~L4691-4696).

GitHub issue [paleobot/pbdb2-dev#51](https://github.com/paleobot/pbdb2-dev/issues/51) names the general
gap — no equivalent to Classic's single ranked opinion pool per identity — via a concrete case: a 1990
opinion calls "Myliobatus" a misspelling of "Myliobatis" (a `lineage`-class edge); a 2020,
well-evidenced paper argues they are distinct genera. The 2020 opinion has no way to win: it isn't a
transcription correction, so retraction doesn't apply, and even a competing lineage-class opinion from
Myliobatus would just add a second edge into the same unconditional union, not displace the first.

## What Changes

- Give lineage-class and concept-class edges a per-subject ranked contest, mirroring
  `assignment_opinions`: among a subject's current lineage-class opinions, only the top-ranked one (by
  the existing canonical `evidence DESC, pubyr DESC, id DESC` order) feeds the union-find; likewise for
  concept-class opinions. This resolves the "redirect" half of the problem — a later, higher-ranked
  opinion pointing a subject at a *different* target now displaces an earlier one — without a schema
  change, since nothing currently constrains a subject to at most one live lineage/concept row.
- Add a `negates boolean` column to `name_opinions`, independent of `reason_id`, so a winning opinion
  can assert "no relationship at all," not just a different target — this is the open half of the
  issue's "explicit negation mechanism, distinct from retraction" path. A negating row keeps the
  existing lineage/concept minting shape (a required target, for provenance) and reuses an ordinary,
  existing reason with reversed polarity (`reason = 'misspelling', negates = true` reads as "not a
  misspelling of [target]"); no new dictionary tokens are needed. See `design.md` D2 for the fuller
  reasoning, including a rejected first draft that pinned `negates` to the dictionary and needed new
  tokens as a result.
- No change to retraction's meaning or scope: it remains reserved for transcription errors, not
  scientific disagreement.

## Capabilities

### New Capabilities

(none — this reworks requirements of an existing capability)

### Modified Capabilities

- `taxa-opinions`: the "Lineage grouping collapses spellings of one name" and "Concept grouping
  collapses synonyms" requirements gain a per-subject (or per-lineage, for concept-class) ranked-contest
  precondition before union-find; "name_opinions models typed edges with a minting shape" gains a
  root-rows-never-negate clause; "Accepted spelling is the top-ranked opinion of the senior lineage"
  gains a negation exclusion alongside its existing `never_accepted` one; "Seniority tiebreak is total
  and deterministic" gains an explicit (and now correctly-defined) "never currently junior" criterion,
  formalizing previously-undocumented behavior that D1/D2 make load-bearing for the first time; a new
  requirement adds the negation mechanism itself.

## Impact

- `postgresql/create_new.sql`: `derive_taxa()`'s `lin_undir`/`con_undir` CTEs (~L5094-5157) gain a
  per-subject ranking step before union-find; `_dt_mint` (~L5081-5084) gains a `negates` column in its
  `SELECT`; the `spelling` CTE (~L5120-5127) gains a `negates = false` exclusion alongside its existing
  `never_accepted` one; `con_sources` (~L5162-5166) is redefined from raw opinion existence to the
  D1-winning, non-negating `con_edge` output; `name_opinions` gains a `negates boolean` column and the
  `name_opinion_shape` CHECK (~L4768-4772) gains a root-rows-never-negate clause. No
  `dictionaries.namechange_reasons` changes.
- `openspec/specs/taxa-opinions/spec.md`: gains delta requirements for the per-subject edge contest and,
  pending design, the negation mechanism.
- Sequenced after/alongside `rework-derive-taxa`: that change's own Non-Goals explicitly leave "the two
  union-find CTEs' construction" untouched, treating it as already-validated — so there is no overlap,
  but both changes touch the same function body and should be coordinated at merge time.
- No live data affected: as with `rework-derive-taxa`, `derive_taxa()` has no consumers yet
  (`migrate-taxa-opinions`/B4 hasn't started).
