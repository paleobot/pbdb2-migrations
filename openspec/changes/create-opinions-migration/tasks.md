## 1. Scaffold the `src/` structure and self-contained `src/lib/`

- [x] 1.1 Create `src/` and `src/lib/` directories (leave `migration_exploration/` and the root-level
      `migrate-*.js` untouched)
- [x] 1.2 Copy the four utility modules verbatim into `src/lib/`: `identity.js`, `evidence.js`,
      `anomaly-log.js` from `migration_exploration/lib/` (no edits needed)
- [x] 1.3 Copy `migration_exploration/lib/attribution.js` into `src/lib/attribution.js`, repointing its two
      imports: `opinionAttribution.schema.js` → `../../payloadSchemas/opinionAttribution.schema.js`, and the
      citation builders → `./authorities-builders.js` (see 1.4)
- [x] 1.4 Create `src/lib/authorities-builders.js` by extracting `decodeEntities`,
      `buildCitationFromFields`, and `buildDescriptorsFromFields` from `migrate-authorities.js` (verbatim
      logic; export the three)
- [x] 1.5 Copy the infrastructure utilities into `src/lib/`: `uuidv7.js`, `mariadb-pool.js`, `pg-pool.js`
      (verbatim; their only deps are npm packages + `process.env`)
- [x] 1.6 Create the simplified `src/lib/db.js`: export `{ mariadb, pg, closeAll }` from
      `./mariadb-pool.js` + `./pg-pool.js`, with **no** `MIGRATION_TEST_MODE` branch
- [x] 1.7 Sanity-check imports resolve: `node --check` each `src/lib/*.js`, and a throwaway `import` of
      `src/lib/db.js` + `src/lib/attribution.js` to confirm no path/module errors

## 2. Add the Behavioral rules section to `opinions.md`

- [x] 2.1 Add a `## Behavioral rules` section to `payloadSchemas/mappings/opinions.md`, after the table and
      before `## Notes`, distilled from the superseded `opinions-pair-handlers` spec: status closure / no
      fall-through; primary vs. lineage resolved and skipped independently; per-output reconciliation
      invariant; self-referential edges skipped; and the two "why this token" notes (`misspelling of` uses
      `historical misspelling`; `nomen oblitum` branches per row)
- [x] 2.2 Confirm the section states the `misspelling of` lineage target as `parent_spelling_no` (corrected),
      not `child_no`, consistent with table row 17 and the spec

## 3. Implement `migrate-opinions.js`

- [x] 3.1 Create `src/opinions-migration/migrate-opinions.js` with the standard skeleton (read MariaDB via
      `mariadb`, resolve identity/reference/person maps via `src/lib/identity.js`, write `pg` in batches),
      importing utilities from `../lib/`
- [x] 3.2 Encode the rule tables in-code: `CONCEPT` (`status → [reason, objective]`), `VALIDITY`
      (`status → nomenclatural_status`), `CROSSWALK` (`spelling_reason → lineage reason token`) — transcribed
      from `opinions.md`; resolve reason/status ids from `dictionaries.namechange_reasons` /
      `dictionaries.nomenclatural_statuses` at startup (fail fast if any token is missing)
- [x] 3.3 Implement the assignment disposition (`belongs to`): `subject = child_spelling_no`,
      `containing = parent_spelling_no`; `parent_spelling_no = 0` → `containing_permid = NULL` (warning, not
      skip); nonzero-but-unresolvable → skip-and-log
- [x] 3.4 Implement the concept disposition (4 statuses) and the validity disposition (3 statuses) from the
      in-code tables; validity rows carry no target
- [x] 3.5 Implement the universal dual emission: when `spelling_reason != 'original spelling'`, emit a second
      `name_opinions` lineage edge (`subject = child_spelling_no`, `target = child_no`, reason via
      `CROSSWALK`), resolved and skipped independently of the primary output
- [x] 3.6 Implement the `misspelling of` exception: lineage-only, `reason = 'historical misspelling'`,
      `target = permid(parent_spelling_no)`; skip-and-log when `child_spelling_no == parent_spelling_no`
- [x] 3.7 Implement the `nomen oblitum` per-row branch on `parent_spelling_no`: `!= 0` → concept edge
      (`reason = 'nomen oblitum'`, `target = parent_spelling_no`); `= 0` → `validity_opinions`; independent of
      the lineage backfill
- [x] 3.8 Implement the mistagged-`original spelling` backfill for `belongs to` / `replaced by` /
      `subjective synonym of`: load `mistagged-original-spelling.csv` (repo root) into an
      `opinion_no → inferred_reason` map plus the 3 hard-coded instances (955925→assignment, 71324→reranked,
      912640→assignment); translate `inferred_reason` → token (`duplicate-or-homonym→assignment`,
      `reranked→reranked`, `recombination→recombination`, `correction→correction`); a matching row absent from
      the worklist is skipped-and-logged
- [x] 3.9 Implement the self-reference guard for every output type (`subject == target` / `subject ==
      containing`): skip-and-log, never let it reach the DB constraint
- [x] 3.10 Wire attribution/evidence/persons: `resolveSecondHand` + `assertValidAttribution` (payload-validate
      each attribution), `evidenceFromBasis`, `resolvePersons` — from `../lib/`
- [x] 3.11 Emit the two run artifacts into `src/opinions-migration/`: the anomaly CSV via `createAnomalyLog`
      (`script = migrate-opinions.js`) and a run-summary file with per-output written/skipped counts and the
      reconciliation result; assert `written + skipped == source rows` per output type
- [x] 3.12 Add keyset pagination for large reads (e.g. `belongs to`'s ~743k rows) so memory stays bounded
- [x] 3.13 `node --check` the script

## 4. Build the test harness

- [x] 4.1 Create the harness under `src/opinions-migration/` (rebuilt from the design of
      `migration_exploration/testing/seed-and-run-sample.js` / `run-full-migration.js`): reset the target,
      seed the dependency layer (persons/refs/authorities/root `name_opinions`), run the migration, assert
      per-output reconciliation — targeting the real `pg` (localhost), driving the single script, not 48
      spawns
- [x] 4.2 Support a `--sample` mode (a few real opinions per `(status, spelling_reason)` pair) and a `--full`
      mode
- [x] 4.3 Wire the spec's acceptance scenarios (`specs/opinions-migration/spec.md`) into harness assertions —
      at minimum: rootless→NULL vs. unresolvable→skip, dual-emission independence, `misspelling of` target =
      `parent_spelling_no`, `nomen oblitum` per-row branch, mistagged backfill fires, self-reference skipped,
      reconciliation holds

## 5. Validate end-to-end

- [x] 5.1 Run `--sample` and confirm it completes with reconciliation holding and an anomaly CSV + summary
      written into `src/opinions-migration/`
- [x] 5.2 Run `--full` against the localhost `pg`; confirm per-output reconciliation (written + skipped ==
      source) across all statuses, and spot-check the anomaly ledger for expected buckets
      (`asserted_rootless`, `self_reference`, `parent_spelling_orphan`, `mislabeled_original_spelling`)
- [x] 5.3 Cross-check a handful of migrated rows against Classic (e.g. a `misspelling of` row where
      `parent_spelling_no != child_no`, an asserted-rootless `belongs to`, a targeted vs. untargeted
      `nomen oblitum`) to confirm the corrected targets landed
- [x] 5.4 Add a read-only cross-check harness under `src/opinions-migration/` that compares the freshly
      migrated localhost `assignment_opinions` / `name_opinions` / `validity_opinions` against the
      reference full-run in the Aurora `pbdb2_migration_test` DB (the archived output of
      `migration_exploration`'s 48 handlers). Read Aurora **only** through the existing read-only
      `pg-migrated-pool.js` (rejects anything but SELECT/WITH); add the `PG_MIGRATED_*` vars to `.env`
      (values in the commented AWS block, `PG_MIGRATED_CA_CERT=global-bundle.pem`). The comparison must
      **exclude the per-run generated columns** that legitimately differ between two independent
      migrations — `id`, `permid`, `created_at`, `preceded_by_id`, `succeeded_by_id` — and compare only
      run-independent content.
- [x] 5.5 First confirm the Aurora reference conforms to the current `postgresql/create_new.sql` schema
      (the authority — **not** the superseded `taxa-opinions-draft.sql`): `publication_year` (not `pubyr`),
      `name_opinions.oldpbdb_taxon_no` + `negates` present and no `pages`/`figures`, nullable
      `assignment_opinions.containing_permid`, and untargeted-only `validity_opinions`
      (`nomenclatural_status_id`, no `targeted`/`target_permid`). If the reference predates the 2026-08-18
      model move (targeted `invalid subgroup of` / `nomen oblitum` folded into `name_opinions` concept
      edges), treat those as **known intentional differences** and reconcile/exclude them rather than
      flagging them as diffs — record the reference's generation in the run-summary. Then resolve the
      permid-matching question: sample-test whether `subject_permid` / `target_permid` /
      `containing_permid` are **shared** across the two DBs (dependency layer seeded from the same
      authorities/`name_opinions`-root run) or minted independently. For `name_opinions`, prefer the stable
      `oldpbdb_taxon_no` as the match key where populated; otherwise (and for the other tables) match on the
      permid tuple if shared, else translate each `*_permid` back to its legacy id via each DB's own
      `authorities` / root `name_opinions` mapping before matching. Record which case holds.
- [x] 5.6 Run the cross-check in two layers and assert both hold: (a) **structural** — per-table row
      counts and counts grouped by the discriminators each table actually carries in `create_new.sql`:
      `name_opinions` by `edge_class` / `reason_id` / `negates` / `objective` / `evidence` /
      `target_permid IS NULL` / `rank_id` / `publication_year`; `assignment_opinions` by `questioned` /
      `evidence` / `containing_permid IS NULL` / `publication_year`; `validity_opinions` by
      `nomenclatural_status_id` / `evidence` / `publication_year` — all matching exactly (net of the 5.5
      known-difference reconciliation); (b) **row-level** — a symmetric-difference (full outer join) on the
      run-independent key reports zero rows present in one DB but not the other. Canonicalize
      semantically-equal-but-textually-different fields before matching (`attribution` jsonb key order /
      whitespace, NULL-vs-sentinel normalization) so equivalent rows don't register as diffs; write any
      residual mismatches to a diff report under `src/opinions-migration/` for inspection.

> **5.4–5.6 note (reference source):** the Aurora `pbdb2_migration_test` DB proved to be a stale,
> pre-correction snapshot (no `negates`, targeted validity, 0 lineage edges, only `junior synonym` concept
> edges, 18 `informal` validity rows), so it could not serve as a current-model oracle — recorded by
> `cross-check-aurora.js` (Layer 1). The cross-check was instead run against a **freshly built local
> reference DB** (`run-reference-handlers.js`: a `TEMPLATE` clone of the primary DB, outputs cleared, then
> all 48 `migration_exploration/opinions/` handlers re-run against it over the same MariaDB source). Because
> the clone shares identical dictionaries and root permids, `cross-check-reference.js` compares output rows
> directly on permids. Result: **byte-for-byte identical** on all run-independent content — every table
> matches on count, all discriminator groups, and the row-level multiset fingerprint. The reference DB is
> dropped afterward (`run-reference-handlers.js --drop`).

## 6. Supersede the consolidate change and close out

- [x] 6.1 Abandon `consolidate-opinions-pair-handlers`: remove its change directory (its rules now live in
      `opinions.md` + `specs/opinions-migration/spec.md`; content remains in git history) — do NOT archive it
      (nothing to promote, since this change owns the canonical spec)
- [x] 6.2 Run `openspec validate create-opinions-migration --strict` and resolve any issues
- [ ] 6.3 Archive this change with `openspec archive create-opinions-migration` once the maintainer confirms
      the implementation matches these artifacts
