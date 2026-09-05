## 1. Baseline

- [x] 1.1 Run `node play/test-collections-transforms.js` and confirm **42 passed, 0 failed** — the pre-move figure the relocated harness must reproduce
- [x] 1.2 Record the pre-move row counts from localhost `pbdb`: `collections` = 275,554, `additional_collection_refs` = 371,774, and the untouched neighbours `refs` = 93,940, `persons` = 1,375, `authorities` = 163,067, `name_opinions` = 766,427
- [x] 1.3 Capture a content sample for the drift check: `SELECT id, permid, collection->'legacyIDs'->>'oldpbdbID' AS legacy, collection->>'name', location->'toponym' FROM collections ORDER BY id LIMIT 5` plus the same for the 5 highest ids, saved for comparison after the re-run
- [x] 1.4 Confirm `node src/run-migrations.js --list` prints nine step names ending in `collections`

## 2. Move the script

- [x] 2.1 `mkdir -p src/collections-migration/tests`
- [x] 2.2 `git mv migrate-collections.js src/collections-migration/migrate-collections.js`
- [x] 2.3 Repoint three imports in the moved script: `./db.js` → `../lib/db.js`, `./uuidv7.js` → `../lib/uuidv7.js`, `./payloadSchemas/collection.schema.js` → `../../payloadSchemas/collection.schema.js`. Leave `ajv/dist/2019.js` alone. Change nothing else in the file
- [x] 2.4 Confirm no `migrate-collections.js` remains at the repository root (design risk: a stale copy would let the harness pass while testing the wrong module)
- [x] 2.5 Smoke-test module resolution without running a migration: `node --input-type=module -e "await import('./src/collections-migration/migrate-collections.js')"` exits 0 without inserting (the `invokedDirectly` guard prevents `main()`)

## 3. Move the harness

- [x] 3.1 `git mv play/test-collections-transforms.js src/collections-migration/tests/test-collections-transforms.js`, keeping the `test-*.js` filename rather than renaming to `*.test.js` (design decision 6)
- [x] 3.2 Repoint its two imports: `../payloadSchemas/collection.schema.js` → `../../../payloadSchemas/collection.schema.js`, and `../migrate-collections.js` → `../migrate-collections.js` (unchanged in form, now resolving to the moved script)
- [x] 3.3 Run `node src/collections-migration/tests/test-collections-transforms.js` and confirm **42 passed, 0 failed**, matching task 1.1 exactly
- [x] 3.4 Confirm `play/` now contains only `server.js` and `schema-query-design.md`

## 4. Update the runner

- [x] 4.1 In `src/run-migrations.js`, change the `collections` step's `script` from `'migrate-collections.js'` to `'src/collections-migration/migrate-collections.js'`. Leave `name: 'collections'` unchanged — the step name survives a relocation
- [x] 4.2 Update the dependency-graph comment above the `STEPS` array if it names any path (it names step names only; verify and leave alone if so)
- [x] 4.3 Run `node src/run-migrations.js --list` and confirm the nine names are unchanged from task 1.4

## 5. Delete the redundant root modules

- [x] 5.1 Confirm the deletion set is still correct before deleting: `grep -rnE "from '[^']*(db|uuidv7|mariadb-pool)\.js'" --include=*.js --include=*.mjs . | grep -v node_modules | grep -v '^./src/'` should show only `migration_exploration/**` and the untracked `scratchpad-count.mjs`
- [x] 5.2 `git rm db.js uuidv7.js mariadb-pool.js`
- [x] 5.3 Confirm `pg-pool.js`, `pg-classic-pool.js`, `pg-migrated-pool.js`, and `pg-play-pool.js` remain at the root, and that `play/server.js:1` still reads `import { pg } from '../pg-pool.js'` — unedited (design decision 2)
- [x] 5.4 Verify the root invariant: `git ls-files --directory ':(glob)*.js'` returns exactly the four pool modules and no migration entry point, shared helper, or dual-database composite
- [x] 5.5 Confirm `node play/server.js` still loads (start it, hit nothing, stop it) — the demo API is the reason `pg-pool.js` was retained, so its survival is the check that decision 2 was implemented

## 6. Verify against localhost — pass 1, non-destructive

- [x] 6.1 Run `node src/collections-migration/migrate-collections.js --dry-run` and confirm it reports the DRY RUN banner, stages 275,554 collections and 371,774 additional_collection_refs, and rolls back
- [x] 6.2 Confirm the two tables are unchanged after the dry run: `collections` = 275,554, `additional_collection_refs` = 371,774
- [x] 6.3 Note the expected side effect: both identity sequences now sit past `MAX(id)` because `--dry-run` skips `setval`. Task 7.1's `RESTART IDENTITY` resets them; no separate correction is needed

## 7. Verify against localhost — pass 2, through the runner

- [x] 7.1 `TRUNCATE collections, additional_collection_refs RESTART IDENTITY CASCADE` — safe because the only FKs pointing at these tables are `collections`' two self-referential version columns and `additional_collection_refs.collection_id`
- [x] 7.2 Run `node src/run-migrations.js --only collections` and confirm it spawns the step from its new path, passes its three preconditions, and exits 0
- [x] 7.3 Confirm the restored counts match task 1.2 exactly: `collections` = 275,554, `additional_collection_refs` = 371,774
- [x] 7.4 Confirm the untouched neighbours are unchanged: `refs` = 93,940, `persons` = 1,375, `authorities` = 163,067, `name_opinions` = 766,427
- [x] 7.5 Re-run the task 1.3 content sample and compare. Ids and payload content must match; `permid` values will differ, because each run mints fresh UUIDv7 values — confirm the new ones still have version nibble 7
- [x] 7.6 Confirm `src/run-migrations.log` recorded the run with `exit=0` and the two `+275554` / `+371774` deltas

## 8. Confirm the delta specs match what was implemented

Deltas are **not** hand-applied to `openspec/specs/` here. Syncing them is `/opsx:archive`'s job, as it was
for all six prior slices — each landed as its own "Sync and archive …" commit. These tasks verify the deltas
are correct and complete against the implementation; they edit no specification.

- [x] 8.1 Confirm the four delta specs match what was implemented: `migration-script-layout` (inventory gains `src/collections-migration/`, root list → explicit **(none)**, relocation-complete and root-invariant paragraphs, "Root scripts keep their existing conventions" replaced by three new scenarios); `migration-runner` (row 9 repointed, "every entry point under `src/`" paragraph and scenario, "Name survives relocation" future → past tense, "Relocation-stability has no remaining cases" added, `collections` added to the deliberate-rename scenario); `permid-uuidv7` (minted-by table and three actor scenarios path-qualified, mixed-list explanation rewritten as discharged, `src/lib/uuidv7.js` named as literally single); `db-connection-config` ("two parallel sets" framing replaced, retained-root-pools table naming `play/server.js`, no-dual-database-entry-point decision, two vacuous scenarios replaced)
- [x] 8.2 Confirm the deltas' factual claims hold against the tree as built: nine directories in the inventory table, row 9's path equals the runner's `STEPS` entry, all seven minted-by script paths resolve, and the four retained root pools are exactly those named in `db-connection-config`
- [x] 8.3 Confirm `collection-migration` needs no edit — it names no script by filename or path, and its permid requirement cites "the shared UUIDv7 helper module" without one. This task verifies the classification; it edits nothing
- [x] 8.4 Confirm `migration-script-layout`'s citation-form requirement is left unedited (design decision 8): the mixed-list rule stays a general rule rather than becoming a status report

## 9. Final checks

- [x] 9.1 `openspec validate relocate-collections-migration` passes
- [x] 9.2 Sweep for stale path-qualified references to the old locations: `grep -rn "migrate-collections\|test-collections-transforms" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=archive .` — every surviving hit outside `openspec/changes/archive/` must either name the new path or be a bare filename the citation-form rule leaves alone
- [x] 9.3 Confirm no root-level reference to the deleted modules survives in tracked files outside `migration_exploration/`
- [x] 9.4 `git status` shows only the intended moves, edits, and deletions — no stray file left at the repository root
