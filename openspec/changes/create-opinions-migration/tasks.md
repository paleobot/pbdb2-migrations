## 1. Scaffold the `src/` structure and self-contained `src/lib/`

- [ ] 1.1 Create `src/` and `src/lib/` directories (leave `migration_exploration/` and the root-level
      `migrate-*.js` untouched)
- [ ] 1.2 Copy the four utility modules verbatim into `src/lib/`: `identity.js`, `evidence.js`,
      `anomaly-log.js` from `migration_exploration/lib/` (no edits needed)
- [ ] 1.3 Copy `migration_exploration/lib/attribution.js` into `src/lib/attribution.js`, repointing its two
      imports: `opinionAttribution.schema.js` → `../../payloadSchemas/opinionAttribution.schema.js`, and the
      citation builders → `./authorities-builders.js` (see 1.4)
- [ ] 1.4 Create `src/lib/authorities-builders.js` by extracting `decodeEntities`,
      `buildCitationFromFields`, and `buildDescriptorsFromFields` from `migrate-authorities.js` (verbatim
      logic; export the three)
- [ ] 1.5 Copy the infrastructure utilities into `src/lib/`: `uuidv7.js`, `mariadb-pool.js`, `pg-pool.js`
      (verbatim; their only deps are npm packages + `process.env`)
- [ ] 1.6 Create the simplified `src/lib/db.js`: export `{ mariadb, pg, closeAll }` from
      `./mariadb-pool.js` + `./pg-pool.js`, with **no** `MIGRATION_TEST_MODE` branch
- [ ] 1.7 Sanity-check imports resolve: `node --check` each `src/lib/*.js`, and a throwaway `import` of
      `src/lib/db.js` + `src/lib/attribution.js` to confirm no path/module errors

## 2. Add the Behavioral rules section to `opinions.md`

- [ ] 2.1 Add a `## Behavioral rules` section to `payloadSchemas/mappings/opinions.md`, after the table and
      before `## Notes`, distilled from the superseded `opinions-pair-handlers` spec: status closure / no
      fall-through; primary vs. lineage resolved and skipped independently; per-output reconciliation
      invariant; self-referential edges skipped; and the two "why this token" notes (`misspelling of` uses
      `historical misspelling`; `nomen oblitum` branches per row)
- [ ] 2.2 Confirm the section states the `misspelling of` lineage target as `parent_spelling_no` (corrected),
      not `child_no`, consistent with table row 17 and the spec

## 3. Implement `migrate-opinions.js`

- [ ] 3.1 Create `src/opinions-migration/migrate-opinions.js` with the standard skeleton (read MariaDB via
      `mariadb`, resolve identity/reference/person maps via `src/lib/identity.js`, write `pg` in batches),
      importing utilities from `../lib/`
- [ ] 3.2 Encode the rule tables in-code: `CONCEPT` (`status → [reason, objective]`), `VALIDITY`
      (`status → nomenclatural_status`), `CROSSWALK` (`spelling_reason → lineage reason token`) — transcribed
      from `opinions.md`; resolve reason/status ids from `dictionaries.namechange_reasons` /
      `dictionaries.nomenclatural_statuses` at startup (fail fast if any token is missing)
- [ ] 3.3 Implement the assignment disposition (`belongs to`): `subject = child_spelling_no`,
      `containing = parent_spelling_no`; `parent_spelling_no = 0` → `containing_permid = NULL` (warning, not
      skip); nonzero-but-unresolvable → skip-and-log
- [ ] 3.4 Implement the concept disposition (4 statuses) and the validity disposition (3 statuses) from the
      in-code tables; validity rows carry no target
- [ ] 3.5 Implement the universal dual emission: when `spelling_reason != 'original spelling'`, emit a second
      `name_opinions` lineage edge (`subject = child_spelling_no`, `target = child_no`, reason via
      `CROSSWALK`), resolved and skipped independently of the primary output
- [ ] 3.6 Implement the `misspelling of` exception: lineage-only, `reason = 'historical misspelling'`,
      `target = permid(parent_spelling_no)`; skip-and-log when `child_spelling_no == parent_spelling_no`
- [ ] 3.7 Implement the `nomen oblitum` per-row branch on `parent_spelling_no`: `!= 0` → concept edge
      (`reason = 'nomen oblitum'`, `target = parent_spelling_no`); `= 0` → `validity_opinions`; independent of
      the lineage backfill
- [ ] 3.8 Implement the mistagged-`original spelling` backfill for `belongs to` / `replaced by` /
      `subjective synonym of`: load `mistagged-original-spelling.csv` (repo root) into an
      `opinion_no → inferred_reason` map plus the 3 hard-coded instances (955925→assignment, 71324→reranked,
      912640→assignment); translate `inferred_reason` → token (`duplicate-or-homonym→assignment`,
      `reranked→reranked`, `recombination→recombination`, `correction→correction`); a matching row absent from
      the worklist is skipped-and-logged
- [ ] 3.9 Implement the self-reference guard for every output type (`subject == target` / `subject ==
      containing`): skip-and-log, never let it reach the DB constraint
- [ ] 3.10 Wire attribution/evidence/persons: `resolveSecondHand` + `assertValidAttribution` (payload-validate
      each attribution), `evidenceFromBasis`, `resolvePersons` — from `../lib/`
- [ ] 3.11 Emit the two run artifacts into `src/opinions-migration/`: the anomaly CSV via `createAnomalyLog`
      (`script = migrate-opinions.js`) and a run-summary file with per-output written/skipped counts and the
      reconciliation result; assert `written + skipped == source rows` per output type
- [ ] 3.12 Add keyset pagination for large reads (e.g. `belongs to`'s ~743k rows) so memory stays bounded
- [ ] 3.13 `node --check` the script

## 4. Build the test harness

- [ ] 4.1 Create the harness under `src/opinions-migration/` (rebuilt from the design of
      `migration_exploration/testing/seed-and-run-sample.js` / `run-full-migration.js`): reset the target,
      seed the dependency layer (persons/refs/authorities/root `name_opinions`), run the migration, assert
      per-output reconciliation — targeting the real `pg` (localhost), driving the single script, not 48
      spawns
- [ ] 4.2 Support a `--sample` mode (a few real opinions per `(status, spelling_reason)` pair) and a `--full`
      mode
- [ ] 4.3 Wire the spec's acceptance scenarios (`specs/opinions-migration/spec.md`) into harness assertions —
      at minimum: rootless→NULL vs. unresolvable→skip, dual-emission independence, `misspelling of` target =
      `parent_spelling_no`, `nomen oblitum` per-row branch, mistagged backfill fires, self-reference skipped,
      reconciliation holds

## 5. Validate end-to-end

- [ ] 5.1 Run `--sample` and confirm it completes with reconciliation holding and an anomaly CSV + summary
      written into `src/opinions-migration/`
- [ ] 5.2 Run `--full` against the localhost `pg`; confirm per-output reconciliation (written + skipped ==
      source) across all statuses, and spot-check the anomaly ledger for expected buckets
      (`asserted_rootless`, `self_reference`, `parent_spelling_orphan`, `mislabeled_original_spelling`)
- [ ] 5.3 Cross-check a handful of migrated rows against Classic (e.g. a `misspelling of` row where
      `parent_spelling_no != child_no`, an asserted-rootless `belongs to`, a targeted vs. untargeted
      `nomen oblitum`) to confirm the corrected targets landed

## 6. Supersede the consolidate change and close out

- [ ] 6.1 Abandon `consolidate-opinions-pair-handlers`: remove its change directory (its rules now live in
      `opinions.md` + `specs/opinions-migration/spec.md`; content remains in git history) — do NOT archive it
      (nothing to promote, since this change owns the canonical spec)
- [ ] 6.2 Run `openspec validate create-opinions-migration --strict` and resolve any issues
- [ ] 6.3 Archive this change with `openspec archive create-opinions-migration` once the maintainer confirms
      the implementation matches these artifacts
