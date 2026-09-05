## Context

Slice 7 of seven, and the last. Six relocations have landed since 2026-09-02;
`migrate-collections.js` is the only migration script still at the repository root.

The script itself is the least demanding of the seven. It has four imports, writes no files, reads no
input files, exports fifteen pure transforms consumed by exactly one harness, and is spawned by the
runner rather than imported by it. What makes this slice worth a design document is not the move.

```
                        the move                    the deletion
                ─────────────────────────    ──────────────────────────────
  files            2 moved, 6 imports          3 deleted from the root
  blast radius     migration pipeline          play/, migration_exploration/,
                                               an untracked scratch file
  specs            2 requirements              4 requirements across 3 specs
  reversible       git mv back                 git revert, but the reasoning
                                               is what would be lost
```

Three prior slices deferred the deletion of the duplicated root helper modules to this one, and four
specifications carry transitional language written on the assumption that it happens here. The
deletion is the part that can break something outside the migration pipeline, and it is the part where
the previous slice's stated facts did not survive checking.

**What slice 6 asserted, and what is actually on disk.** Its proposal read: *"After this change
`migrate-collections.js` is the only remaining importer of those root copies."* Verified against the
tree:

| Root module | Importers once collections has moved | Identical to `src/lib/`? |
|---|---|---|
| `db.js` | ~50 files under `migration_exploration/opinions/` | **no** — carries the `MIGRATION_TEST_MODE` shim branch |
| `uuidv7.js` | the same ~50 files | yes, byte-identical |
| `pg-pool.js` | **`play/server.js:1`** | yes, byte-identical |
| `mariadb-pool.js` | root `db.js`; `scratchpad-count.mjs` (untracked) | yes, byte-identical |

Two corrections follow. `play/server.js` is a live consumer outside the superseded tree, so deleting
all four was never free. And root `db.js` is not a duplicate at all — deleting it deletes the
`migration_exploration/testing/db-test-shim.js` entry point along with it.

## Goals / Non-Goals

**Goals:**

- Relocate `migrate-collections.js` and its harness under `src/collections-migration/`, completing the
  `migration-script-layout` inventory.
- Delete the root helper modules that the relocation makes redundant, closing `permid-uuidv7`'s
  "single ESM helper module" gap after three slices of deferral.
- Replace `db-connection-config`'s "two parallel sets … while the relocation is in progress" framing,
  which describes a state that ends with this change.
- Leave the repository root in a condition that is *checkable*, not merely tidier: pools only, with a
  recorded reason for each one that stays.
- Verify against localhost by exercising the runner, not only the relocated script.

**Non-Goals:**

- Repairing or deleting `migration_exploration/`.
- Repointing `play/server.js`.
- Adding `src/lib/` counterparts for the three specialty pools.
- Promoting any of the script's transforms to `src/lib/`.
- Any change to collections migration behaviour, including the deferred age-interval, `environment`,
  and `paleontology` work.

## Decisions

### 1. Bundle the deletion with the relocation

**Decision:** one change, both halves.

The alternative is a relocation slice followed by a cleanup slice. It has a real argument: the two are
separable, the deletion has a wider blast radius than the move, and a reader of the diff sees two
concerns.

Rejected because the redundancy is *created* by the relocation. Landing the move alone leaves
`src/lib/uuidv7.js` and root `uuidv7.js` as identical twins with no remaining reason for the second —
exactly the state `permid-uuidv7` already flags as a gap, now with no pending slice to justify it.
Splitting would also mean editing `db-connection-config` twice in a week, once to say the relocation
finished and once to say the modules went, which is the churn the previous slice avoided by bundling
its own rename.

### 2. Retain root `pg-pool.js`; do not repoint `play/server.js`

**Decision:** keep the module, name its consumer in the specification, leave `server.js` untouched.

`play/server.js` is a demo API. It must keep working, it is PostgreSQL-only, and it lives outside
`src/`.

Alternatives:

| Option | Effect |
|---|---|
| Repoint `server.js` → `src/lib/pg-pool.js` | Root pool set collapses fully, but a non-`src/` script now reaches *into* `src/lib/` — a direction `db-connection-config` does not describe, established for a demo |
| Delete `pg-pool.js`, break `server.js` | Rejected outright: the user requires it to keep working |
| **Retain, with the reason recorded** | Root keeps one non-specialty pool; the spec says which consumer and why |

The third wins on the same reasoning the layout spec already applies to directory names. An
unexplained retained module reads as drift and invites a future drive-by deletion; a module whose
consumer is named in the specification survives that reader. `src/lib/` remains the set for everything
under `src/`, which is the rule that actually governs the migrations.

### 3. Delete `mariadb-pool.js` but keep `pg-pool.js` — an asymmetry with a rule behind it

This pair looks inconsistent, so the rule is stated rather than left to be inferred: **a root pool is
retained if and only if something outside `src/` imports it, or it is a specialty pool with no
`src/lib/` counterpart.** `play/server.js` needs Postgres and not MariaDB, so `pg-pool.js` is retained
and `mariadb-pool.js` is not. Applying the rule to the four remaining root modules reproduces exactly
the set that stays, which is what makes it a rule rather than a rationalization.

### 4. Deleting root `db.js` also removes the `MIGRATION_TEST_MODE` shim entry point

Root `db.js` differs from `src/lib/db.js` by a branch that swaps both connections for
`migration_exploration/testing/db-test-shim.js` when `MIGRATION_TEST_MODE=1`. `src/lib/db.js`'s own
comment already records dropping it: *"that branch belonged to the migration_exploration harness this
structure does not carry forward."*

Accepted. The shim drives handlers in a tree that is already broken two ways over — see decision 5 —
so the branch reaches code that cannot run. Preserving an entry point into unrunnable code is not
preservation.

### 5. Accept the `migration_exploration/` breakage; do not repair it, do not delete it

The tree is already broken independently of this change:

```
migration_exploration/lib/attribution.js:6
    import { … } from '../../migrate-authorities.js'      ← moved in slice 5
migration_exploration/opinions/belongs-to/original-spelling.js:37
    new URL('../../../mistagged-original-spelling.csv')    ← moved in slice 4
```

Deleting root `db.js` and `uuidv7.js` breaks roughly fifty further files in it. That changes the
degree, not the fact.

Both alternatives were considered and declined. Repairing it contradicts its superseded status and
would make a relocation slice the owner of a dead harness. Deleting the tree is a decision of its own
with its own reasoning about what the repository keeps as history — legitimate, but not something a
relocation should smuggle in on the grounds that it was passing by. It stays, broken and labelled.

### 6. Keep the harness filename; move it to `tests/`

`play/test-collections-transforms.js` → `src/collections-migration/tests/test-collections-transforms.js`,
keeping the `test-*.js` form rather than renaming to `*.test.js`. This repeats the authorities slice's
decision 6 for the sibling file, and `migration-script-layout` requires the `tests/` subdirectory
independently. A rename would also trip the citation-form rule's rename clause for no gain.

Consequence worth noting: `play/` stops being a test directory and retains only `server.js` and
`schema-query-design.md`.

### 7. `collections-migration`, plural — and the reason is written down

No naming decision is being made here, but the *absence* of one is worth recording, because the
previous slice made the opposite call for a similar-looking name. `collections` is the head noun
naming the table, as in `authorities-migration`. `authority-opinions-migration` is singular because
*authority* modifies *opinions* attributively. Both grammars are now in the inventory beside each
other, with a scenario protecting the plural from being "corrected" to match its singular sibling.

The step name `collections` does not change. `migration-runner` requires relocation-stability, and
this slice has no deliberate-rename decision to record — which is precisely the distinction that
specification drew when the `authorities-opinions` rename rode along with slice 6.

### 8. Path-qualify the mixed lists now, in one edit

`migration-script-layout`'s citation-form rule holds that a list naming several scripts stays
unqualified until every member has moved, then *"is path-qualified in a single later change once the
last of them has moved."* This is that change. `permid-uuidv7`'s minted-by table and its three
actor scenarios are qualified together, and the paragraph explaining why they were bare is rewritten
rather than left standing above a table that now contradicts it.

The citation-form requirement itself is **not** edited. It is a general rule that remains correct once
it has nothing left to defer; rewriting it to say "there are no mixed lists left" would convert a rule
into a status report.

### 9. Two-pass verification: `--dry-run` first, truncate-and-run second

The script accepts `--dry-run` / `DRY_RUN=1` — the full stream/build/validate/stage/insert path with
`ROLLBACK` instead of `COMMIT`. Because `collections.id` is an identity column and `permid` is minted
fresh per run, it succeeds against a *populated* table: it inserts and discards 275,554 rows.

```
pass 1   node src/collections-migration/migrate-collections.js --dry-run
         catches: every import failure, both counts, full transform path
         misses:  the runner's spawn path        side effect: sequences advance

pass 2   TRUNCATE collections, additional_collection_refs RESTART IDENTITY CASCADE
         node src/run-migrations.js --only collections
         catches: the spawn path, preconditions, postconditions
         restores: exact baseline counts and the sequences
```

Pass 1 alone is insufficient for a reason specific to this change: the runner spawns the script *by
path*, so a stale `script:` entry fails at spawn time, and invoking the relocated script directly
would pass while the runner stayed broken. Pass 2 alone is worse than the pair, because pass 1 is
non-destructive and catches import breakage before anything is truncated.

`--dry-run` skips the identity-sequence `setval` — deliberately, since `setval` over an empty table's
NULL `MAX(id)` errors — so after pass 1 both sequences sit past `MAX(id)`. Harmless for correctness;
pass 2's `RESTART IDENTITY` resets them, which is a second reason to order the passes this way.

**The truncation is safe here in a way `reset-opinions.sql` was not.** The only foreign keys pointing
at these two tables are `collections`' two self-referential version columns and
`additional_collection_refs.collection_id` — confirmed against both `postgresql/create_new.sql` and
the live localhost catalog. Nothing the other eight steps produce references either table, so the
comparison leaves `persons`, `refs`, `authorities`, and all three opinion tables standing and carries
no live-PBot GraphQL nondeterminism at all.

## Risks / Trade-offs

**A stale runner path fails late, not at import.** → Pass 2 runs the step *through the runner*. This
is the one failure mode `--dry-run` cannot see.

**Content could drift while counts hold.** → Low here: no functions are collapsed and no duplicated
logic is deduplicated, unlike the authorities slice where that risk was real. Verification checks
payload content on a sampled row alongside the two counts anyway, following that slice's lesson.

**The harness might pass while testing the wrong module.** → It imports `../migrate-collections.js`
after the move; if that resolved to a stale copy the assertion count would still be 42. Mitigated by
deleting the original in the same `git mv` and confirming no `migrate-collections.js` remains at the
root before running it.

**`scratchpad-count.mjs` breaks silently.** → Untracked, uncommitted, a one-off from 2026-08-06 that
recomputes the 670-orphan figure already enumerated in `docs/taxa-orphans-670.csv`. Not in version
control, so not this change's to edit. Named in the proposal so its breakage is expected rather than
discovered.

**Retaining root `pg-pool.js` weakens the "root is clean" story.** → Accepted, and traded for a
stronger one: the root holds pools and only pools, each with a recorded reason. That is checkable by
listing the directory; "clean" would not have been true anyway, since three specialty pools stay
regardless.

**A future reader deletes root `pg-pool.js` as leftover cleanup.** → `db-connection-config` names
`play/server.js` as its consumer and carries a scenario stating it is not to be cleaned up — the same
protection `migration-script-layout` gives directory names.

**Someone reintroduces a root `db.js` for a future dual-database script.** → The spec states the
answer in advance: place the script under `src/` and import `src/lib/db.js`.

## Migration Plan

No database migration and no schema change. Rollback is `git revert`; nothing is written that a revert
would not undo, and pass 2 restores the baseline row counts regardless of outcome.

Order matters in one place: delete the root modules *after* moving the script and repointing its
imports, so that an intermediate commit never has a script importing a module that no longer exists.

## Open Questions

None blocking.

Carried forward, unanswered but not owed by this change: **should the three specialty pools gain
`src/lib/` counterparts?** The question has been open since the persons slice, on the expectation that
`migrate-collections.js` would force it. It does not — the script needs `db.js` and nothing else — so
the question survives this slice unforced. `src/opinions-migration/tests/cross-check-aurora.js:17`
continues to import `pg-migrated-pool.js` from the root, which `db-connection-config` specifies rather
than tolerates. The next cross-check harness that needs one is where it will be decided.
