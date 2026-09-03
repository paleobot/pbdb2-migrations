## 1. Rename the two directories

- [x] 1.1 Confirm the working tree is clean apart from the pre-existing untracked files, so the renames show up as a reviewable diff
- [x] 1.2 Confirm each directory still contains only its entry-point script — no `tests/` subdirectory and no run artifacts, so nothing else travels with the rename
- [x] 1.3 `git mv src/pbot-persons-migrations src/pbot-persons-migration`
- [x] 1.4 `git mv src/pbot-refs-migrations src/pbot-refs-migration`
- [x] 1.5 Confirm `git status` records two renames with 100% similarity, not deletes plus adds — the scripts must be byte-for-byte unchanged, since only their parent directory's name differs

## 2. Update the executable paths

- [x] 2.1 Update the two `.claude/settings.local.json` permission entries naming the old directories (`Bash(node src/pbot-persons-migrations/…)` and `Bash(node src/pbot-refs-migrations/…)`) to the new paths, and confirm the file is still valid JSON
- [x] 2.2 Note in the change record that this file is gitignored, so the edit is real but uncommitted — a fresh clone has nothing stale to fix, only this working copy does

## 3. Confirm nothing else referenced the old names

- [x] 3.1 Grep the repo for `pbot-persons-migrations` and `pbot-refs-migrations` and confirm every surviving mention outside `openspec/changes/archive/` is in this change's own artifacts. Expect zero in `.js` files — the `src/lib/` rule forbids a migration importing a sibling directory, so a directory name cannot appear in any script
- [x] 3.2 Confirm the archive's mentions are left untouched, per `design.md` decision 5: an archived change records what was true when it landed, and the `migration-script-layout` inventory is the authority on where a script lives today
- [x] 3.3 Confirm no `docs/`, `README.md`, or `package.json` reference exists to either old path

## 4. Verify the scripts still resolve

- [x] 4.1 Syntax-check both moved scripts from their new locations (`node --check`)
- [x] 4.2 Confirm both still resolve `../lib/pg-pool.js` and `../lib/uuidv7.js` — the `..` resolves identically from either directory name, so this confirms the rename rather than testing it
- [x] 4.3 Do **not** run either migration. Per `design.md` decision 6 a run would prove nothing about a directory rename while importing unrelated upstream drift from the live PBot source, muddying the record

## 5. Update specifications

- [x] 5.1 Confirm the `migration-script-layout` delta matches what was implemented: three MODIFIED requirements — the directory-naming requirement (positive `<subject>-migration` convention added, literal-names rule reframed, "Deliberate name asymmetry preserved" scenario gone), the persons run-order citation, and the inventory's two renamed rows
- [x] 5.2 Confirm the removed pbot-schemas singular-naming scenario is genuinely covered by the new "Singular naming regardless of source system" scenario, so nothing is lost by dropping it — per `design.md` decision 4 it is being generalised, not reversed
- [x] 5.3 Confirm the resulting spec contains no requirement that forbids what another requirement mandates — specifically that nothing still says a name SHALL NOT be normalized for mutual consistency, which is what this change does
- [x] 5.4 Run `openspec validate singularize-pbot-migration-directories` and confirm it passes
- [x] 5.5 Do **not** hand-edit `openspec/specs/migration-script-layout/spec.md` — the delta reaches the main spec via `/opsx:sync` or at archive time

## 6. Finish

- [ ] 6.1 Commit the renames and the change artifacts together on the current branch
- [ ] 6.2 Run `/opsx:verify` before archiving
