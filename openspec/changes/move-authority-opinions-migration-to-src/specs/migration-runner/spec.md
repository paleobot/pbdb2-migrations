## MODIFIED Requirements

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
| 9 | `collections` | `migrate-collections.js` |

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

Row 7 changes in both columns here: its entry point follows the script under `src/`, and its step name
changes from `authorities-opinions` to `authority-opinions`. The two are independent — see "Steps are
addressed by name" — and the position, the order, and every dependency edge are unchanged.

#### Scenario: Full pipeline runs in the specified order
- **WHEN** `src/run-migrations.js` is invoked with no step-selection flag
- **THEN** it runs all nine steps in the order given in the table, and does not begin a step until the preceding step has completed successfully

#### Scenario: PBot leg is interleaved rather than deferred
- **WHEN** the run order is read
- **THEN** `pbot-persons` follows `persons` and `pbot-refs` follows `refs`, so that each shared target table is complete from every source before any step that depends on that table runs

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
- **WHEN** `migrate-collections.js` is later relocated to `src/collections-migration/migrate-collections.js`
- **THEN** the step name `collections` is unchanged and only the entry-point path in the run-order table is updated

#### Scenario: Relocation already exercised this guarantee
- **WHEN** `migrate-authorities.js` was relocated to `src/authorities-migration/migrate-authorities.js`
- **THEN** the step name `authorities` did not change, so `--from authorities` and `--only authorities` kept working across the move and only row 6's entry-point path was edited

#### Scenario: A deliberate rename is recorded, not inferred from a move
- **WHEN** the step `authorities-opinions` is renamed to `authority-opinions` in the same change that relocates its script
- **THEN** the rename is justified by its own recorded reason — *authority* is attributive, so the singular is correct — and not by the relocation, which on its own would have left the name untouched exactly as it did for `authorities`

#### Scenario: Old step name stops resolving
- **WHEN** `--only authorities-opinions` is passed after that step has been renamed
- **THEN** it is rejected as an unknown step name, because step names are addresses rather than aliases and the runner keeps no historical spellings

#### Scenario: Listing steps touches nothing
- **WHEN** `--list` is passed
- **THEN** the nine step names are printed in run order and the process exits 0 without opening a database connection

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
