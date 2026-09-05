# migration-runner Specification

## Purpose
Define `src/run-migrations.js`: the frozen order in which the nine migrations run, the dependency edges
that justify that order, and the database-state assertions that enforce it. The runner exists because the
order is otherwise reconstructible only by reading each script's PostgreSQL pre-loads, because five of the
nine scripts duplicate their rows on a second run, and because one of them under-migrates while still
exiting 0. It spawns migrations; it never performs one.

## Requirements

### Requirement: The migration run order is frozen in the runner
`src/run-migrations.js` SHALL execute the migration scripts in exactly this order, and this order SHALL be
the authoritative statement of the sequence:

| # | Step name | Entry point |
|---|---|---|
| 1 | `persons` | `src/persons-migration/migrate-persons.js` |
| 2 | `pbot-persons` | `src/pbot-persons-migration/migrate-pbot-persons.js` |
| 3 | `refs` | `src/refs-migration/migrate-refs.js` |
| 4 | `pbot-refs` | `src/pbot-refs-migration/migrate-pbot-refs.js` |
| 5 | `pbot-schemas` | `src/pbot-schemas-migration/migrate-pbot-schemas.js` |
| 6 | `authorities` | `src/authorities-migration/migrate-authorities.js` |
| 7 | `authority-opinions` | `src/authority-opinions-migration/migrate-authority-opinions.js` |
| 8 | `opinions` | `src/opinions-migration/migrate-opinions.js` |
| 9 | `collections` | `src/collections-migration/migrate-collections.js` |

Every entry point in this table now sits under `src/`. The table is the runner's own `STEPS` array restated,
so it is verifiable by reading `src/run-migrations.js` rather than by trusting this specification.

The order SHALL satisfy these dependency edges, each of which exists because the later step reads from
PostgreSQL what the earlier step wrote:

```
persons ──┬─▶ pbot-persons ──┐
          │                  ├─▶ pbot-refs ──▶ pbot-schemas
          └─▶ refs ──────────┤
                             ├─▶ authorities ──▶ authority-opinions ──▶ opinions
                             ├─────────────────────────────────────────────▶ (refs)
                             └─▶ collections
```

- `pbot-persons` matches and updates the rows `persons` created.
- `refs` requires `persons` for its `authorizer_person_id` / `enterer_person_id` foreign keys.
- `pbot-refs` resolves its enterer through `persons.person->'legacyIDs'->>'pbotID'` and deduplicates
  against `refs`.
- `pbot-schemas` resolves its enterer through `persons.person->'legacyIDs'->>'pbotID'` and its primary
  reference through `refs.reference->'legacyIDs'->>'pbotID'`.
- `authorities` reads `refs` filtered on `reference->'legacyIDs'->>'oldpbdbID' IS NOT NULL`.
- `authority-opinions` reads `authorities`.
- `opinions` builds its name permid map from `name_opinions` and its reference map from `refs`.
- `collections` reads `refs` filtered on `reference->'legacyIDs'->>'oldpbdbID' IS NOT NULL`.

The order SHALL NOT be changed except by a change that records the new order in this specification.

Row 9's entry point changes here, and nothing else does: the step keeps its name, its position, and every
dependency edge. This is the last of the nine relocations, so no future change to this table will be a
relocation.

#### Scenario: Full pipeline runs in the specified order
- **WHEN** `src/run-migrations.js` is invoked with no step-selection flag
- **THEN** it runs all nine steps in the order given in the table, and does not begin a step until the preceding step has completed successfully

#### Scenario: Every entry point resolves under src/
- **WHEN** the runner spawns any of the nine steps
- **THEN** the path it spawns is under `src/`, because no migration entry point remains at the repository root

### Requirement: Steps are addressed by name
The runner SHALL identify steps by the step names in the run-order table, and SHALL NOT require or accept
a numeric position as a step identifier. A step name SHALL remain stable when the script it names is
relocated, and SHALL NOT change when steps are appended to the pipeline.

A step name is nonetheless literal: it changes only by a deliberate decision recorded in this
specification, and SHALL NOT be changed as incidental cleanup by a passing reader, nor as a side effect of
relocating the script it names. This mirrors the rule `migration-script-layout` applies to migration
directory names, and it is what distinguishes a renamed step from a step whose name drifted.

Relocation-stability and deliberate renaming are therefore separate rules, not competing ones: a relocation
SHALL NOT change a step name, and a change that does rename a step SHALL record the reason here rather than
letting the rename ride along unexplained with a move that happens to accompany it.

The runner SHALL provide `--list`, which prints the step names in run order and exits without running any
migration or connecting to any database.

#### Scenario: Step named, not numbered
- **WHEN** a user selects a step on the command line
- **THEN** they write `--from authorities`, and `--from 6` is rejected as an unknown step name

#### Scenario: Name survives relocation
- **WHEN** `migrate-collections.js` was relocated to `src/collections-migration/migrate-collections.js`
- **THEN** the step name `collections` was unchanged and only the entry-point path in row 9 of the run-order table was edited, so `--only collections` kept working across the move

#### Scenario: Relocation already exercised this guarantee
- **WHEN** `migrate-authorities.js` was relocated to `src/authorities-migration/migrate-authorities.js`
- **THEN** the step name `authorities` did not change, so `--from authorities` and `--only authorities` kept working across the move and only row 6's entry-point path was edited

#### Scenario: Relocation-stability has no remaining cases
- **WHEN** a reader asks which steps might still change their entry point through a relocation
- **THEN** the answer is none, because all nine scripts are under `src/`, and the relocation-stability rule now governs only hypothetical future moves rather than pending ones

#### Scenario: A deliberate rename is recorded, not inferred from a move
- **WHEN** the step `authorities-opinions` is renamed to `authority-opinions` in the same change that relocates its script
- **THEN** the rename is justified by its own recorded reason — *authority* is attributive, so the singular is correct — and not by the relocation, which on its own would have left the name untouched exactly as it did for `authorities` and `collections`

#### Scenario: Old step name stops resolving
- **WHEN** `--only authorities-opinions` is passed after that step has been renamed
- **THEN** it is rejected as an unknown step name, because step names are addresses rather than aliases and the runner keeps no historical spellings

### Requirement: Steps run as isolated child processes
The runner SHALL execute each step as a child process invoking the step's entry point with `node`, and
SHALL NOT import a step's module into the runner process. Each step SHALL therefore manage its own
connection pools and produce its own exit code.

This is required because the entry points are not uniform: five of the nine call `main()` unconditionally
at module load, and four guard it behind an `import.meta.url === file://${process.argv[1]}` check.

#### Scenario: Unconditional-main script is spawned safely
- **WHEN** the runner reaches `refs`, whose module calls `main()` at load time with no `invokedDirectly` guard
- **THEN** the runner spawns it as a child process, so module load and migration execution stay inside that child

#### Scenario: Child inherits configuration
- **WHEN** a step is spawned
- **THEN** it inherits the parent environment, so all steps resolve the same `PG_*` and `MARIADB_*` connection settings from `.env`

### Requirement: Preflight assertions run once before the first step
Before spawning any step, the runner SHALL verify all of the following and SHALL abort without spawning
anything if any check fails:

1. **Environment.** Every variable required by the selected steps is set. `PG_HOST`, `PG_USER`,
   `PG_PASSWORD`, and `PG_DATABASE` are required by every step. `MARIADB_HOST`, `MARIADB_USER`,
   `MARIADB_PASSWORD`, and `MARIADB_DATABASE` are required by `persons`, `refs`, `authorities`,
   `authority-opinions`, `opinions`, and `collections`. `PBOT_TOKEN` is required by `pbot-persons` and
   `pbot-schemas`. The required set SHALL be the union over the *selected* steps only.
2. **Connectivity.** The PostgreSQL connection succeeds, and the MariaDB connection succeeds if any
   selected step requires it.
3. **Dictionaries.** All 14 `dictionaries.*` tables — `genders`, `roles`, `interval_types`, `zone_types`,
   `taxonomy_ranks`, `reference_types`, `book_types`, `parts_preserved`, `notable_features`,
   `namechange_reasons`, `nomenclatural_statuses`, `admin0`, `admin1`, `maritime` — exist and are
   non-empty.
4. **First-writer emptiness.** Every target table that a selected step is the *first* writer of is empty.
5. **Required input files.** Every file a selected step reads from disk exists and is readable. Each step
   SHALL declare its input files, and the runner SHALL check the declared paths rather than inferring
   them. The only such input at present is `mistagged-original-spelling.csv`, read by `opinions`.

#### Scenario: Missing token fails before any work
- **WHEN** `PBOT_TOKEN` is unset and the full pipeline is selected
- **THEN** the runner aborts during preflight, before spawning `persons`, rather than failing at step 2 after `persons` has loaded

#### Scenario: Unselected step's environment is not demanded
- **WHEN** the runner is invoked with `--from authorities` and `PBOT_TOKEN` is unset
- **THEN** preflight passes, because no selected step requires `PBOT_TOKEN`

#### Scenario: Unseeded dictionaries are caught up front
- **WHEN** the target database has the schema created but `dictionaries.taxonomy_ranks` is empty
- **THEN** preflight fails naming that table, because the steps that read it would otherwise fail partway through the pipeline

#### Scenario: Populated target refuses a full run
- **WHEN** the full pipeline is selected and `authorities` already contains rows
- **THEN** preflight fails, because `migrate-authorities.js` inserts without an upsert or natural key and would duplicate every row

#### Scenario: Missing input file fails before the pipeline starts
- **WHEN** the full pipeline is selected and `mistagged-original-spelling.csv` is absent
- **THEN** preflight fails naming that file, rather than the `opinions` step failing on `readFileSync` after the six preceding steps have already loaded their data

#### Scenario: Input files are declared, not discovered
- **WHEN** a step reads a file from disk
- **THEN** its path appears in that step's declared input list, so preflight checks it without parsing the step's source

### Requirement: Per-step preconditions assert what earlier steps produced
Immediately before spawning each step, the runner SHALL assert that step's preconditions against the
target database, and SHALL abort without spawning that step if any fails. Because three target tables have
two writers each — `persons` (steps 1, 2), `refs` (steps 3, 4), and `name_opinions` (steps 7, 8) — a
precondition SHALL be a per-step predicate rather than a uniform "target table is empty" rule.

| Step | Preconditions |
|---|---|
| `persons` | `persons` is empty |
| `pbot-persons` | `persons` is non-empty; no `persons` row has `person->'legacyIDs'->>'pbotID'` |
| `refs` | `refs` is empty; `persons` is non-empty |
| `pbot-refs` | `refs` is non-empty; no `refs` row has `reference->'legacyIDs'->>'pbotID'`; at least one `persons` row has `person->'legacyIDs'->>'pbotID'` |
| `pbot-schemas` | `schemas`, `characters`, and `states` are empty; at least one `persons` row has `person->'legacyIDs'->>'pbotID'`; at least one `refs` row has `reference->'legacyIDs'->>'pbotID'` |
| `authorities` | `authorities` is empty; at least one `refs` row has `reference->'legacyIDs'->>'oldpbdbID'` |
| `authority-opinions` | `name_opinions` is empty; `authorities` is non-empty |
| `opinions` | `assignment_opinions` and `validity_opinions` are empty; `name_opinions` is non-empty; `refs` is non-empty |
| `collections` | `collections` and `additional_collection_refs` are empty; at least one `refs` row has `reference->'legacyIDs'->>'oldpbdbID'` |

#### Scenario: Reversed persons order is refused
- **WHEN** `pbot-persons` is selected against an empty `persons` table
- **THEN** its precondition fails, because `persons.id = person_no` holds only when `migrate-persons.js` inserts explicit ids before `migrate-pbot-persons.js` draws from the identity sequence

#### Scenario: Second writer requires a non-empty table
- **WHEN** `opinions` is about to run
- **THEN** its precondition on `name_opinions` is that the table is *non-empty*, and its guard against a repeat run is that `assignment_opinions` and `validity_opinions` are empty

#### Scenario: Stale PBot prerequisites are caught before the step runs
- **WHEN** `pbot-schemas` is about to run and no `refs` row carries `reference->'legacyIDs'->>'pbotID'`
- **THEN** its precondition fails and the step is not spawned, rather than the step exiting 0 having silently skipped every schema whose primary reference could not be resolved

### Requirement: Per-step postconditions verify the step produced rows
Exit code 0 SHALL NOT by itself be treated as step success. After each step exits, the runner SHALL verify
that the exit code is 0 **and** that the row count of every table that step writes increased relative to
the count captured immediately before the step was spawned. The runner SHALL record each table's before
count, after count, and delta.

Tables written per step: `persons` → `persons`; `pbot-persons` → `persons`; `refs` → `refs`; `pbot-refs` →
`refs`; `pbot-schemas` → `schemas`, `characters`, `states`, `additional_schema_refs`; `authorities` →
`authorities`; `authority-opinions` → `name_opinions`; `opinions` → `assignment_opinions`,
`name_opinions`, `validity_opinions`; `collections` → `collections`, `additional_collection_refs`.

The runner SHALL NOT compare deltas against hard-coded expected row counts, so that the assertion does not
drift as the source data changes.

#### Scenario: Clean exit that wrote nothing is a failure
- **WHEN** a step exits 0 but the row count of a table it writes is unchanged
- **THEN** the runner reports the step as failed and halts

#### Scenario: Counts are recorded, not asserted against constants
- **WHEN** `authorities` completes
- **THEN** the runner records the observed delta in the run log and asserts only that it is positive, rather than comparing it to a fixed expected total

### Requirement: The pbot-schemas step is verified beyond its exit code
The runner SHALL capture the `pbot-schemas` step's standard output, parse its final summary lines, and
treat a non-zero `schemasSkipped`, `charactersSkipped`, or `statesSkipped` counter as a step failure.
This is necessary because `migrate-pbot-schemas.js` warns and continues when an enterer or primary
reference cannot be resolved, increments the corresponding counter, and still exits 0.

This textual check is a backstop, not the primary guard. The primary guard is structural: the
pbotID-coverage postcondition of `pbot-refs` is a precondition of `pbot-schemas`, which catches stale
prerequisites before the step runs. The counter check covers the residual case of a PBot record whose
prerequisite was never exposed to an earlier step at all.

#### Scenario: Silent under-migration is reported as failure
- **WHEN** `migrate-pbot-schemas.js` exits 0 having reported `skipped=3` for schemas
- **THEN** the runner reports the step as failed and halts, rather than proceeding on the strength of the exit code

#### Scenario: Orphan counters are distinct from skip counters
- **WHEN** the step reports non-zero `characterOrphans` or `stateOrphans` but zero skip counters
- **THEN** the runner records those orphan counts in the run log and does not fail the step, because an orphan is a recorded outcome rather than an unresolved prerequisite

### Requirement: `--createdb` initializes an empty database and cannot reset a populated one
When `--createdb` is passed, the runner SHALL execute the entire contents of `postgresql/create_new.sql`
as a single `pg` query through the existing pool, before preflight's dictionary and emptiness checks and
before the first step.

The file contains no `psql` meta-commands, no `COPY`, and no explicit `BEGIN`/`COMMIT`, so PostgreSQL
executes it as one implicit transaction: it either applies completely or rolls back completely. The runner
SHALL NOT shell out to `psql`, which would require an external binary and a separately constructed
connection string and would leave a partially built schema on failure.

The file has no top-level `DROP` and begins with an unqualified `CREATE SCHEMA dictionaries`, so applying
it to a database that already has that schema fails before any row is touched. `--createdb` therefore
initializes an empty database and SHALL NOT be described or used as a way to reset a populated one.
Creating the database itself is outside the runner's scope.

#### Scenario: Schema is applied atomically
- **WHEN** `--createdb` is passed against an empty database and a statement partway through the file fails
- **THEN** the whole script rolls back and the database is left empty, rather than partially built

#### Scenario: Populated database is protected
- **WHEN** `--createdb` is passed against a database that already contains the `dictionaries` schema
- **THEN** the operation fails on `CREATE SCHEMA dictionaries` without modifying any data, and the runner reports that `--createdb` initializes an empty database rather than resetting an existing one

#### Scenario: Database creation is out of scope
- **WHEN** `PG_DATABASE` names a database that does not exist
- **THEN** the runner fails to connect during preflight and reports that the database must be created before `--createdb` is used

### Requirement: `--from` and `--only` narrow the preflight tier but never the per-step tier
`--from <step>` SHALL select that step and every step after it in run order. `--only <step>` SHALL select
exactly that step.

Step selection SHALL narrow the preflight tier: the environment union and the first-writer-emptiness
checks apply to the selected steps only. Step selection SHALL NOT narrow the per-step precondition or
postcondition tiers, which apply in full to every step that runs.

Consequently these flags can skip work that has already been done, but cannot be used to run a step whose
prerequisites are absent.

#### Scenario: Resuming after a mid-pipeline failure
- **WHEN** `opinions` fails and is fixed, and the runner is re-invoked with `--from opinions`
- **THEN** preflight does not require `persons`, `refs`, or `authorities` to be empty, and does not require `PBOT_TOKEN`, and the run resumes at `opinions` and continues through `collections`

#### Scenario: Selection cannot bypass the dependency graph
- **WHEN** `--only opinions` is passed against a database where `authority-opinions` never ran
- **THEN** the `opinions` precondition that `name_opinions` is non-empty fails and the step is not spawned

#### Scenario: Selection does not relax postconditions
- **WHEN** a single step is run with `--only`
- **THEN** its postconditions, including the `pbot-schemas` skip-counter check where applicable, are enforced exactly as in a full run

### Requirement: Incoherent flag combinations are rejected
The runner SHALL reject the following combinations with a non-zero exit and an explanatory message, before
connecting to any database:

- `--from` together with `--only`.
- `--createdb` together with `--from <step>` where the step is not `persons`.
- `--createdb` together with `--only <step>` where the step is not `persons`.
- Any `--from` or `--only` value that is not a step name in the run-order table.

The runner SHALL NOT provide a flag that bypasses a failed precondition or postcondition.

#### Scenario: Reset plus resume is contradictory
- **WHEN** `--createdb --from authorities` is passed
- **THEN** the runner exits non-zero explaining that `--createdb` yields an empty database while `--from authorities` asserts that the five preceding steps have already run

#### Scenario: Unknown step name
- **WHEN** `--only taxa` is passed
- **THEN** the runner exits non-zero listing the valid step names

#### Scenario: No override exists
- **WHEN** a user wishes to run a step whose precondition fails
- **THEN** no flag permits it, because the preconditions are the runner's purpose rather than an advisory check

### Requirement: The runner halts on the first failure
When any preflight check, precondition, step exit code, or postcondition fails, the runner SHALL stop
without spawning any subsequent step, and SHALL exit non-zero. It SHALL NOT continue past a failed step,
because every later step depends on database state a failed step was responsible for producing.

The runner SHALL report which step failed, which specific check failed, and the observed versus required
state.

#### Scenario: Failure stops the pipeline
- **WHEN** `authorities` exits non-zero during a full run
- **THEN** `authority-opinions`, `opinions`, and `collections` are not spawned, and the runner exits non-zero

#### Scenario: Failure is attributable
- **WHEN** a precondition fails
- **THEN** the message names the step, the predicate, and the observed value, so the operator can tell a stale database from a genuine ordering error

### Requirement: The runner appends a per-run log
The runner SHALL write `src/run-migrations.log`, appending one delimited block per run rather than
overwriting, so that a failed run can be compared against the last successful one.

Each run's block SHALL record the start timestamp, the full argument vector, and for each step attempted:
the step name, start and end timestamps, exit code, and the before/after/delta row counts for every table
that step writes. For `pbot-schemas` it SHALL additionally record the fetched, inserted, orphan, and
skipped counters. The block SHALL end with the overall outcome.

#### Scenario: Runs accumulate rather than replace
- **WHEN** a second run is executed after a failed first run
- **THEN** `src/run-migrations.log` contains both runs' blocks in order, and the first run's recorded deltas remain available for comparison

#### Scenario: Row counts are captured without hard-coding
- **WHEN** a full pipeline run completes
- **THEN** the log states the observed row count for every migrated table, which is the record of what the run produced rather than an expectation it was checked against
