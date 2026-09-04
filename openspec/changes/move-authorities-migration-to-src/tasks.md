## 1. Capture the pre-move baseline

- [x] 1.1 Record the row counts section 6 compares against, from localhost `pbdb` before touching anything: `authorities` 163,067, `name_opinions` 766,427, `assignment_opinions` 927,497, `validity_opinions` 11,327, `refs` 93,940, `collections` 275,554, `additional_collection_refs` 371,774
- [x] 1.2 Run `node play/test-authorities-transforms.js` and confirm `34 passed, 0 failed` — this is the pre-move figure the relocated harness must reproduce
- [x] 1.3 Snapshot the `authority` jsonb of a fixed sample of authorities rows (e.g. 20 by id, spanning all four scenarios) so section 6 can prove citations and descriptors are unchanged, not merely that the row count matched
- [x] 1.4 Re-confirm the three duplicated functions are still byte-identical between `migrate-authorities.js` and `src/lib/authorities-builders.js` (modulo the `export` keyword) — decision 1 rests on this, and it must be true at the moment of the move, not only when the change was scoped
- [x] 1.5 Confirm the working tree is clean apart from the pre-existing untracked files, so the move shows up as a reviewable diff

## 2. Move the migration script

- [x] 2.1 Create `src/authorities-migration/`
- [x] 2.2 `git mv migrate-authorities.js src/authorities-migration/migrate-authorities.js` (use `git mv` so history and rename detection are preserved)
- [x] 2.3 Change its import from `'./db.js'` to `'../lib/db.js'`
- [x] 2.4 Change its import from `'./uuidv7.js'` to `'../lib/uuidv7.js'`
- [x] 2.5 Change its import from `'./payloadSchemas/authority.schema.js'` to `'../../payloadSchemas/authority.schema.js'` — this one deliberately still reaches above `src/`, per design decision 3
- [x] 2.6 Delete the `decodeEntities`, `buildDescriptorsFromFields`, and `buildCitationFromFields` definitions and add `import { buildCitationFromFields, buildDescriptorsFromFields } from '../lib/authorities-builders.js';`. `decodeEntities` is only used by `buildDescriptorsFromFields`, so it is not imported — confirm nothing else in the file references it
- [x] 2.7 Do **not** re-export the two imported builders (design decision 2). Confirm the module's export list is now exactly `classifyScenario`, `buildDescriptorsFromRef`, `buildCitationFromRef`, `buildAuthorityPayload`, `dedupKey`
- [x] 2.8 Confirm `buildAuthorityPayload` still resolves both imported builders at its call sites (the scenarios ②/③ branch), and that the `invokedDirectly` guard at the foot of the file is untouched
- [x] 2.9 Record the moved file's new total line count — task 5.2 needs it to renumber the `docs/` citation

## 3. Move the transform harness

- [x] 3.1 Create `src/authorities-migration/tests/`
- [x] 3.2 `git mv play/test-authorities-transforms.js src/authorities-migration/tests/test-authorities-transforms.js`, keeping the `test-*.js` filename rather than renaming to `*.test.js` (design decision 6)
- [x] 3.3 Split its single import block in two: `buildCitationFromFields` and `buildDescriptorsFromFields` from `'../../lib/authorities-builders.js'`; `classifyScenario`, `buildDescriptorsFromRef`, `buildCitationFromRef`, `buildAuthorityPayload`, and `dedupKey` from `'../migrate-authorities.js'`
- [x] 3.4 Run `node src/authorities-migration/tests/test-authorities-transforms.js` and confirm `34 passed, 0 failed` — identical to the 1.2 baseline. This is the primary guard on the builder collapse
- [x] 3.5 Confirm `play/` still contains `test-collections-transforms.js`, `server.js`, and `schema-query-design.md`, and that nothing else referenced the moved harness

## 4. Update the runner

- [x] 4.1 In `src/run-migrations.js`, change the `authorities` step's `script` from `'migrate-authorities.js'` to `'src/authorities-migration/migrate-authorities.js'`. Leave the step's `name`, `env`, `inputs`, `writes`, `firstWriterOf`, and `preconditions` untouched
- [x] 4.2 Run `node src/run-migrations.js --list` and confirm nine step names print in run order with `authorities` unchanged, and that the process exits 0 without opening a database connection

## 5. Update the source-of-guarantee citation in `docs/`

- [x] 5.1 Confirm the current text at `docs/taxa-opinions-migration-mapping.md:659` cites `migrate-authorities.js:143` for the `persons.id == legacy person_no` guarantee
- [x] 5.2 Locate the persons comment in the moved file and record its actual post-move line number. The old citation is already stale by seven lines (the comment sits at 150-151 before the move), and section 2 removes roughly 34 lines above it — so compute this by reading the file, never by arithmetic
- [x] 5.3 Update the citation to `src/authorities-migration/migrate-authorities.js:<new line>` and confirm by reading that line that it is the `persons.id == legacy person_no by construction` comment
- [x] 5.4 Update the "keep the two in sync until the root scripts move" caveat in `src/lib/authorities-builders.js:1-5`: the root script has now moved and this file is the single definition, so the header should say that rather than describing a duplication that no longer exists
- [x] 5.5 Grep the repository for `migrate-authorities.js` and confirm every surviving mention outside `openspec/changes/archive/` is either updated by this change or a bare filename in a comparative aside per the citation-form rule — specifically leaving `authorities-migration:259,311`, `permid-uuidv7`'s script list, and `name-opinions-migration:18,96` unchanged. This task verifies the classification; it does not edit them
- [x] 5.6 Confirm `.claude/settings.local.json` needs no edit — there is no `Bash(node migrate-authorities.js:*)` permission entry

## 6. Verify by reproducing the migration output

- [x] 6.1 Empty the four target tables with `TRUNCATE authorities, name_opinions, assignment_opinions, validity_opinions RESTART IDENTITY CASCADE`. This replaces the originally-planned `src/opinions-migration/tests/reset-opinions.sql`, which no longer works against the current schema — its `DROP TABLE name_opinions` is refused by the `winning_name_opinion_id` foreign keys on `taxa`, `taxa_clades`, and `taxa_linnaean` (see design decision 10). TRUNCATE performs no DDL and leaves `persons`, `refs`, and `collections` untouched
- [x] 6.2 Before truncating, confirm `taxa`, `taxa_clades`, `taxa_linnaean`, and `taxon_annotations` hold zero rows, so the cascade discards nothing (all confirmed 0; the cascade additionally reached the empty `cycle_cuts` and `taxa_attachments`)
- [x] 6.3 Run `node src/run-migrations.js --only authorities`; confirm exit 0 and `authorities` = **163,067** exactly. Do not use `--from authorities` — preflight 4/5 will abort on four populated first-writer tables (design decision 10)
- [x] 6.4 Confirm the sampled `authority` jsonb payloads from 1.3 are byte-identical to their pre-move values. This, not the row count alone, is what proves the builder collapse changed no citation or descriptor
- [x] 6.5 Record the run's scenario counters and confirm its internal `accounted == sourceRows` check passes (517,287 == 517,287; ① 258,965 / ② 7 / ③ 241,706 / ④ 16,606; orphan-ref 3; both-zero 1; survivors 163,067; merges 354,217). Note: these cannot be diffed against a pre-move *run*, because none exists and none could — the migration is not idempotent, so running it before the move would have doubled the table. The cross-move equivalence is carried instead by survivors == the pre-move table count and by the 6.4 checksum, which subsumes the counters entirely: any change in scenario classification would alter a payload
- [x] 6.6 Run `node src/run-migrations.js --only authorities-opinions`; confirm exit 0 and `name_opinions` = **517,284** root rows
- [x] 6.7 Run `node src/run-migrations.js --only opinions`; confirm exit 0, `name_opinions` = **766,427**, `assignment_opinions` = **927,497**, `validity_opinions` = **11,327**
- [x] 6.8 Confirm `persons`, `refs` (93,940), `collections` (275,554), and `additional_collection_refs` (371,774) are untouched, proving the verification introduced no live-PBot nondeterminism

## 7. Reconcile the permid-uuidv7 spec drift

- [x] 7.1 Confirm the `authorities-migration` delta rewrites "Generate fresh permid per inserted authority" to UUIDv7 in both the requirement text (`:275`) and the scenario's THEN clause (`:279`), while leaving the bare `migrate-refs.js` aside in that same sentence unqualified
- [x] 7.2 Confirm the `refs-migration` delta rewrites "Generate permid UUID" (`:27`) to UUIDv7 and preserves both existing scenarios, including the idempotent-re-run one
- [x] 7.3 Confirm the `collection-migration` delta rewrites "Generate a fresh permid per collection" (`:192`) to UUIDv7
- [x] 7.4 Confirm the `permid-uuidv7` delta expands the in-scope inventory from six tables to all fourteen minted permid columns, adds the minted-versus-reference rule, and restates the timescales/intervals exclusion against the expanded list
- [x] 7.5 Re-run the audit that justified these deltas and confirm it still holds: zero `randomUUID` / `uuidv4` / `gen_random_uuid` occurrences in any JavaScript outside `node_modules`, and zero non-v7 permids in every table carrying a minted permid
- [x] 7.6 Confirm no code change follows from section 7 — every script already generates UUIDv7 via the shared helper. If any task here implies a code edit, the audit in 7.5 was wrong and must be re-run before proceeding

## 8. Update specifications

- [x] 8.1 Confirm all eight delta specs match what was implemented: `migration-script-layout` (inventory: root list three → two, `src/authorities-migration/` added), `migration-runner` (run-order row 6 repointed, "Name survives relocation" rewritten against `migrate-collections.js`), `permid-uuidv7`, `authorities-migration`, `refs-migration`, `collection-migration`, `assignment-opinions-migration`, and `synonymy-opinions-migration`
- [x] 8.2 Confirm each MODIFIED requirement carries the complete requirement block including every scenario, since partial MODIFIED content silently loses detail at archive time
- [x] 8.3 Run `openspec validate move-authorities-migration-to-src` and confirm it passes
- [x] 8.4 Do **not** hand-edit any file under `openspec/specs/` — the deltas reach the main specs via `/opsx:sync` or at archive time

## 9. Finish

- [ ] 9.1 Commit the two moves, the runner and docs updates, and the change artifacts together on the current branch
- [ ] 9.2 Run `/opsx:verify` before archiving
