## Why

Slice 7 of seven, and the last. `migrate-collections.js` is the only migration script still at the
repository root, and the previous slice named it as the one that "carries with it the deletion of root
`db.js`, `uuidv7.js`, `pg-pool.js`, and `mariadb-pool.js`, and therefore the closing of `permid-uuidv7`'s
'single ESM helper module' gap, deferred through three slices now"
(`move-authority-opinions-migration-to-src/proposal.md`).

That deletion is the reason this slice is not merely the smallest of the seven. Moving the script touches
four import lines and one runner path. Retiring the duplicated root modules discharges a gap four
specifications have been carrying transitional language for, and it is the only part of this change that can
break something outside the migration pipeline.

## What Changes

**The relocation.**

| | From | To |
|---|---|---|
| Entry point | `migrate-collections.js` | `src/collections-migration/migrate-collections.js` |
| Harness | `play/test-collections-transforms.js` | `src/collections-migration/tests/test-collections-transforms.js` |
| Runner step name | `collections` | `collections` — **unchanged** |

The directory is `collections-migration`, plural, because *collections* is the head noun naming the table
being migrated — the same grammar as `authorities-migration`, and not the attributive-noun case that forced
the singular in `authority-opinions-migration`. The step name does not change: `migration-runner` requires a
step name to survive a relocation, and this slice has no deliberate-rename decision to record.

Four imports are repointed: `./db.js` → `../lib/db.js`, `./uuidv7.js` → `../lib/uuidv7.js`,
`./payloadSchemas/collection.schema.js` → `../../payloadSchemas/collection.schema.js` (still deliberately
reaching above `src/`, as in every prior slice), and `ajv/dist/2019.js` unchanged. The harness's two imports
follow the same pattern.

**The deletion.** Three root modules are removed:

| Module | Root importers once collections has moved | Disposition |
|---|---|---|
| `db.js` | `migration_exploration/opinions/**` only | **deleted** |
| `uuidv7.js` | `migration_exploration/opinions/**` only | **deleted** — closes the `permid-uuidv7` gap |
| `mariadb-pool.js` | root `db.js` (itself being deleted) | **deleted** |
| `pg-pool.js` | **`play/server.js:1`** | **retained** |
| `pg-classic-pool.js`, `pg-migrated-pool.js`, `pg-play-pool.js` | `migration_exploration/testing/**`; `pg-migrated-pool.js` also from `src/opinions-migration/tests/cross-check-aurora.js:17` | **retained** — specialty pools with no `src/lib/` counterpart |

`uuidv7.js`, `pg-pool.js`, and `mariadb-pool.js` are byte-identical to their `src/lib/` counterparts. Root
`db.js` is **not**: it carries a `MIGRATION_TEST_MODE=1` branch that swaps in
`migration_exploration/testing/db-test-shim.js`, which `src/lib/db.js` deliberately dropped. Deleting it
removes that shim's entry point, which is accepted below.

**`pg-pool.js` is retained on purpose, and the reason is recorded rather than left to inference.**
`play/server.js` is a demo API that must keep working, it lives outside `src/`, and it is PostgreSQL-only. A
root module with a live consumer is not a leftover, but an unexplained one invites exactly the drive-by
deletion `migration-script-layout` warns against, so `db-connection-config` states the consumer by name.

**The resulting invariant is checkable:** after this change the repository root holds connection-pool
modules and nothing else — no migration entry point, no shared helper, no dual-database composite.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `db-connection-config`: **Modified** — the heaviest edit. Its "Shared connection module" requirement is
  built on *"Two parallel sets of these modules exist while the relocation of migration scripts under `src/`
  is in progress."* The relocation is no longer in progress, so that framing is replaced: `src/lib/` is the
  set, and the root retains `pg-pool.js` for `play/server.js` plus the three specialty pools. Two scenarios
  become vacuous and are replaced rather than deleted silently. A new statement records that the root has no
  dual-database entry point and that the answer for a future script needing both pools is `src/lib/db.js`,
  not a restored root `db.js`.
- `migration-script-layout`: **Modified**, one requirement — the inventory. It gains
  `src/collections-migration/` and its root list becomes an explicit **(none)** rather than an empty section,
  so the absence reads as an assertion instead of an oversight, and it records that the relocation program is
  complete. Its "Root scripts keep their existing conventions" scenario is replaced by one saying the
  transitional allowance is spent. The citation-form requirement is deliberately **not** edited: its
  mixed-list rule is a general rule that remains correct once it has nothing left to defer.
- `permid-uuidv7`: **Modified**, two requirements. The minted-by table and the
  "Authorities/collections/refs permid is v7" scenario are path-qualified — this is the change that
  discharges the mixed-list rule, and the paragraph explaining *why* the list stayed bare (because
  `migrate-collections.js` was still at root) is rewritten rather than left contradicting the table above it.
  "Shared UUIDv7 generation helper" gains the fact that the single module is now literally single.
- `migration-runner`: **Modified**, two requirements. Run-order row 9 is repointed. The
  "Name survives relocation" scenario is written in the future tense *about this exact change* — "**WHEN**
  `migrate-collections.js` is later relocated to `src/collections-migration/migrate-collections.js`" — and is
  converted to the past tense, the same surgery the authorities slice performed on its own predecessor.

`collection-migration` is **not** modified, and the check is worth recording: it never names the script by
filename or path, and its permid requirement cites "the shared UUIDv7 helper module" without a path. A
relocation that touches no citation in the capability's own specification is the shape the citation-form rule
was written to produce.

## Impact

**Source and target tables.** MariaDB `collections` (275,555 rows) and `secondary_refs` are read; PostgreSQL
`collections` and `additional_collection_refs` are written. Neither schema changes. No transformation, type
mapping, or sentinel handling is altered: the normalize-then-alias toponym pipeline, the maritime fallback,
the feet→meter altitude conversion with blank-unit drop, the `geogscale`→`"unspecified"` coercion, the
unresolved-`admin1` `location.comments` marker, the zero-sentinel person fallback, and the orphan-ref skips
all carry across untouched. No anomaly class from `anomaly-report.md` newly enters or leaves play — the 32.8%
DMS/decimal coordinate mismatch remains out of reach because the script reads decimal `lat`/`lng` only, as
`collection-migration` already requires.

**Code moved.** `migrate-collections.js` (681 lines, 26 KB) and `play/test-collections-transforms.js` (199
lines, 9.6 KB). Six import lines change between them; nothing else in either file is touched.

**Code deleted.** Root `db.js`, `uuidv7.js`, `mariadb-pool.js`.

**Code edited in place.** `src/run-migrations.js` — the step's `script` path, and the dependency-graph comment
above the step table.

**`play/` stops being a test directory.** It retains `server.js` and `schema-query-design.md`. `server.js`'s
`import { pg } from '../pg-pool.js'` is deliberately **not** edited: the module it names is retained for it.

**Databases.** This change performs no schema change and no new migration. Verification re-runs one existing
step against localhost.

**Data-integrity risk: low, with one path that fails late.** A script that no longer resolves an import fails
at module load, before any query. The exception is the runner's spawn path — `src/run-migrations.js` invokes
this script by path, so a stale reference surfaces at spawn time rather than import time. Verification
therefore exercises the runner, not just the script, because invoking the relocated script directly would
pass while the runner was still broken.

Unlike the authorities slice there is no silent-failure path: no functions are collapsed and no duplicated
logic is deduplicated, so payload content cannot drift while row counts hold steady. Verification checks
content as well as cardinality regardless, following that slice's lesson.

**Verification baseline**, from localhost `pbdb` on 2026-09-04:

| Measure | Value |
|---|---|
| `collections` | 275,554 — this step's output |
| `additional_collection_refs` | 371,774 — this step's output |
| `test-collections-transforms.js` | **42 passed, 0 failed** — the pre-move figure the relocated harness must reproduce |
| `refs` | 93,940 — this step's input, untouched by verification |
| `persons` / `authorities` / `name_opinions` | 1,375 / 163,067 / 766,427 — untouched |

**Verification has a non-destructive first pass this slice, and a destructive second one.** The script
accepts `--dry-run` (or `DRY_RUN=1`): it runs the full stream/build/validate/stage/insert path against the
live database and issues `ROLLBACK` instead of `COMMIT`. Because `collections.id` is an identity column and
`permid` is freshly minted per run, a dry run succeeds against a *populated* table — it inserts and discards
275,554 rows. That catches every import failure and reproduces both counts without touching a row.

It cannot be the whole story, for two reasons. It does not exercise the runner's spawn path, which is the one
thing in this change that fails late. And it skips the identity-sequence `setval`, leaving both sequences
advanced past `MAX(id)` — harmless for correctness, but a real side effect worth naming rather than
discovering. So a second pass truncates and re-runs through the runner, which both exercises the edited path
and resets the sequences.

`TRUNCATE collections, additional_collection_refs RESTART IDENTITY CASCADE` is safe here in a way
`reset-opinions.sql` was not: the only foreign keys pointing at these tables are `collections`' two
self-referential version columns and `additional_collection_refs.collection_id`. Nothing produced by the
other eight steps references either table, so the comparison carries no live-PBot GraphQL nondeterminism and
leaves `persons`, `refs`, `authorities`, and all three opinion tables standing.

**Not in scope.**

- **`migration_exploration/`.** The tree is superseded and already broken independently of this change:
  `migration_exploration/lib/attribution.js:6` imports `../../migrate-authorities.js`, moved in slice 5, and
  `opinions/belongs-to/original-spelling.js:37` reads a root `mistagged-original-spelling.csv` relocated in
  slice 4. Deleting root `db.js` and `uuidv7.js` breaks roughly fifty further files in it. This is accepted,
  not repaired and not deleted: repairing cruft is out of scope, and deleting the tree is a decision of its
  own that a relocation slice should not smuggle in.
- **`scratchpad-count.mjs`.** An untracked, uncommitted one-off from 2026-08-06 that recomputes the 670-orphan
  figure enumerated in `docs/taxa-orphans-670.csv`. It imports root `mariadb-pool.js` and will break. It is
  not in version control, so it is not this change's to edit or delete.
- **Repointing `play/server.js`.** Deliberately declined; see above.
- **Adding `src/lib/` counterparts for the three specialty pools.** The open question `db-connection-config`
  has carried since the persons slice — *"what happens when a slice needs a specialty pool?"* — is answered by
  this slice only in the negative: `migrate-collections.js` needs `db.js` and nothing more, so the question
  goes unforced. `src/opinions-migration/tests/cross-check-aurora.js:17` continues to import
  `pg-migrated-pool.js` from the root, which is the specified behaviour rather than a gap.
- **Promoting any of the script's fifteen exported transforms into `src/lib/`.** All fifteen are imported by
  exactly one consumer, its own harness. The shared-utility requirement is not triggered by a helper with one
  caller, and promoting on speculation is the behavioural refactor in relocation's clothing that the refs
  slice declined.
- **The deferred collections work** — age interval FKs, `ages.intervals`, `environment`, and `paleontology` —
  which `collection-migration` already specifies as out of scope and which this change does not revisit.
