## 1. Capture the pre-move baseline

- [x] 1.1 Record the counts section 6 compares against, from localhost `pbdb` before touching anything: `name_opinions` 766,427, `assignment_opinions` 927,497, `validity_opinions` 11,327, `authorities` 163,067, `refs` 93,940, `collections` 275,554, `additional_collection_refs` 371,774
- [x] 1.2 Record the root-row count specifically: `SELECT COUNT(*) FROM name_opinions WHERE edge_class = 'root'` — expected 517,284, the figure task 6.4 must reproduce
- [x] 1.3 Take an md5 over the root rows' stable columns, excluding `permid` and `id` which are regenerated each run — include `oldpbdb_taxon_no`, `new_name`, `rank_id`, `authority_id`, `reference_id`, `publication_year`, `attribution`, `evidence`, `authorizer_person_id`, `enterer_person_id`, ordered by `oldpbdb_taxon_no`. This is what proves content rather than cardinality
- [x] 1.4 Confirm `taxa`, `taxa_clades`, `taxa_linnaean`, `taxa_attachments`, and `cycle_cuts` are empty, so the verification cascade in 6.2 discards nothing
- [x] 1.5 Confirm the working tree is clean apart from the pre-existing untracked files

## 2. Move and rename the script

- [x] 2.1 Create `src/authority-opinions-migration/`
- [x] 2.2 `git mv migrate-authorities-opinions.js src/authority-opinions-migration/migrate-authority-opinions.js` — a move and a rename in one step; use `git mv` so rename detection survives
- [x] 2.3 Change its import from `'./db.js'` to `'../lib/db.js'`
- [x] 2.4 Change its import from `'./uuidv7.js'` to `'../lib/uuidv7.js'`
- [x] 2.5 Change its import from `'./payloadSchemas/opinionAttribution.schema.js'` to `'../../payloadSchemas/opinionAttribution.schema.js'` — deliberately still reaching above `src/`, per design decision 1 of the authorities slice and the precedent in `src/lib/attribution.js:5`
- [x] 2.6 Confirm `git diff` on the moved file shows exactly three changed lines and that its total line count is unchanged at 282 — no function is being removed here, unlike the previous slice
- [x] 2.7 Confirm the module still exports `buildAttribution` and `parsePublicationYear` unchanged, and that the `invokedDirectly` guard at the foot of the file is untouched
- [x] 2.8 Confirm `parsePublicationYear` is still defined locally and NOT imported from `src/lib/attribution.js` — the near-twin `parseYear` is deliberately not adopted (design decision 5)

## 3. Rename the runner step

- [x] 3.1 In `src/run-migrations.js`, change the step's `name` from `'authorities-opinions'` to `'authority-opinions'` and its `script` to `'src/authority-opinions-migration/migrate-authority-opinions.js'`. Leave `env`, `inputs`, `writes`, `firstWriterOf`, and `preconditions` untouched
- [x] 3.2 Update the dependency-graph comment at `src/run-migrations.js:74`, which names the step in its ASCII diagram
- [x] 3.3 Run `node src/run-migrations.js --list` and confirm nine names print in run order with `authority-opinions` at position 7, exiting 0 without a database connection
- [x] 3.4 Confirm `node src/run-migrations.js --only authorities-opinions` is now rejected as an unknown step name — this is what proves the rename took effect end to end rather than only in the table

## 4. Update the remaining executable paths

- [x] 4.1 Update `src/opinions-migration/tests/run-migration.js:26`, `const AUTHORITIES_OPINIONS = join(REPO_ROOT, 'migrate-authorities-opinions.js')`, to the new path under `src/`. This is the easiest path to miss: it lives in another migration's `tests/` directory and fails at spawn time, not at import
- [x] 4.2 Update the error string at `src/opinions-migration/tests/run-migration.js:66`, which names the script in its "run with --full first" guidance
- [x] 4.3 Update the documented command at `src/opinions-migration/tests/reset-opinions.sql:15` from `--only authorities-opinions` to `--only authority-opinions`. Only this comment is touched; repairing that script is out of scope
- [x] 4.4 Check `.claude/settings.local.json` for a permission entry naming the old script or step and update it if present — the authorities slice found none for its script, so verify rather than assume
- [x] 4.5 Update the two prose mentions in `docs/taxa-opinions-migration-mapping.md` at lines 208 and 686

## 5. Update every remaining mention of the old name

- [x] 5.1 Grep the repository for `migrate-authorities-opinions` and for the step name `authorities-opinions`, excluding `openspec/changes/archive/` and this change's own artifacts
- [x] 5.2 Confirm every surviving hit is either updated by this change or a deliberate historical reference (for example the delta specs' own "renamed from" sentences). Per design decision 4, a rename leaves NO mention correct — including comparative asides that a relocation would have left bare
- [x] 5.3 Confirm `migration_exploration/` hits are left alone: that tree is superseded and already broken by the previous slice
- [x] 5.4 Confirm `payloadSchemas/mappings/authorities-opinions.md` is NOT renamed — it is a mapping document, not an executable path or a source-of-guarantee citation

## 6. Verify by reproducing the migration output

- [x] 6.1 Do NOT use `src/opinions-migration/tests/reset-opinions.sql` — it is broken against the current schema, its `DROP TABLE name_opinions` refused by three `winning_name_opinion_id` foreign keys on the taxa tables
- [x] 6.2 Run `TRUNCATE name_opinions, assignment_opinions, validity_opinions RESTART IDENTITY CASCADE`. Confirm `authorities` still holds 163,067 rows afterwards — it is this step's input layer and must NOT be truncated
- [x] 6.3 Confirm `refs`, `collections`, `additional_collection_refs`, and `persons` are untouched by the truncate, so no live-PBot GraphQL source enters the comparison
- [x] 6.4 Run `node src/run-migrations.js --only authority-opinions`; confirm exit 0 and `name_opinions` = **517,284** root rows
- [x] 6.5 Recompute the md5 from 1.3 and confirm it is identical — proving the relocation altered no attribution, year, rank, or authority resolution, not merely that the row count matched
- [x] 6.6 Confirm the run's counters match the pre-move run's shape: rows read, roots minted, orphan-authority skips, both-auth/ent-zero fallbacks, and its internal reconciliation check
- [x] 6.7 Run `node src/run-migrations.js --only opinions`; confirm exit 0, `name_opinions` = **766,427**, `assignment_opinions` = **927,497**, `validity_opinions` = **11,327**
- [x] 6.8 Confirm `authorities` is still 163,067 and `refs` still 93,940 at the end, proving the verification touched only this step's outputs

## 7. Update specifications

- [x] 7.1 Confirm the four delta specs match what was implemented: `migration-runner` (7 requirements), `migration-script-layout` (2), `permid-uuidv7` (1), `synonymy-opinions-migration` (1)
- [x] 7.2 Confirm the `migration-runner` delta carries the step name through all seven requirements — run-order table and dependency graph, preflight environment grouping, precondition table, postcondition mapping, the `--only opinions` scenario, and the halt-on-failure scenario — and that the "Steps are addressed by name" requirement gained the deliberate-decision escape hatch
- [x] 7.3 Confirm the "Relocation already exercised this guarantee" scenario for `authorities` is preserved UNCHANGED — it is the contrast case that keeps the relocation-stability rule legible (design decision 2)
- [x] 7.4 Confirm the `migration-script-layout` delta states the rename-versus-relocation distinction and that its inventory records the deliberate `authority` / `authorities` grammatical difference between the two sibling directories
- [x] 7.5 Confirm each MODIFIED requirement carries its complete block including every scenario, since partial MODIFIED content silently loses detail at archive time
- [x] 7.6 Run `openspec validate move-authority-opinions-migration-to-src` and confirm it passes
- [x] 7.7 Apply the `name-opinions-migration` Purpose correction (line 4, "Implemented by …") as a direct non-delta edit at sync time — per design decision 6, OpenSpec has no delta mechanism for Purpose text. This is the one sanctioned direct edit under `openspec/specs/`; requirement text is still never hand-edited
- [x] 7.8 Confirm `name-opinions-migration` lines 18 and 96 are left unchanged — they name `migrate-authorities.js`, a different script, in comparative asides

## 8. Finish

- [x] 8.1 Commit the move, the renames, the path updates, and the change artifacts together on the current branch
- [x] 8.2 Run `/opsx:verify` before archiving — run inline at archive time: completeness, runner behaviour (step 7 = authority-opinions, old name exits 1), harness spawn path resolves, and no stale filename outside the archive
