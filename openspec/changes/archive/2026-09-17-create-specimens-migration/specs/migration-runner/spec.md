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
| 9 | `collections` | `src/collections-migration/migrate-collections.js` |
| 10 | `specimens` | `src/specimens-migration/migrate-specimens.js` |

Every entry point in this table sits under `src/`. The table is the runner's own `STEPS` array restated,
so it is verifiable by reading `src/run-migrations.js` rather than by trusting this specification.

The order SHALL satisfy these dependency edges, each of which exists because the later step reads from
PostgreSQL what the earlier step wrote:

```
persons ──┬─▶ pbot-persons ──┐
          │                  ├─▶ pbot-refs ──▶ pbot-schemas
          └─▶ refs ──────────┤
                             ├─▶ authorities ──▶ authority-opinions ──▶ opinions
                             ├─────────────────────────────────────────────▶ (refs)
                             ├─▶ collections ───────────────┐
                             ├──────────────────────────────┼─▶ specimens
                             └─▶ (name_opinions) ───────────┘
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
- `specimens` reads `refs` and `collections` through `legacyIDs.oldpbdbID`, and `name_opinions` through
  `oldpbdb_taxon_no`. It is last because it is the only step that reads from three other steps' output at
  once, and nothing reads from it.

The order SHALL NOT be changed except by a change that records the new order in this specification.

Row 10 is an addition rather than a relocation: it introduces a migration that did not previously exist,
where the nine preceding rows reached their current form by moving scripts already in the repository. No row
1–9 changes here — not its name, its position, its entry point, or its dependency edges.

#### Scenario: Full pipeline runs in the specified order
- **WHEN** `src/run-migrations.js` is invoked with no step-selection flag
- **THEN** it runs all ten steps in the order given in the table, and does not begin a step until the preceding step has completed successfully

#### Scenario: Every entry point resolves under src/
- **WHEN** the runner spawns any of the ten steps
- **THEN** the path it spawns is under `src/`, because no migration entry point remains at the repository root

#### Scenario: A new migration is appended, not inserted
- **WHEN** `specimens` is added to the run order
- **THEN** it takes position 10 after `collections`, and the preceding nine rows are left byte-for-byte unchanged, because its dependency edges are all satisfied by steps that already run before it

### Requirement: Steps run as isolated child processes
The runner SHALL execute each step as a child process invoking the step's entry point with `node`, and
SHALL NOT import a step's module into the runner process. Each step SHALL therefore manage its own
connection pools and produce its own exit code.

This is required because the entry points are not uniform: five of the ten call `main()` unconditionally
at module load, and five guard it behind an `import.meta.url === file://${process.argv[1]}` check.

#### Scenario: Unconditional-main script is spawned safely
- **WHEN** the runner reaches `refs`, whose module calls `main()` at load time with no `invokedDirectly` guard
- **THEN** the runner spawns it as a child process, so module load and migration execution stay inside that child

#### Scenario: Child inherits configuration
- **WHEN** a step is spawned
- **THEN** it inherits the parent environment, so all steps resolve the same `PG_*` and `MARIADB_*` connection settings from `.env`

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
| `specimens` | `specimens` is empty; `collections` is non-empty; `name_opinions` is non-empty; at least one `refs` row has `reference->'legacyIDs'->>'oldpbdbID'` |

#### Scenario: Reversed persons order is refused
- **WHEN** `pbot-persons` is selected against an empty `persons` table
- **THEN** its precondition fails, because `persons.id = person_no` holds only when `migrate-persons.js` inserts explicit ids before `migrate-pbot-persons.js` draws from the identity sequence

#### Scenario: Second writer requires a non-empty table
- **WHEN** `opinions` is about to run
- **THEN** its precondition on `name_opinions` is that the table is *non-empty*, and its guard against a repeat run is that `assignment_opinions` and `validity_opinions` are empty

#### Scenario: Stale PBot prerequisites are caught before the step runs
- **WHEN** `pbot-schemas` is about to run and no `refs` row carries `reference->'legacyIDs'->>'pbotID'`
- **THEN** its precondition fails and the step is not spawned, rather than the step exiting 0 having silently skipped every schema whose primary reference could not be resolved

#### Scenario: Specimens requires all three of its input tables
- **WHEN** `specimens` is about to run against a database where `collections` is populated but `name_opinions` is empty
- **THEN** its precondition fails and the step is not spawned, rather than the step running and leaving `name_opinions_permid` null on every row it could otherwise have resolved

### Requirement: Per-step postconditions verify the step produced rows
Exit code 0 SHALL NOT by itself be treated as step success. After each step exits, the runner SHALL verify
that the exit code is 0 **and** that the row count of every table that step writes increased relative to
the count captured immediately before the step was spawned. The runner SHALL record each table's before
count, after count, and delta.

Tables written per step: `persons` → `persons`; `pbot-persons` → `persons`; `refs` → `refs`; `pbot-refs` →
`refs`; `pbot-schemas` → `schemas`, `characters`, `states`, `additional_schema_refs`; `authorities` →
`authorities`; `authority-opinions` → `name_opinions`; `opinions` → `assignment_opinions`,
`name_opinions`, `validity_opinions`; `collections` → `collections`, `additional_collection_refs`;
`specimens` → `specimens`.

The runner SHALL NOT compare deltas against hard-coded expected row counts, so that the assertion does not
drift as the source data changes.

#### Scenario: Clean exit that wrote nothing is a failure
- **WHEN** a step exits 0 but the row count of a table it writes is unchanged
- **THEN** the runner reports the step as failed and halts

#### Scenario: Counts are recorded, not asserted against constants
- **WHEN** `authorities` completes
- **THEN** the runner records the observed delta in the run log and asserts only that it is positive, rather than comparing it to a fixed expected total

#### Scenario: Specimens writes exactly one table
- **WHEN** `specimens` completes
- **THEN** the runner verifies that `specimens` gained rows, and asserts nothing about `collections`, `occurrences`, or any measurement table, because the step writes none of them
