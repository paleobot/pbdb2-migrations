## Context

The opinions migration exists today only as `migration_exploration/opinions/` — 48 hand-written
`(status, spelling_reason)` handler files, ~43 of them copy-paste duplicates, driven by a testing harness
that spawns each handler through a `MIGRATION_TEST_MODE` shim against `pg_classic`/`pg_migrated`/`pg_play`.
That structure was a deliberate aid to understanding, not a maintainable target. The rules it encodes are
now captured concisely in `payloadSchemas/mappings/opinions.md` (a mapping table plus, as part of this
change, a Behavioral rules section), which was cross-checked against the live MariaDB `pbdb_archive` during
exploration and found to be more accurate than the superseded `consolidate-opinions-pair-handlers` spec on
two points (the `misspelling of` lineage target, and the `nomen oblitum` branch field).

This design covers how that single rule set becomes one streamlined script inside a new, standard `src/`
directory, what gets copied into a self-contained `src/lib/`, and how the script is structured and tested.
The behavioral contract itself lives in `specs/opinions-migration/spec.md`; this document is the *how*.

## Goals / Non-Goals

**Goals:**
- Stand up a conventional `src/` layout (`src/lib/` utilities, `src/opinions-migration/` for the migration)
  that later refactors can extend, without disturbing anything currently in the tree.
- Implement the full `opinions.md` rule set as one `migrate-opinions.js` whose structure mirrors the table:
  three dispositions + one crosswalk + named exceptions, as in-code data and small named branches — not 48
  files, and not a runtime markdown parser.
- Make `src/lib/` self-contained: nothing in it reaches back into a root-level `migrate-*.js` or into
  `migration_exploration/`.
- Preserve, as the migration's acceptance criteria, the behavioral scenarios from the superseded spec, with
  the two corrections established during exploration.

**Non-Goals:**
- Moving or modifying the root-level `migrate-*.js` scripts, or `migration_exploration/` (its `lib/`, 48
  handlers, and testing files stay exactly where they are — `src/lib/` is a copy, not a move). Relocating
  the older scripts under `src/` is a deliberate later refactor.
- Reconciling with the pre-existing `assignment-opinions-migration` / `synonymy-opinions-migration` specs
  (the separate, narrower root-level baseline). Out of scope, as in the superseded change.
- Re-deriving or re-validating the mapping rules. They are taken as given from `opinions.md`; this change
  transcribes them into code, it does not re-litigate them.
- A dedicated play/scratch database or a test-mode DB shim. The harness runs against the real `pg`
  (localhost, per `.env`).

## Decisions

### 1. `src/lib/` is a self-contained copy, with the citation builders extracted (option b)

`src/lib/` is populated by copying the four `migration_exploration/lib/` modules (`identity.js`,
`attribution.js`, `evidence.js`, `anomaly-log.js`) — a verified-equivalent extraction of the top-level
scripts' logic — plus the infrastructure they and the migration need: `uuidv7.js`, `mariadb-pool.js`,
`pg-pool.js`, and `db.js`. To keep `src/lib/` from depending on a root-level `migrate-*.js`, the citation
builders `attribution.js` relies on (`decodeEntities`, `buildCitationFromFields`,
`buildDescriptorsFromFields`) are extracted from `migrate-authorities.js` into a new
`src/lib/authorities-builders.js`, and `src/lib/attribution.js`'s import is repointed there.

*Why a copy, not a shared import:* the two directories sit at the same depth, so most `../../` imports would
resolve either way — but importing across into `migration_exploration/` (which we're leaving as a frozen
exploration artifact) would couple the new standard structure to code we intend to treat as legacy. A copy
makes `src/` independent and lets `migration_exploration/` be deleted wholesale someday without touching
`src/`.

*The one external dependency kept as an import, not a copy:* `payloadSchemas/opinionAttribution.schema.js`.
It is a payload-validation contract, not a utility; copying it would fork that contract. `src/lib/
attribution.js` imports it from `payloadSchemas/`.

### 2. `db.js` is simplified — no `MIGRATION_TEST_MODE` shim

The copied `src/lib/db.js` exports `{ mariadb, pg, closeAll }` built directly from `src/lib/mariadb-pool.js`
and `src/lib/pg-pool.js`, against the real localhost `MARIADB_*` / `PG_*` connections in `.env`. The
original `db.js`'s `MIGRATION_TEST_MODE` branch (which dynamically imports
`migration_exploration/testing/db-test-shim.js` to swap in `pg_classic`/`pg_play`) is dropped — it belongs
to the exploration harness this change does not carry forward, and keeping it would reintroduce exactly the
cross-directory reach Decision 1 removes.

*Alternative considered:* preserve test-mode by also copying `pg-classic-pool.js` / `pg-play-pool.js` and
porting the shim into `src/`. Rejected — it pulls exploration-only test scaffolding into the standard
structure for no benefit, since the new harness (Decision 4) runs against real `pg`.

### 3. `migrate-opinions.js` is table-shaped conventional code, not a config engine

Following the house convention (`payloadSchemas/mappings/*.md` is a human-read spec; `migrate-*.js` is
hand-written code — the markdown is never parsed at runtime), the script transcribes `opinions.md`'s cells
into small in-code structures and dispatches over them:

- a `CONCEPT` map (`status → [reason token, objective]`) for the four concept statuses;
- a `VALIDITY` map (`status → nomenclatural_status`) for the three validity statuses;
- a `CROSSWALK` map (`spelling_reason → lineage reason token`) applied as the universal dual emission;
- named branches for the exceptions: `belongs to` (assignment, with rootless-NULL handling),
  `misspelling of` (lineage-only, target `parent_spelling_no`), `nomen oblitum` (per-row branch on
  `parent_spelling_no`), and the mistagged-`original spelling` backfill (worklist-driven).

Each source row runs the same shape: resolve the primary disposition, resolve the lineage backfill, emit
each independently (a skip in one never blocks the other), and log every skip/warning to the anomaly ledger.
This is denser than the other `migrate-*.js` (which are mostly one-row-in/one-row-out) because opinions is
the first migration that fans one source row out to 1–2 outputs across 3 possible target tables — but it is
the same skeleton (read MariaDB → transform → validate payload → batched `pg` insert → reconcile).

*File split:* start as one `migrate-opinions.js`. If it grows unwieldy, split by target table
(`assignment`/`concept`/`validity` emitters) behind the single entry point — a tasks-time judgment, not a
design commitment.

### 4. The test harness is rebuilt from the exploration harness's design, against real `pg`

`migration_exploration/testing/`'s opinions-relevant files (`seed-and-run-sample.js`,
`run-full-migration.js`) are not salvageable as code — every one spawns the 48 handlers, uses `pairs.js`,
and drives the `MIGRATION_TEST_MODE` shim across three pools. Their *design* is worth keeping: reset the
target, seed the dependency layer (persons/refs/authorities/root `name_opinions`), run the migration, assert
per-output reconciliation; offer a fast **sampled** mode (a few real opinions per pair) and a **full** mode;
keyset-paginate large reads so memory stays bounded over `belongs to`'s ~743k rows. The new harness lives in
`src/opinions-migration/`, drives the single script (a `--sample`/`--full` flag, not 48 spawns), and targets
the real `pg` — consistent with having verified the `nomen oblitum` counts against MariaDB directly during
exploration.

### 5. Run outputs are written into `src/opinions-migration/`

Each run writes two files into the script's own directory: an anomaly ledger via the copied
`createAnomalyLog`, keyed `script = migrate-opinions.js` (columns
`opinion_no,script,target_table,severity,issue,description`), and a run-summary text file with per-output
written/skipped counts and the reconciliation result. This matches the spec's "every source row accounted
for and reconciliation reported" requirement and keeps run artifacts co-located with the script rather than
scattered at the repo root (where the older scripts drop their CSVs today).

### 6. `opinions.md` gains a Behavioral rules section; the superseded spec's scenarios become acceptance tests

The mapping table states *what maps to what*; it cannot state *how the mapper must behave* (independent
resolution/skip, status closure, reconciliation, self-reference skipping, and the two "why this token"
notes). Those are distilled from the superseded `opinions-pair-handlers` spec into a new Behavioral rules
section placed after the table and before the existing Notes. The `misspelling of` lineage target is written
as `parent_spelling_no` (the corrected value), not the stale `child_no` the superseded spec carried. The
superseded spec's `#### Scenario` blocks live on as this change's `specs/opinions-migration/spec.md`
scenarios, which the harness's sampled/full runs exercise.

## Risks / Trade-offs

- **[Risk] Copying `lib/` creates two divergent copies (`src/lib/` and `migration_exploration/lib/`).** →
  **Mitigation:** intentional and bounded — `migration_exploration/` is frozen legacy that this change does
  not modify; `src/lib/` is the forward copy. The eventual deletion of `migration_exploration/` (a later
  refactor) removes the duplication. Until then, only `src/lib/` is maintained.
- **[Risk] The `nomen oblitum` branch field (`parent_spelling_no`) differs from the exploration handler code
  (`parent_no`).** → **Mitigation:** verified against MariaDB during exploration that the two never disagree
  on zero-ness across all 76 `nomen oblitum` rows (indeed across all statuses), so the choice changes no
  row's disposition. `parent_spelling_no` is chosen for consistency with the corrected `opinions.md` and the
  spelling-level fields used elsewhere; the equivalence is noted so it is not re-litigated.
- **[Risk] Running the harness against real `pg` (not a scratch DB) could dirty the target.** →
  **Mitigation:** the harness resets/seeds explicitly before a run and nothing production consumes the
  opinions-migration output yet; the target is the localhost dev PG in `.env`, not a shared/prod system.
  Reconciliation counts surface any partial run. A dedicated scratch DB remains a future option if desired.
- **[Risk] The mistagged-`original spelling` worklist (`mistagged-original-spelling.csv`, 50 rows) plus 3
  hard-coded instances is a curated exception list the rules cannot regenerate.** → **Mitigation:** carried
  forward verbatim from the exploration handlers; a matching row absent from the worklist is
  skipped-and-logged, never silently dropped (spec requirement), so any drift surfaces in the anomaly ledger
  rather than as lost data.
- **[Risk] A spec-and-table with no executable enforcement can drift from the code.** → **Mitigation:** the
  harness derives its assertions from the spec's scenarios and the reconciliation invariant, giving the rule
  set executable teeth that the documentation-only superseded change lacked.
