## 1. Capture and preserve the pre-move baseline

- [x] 1.1 Confirm the working tree is clean apart from the pre-existing untracked files, so the move shows up as a reviewable diff
- [x] 1.2 Save the baseline capture query into the change directory as `capture-baseline.mjs`, so the baseline is reproducible after the session scratchpad is gone. It must emit, per table, both the payload form (JSONB with `id`/`permid` projected out) and the `*_structure.json` form that resolves every FK through to the target row's `legacyIDs->>'pbotID'` — see `design.md` decision 4 for why the structural form is the one that proves anything
- [x] 1.3 Run it against localhost and confirm it reproduces the captured baseline: 10 schemas / 301 characters / 1,183 states / 1 additional_schema_ref, and 0 schemas with an unresolvable `reference_id` (a total structural join, so the later diff is not a field of nulls)
- [x] 1.4 Copy the baseline JSON into the change directory alongside the script, so verification in section 5 does not depend on the session scratchpad surviving. Stored as `baseline.tgz` (185 KB) rather than nine loose files (1.1 MB) — uncompressed it would have been 2.6x the largest tracked file in the repo, which is disproportionate for one change's verification evidence. `tar xzf baseline.tgz` restores it; `capture-baseline.mjs` documents the format

## 2. Move `migrate-pbot-schemas.js`

- [x] 2.1 Create `src/pbot-schemas-migration/` — **singular** `migration`, deliberately unlike its `src/pbot-persons-migrations/` and `src/pbot-refs-migrations/` neighbours, per `design.md` decision 2. Do not normalize it to match them
- [x] 2.2 `git mv migrate-pbot-schemas.js src/pbot-schemas-migration/migrate-pbot-schemas.js` (use `git mv` so history and rename detection are preserved)
- [x] 2.3 Change its import from `'./pg-pool.js'` to `'../lib/pg-pool.js'`
- [x] 2.4 Change its import from `'./uuidv7.js'` to `'../lib/uuidv7.js'`
- [x] 2.5 Confirm `git diff` on the moved file shows exactly two changed lines and the file is still 602 lines, so every line number in it is preserved
- [x] 2.6 Confirm the script still imports no MariaDB module and no `db.js` — its dependency surface is `../lib/pg-pool.js`, `../lib/uuidv7.js`, and `fetch()`, and nothing else

## 3. Update the one stale reference

- [x] 3.1 Grep the repo for `migrate-pbot-schemas` and confirm exactly two mentions survive outside `openspec/changes/archive/`: `migration-script-layout/spec.md:126` and `permid-uuidv7/spec.md:16`
- [x] 3.2 Confirm `permid-uuidv7:16` is left unchanged. It is a mixed list of five normative actors of which `migrate-authorities.js` and `migrate-collections.js` are still at root, so the citation-form rule keeps the whole list unqualified until the last of them moves. This task verifies the classification; it does not edit anything
- [x] 3.3 Confirm no `.claude/settings.local.json` permission entry names this script, so there is no executable path to update
- [x] 3.4 Confirm `pbot-schema-migration/spec.md` contains no filename or path citation of the script, so it needs no delta

## 4. Prove the reload is possible before destroying anything

- [x] 4.1 Confirm `PBOT_TOKEN` is set and `PG_*` points at localhost `pbdb`
- [x] 4.2 Check that the moved script's imports resolve, **without running the migration** — e.g. `node --check src/pbot-schemas-migration/migrate-pbot-schemas.js` for syntax, plus a bare `node -e "import('./src/lib/pg-pool.js')"`-style resolution probe of the two `../lib/` targets. Do **not** invoke the migration itself here: it begins inserting immediately after its first fetch and there is no dry-run flag, so a run against the still-populated tables would duplicate them and interrupting mid-run would leave a partial duplicate set — the exact hazard `design.md` decision 3 documents
- [x] 4.3 Probe the live endpoint independently of the script: POST a trivial query to `pbot.paleobiodb.org/graphql` with the `PBOT_TOKEN` bearer header and confirm a 200 with a well-formed response. If the endpoint is unreachable or the token is rejected, **stop**: do not truncate, and fall back to the resolution-check-only verification in `design.md` decision 3 (module-resolution check only), recording that the reload was not performed
- [x] 4.4 Confirm the four tables still hold 10 / 301 / 1,183 / 1 — nothing in this section touched them

## 5. Verify by clear-and-reload

- [x] 5.1 `TRUNCATE additional_schema_refs, states, characters, schemas;` — all four in one statement, which closes the FK graph so no `CASCADE` is needed. Not needing `CASCADE` is itself the check that nothing outside the cluster is caught by it
- [x] 5.2 Run `node src/pbot-schemas-migration/migrate-pbot-schemas.js` to completion and confirm exit 0
- [x] 5.3 Read the summary block and confirm `schemasSkipped`, `charactersSkipped`, `statesSkipped`, and `characterOrphans` are zero, and that any remaining `stateOrphans` is individually attributed to an upstream data defect that also orphaned the row **before** the move. A clean exit is not sufficient — this script skips unresolvable rows with a `console.warn` and still exits 0, so a silent under-migration would otherwise pass unnoticed (`design.md` decision 5). **Amended during apply**: the criterion was originally "all zero", which the first reload proved too strong — one upstream state (`ed088383…`, "other") is its own `stateOf` parent, a self-referential cycle the level-by-level insertion can never resolve. It is absent from the pre-move baseline too, so identical behavior on identical pathological input is evidence the move preserved behavior rather than a defect it introduced
- [x] 5.3a Record the first reload attempt as a finding: it exited 0 having inserted only 5 of 8 schemas, 168 of 336 characters, and 797 of 1,326 states, because localhost's PBot-sourced `persons` (70 of 313) and `refs` (174 of 280) were stale relative to upstream. Three schemas could not resolve a prerequisite — `aeef6256…` (both its primary ref `a093e770…` and its enterer), `93e1379b…` and `1f418977…` (enterers Ellen Currano, Julian Moore). This is `design.md` decision 5's run-order hazard observed live, not a regression from the move. Resolved by running the documented prerequisites `migrate-pbot-persons.js` (pbot-sourced persons 70 → 93) and `migrate-pbot-refs.js` (pbot refs 174 → 234, `oldpbdbID` unchanged at 93,705), then re-truncating and reloading
- [x] 5.4 Confirm the counts are 8 / 336 / 1,325 / 1, and that each delta from the 10 / 301 / 1,183 / 1 baseline reconciles against the upstream comparison made in section 4: three schemas deleted upstream (`3e97bfeb…`, `61115b59…`, `d54653b3…`, all titled "To be deleted", all with zero characters, states, and additional refs), one added (`aeef6256…`, "Holian et al. Fern Schema"), and +35 characters / +142 states of upstream growth (upstream grew by 143 states; one of them, `ed088383…`, is the self-parented row 5.3 accounts for and is not inserted). A delta that does *not* reconcile is a failure; these do. **Amended during apply** — the task originally expected the baseline counts to return unchanged, which a live source made false; see 5.5 for the criterion that replaces exact match
- [x] 5.5 Re-run the capture script and diff the `*_structure.json` files against the baseline **on the intersection**: every pbotID present in both the baseline and the reload MUST round-trip byte-identically in pbotID space — parentage, primary reference, and enterer are all invariant under the id renumbering the reload causes. Rows only in the baseline must be exactly the three upstream-deleted stubs; rows only in the reload must be exactly the upstream additions. **This is the proof the move preserved behavior**; the counts in 5.4 are only the fast check.
  Result: characters (301 shared) and states (1,183 shared) round-trip byte-identically with zero baseline-only rows. Schemas: 7 shared, 5 identical and 2 differing only in the projected `enterer_pbot_id`, which resolved to `None` in the baseline and to Julian Moore's pbotID in the reload. That is **not** a difference in what the migration wrote — both runs stored `enterer_person_id = 1299` for those two schemas, byte-identical; the projection changed because the prerequisite `migrate-pbot-persons.js` run backfilled `legacyIDs.pbotID` onto persons row 1299 underneath it. A projection artifact from a dependency that moved, not a behavioral delta
- [x] 5.6 Diff the payload files and confirm the JSONB documents round-trip unchanged. Expect `id` and `permid` to differ legitimately — the finalization does `setval(…, MAX(id))` rather than restarting identity, and permids are freshly minted per insert by design
- [x] 5.7 Confirm each of the three main tables has exactly one lineage head per row (`succeeded_by_id IS NULL` throughout) and no row acquired a `preceded_by_id`, i.e. the reload created fresh lineages rather than versioning anything

## 6. Update specifications

- [x] 6.1 Confirm the `migration-script-layout` delta matches what was implemented: the inventory MODIFIED with `src/pbot-schemas-migration/` added to the `src/` table and the root list reduced from four scripts to three, plus the scenario recording why this directory name is singular
- [x] 6.2 Run `openspec validate move-pbot-schemas-migration-to-src` and confirm it passes
- [x] 6.3 Do **not** hand-edit `openspec/specs/migration-script-layout/spec.md` — the delta reaches the main spec via `/opsx:sync` or at archive time

## 7. Finish

- [x] 7.1 Commit the move and the change artifacts together on the current branch
- [ ] 7.2 Run `/opsx:verify` before archiving
