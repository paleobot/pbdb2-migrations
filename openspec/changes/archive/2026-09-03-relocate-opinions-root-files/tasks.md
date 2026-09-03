## 1. Move the files

- [x] 1.1 `mkdir src/opinions-migration/inputs/`, then `git mv mistagged-original-spelling.csv src/opinions-migration/inputs/` — confirm git records a rename at 100% similarity and the file is byte-for-byte unchanged
- [x] 1.2 `git mv reset-opinions.sql src/opinions-migration/tests/` — confirm git records a rename
- [x] 1.3 Confirm nothing remains at the repository root that a script under `src/` reads, other than the three migration scripts awaiting their own relocation

## 2. Update the references that assert a location

- [x] 2.1 `src/opinions-migration/migrate-opinions.js:26` — `MISTAGGED_CSV` resolves to `inputs/mistagged-original-spelling.csv` relative to `SCRIPT_DIR`, dropping the two `'..'` segments
- [x] 2.2 `src/opinions-migration/tests/run-migration.js:25` — `RESET_SQL` resolves to `reset-opinions.sql` beside the harness; leave `REPO_ROOT` itself in place, since line 26 still needs it for `migrate-authorities-opinions.js`
- [x] 2.3 `src/run-migrations.js:169` — the `opinions` step's `inputs` entry becomes the path under `src/opinions-migration/inputs/`, still declared rather than derived
- [x] 2.4 `payloadSchemas/mappings/opinions.md:88` — replace "(repo root, git-tracked)" with the file's new path; it names the file as the source of the 50 overrides and states where it lives, so the citation rule requires it be qualified
- [x] 2.5 Confirm the bare mentions are untouched: three in `openspec/specs/opinions-migration/spec.md`, two in `openspec/specs/migration-runner/spec.md`, one in `docs/taxa-opinions-migration-mapping.md:425`, and the strings at `migrate-opinions.js:105` and `:124`

## 3. Correct the reset-opinions.sql header

- [x] 3.1 Remove the stale reference to `migrate-name-opinions.js` "needing a small update first" — it was renamed to `migrate-authorities-opinions.js`, which `tests/run-migration.js:26` already calls
- [x] 3.2 Remove the pointer to "the note in the accompanying message," which is not in the repository
- [x] 3.3 Keep the `scratch-build-reset.mjs` attribution but mark it as no longer present, so the DDL's provenance is not silently erased
- [x] 3.4 Replace the manual "you MUST re-mint the name_opinions ROOT rows" instruction with the runner commands that now do it and verify it: `--only authorities-opinions` then `--only opinions`
- [x] 3.5 Leave every DDL statement in the file untouched — this task edits comments only

## 4. Verify

- [x] 4.1 `node src/run-migrations.js --only opinions` against the populated localhost `pbdb` — preflight check 5 must report the input file present at its new path, then the run must fail on `assignment_opinions` being non-empty, proving the declared path resolves before any database work
- [x] 4.2 Temporarily rename the moved CSV and re-run 4.1 — preflight must name the new path, confirming the declaration was updated rather than merely still passing by accident
- [x] 4.3 Confirm `RESET_SQL` in `tests/run-migration.js` resolves to an existing file, without executing the destructive `--full` path
- [x] 4.4 Confirm `migrate-opinions.js` resolves its worklist from a different working directory — run the check from outside the repository root, since input resolution must be script-relative
- [x] 4.5 Confirm `node src/run-migrations.js --list` and the parser harness `node src/tests/pbot-schemas-summary.test.js` still pass, as a regression check on the runner edit
- [x] 4.6 Confirm `git log --follow` still traces `mistagged-original-spelling.csv` to its original commit

## 5. Specification sync

- [x] 5.1 Confirm the new requirement's scenarios match what was actually done — both destinations, script-relative resolution, and the runner's declared path
- [x] 5.2 Confirm no requirement in `migration-script-layout` now contradicts another, particularly the run-artifact requirement that keeps outputs at the directory root
- [x] 5.3 Record `migration_exploration/opinions/belongs-to/original-spelling.js` as knowingly broken rather than repairing it or treating it as scope
- [x] 5.4 Run `openspec validate relocate-opinions-root-files` and resolve any findings
