## Why

The legacy `opinions` → `assignment_opinions` / `name_opinions` / `validity_opinions` migration currently
exists only as `migration_exploration/opinions/`: 48 hand-written handler files, one per `(status,
spelling_reason)` pair, of which ~43 are copy-paste duplicates. That structure was deliberate — it made the
rules legible one pair at a time — but it is not the shape we want to run or maintain. The mapping rules are
now captured concisely and (verified against the live MariaDB) accurately in
`payloadSchemas/mappings/opinions.md`, following the same "mapping doc → migration script" convention the
other `migrate-*.js` scripts already use. This change implements that table as a single, streamlined
migration script inside a new, standard `src/` directory structure.

## What Changes

- Establish a standard top-level `src/` directory with a self-contained `src/lib/` utility subdirectory,
  so migration code stops living at the repository root and inside `migration_exploration/`. (Moving the
  older root-level `migrate-*.js` scripts under `src/` is explicitly a **later** refactor, not part of this
  change.)
- Populate `src/lib/` as a self-contained copy of the shared transforms plus the infrastructure they need:
  - the four modules from `migration_exploration/lib/` (`identity.js`, `attribution.js`, `evidence.js`,
    `anomaly-log.js`), which are a verified-equivalent extraction of the top-level scripts' logic;
  - the citation/descriptor builders (`decodeEntities`, `buildCitationFromFields`,
    `buildDescriptorsFromFields`) extracted from `migrate-authorities.js`, so `src/lib/attribution.js`
    depends on `src/lib/`, not back on a root-level `migrate-*.js`;
  - the infrastructure utilities `uuidv7.js`, `mariadb-pool.js`, `pg-pool.js`, and a **simplified** `db.js`
    that exports `{ mariadb, pg, closeAll }` against the real localhost connections in `.env`, dropping the
    `MIGRATION_TEST_MODE` shim (which reaches into `migration_exploration/testing/`).
- Add `src/opinions-migration/migrate-opinions.js`: one script implementing the full rule set in
  `opinions.md` — the three canonical dispositions (**assignment**, **concept**, **validity**), the
  universal `spelling_reason → lineage reason` crosswalk applied as an independent second (dual) emission,
  and the named exceptions (`misspelling of`'s lineage-only shape; `nomen oblitum`'s per-row
  targeted/untargeted branch; the mistagged-`original spelling` backfill for `belongs to` / `replaced by` /
  `subjective synonym of`).
- On each run, `migrate-opinions.js` writes two artifacts **into `src/opinions-migration/`**: an anomaly CSV
  in the existing `createAnomalyLog` format (`opinion_no,script,target_table,severity,issue,description`)
  and a run-summary output file (per-output-type written/skipped counts and the reconciliation invariant).
- Add a small test harness under `src/opinions-migration/` supporting a fast **sampled** run (a handful of
  real opinions per pair) and a **full** run, rebuilt from the design of
  `migration_exploration/testing/seed-and-run-sample.js` and `run-full-migration.js` — but targeting the
  real `pg`, not a dedicated play/scratch database, and driving the single script rather than spawning 48
  handlers.
- Extend `payloadSchemas/mappings/opinions.md` with a **Behavioral rules** section distilled from the
  `consolidate-opinions-pair-handlers` spec: the rules a mapping table cannot express (independent
  resolution/skip of primary vs. lineage output, status closure / no fall-through, the reconciliation
  invariant, self-referential-edge skipping, and the two "why this token" notes for `misspelling of` and
  `nomen oblitum`). The `misspelling of` lineage target is written as `parent_spelling_no` (the corrected
  value), not the stale `child_no` the superseded spec carried.
- **Supersede** the `consolidate-opinions-pair-handlers` change: this change's `opinions.md` (table +
  behavioral rules) plus the `opinions-migration` capability spec become the single reference, so that
  documentation-only change is abandoned rather than archived. Its behavioral `#### Scenario` blocks are
  carried forward as this change's acceptance criteria.

Out of scope: `migration_exploration/` is left untouched (its `lib/`, 48 handlers, and testing files stay
where they are — `src/lib/` is a copy, not a move); the root-level `migrate-*.js` scripts are not moved or
modified; the pre-existing `assignment-opinions-migration` / `synonymy-opinions-migration` specs (which
describe the separate, narrower root-level baseline scripts) are not reconciled here.

## Capabilities

### New Capabilities
- `opinions-migration`: the behavioral contract for migrating every legacy `opinions` `(status,
  spelling_reason)` pair to its `assignment_opinions` / `name_opinions` / `validity_opinions` output(s) —
  the three dispositions, the universal lineage crosswalk with independent dual emission, the named
  structural and data-anomaly exceptions, and the run-level invariants (status closure, per-output
  reconciliation, independent skip, no self-referential edges) that the single script must satisfy.

### Modified Capabilities
(none — no existing spec in `openspec/specs/` covers this migration. The `opinions-pair-handlers` spec
lives only inside the unarchived `consolidate-opinions-pair-handlers` change, which this change supersedes
rather than modifies.)

## Impact

- **New:** `src/lib/` (copied/extracted utilities + simplified `db.js`), `src/opinions-migration/`
  (`migrate-opinions.js`, its test harness, and its runtime CSV/summary outputs).
- **Modified:** `payloadSchemas/mappings/opinions.md` (gains the Behavioral rules section; `misspelling of`
  target correction).
- **Superseded / abandoned:** the `consolidate-opinions-pair-handlers` change and its
  `opinions-pair-handlers` delta spec; `migration_exploration/DESIGN.md` and
  `migration_exploration/opinions-pair-mapping.md` remain in place but are no longer the reference.
- **Source → target:** MariaDB `pbdb_archive.opinions` (read via `mariadb`) → PostgreSQL
  `assignment_opinions`, `name_opinions`, `validity_opinions` (written via `pg`), plus reads of migrated
  `name_opinions` (root permids), `refs`, `authorities`, and `persons` for identity resolution.
- **Data-integrity notes:** the 0-as-sentinel convention is handled per existing rules (`parent_spelling_no
  = 0` → asserted-rootless `containing_permid = NULL`, distinct from an unresolvable orphan, which is
  skipped-and-logged; person `authorizer_no`/`enterer_no` 0-sentinel fallback in `resolvePersons`). No
  already-migrated data is altered; nothing currently consumes the opinions-migration output, so there is
  no running system to disrupt.
- **Dependencies:** Node ESM; `mysql2`, `pg`, `uuid`, `ajv`, `dotenv` (all already in use). Runs against the
  localhost `MARIADB_*` and `PG_*` connections in `.env`.
