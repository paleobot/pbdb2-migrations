## Why

`derive_taxa(NULL)` (full derive-all) raises `classification containment cycle detected` against real,
full-migration data. Root cause: `_dt_assign`'s "pool assignment opinions across the concept" logic has
no check excluding a candidate whose `containing_permid` resolves back to the subject's own concept.
73 concepts in the live dataset end up with `containing_concept_permid = concept_permid` as a result — a
handful sit at high ranks (subclass/order/family) and each traps its entire subtree, leaving 291,342 of
~472,805 concepts unable to reach a tree root. This blocks a full derive-all from ever completing on
production-scale data.

## What Changes

- `_dt_assign` resolves each candidate `assignment_opinions` row's `containing_permid` to its concept
  (`con_rep`) **before** ranking, and excludes any candidate whose resolved containing concept equals its
  own concept — the same resolution the CTE already performs for the *winner*, done earlier so a
  self-referential opinion never enters the ranking contest.
- Ranking among the remaining (non-self-referential) candidates is unchanged: still
  `evidence DESC, yr DESC NULLS LAST, opinion_id DESC` per `con_rep`.
- When exclusion leaves **no** candidate for a concept (every rank-matching assignment opinion for it was
  self-referential — the 2/73 rank-change case), that concept's `containing_concept_permid` is `NULL`
  ("rootless") — the same treatment already used elsewhere for "no container asserted"
  (e.g. `parent_spelling_no = 0` in the migration layer), not an error and not a synthesized guess.
- No change to the 71/73 case's outcome path in the common case: once the self-referential candidate is
  excluded, the genuine (non-self-referential) assignment opinion for that concept, if one exists, wins
  normally.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `taxa-opinions`: the `containing_concept_permid` pooling requirement gains a self-reference exclusion
  (a candidate whose resolved containing concept equals its own concept is never eligible to win), with a
  `NULL`/rootless outcome when exclusion leaves no candidate. This refines, rather than contradicts, the
  existing "derive_taxa() terminates on cycles and surfaces containment cycles" requirement — a
  *classification* cycle across multiple concepts still raises; a concept whose only candidate points at
  itself no longer reaches the cycle guard at all, because it's resolved to rootless before any cycle
  could form.

## Impact

- `postgresql/create_new.sql` — the `_dt_assign` CTE (currently flagged with an inline `KNOWN GAP` comment
  dated 2026-08-21 describing exactly this gap).
- `pg_play` — redeploy `derive_taxa()` after the fix to confirm live.
- Validate first against `derive_taxa_analyzed()` (`migration_exploration/testing/derive-taxa-analyzed.sql`),
  the existing test-only copy, before touching the real function.
- Diagnostic tooling already in place to confirm the fix: `find-containment-cycle.js` (should find zero
  cycles after the fix), `diagnose-containment-self-loops.js` and `diagnose-same-lineage-self-loops.js`
  (should report 0 self-loops of both sub-patterns).
