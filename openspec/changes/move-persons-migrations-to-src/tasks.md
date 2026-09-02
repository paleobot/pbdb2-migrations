## 1. Capture the pre-move baseline

- [x] 1.1 Record the current `persons` row count from localhost PostgreSQL (`SELECT COUNT(*) FROM persons`) — the verification in section 5 compares against it
- [x] 1.2 Confirm the working tree is clean apart from the pre-existing untracked files, so the move shows up as a reviewable diff

## 2. Move `migrate-persons.js`

- [x] 2.1 Create `src/persons-migration/`
- [x] 2.2 `git mv migrate-persons.js src/persons-migration/migrate-persons.js` (use `git mv` so history and rename detection are preserved)
- [x] 2.3 Change its import from `'./db.js'` to `'../lib/db.js'` — this is the only line that changes
- [x] 2.4 Confirm `git diff` on the moved file shows exactly one changed line

## 3. Move `migrate-pbot-persons.js`

- [x] 3.1 Create `src/pbot-persons-migrations/` — note the deliberate trailing `s` on `migrations`, which its sibling `src/persons-migration/` does not have; do not normalize it
- [x] 3.2 `git mv migrate-pbot-persons.js src/pbot-persons-migrations/migrate-pbot-persons.js`
- [x] 3.3 Change its import from `'./pg-pool.js'` to `'../lib/pg-pool.js'` — this is the only line that changes
- [x] 3.4 Confirm `git diff` on the moved file shows exactly one changed line, and that the script still imports no MariaDB module (its "PG-only connection" requirement)

## 4. Update the three inbound references

- [x] 4.1 Update the `Bash(node migrate-persons.js:*)` permission entry in `.claude/settings.local.json` to the new path
- [x] 4.2 Update the comment at `migrate-authorities.js:150` that cites `migrate-persons.js` by path
- [x] 4.3 Grep the repo for `migrate-persons.js` and `migrate-pbot-persons.js` and confirm no stale path reference survives outside `openspec/changes/archive/` (archived changes are historical and are left as-is)

## 5. Verify by re-running both migrations

- [x] 5.1 Run `node src/persons-migration/migrate-persons.js` against localhost; confirm it completes with exit 0 and upserts the full MariaDB source count. Its built-in check compares only against MariaDB, so once PBot-only rows exist it always logs `Verification WARNING: PostgreSQL has N rows but source had 1304` — pre-existing expected behaviour, not a regression from the move.
- [x] 5.2 Run `node src/pbot-persons-migrations/migrate-pbot-persons.js` against localhost; confirm it completes. PBot is a **live** GraphQL source, so a run may legitimately insert people added upstream since the last run (the `pbot-person-migration` spec's "Re-run after new PBot persons added" scenario). Idempotency is therefore proved by a **second consecutive run reporting 0 new inserts**, not by the first run inserting none.
- [x] 5.3 Confirm the move changed no data: the count of rows carrying `legacyIDs.oldpbdbID` must equal the MariaDB source count exactly (nothing lost or duplicated on the PBDB side), and any change in total row count must be fully accounted for by upstream PBot additions identified in 5.2

## 6. Update specifications

- [x] 6.1 Confirm the three delta specs under `openspec/changes/move-persons-migrations-to-src/specs/` still match what was implemented (`migration-script-layout` added; `db-connection-config` and `authorities-migration` modified)
- [x] 6.2 Run `openspec validate move-persons-migrations-to-src` and confirm it passes
- [x] 6.3 Do **not** hand-edit `openspec/specs/authorities-migration/spec.md` or `openspec/specs/db-connection-config/spec.md` — the corrected text reaches the main specs via `/opsx:sync` or at archive time

## 7. Finish

- [x] 7.1 Commit the move, the reference updates, and the change artifacts together on the current branch
- [ ] 7.2 Run `/opsx:verify` before archiving
