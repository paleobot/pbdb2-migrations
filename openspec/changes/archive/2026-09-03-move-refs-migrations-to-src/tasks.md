## 1. Capture the pre-move baseline

- [x] 1.1 Record the four baseline measures from localhost before touching anything: `refs` total (93,879), rows carrying `legacyIDs.oldpbdbID` (93,705), rows carrying `legacyIDs.pbotID` (174, ids 93,904–94,077), and MariaDB `MAX(reference_no)` (93,903). Section 5 compares against these.
- [x] 1.2 Snapshot the permids of a fixed sample of PBDB-sourced refs (e.g. 20 rows by id) so section 5 can prove the re-run preserved them rather than assuming `ON CONFLICT` omitted the column
- [x] 1.3 Confirm the working tree is clean apart from the pre-existing untracked files, so the move shows up as a reviewable diff

## 2. Move `migrate-refs.js`

- [x] 2.1 Create `src/refs-migration/`
- [x] 2.2 `git mv migrate-refs.js src/refs-migration/migrate-refs.js` (use `git mv` so history and rename detection are preserved)
- [x] 2.3 Change its import from `'./db.js'` to `'../lib/db.js'`
- [x] 2.4 Change its import from `'./uuidv7.js'` to `'../lib/uuidv7.js'`
- [x] 2.5 Confirm `git diff` on the moved file shows exactly two changed lines, and that the file's total line count is unchanged (the `docs/` citation to `migrate-refs.js:300` depends on it)

## 3. Move `migrate-pbot-refs.js`

- [x] 3.1 Create `src/pbot-refs-migrations/` — note the deliberate trailing `s` on `migrations`, which its sibling `src/refs-migration/` does not have; do not normalize it
- [x] 3.2 `git mv migrate-pbot-refs.js src/pbot-refs-migrations/migrate-pbot-refs.js`
- [x] 3.3 Change its import from `'./pg-pool.js'` to `'../lib/pg-pool.js'`
- [x] 3.4 Change its import from `'./uuidv7.js'` to `'../lib/uuidv7.js'`
- [x] 3.5 Confirm `git diff` shows exactly two changed lines, and that the script still imports no MariaDB module (its PG-only connection requirement)

## 4. Update the two stale path references

- [x] 4.1 Update the `Bash(node migrate-refs.js:*)` permission entry in `.claude/settings.local.json:15` to `Bash(node src/refs-migration/migrate-refs.js:*)`
- [x] 4.2 Update the `migrate-refs.js:300` citation in `docs/taxa-opinions-migration-mapping.md:661` to `src/refs-migration/migrate-refs.js:300`, and confirm line 300 of the moved file is still `id: ref.reference_no`
- [x] 4.3 Grep the repo for `migrate-refs.js` and `migrate-pbot-refs.js` and confirm every surviving mention outside `openspec/changes/archive/` is a bare filename in a comparative aside, per the citation-form rule — specifically `authorities-migration:259,275,311`, `permid-uuidv7:12,16`, `pbot-person-migration:157`, and `migrate-authorities.js:153,194`. Leave all eight unchanged; this task verifies the classification, it does not edit them.

## 5. Verify by re-running both migrations

- [x] 5.1 Run `node src/refs-migration/migrate-refs.js` against localhost; confirm exit 0 and that it upserts the full MariaDB source count (93,705). Its built-in check compares PG total against the MariaDB count, so with 174 PBot rows present it logs `Verification WARNING: PostgreSQL has 93879 rows but source had 93705` — pre-existing expected behaviour, not a regression from the move.
- [x] 5.2 Confirm the sampled permids from 1.2 are byte-identical after the run, proving `ON CONFLICT (id) DO UPDATE SET` still omits `permid`
- [x] 5.3 Run `node src/pbot-refs-migrations/migrate-pbot-refs.js` against localhost; confirm exit 0. PBot is a **live** GraphQL source, so a first run may legitimately insert references added upstream since the last one.
- [x] 5.4 Run `migrate-pbot-refs.js` a second time consecutively and confirm it reports zero new inserts — this, not the first run, is what proves idempotency survived the move
- [x] 5.5 Confirm the move changed no data: rows carrying `legacyIDs.oldpbdbID` must still equal 93,705 exactly (nothing lost or duplicated on the PBDB side), and any change in total row count must be fully accounted for by upstream PBot additions identified in 5.3
- [x] 5.6 Confirm PBot-sourced ids remain contiguously above MariaDB's `MAX(reference_no)` of 93,903, i.e. no id collision was introduced

## 6. Update specifications

- [x] 6.1 Confirm the `migration-script-layout` delta spec matches what was implemented: the inventory MODIFIED (two scripts moved to the `src/` table, root list six → four) and the citation-form requirement ADDED
- [x] 6.2 Run `openspec validate move-refs-migrations-to-src` and confirm it passes
- [x] 6.3 Do **not** hand-edit `openspec/specs/migration-script-layout/spec.md` — the delta reaches the main spec via `/opsx:sync` or at archive time

## 7. Finish

- [x] 7.1 Commit the moves, the two reference updates, and the change artifacts together on the current branch
- [x] 7.2 Run `/opsx:verify` before archiving
