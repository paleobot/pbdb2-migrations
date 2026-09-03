## 1. Step table and inspection

- [x] 1.1 Create `src/run-migrations.js` with the nine-step declarative table from design decision 1: `name`, `script`, `env`, `inputs`, `writes`, `firstWriterOf`, `preconditions`, optional step-specific `postcondition` — in the frozen order `persons → pbot-persons → refs → pbot-refs → pbot-schemas → authorities → authorities-opinions → opinions → collections`
- [x] 1.2 Populate `script` paths, noting that `authorities`, `authorities-opinions`, and `collections` resolve to the repository root while the other six resolve under `src/`; resolve all paths relative to the repo root rather than the cwd
- [x] 1.3 Populate `writes` per step, and `firstWriterOf` as a separate field — `persons` (step 1 only), `refs` (step 3 only), and `name_opinions` (step 7 only) are first-written by one step each despite having two writers
- [x] 1.4 Populate `env` per step: `PG` for all nine; `MARIADB` for persons, refs, authorities, authorities-opinions, opinions, collections; `PBOT` for pbot-persons and pbot-schemas
- [x] 1.4a Populate `inputs` per step — empty for eight steps, and `mistagged-original-spelling.csv` for `opinions`; declare the path rather than deriving it, so a later relocation of that file changes one field
- [x] 1.5 Implement `--list`, printing step names in run order and exiting 0 without opening a database connection
- [x] 1.6 Verify `node src/run-migrations.js --list` prints the nine names in order with no `.env` loaded and no connection attempted

## 2. Argument parsing and flag conflicts

- [x] 2.1 Parse `--createdb`, `--from <step>`, `--only <step>`, `--list`; reject any unrecognised flag
- [x] 2.2 Reject `--from` together with `--only`, exiting non-zero before any database connection
- [x] 2.3 Reject `--createdb` with `--from <step>` or `--only <step>` where the step is not `persons`, with a message explaining that `--createdb` yields an empty database while the selection asserts earlier steps have run
- [x] 2.4 Reject an unknown `--from` / `--only` value, listing the valid step names; confirm a numeric value such as `--from 6` is rejected as unknown
- [x] 2.5 Implement selection as a slice of the step table — `--from` selects that step through the end, `--only` selects exactly one
- [x] 2.6 Verify every rejection in 2.2–2.4 exits non-zero and prints its explanation without connecting to PostgreSQL or MariaDB

## 3. Predicate vocabulary and preflight tier

- [x] 3.1 Open one `pg` pool for the runner from `src/lib/pg-pool.js`, used only for assertion counts and the `--createdb` apply, closed in a `finally`
- [x] 3.2 Implement the predicate vocabulary as single-`COUNT(*)` checks that report predicate and observed value on failure: `empty(table)`, `nonEmpty(table)`, and the JSONB-key variants `noneHave(table, jsonPath)` / `someHave(table, jsonPath)` covering `person->'legacyIDs'->>'pbotID'`, `reference->'legacyIDs'->>'pbotID'`, and `reference->'legacyIDs'->>'oldpbdbID'`
- [x] 3.3 Implement preflight check 1 — environment variables as the union over *selected* steps only: `PG_HOST`/`PG_USER`/`PG_PASSWORD`/`PG_DATABASE`, `MARIADB_HOST`/`MARIADB_USER`/`MARIADB_PASSWORD`/`MARIADB_DATABASE`, `PBOT_TOKEN`
- [x] 3.4 Implement preflight check 2 — PostgreSQL connectivity, plus MariaDB connectivity only if a selected step declares `MARIADB`
- [x] 3.5 Implement preflight check 3 — all 14 `dictionaries.*` tables exist and are non-empty (`genders`, `roles`, `interval_types`, `zone_types`, `taxonomy_ranks`, `reference_types`, `book_types`, `parts_preserved`, `notable_features`, `namechange_reasons`, `nomenclatural_statuses`, `admin0`, `admin1`, `maritime`)
- [x] 3.6 Implement preflight check 4 — every table in the union of `firstWriterOf` across selected steps is empty
- [x] 3.7 Implement preflight check 5 — every path in the `inputs` of a selected step exists and is readable, checked against the declared paths rather than inferred from script source
- [x] 3.8 Verify against the populated localhost database that a full run aborts in preflight naming a non-empty first-writer table, before spawning anything
- [x] 3.9 Verify `--from authorities` passes the environment check with `PBOT_TOKEN` unset
- [x] 3.10 Verify that with `mistagged-original-spelling.csv` temporarily renamed, a full run aborts in preflight naming that file rather than failing inside `opinions` at line 123

## 4. Per-step preconditions

- [x] 4.1 Encode the step 1–4 predicates: `persons` empty; `persons` non-empty and no row has `legacyIDs.pbotID`; `refs` empty and `persons` non-empty; `refs` non-empty, no `refs` row has `legacyIDs.pbotID`, and at least one `persons` row does
- [x] 4.2 Encode step 5 (`pbot-schemas`): `schemas`/`characters`/`states` empty, plus the borrowed coverage predicates — at least one `persons` row has `legacyIDs.pbotID` and at least one `refs` row has `legacyIDs.pbotID`
- [x] 4.3 Encode steps 6–7: `authorities` empty with at least one `refs` row carrying `legacyIDs.oldpbdbID`; `name_opinions` empty with `authorities` non-empty
- [x] 4.4 Encode step 8 (`opinions`) with its inverted shape — `assignment_opinions` and `validity_opinions` empty, `name_opinions` **non-empty**, `refs` non-empty
- [x] 4.5 Encode step 9 (`collections`): `collections` and `additional_collection_refs` empty, at least one `refs` row carrying `legacyIDs.oldpbdbID`
- [x] 4.6 Evaluate a step's preconditions immediately before spawning it, not all up front, and abort without spawning on failure
- [x] 4.7 Verify against localhost that `--only opinions` fails its `assignment_opinions` empty guard, and that on a database lacking `name_opinions` rows it would fail the non-empty predicate instead — confirming selection cannot bypass the graph

## 5. Spawn loop and postconditions

- [x] 5.1 Spawn each step with `child_process.spawn(process.execPath, [script], { env: process.env })`, piping stdout/stderr through to the runner's output while capturing them
- [x] 5.2 Capture per-table `COUNT(*)` for the step's `writes` immediately before the spawn and again after exit; compute deltas
- [x] 5.3 Fail the step unless exit code is 0 **and** every table in `writes` shows a positive delta; assert no hard-coded expected totals
- [x] 5.4 Halt the pipeline on the first failure without spawning any later step, exiting non-zero and naming the step, the failed check, and observed versus required state
- [x] 5.5 Verify a spawned step's own `closeAll()`/`closePg()` runs in its child without disturbing the runner's pool, and that an unconditional-`main()` script such as `refs` executes correctly when spawned

## 6. pbot-schemas output verification

- [x] 6.1 Parse the `pbot-schemas` final summary lines for `fetched`, `inserted`, `orphans`, and `skipped` across schemas, characters, and states
- [x] 6.2 Fail the step if `schemasSkipped`, `charactersSkipped`, or `statesSkipped` is non-zero, despite exit code 0
- [x] 6.3 Fail the step if the summary block cannot be found at all — an unparseable summary is an unverified step, never an implied zero
- [x] 6.4 Record but do not fail on non-zero `characterOrphans` / `stateOrphans`, which are recorded outcomes rather than unresolved prerequisites
- [x] 6.5 Verify the parser against real captured output from a `migrate-pbot-schemas.js` run, including a case with non-zero skips

## 7. `--createdb`

- [x] 7.1 Read `postgresql/create_new.sql` and apply it as a single `pg.query()` before preflight's dictionary and emptiness checks and before step 1
- [x] 7.2 Do not shell out to `psql`; rely on the pool's existing `PG_CA_CERT`/SSL configuration
- [x] 7.3 On failure, report the rollback plainly — the implicit single transaction leaves the database empty rather than half-built
- [x] 7.4 On `CREATE SCHEMA dictionaries` failing against a populated database, report that `--createdb` initializes an empty database and does not reset a populated one
- [x] 7.5 Report that creating the database itself is outside the runner when the connection fails because `PG_DATABASE` does not exist
- [x] 7.6 Verify `--createdb` against a freshly created empty database — 37 tables and the 14 seeded dictionaries present afterwards — and verify it fails harmlessly against the populated localhost database

## 8. Run log

- [x] 8.1 Append a delimited block per run to `src/run-migrations.log` — never overwrite
- [x] 8.2 Record the run header: start timestamp and full argument vector
- [x] 8.3 Record per step: name, start/end timestamps, exit code, and before/after/delta counts for every table in `writes`
- [x] 8.4 Record the `pbot-schemas` fetched/inserted/orphan/skipped counters, and close each block with the overall outcome
- [x] 8.5 Resolve the open question from design — log summary values plus any `WARNING:` lines rather than each step's full stdout — and record the decision in `design.md`
- [x] 8.6 Verify two successive runs produce two blocks with the first run's deltas intact

## 9. Full-pipeline verification

- [x] 9.0 Add `CREATE EXTENSION IF NOT EXISTS postgis;` to `postgresql/create_new.sql` beside the existing `ltree` line, and confirm the file still refuses a populated database at `CREATE SCHEMA dictionaries`

- [x] 9.1 Run the complete pipeline with `--createdb` against an empty database and confirm all nine steps pass their preconditions, postconditions, and exit codes
- [x] 9.2 Confirm the observed row counts are consistent with the established migration totals — persons, refs, ~163,067 authorities, ~517,284 `name_opinions` after step 7, 275,554 collections and 371,774 `additional_collection_refs` — recorded in the log rather than asserted by the runner
- [x] 9.3 Confirm `persons.id = person_no` still holds after the persons pair, and that steps 3, 6, 8, and 9 resolved their `authorizer_person_id` / `enterer_person_id` values under the 0-as-NULL sentinel fallback each script already applies, with no FK violations
- [x] 9.4 Confirm `pbot-schemas` reported zero skips on the green-field run, the failure mode this runner exists to catch
- [x] 9.5 Interrupt a run mid-pipeline and confirm `--from <next step>` resumes correctly, with preflight not demanding emptiness of already-loaded tables
- [x] 9.6 Confirm the runner leaves no open pool and exits 0 on success

## 10. Specification sync

- [x] 10.0 Place the runner harness in `src/tests/`, and extend the layout delta to cover harnesses for non-migration scripts (gap found during 6.5)
- [x] 10.1 Confirm the implemented step table matches the run-order table in `specs/migration-runner/spec.md` exactly, including step names and entry-point paths
- [x] 10.2 Confirm no migration script was modified by this change
- [x] 10.2a Add `src/run-migrations.log` to `.gitignore`, matching how every other run artifact in this repo is ignored by explicit path
- [x] 10.3 Run `openspec validate create-migration-runner` and resolve any findings
