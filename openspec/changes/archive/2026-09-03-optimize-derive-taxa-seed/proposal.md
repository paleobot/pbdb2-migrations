## Why

`derive_taxa(seed uuid[])` and `derive_linnaean(seed uuid[])` were benchmarked live against `pg_play`
on 2026-09-03: `derive_taxa(seed)` (a single seeded permid) took 339.8s vs `derive_taxa(NULL)`'s 382.1s
(1.12x), and `derive_linnaean(seed)` took 25.7s vs `derive_linnaean(NULL)`'s 30.7s (1.19x). Code
inspection confirms why: `seed` appears exactly twice per function — the parameter declaration and a
`WHERE seed IS NULL OR m.permid = ANY(seed)` filter on the *final* return `SELECT`. Every intermediate
temp table (union-find over `name_opinions`/`assignment_opinions`, `_dtu_assign`/`_dtu_node`, the
cycle-breaking loop, the cycle-member walk) is still built over the entire ~500K-concept dataset
regardless of `seed` size. `seed` currently saves only row materialization/return cost, not computation.

If a real-time "curator submits one new opinion, sees the classification update immediately" workflow
is wanted, `seed` needs to actually scope the internal computation to the affected neighborhood, not
just the output rows. This change designs and implements that.

## What Changes

- Restrict `derive_taxa()`'s (and `derive_linnaean()`'s, and `derive_taxa_clades()`'s, since all three
  share the same internal shape per `optimize-derive-taxa-cycle-loop`) internal temp-table construction
  — union-find, assign/node candidate tables, the cycle-breaking loop, and cycle-member detection — to
  the set of concepts actually reachable from `seed` through name/assignment/validity edges, instead of
  building each over the full dataset when `seed IS NOT NULL`.
- Define and implement the "affected scope" precisely: a change to one opinion can only change the
  winning candidate for concepts whose classification depends on that opinion's subject or target,
  transitively through containment/synonymy — this needs to be walked out from `seed`, not assumed to
  be just the seeded permids themselves.
- Preserve exact correctness: for any `seed`, every returned row must remain byte-identical to the
  corresponding row from a full `derive_taxa(NULL)`/`derive_linnaean(NULL)` call — this is the same
  invariant already confirmed for the current (non-scoped) `seed` implementation, and must continue to
  hold after scoping.
- `seed IS NULL` (full derivation) is unaffected — no change to that path's temp-table construction,
  only to the `seed IS NOT NULL` path.
- No change to function signatures, return shape, or selection/tie-break rules — this is a performance
  change to the `seed IS NOT NULL` code path, not a change to what any caller observes.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
(none — this changes the internal computation strategy of `derive_taxa()`/`derive_linnaean()`/
`derive_taxa_clades()` for `seed IS NOT NULL`, not any externally-observable behavior described in
`openspec/specs/taxa-opinions/spec.md` or `openspec/specs/taxa-clades/spec.md`. Inputs, outputs, and
selection rules are unaffected; only how fast a seeded call reaches the same answer changes.)

## Impact

- **Affected code**: `postgresql/create_new.sql` — `derive_taxa()`, `derive_linnaean()`, and
  `derive_taxa_clades()`'s `seed IS NOT NULL` handling. Possibly `rebuild_taxa()`/`rebuild_linnaean()`/
  `rebuild_taxa_clades()` if they are meant to call the scoped path for incremental updates.
- **Affected data**: none expected — `pg_play`'s persisted tables (`taxa`, `taxa_linnaean`,
  `taxa_clades`, `taxa_attachments`) must be identical before and after, verified via
  `assert_taxa_invariant()`/`assert_linnaean_invariant()`/`assert_taxa_clades_invariant()`.
- **Primary risk**: correctly identifying the "affected scope" is the hard part of this change.
  Under-scoping (missing a concept whose winning candidate should have been recomputed) silently
  produces wrong output rather than an error — this needs to be the main focus of design and
  verification, not just the speedup.
- **Out of scope**: this change does not add a new caller-facing "recompute on opinion insert" trigger
  or API — it only makes the existing `seed` parameter fast enough to make such a workflow feasible
  later.
