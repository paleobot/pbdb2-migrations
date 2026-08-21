## Why

`migration_exploration/opinions/` implements the legacy `opinions` → `assignment_opinions` /
`name_opinions` / `validity_opinions` migration as 48 separate handler files, one per `(status,
spelling_reason)` pair, on the deliberate principle that every pair gets its own explicit mapping
(`DESIGN.md` §1: "nothing routes by default"). Diffing the actual files across statuses shows that
principle has a real cost: 43 of the 48 pairs are byte-for-byte identical modulo a handful of string/
boolean substitutions (a status literal, a reason token, an `objective` value) — not 43 independently
reasoned mappings, but one small rule set copy-pasted 43 times. `opinions-pair-mapping.md` (1,548 lines)
and `DESIGN.md` (284 lines) both document this territory today, but neither exposes the rule set at the
size it actually is: a contributor has to read all 48 sections (or all 48 files) to discover that only
three things ever vary, and that the variation is fully captured by two small crosswalk tables.

This change establishes that rule set as the authoritative target design — independent of the 48-file
implementation — so a future contributor refactoring `migration_exploration/opinions/` has one place
that states what the code must do, rather than needing to reverse-engineer it from 48 files or reconcile
two overlapping prose documents. It replaces, rather than restates, `DESIGN.md` and
`opinions-pair-mapping.md`: those documents describe how the current 48-file implementation happens to
be organized (decomposition-by-file, one section per pair); this spec describes the rules those 48 files
collectively encode, which is the more durable artifact of the two now that the file-per-pair structure
is itself understood to be incidental, not load-bearing.

## What Changes

- Establish a new `opinions-pair-handlers` capability defining the target rule set for mapping every
  legacy `opinions` `(status, spelling_reason)` pair to its `assignment_opinions` / `name_opinions` /
  `validity_opinions` output(s), stated as behavioral requirements (rules), not as a code/config schema —
  implementation is left to whoever picks up the resulting refactor.
- Define three canonical dispositions — **assignment**, **concept**, **validity** — each a small,
  named set of per-status parameters (a reason token, an `objective` value, or a `nomenclatural_status_id`
  lookup), replacing 43 independently-filed pairs with 3 parameterized rules.
- Define one universal `spelling_reason → lineage reason token` crosswalk (`correction`→`correction`,
  `rank change`→`reranked`, `recombination`→`recombination`, `misspelling`→`misspelling`,
  `reassignment`→`assignment`) shared verbatim by all three dispositions, replacing the 43 pairs' worth
  of copy-pasted lineage-backfill logic with one table.
- Name and preserve, as explicit exceptions rather than folding them into the general rule: the 5
  structurally bespoke pairs (`misspelling-of/misspelling`'s lineage-only shape; the 4 `nomen-oblitum/*`
  per-row targeted/untargeted branch) and the 3 pairs carrying the CSV-driven "mistagged original
  spelling" backfill (`belongs-to`, `replaced-by`, `subjective-synonym-of` × `original-spelling`).
- **Supersede** `migration_exploration/DESIGN.md` and `migration_exploration/opinions-pair-mapping.md`:
  once this capability's spec is accepted, those two documents are archived/removed and the spec becomes
  the one reference for how opinions-pair handling works.
- Out of scope: the `migration_exploration/opinions/*.js` handler files themselves (no code changes in
  this change — it defines the target, a later change implements it), the shared `lib/` primitives
  (`identity.js`, `attribution.js`, `evidence.js`, `anomaly-log.js`), the testing harness
  (`db-test-shim.js`, `run-full-migration.js`), and the pre-existing, unrelated `assignment-opinions-migration`
  / `synonymy-opinions-migration` specs (those describe the old root-level baseline scripts' `original
  spelling`-only slices, not this rewrite).

## Capabilities

### New Capabilities
- `opinions-pair-handlers`: the target rule set for mapping every legacy `opinions` `(status,
  spelling_reason)` pair to its `assignment_opinions` / `name_opinions` / `validity_opinions` output(s) —
  the three dispositions, the universal lineage crosswalk, and the named set of exceptions that fall
  outside the general rule.

### Modified Capabilities
(none — no existing spec covers `migration_exploration/`; this is new territory, not a change to
`assignment-opinions-migration` or `synonymy-opinions-migration`, which describe a separate, unrelated
pair of baseline scripts)

## Impact

- `migration_exploration/DESIGN.md` — superseded; archived once this change lands.
- `migration_exploration/opinions-pair-mapping.md` — superseded; archived once this change lands.
- `migration_exploration/opinions/*.js` (48 files) — not modified by this change; the new spec is the
  target a future implementation change would refactor them against.
- `migration_exploration/lib/*.js`, `migration_exploration/testing/*.js` — untouched; already
  correctly factored out of the per-pair duplication this change addresses.
- No impact on already-migrated data, `postgresql/create_new.sql`, or any deployed system — nothing has
  ever consumed `migration_exploration/opinions/`'s output (same "no running system affected" status as
  `rework-derive-taxa`).
