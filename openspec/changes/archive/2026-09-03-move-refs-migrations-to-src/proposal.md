## Why

The archived `create-opinions-migration` change stood up the standard `src/` layout and deferred relocating
the older root-level `migrate-*.js` scripts; `move-persons-migrations-to-src` opened that refactor with the
persons pair and left six scripts at root. This change is slice 2, covering the refs pair — which the
persons design named in advance: *"The refs pair (`migrate-refs.js` / `migrate-pbot-refs.js`) has the
identical shape and will follow this same split"* (that change's `design.md:74`).

Refs is the right next slice because it is the last pair that is purely mechanical. Between them the two
scripts depend on exactly three root-level modules, all of which already have byte-identical `src/lib/`
counterparts; nothing imports either script programmatically; and both are idempotent, so the move is
verified by a re-run and a row count. The four remaining scripts are more entangled — `migrate-authorities.js`
in particular has to resolve the `src/lib/authorities-builders.js` duplication when it moves.

## What Changes

- Move `migrate-refs.js` → `src/refs-migration/migrate-refs.js`, repointing `./db.js` → `../lib/db.js` and
  `./uuidv7.js` → `../lib/uuidv7.js`.
- Move `migrate-pbot-refs.js` → `src/pbot-refs-migrations/migrate-pbot-refs.js`, repointing `./pg-pool.js` →
  `../lib/pg-pool.js` and `./uuidv7.js` → `../lib/uuidv7.js`.
- Each script gets its own directory, mirroring the persons split, so the two scripts' differing connection
  requirements stay visible: `migrate-refs.js` needs `MARIADB_*` + `PG_*`; `migrate-pbot-refs.js` is PG-only.
  Directory names carry the same deliberate singular/plural asymmetry as the persons pair
  (`refs-migration` / `pbot-refs-migrations`); this is intentional and is not to be normalized.
- Delete the root-level originals. This is a move, not a copy.
- Update the two inbound path references: the `Bash(node migrate-refs.js:*)` permission entry in
  `.claude/settings.local.json`, and the `migrate-refs.js:300` citation in
  `docs/taxa-opinions-migration-mapping.md:661` (the line number is unaffected by the move — only imports
  change, so no line is added or removed).
- Update the `migration-script-layout` inventory: two scripts move from the root list to the `src/` table.

Four import lines change. No other line of either script is touched. No behavior changes, no source or
target schema changes, no new database access. Root `pg-pool.js` and `uuidv7.js` are byte-identical to their
`src/lib/` counterparts, so those three swaps have zero behavior delta. `migrate-refs.js` loses only the
`MIGRATION_TEST_MODE` branch that root `db.js` carries and `src/lib/db.js` deliberately dropped — verified a
no-op here, and more cleanly than for persons: `db-test-shim.js` intercepts on `/ORDER BY opinion_no ASC/`
against the `opinions` table and could not answer a refs query at all.

## Capabilities

### New Capabilities

None. `migration-script-layout`, created by the persons slice, is the durable home this change writes to.

### Modified Capabilities

- `migration-script-layout`: Two requirement changes.
  - **Modified** — "Inventory of migrated and not-yet-migrated scripts" moves `migrate-refs.js` and
    `migrate-pbot-refs.js` from the root list (six scripts → four) into the `src/` directory table.
  - **Added** — "Script citations are path-qualified only where they assert a source of truth" states the
    rule the persons slice followed in practice but never wrote down: qualify a citation with a path when it
    directs the reader to a file as the source of a guarantee; leave a bare filename alone when it is a
    comparative aside; keep a mixed list of moved and unmoved scripts entirely unqualified until the last of
    them moves; always update an executable path. This rule is what reduces this change's spec surface from
    six candidate specs to one, and it needs a durable home for the four remaining slices — the persons
    slice's own reasoning was that archived design notes are not a source of truth, which is why the layout
    convention became a capability spec rather than staying in `design.md`.

  The existing layout, name-asymmetry, shared-utility, and run-artifact requirements already cover the refs
  pair as written and are unchanged.

**Deliberately not modified.** Five specs mention one of the two scripts and are nonetheless left alone,
following the citation-form rule this change writes into `migration-script-layout` above — which the persons
slice established in practice but never stated: qualify a citation with a path when it points the reader at
a file as the *source of a guarantee*; leave a bare filename alone when it is a comparative aside. That
slice updated exactly one citation (`authorities-migration:259`, "the
`migrate-persons.js` migration inserted persons with `id = person_no`") while leaving "Same fallback as
`migrate-refs.js`" bare in the very same sentence.

| Spec | Mention | Why no delta |
|---|---|---|
| `authorities-migration` | 259, 275, 311 | All three are comparative asides — "Same fallback as", "Same pattern as", "Logging style matches". Bare filenames stay accurate. |
| `permid-uuidv7` | 12, 16 | Bare-name list of five scripts, three of which remain at root. Path-qualifying two of five would imply the other three live elsewhere. Better qualified all at once when the last slice lands. |
| `pbot-person-migration` | 157 | Comparative aside ("the same PG connection configuration as `migrate-pbot-refs.js`"). Already declared out of scope by the persons slice; that judgment still holds. |
| `refs-migration` | — | Contains no filename or path citation at all; every requirement reads "The script SHALL …". |
| `pbot-refs-migration` | — | Same. |
| `db-connection-config` | — | Names no scripts. Its rule — scripts under `src/` import from `src/lib/` where a counterpart exists — already covers both moved scripts; all three modules they need have counterparts. |

## Impact

**Code moved:** `migrate-refs.js`, `migrate-pbot-refs.js` (2 files, ~25.2 KB combined). Two import lines
change in each; nothing else.

**Code edited in place:** `.claude/settings.local.json` (one permission entry),
`docs/taxa-opinions-migration-mapping.md` (one path citation).

**Databases:** none. This change performs no migration, alters no source or target schema, transforms no
data, and introduces no type mappings. The MariaDB `refs` / `ref_authors` / `ref_editors` tables and the
PostgreSQL `refs` table are untouched; the scripts that read and write them are only relocated. The anomaly
classes tracked in `anomaly-report.md` are therefore out of play here.

**Data-integrity risk:** minimal, and confined to one failure mode — a script that no longer resolves a
connection module fails at import, loudly, before any query. Both scripts are idempotent, and
`migrate-refs.js` correctly excludes `permid` from its `ON CONFLICT (id) DO UPDATE SET`, so a re-run
preserves existing permids rather than churning them.

Verification baseline, captured from localhost `pbdb` before any move:

| Measure | Value |
|---|---|
| `refs` total | 93,879 |
| carrying `legacyIDs.oldpbdbID` | 93,705 — equals the MariaDB `refs` count exactly |
| carrying `legacyIDs.pbotID` | 174, occupying ids 93,904–94,077 |
| MariaDB `MAX(reference_no)` | 93,903 |

One caveat on re-running: `migrate-pbot-refs.js` reads a **live** GraphQL source, so a run may legitimately
insert references added upstream since the last one. Idempotency is proved by a second consecutive run
inserting zero, not by the first run inserting none — the same rule the persons slice applied.

**Also worth noting:** `migrate-pbot-refs.js` issues one guarded DDL statement (`ALTER TABLE refs ADD
CONSTRAINT references_permid_key UNIQUE (permid)` inside an existence check). The move does not touch it,
but it means "this change makes no schema changes" is true of the change and not of the script.

**Not in scope:**

- **The refs run order.** `migrate-refs.js` must run before `migrate-pbot-refs.js`: the former inserts with
  explicit `id = reference_no` and then `setval`s the sequence, and the latter draws auto-generated ids from
  it. Reversed on a fresh database, PBot refs would take low ids and `migrate-refs.js`'s
  `ON CONFLICT (id) DO UPDATE` would silently overwrite them — exit 0, with the built-in row-count check
  still passing. This is real but is **deliberately deferred**: the ordering for all migrations will be
  encoded in an overall run script under `src/` in a later change, which is a better home than prose spread
  across capability specs. Recorded here so that change inherits the finding rather than rediscovering it.
  The persons ordering already sitting in `migration-script-layout` is left untouched for that change to
  consolidate.
- Extracting anything into `src/lib/`, even where a twin is visible: `mapPersonIds()` in `migrate-refs.js` is
  behaviorally identical to `src/lib/identity.js`'s `resolvePersons()` apart from its `console.warn` calls,
  and `buildPages()` duplicates the inline page parsing in `migrate-pbot-refs.js:140-152`. Per the persons
  slice's decision 4, extraction is a behavioral refactor wearing a relocation's clothes; keeping this change
  pure means its verification is a re-run and a diff.
- Path-qualifying the `permid-uuidv7` script list, or the comparative citations in `authorities-migration`,
  `pbot-person-migration`, and the two `migrate-authorities.js` comments (lines 153, 194).
- Correcting two pre-existing spec drifts found while scoping: `refs-migration:27` and
  `authorities-migration:275` still specify "a v4 UUID using `crypto.randomUUID()`" though `permid-uuidv7`
  superseded that in July, and `refs-migration:24` says the sequence resets to `MAX(id) + 1` where the code
  does `setval(…, MAX(id))`. Both predate this change and neither blocks it.
- Moving the four remaining root-level scripts, or renaming the `refs-migration` / `pbot-refs-migration`
  capabilities to match the new directory names.
