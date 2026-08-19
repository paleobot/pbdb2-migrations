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

- `taxa-opinions`: `derive_taxa()`'s requirements change in five ways — (1) the existing "total over
  minted permids" requirement gets scenarios covering the multi-introducing-edge case that currently
  violates it; (2) the existing "Accepted spelling" requirement's never-accepted exclusion is clarified/
  tightened to be explicitly permid-scoped; (3) a new requirement adds the nomen-nudum candidacy bar;
  (4) a new requirement adds the empty-lineage/empty-concept cascade; (5) the existing "Lineage grouping"
  requirement gains an explicit, deterministic `original_permid` tie-break rule it currently leaves
  implicit.

## Impact

- `postgresql/create_new.sql`: the `derive_taxa()` function body (~L5050-5298) is substantially
  rewritten.
- `openspec/specs/taxa-opinions/spec.md`: gains the requirement changes above via a delta spec.
- No migration script changes — `derive_taxa()` has no consumers yet; this completes Layer 2 ahead of
  B4, it doesn't touch any `migrate-*.js` script.
- Adjacent, explicitly out of scope: `dependency_closure`'s own rework (tracked separately, §9.6.4/B2).
