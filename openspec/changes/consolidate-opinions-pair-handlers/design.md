## Context

`migration_exploration/opinions/` currently implements the spec's rule set as 48 hand-written files (see
proposal.md - Why for how that was discovered to be ~90% mechanical duplication). This design covers how
the rule set in `specs/opinions-pair-handlers/spec.md` was drawn out of that implementation, the
boundaries chosen for what counts as a "disposition" versus a "named exception," and what happens to the
two documents this change supersedes. It does not cover how a future contributor should structure the
replacement code — the proposal and spec deliberately stop at rules, not config schemas or pseudocode
(see proposal.md - What Changes).

## Goals / Non-Goals

**Goals:**
- Draw a small, principled boundary between "general rule" and "named exception" that matches the actual
  shape of the data (confirmed by diffing the real handler files), not an arbitrary simplification.
- Leave the spec implementation-neutral, so a future refactor isn't constrained to a particular JS
  structure this design didn't need to prescribe.
- Make the supersession of `DESIGN.md` and `opinions-pair-mapping.md` clean: everything load-bearing in
  either document either landed in the spec (the rules) or is identified here as intentionally dropped
  (the per-pair citations and row counts) with a reason.

**Non-Goals:**
- Designing the replacement code's structure (function signatures, a config-object shape, file layout).
  That belongs to whichever future change actually implements this spec.
- Re-validating the underlying row counts or re-probing `pg_classic` for new anomalies. The spec's rules
  are drawn from the anomalies `opinions-pair-mapping.md` already documents as live-validated
  (2026-08-19); this change doesn't repeat that validation.
- Reconciling this capability with the pre-existing `assignment-opinions-migration` /
  `synonymy-opinions-migration` specs, which describe the separate, narrower root-level baseline scripts.
  DESIGN.md §7 already flags that reconciliation as outstanding, unrelated work.

## Decisions

### 1. Three dispositions, kept separate rather than unified into one generic "targeted edge" shape

Assignment and concept edges look superficially identical (a subject and an "other end"), which invites
collapsing all three dispositions into one generic shape. Rejected: `validity_opinions` has no
target-bearing column at all (schema-enforced — there is no field to populate even if we wanted to), and
assignment's "other end" (`containing_permid`) is nullable for the asserted-rootless case while concept's
`target_permid` is `NOT NULL` by the `name_opinion_shape` CHECK. Collapsing three schema-distinct shapes
into one abstraction would blur a real distinction `postgresql/create_new.sql` already enforces, and
would reintroduce exactly the "one thing routing several ways" ambiguity the original per-pair design
(DESIGN.md §1) was trying to avoid in the first place — just moved from the status axis to a fake shared
shape.

*Alternative considered:* a single "edge" disposition with an optional target and an optional
"nullable-if-rootless" flag. Rejected for the schema-mismatch reason above, and because it would still
need a per-status flag to distinguish which table the edge lands in — no simpler than naming three
dispositions directly.

### 2. nomen oblitum stays a named, per-row structural exception, not a fourth disposition

Only one status (`nomen oblitum`, 76 rows total) branches its disposition per row rather than per pair.
Generalizing "a disposition chosen per row" into a fourth universal disposition class, available to any
status, would add a mechanism with exactly one real user. The spec instead names it as a bounded
exception (Requirement: nomen oblitum's disposition is chosen per row, not per pair) — legible on its own
terms, without implying other statuses might someday need the same branch.

*Alternative considered:* generalize to "any status MAY define a per-row disposition predicate."
Rejected — no other status in the 998,565-row dataset exhibits this pattern (per the live-probed data
`opinions-pair-mapping.md` already reconciles), so the generalization has no second data point to justify
it, and would make the common case (per-pair, not per-row) look like the exception instead of the rule.

### 3. The spec's tables are the de facto config shape, deliberately without saying so

The three markdown tables in the spec (concept-disposition parameters, validity-disposition parameters,
the universal lineage crosswalk) are already, structurally, exactly what a future config-driven
implementation would transcribe into code — but the spec states them as requirement tables, not as a
named schema, per the "rules only" scope decided with the user. This is intentional, not an oversight:
a future implementer has an unambiguous, literal transcription path (each spec table row becomes one
config entry) without this design prescribing the actual JS shape, variable names, or module boundaries.

### 4. The mistagged-original-spelling exception stays separate from the universal crosswalk, not folded in

The three affected pairs' extra lineage edges exist because of a Classic data-entry anomaly
(`spelling_reason` mistagged as `original spelling` on rows that carry a real spelling deviation), not
because of a designed rule. Folding it into the universal crosswalk table (e.g., adding a fifth row for
"original spelling (mistagged)") would misrepresent a data-quality issue as an intentional design choice,
and would incorrectly suggest every `original spelling` pair needs the same per-row worklist check when
only three specific pairs are affected.

### 5. `lib/` and the testing harness are untouched, and this change says nothing further about them

Consolidating the per-pair mapping logic doesn't change how identity/reference/attribution/evidence
resolution works, or how the pg_classic/pg_play test harness runs handlers — those are already correctly
factored out of the 48-file duplication this change addresses (proposal.md - Impact). Restating them here
would duplicate documentation that already exists and isn't changing.

## Risks / Trade-offs

- **[Risk] The rule set could be incomplete if an anomaly exists in the dataset that neither
  `opinions-pair-mapping.md` nor this change's own file-diffing surfaced.** → **Mitigation:** the spec's
  rules are drawn from anomalies already live-validated against `pg_classic` as of 2026-08-19
  (`opinions-pair-mapping.md`), and DESIGN.md §6 confirms all 48 pairs partition strictly into the four
  shapes this spec's dispositions/exceptions are built from. Residual risk is bounded to whatever
  execution-testing (DESIGN.md §7, still outstanding) might yet surface — not eliminated, but not blind
  either.
- **[Risk] Archiving `opinions-pair-mapping.md` loses per-pair evidentiary detail** (live row counts,
  specific `opinion_no` citations like 955925 or 71324) that the rules-only spec deliberately does not
  restate. → **Mitigation:** that detail is evidentiary, not behavioral — a correct implementation doesn't
  need its own supporting sample size, and the archived document remains reachable in git history. Called
  out explicitly here so a future reader doesn't expect the new spec to double as a citation index.
- **[Risk] A spec with no code has no automatic enforcement** — a future implementation could still drift
  into 48 divergent files despite this spec existing. → **Mitigation:** process only, not technical, for
  this change; the natural mitigation (deriving fixtures/tests directly from the spec's scenarios) belongs
  to whichever future change implements this spec, not to this documentation-only change.
- **[Risk] Readers could confuse this capability with the pre-existing, narrower
  `assignment-opinions-migration` / `synonymy-opinions-migration` specs**, which describe the separate
  root-level baseline scripts and a different (original-spelling-only, no rootless-NULL) rule set. →
  **Mitigation:** proposal.md's Impact section and this design's Non-Goals both state explicitly that
  those specs are untouched and describe a different, currently-unreconciled baseline (DESIGN.md §7).

## Migration Plan

1. Land this OpenSpec change (proposal + spec + design + tasks) and get it accepted/archived through the
   normal `openspec` workflow — this makes `specs/opinions-pair-handlers/spec.md` the canonical rule set.
2. Archive or remove `migration_exploration/DESIGN.md` and `migration_exploration/opinions-pair-mapping.md`
   once the spec is accepted; their content remains reachable through git history.
3. (Separate, future change, not part of this one) Implement the spec: replace the 48 handler files with
   code structured around the three dispositions plus the named exceptions, validated against the
   existing `migration_exploration/testing/` harness.

**Rollback:** this change touches no code and no running system (same status as `rework-derive-taxa`) —
reverting means simply not archiving `DESIGN.md`/`opinions-pair-mapping.md` and not accepting the spec.

## Open Questions

- Whether and when to reconcile this capability with the pre-existing `assignment-opinions-migration` /
  `synonymy-opinions-migration` specs (the old root-level baseline) is left open — it doesn't affect this
  spec's content or the task breakdown for implementing it, and DESIGN.md §7 already tracks it as
  separate, outstanding work.
- The name/scope of the future change that actually implements this spec in code is left open — nothing
  in this change's tasks depends on deciding it now.
