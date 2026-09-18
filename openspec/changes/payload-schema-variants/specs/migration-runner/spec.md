## ADDED Requirements

### Requirement: The runner audits stored payloads after the last selected step
After the last selected step has passed its postconditions, the runner SHALL spawn `src/audit-payloads.js` as a child process, as it does for steps. The audit SHALL be scoped the same way postconditions are: the runner passes one `--entity` for each audit-registry entity whose table is written by a selected step (per the tables-written list in the postconditions requirement). Today `collections` → `collection` and `specimens` → `specimen`.

- When no selected step writes an audited table, the runner SHALL NOT spawn the audit, and it SHALL record in the run log that no audited tables were written.
- A non-zero audit exit SHALL be a run failure: the runner reports it and exits non-zero.
- The scope follows from the selection. The runner SHALL NOT provide a flag that skips or widens the audit.
- The audit SHALL NOT run when a step or check has already failed.

#### Scenario: Full run audits every audited entity
- **WHEN** `specimens` passes its postconditions in a full run
- **THEN** the runner spawns the audit with `--entity collection --entity specimen` and reports the run successful only if the audit exits 0

#### Scenario: Audit failure fails the run
- **WHEN** every step succeeds but the audit reports a violation
- **THEN** the runner exits non-zero and names the audit as the failed check

#### Scenario: Narrowed run audits only what it wrote
- **WHEN** the runner is invoked with `--only specimens`
- **THEN** the audit is spawned with `--entity specimen` only, and `collections` is not read

#### Scenario: Run that writes no audited table
- **WHEN** the runner is invoked with `--only persons`
- **THEN** the audit is not spawned, and the run log records that no audited tables were written

#### Scenario: No audit after a failure
- **WHEN** `collections` fails its postconditions
- **THEN** the runner halts without spawning the audit

## MODIFIED Requirements

### Requirement: The runner appends a per-run log
The runner SHALL write `src/run-migrations.log`, appending one delimited block per run rather than
overwriting, so that a failed run can be compared against the last successful one.

Each run's block SHALL record the start timestamp, the full argument vector, and for each step attempted:
the step name, start and end timestamps, exit code, and the before/after/delta row counts for every table
that step writes. For `pbot-schemas` it SHALL additionally record the fetched, inserted, orphan, and
skipped counters. When the audit runs, the block SHALL record the entities audited, its start and end timestamps, exit code,
and per-entity rows-checked and violation counts. When it is not spawned because no selected step wrote an
audited table, the block SHALL say so. The block SHALL end with the overall outcome.

#### Scenario: Runs accumulate rather than replace
- **WHEN** a second run is executed after a failed first run
- **THEN** `src/run-migrations.log` contains both runs' blocks in order, and the first run's recorded deltas remain available for comparison

#### Scenario: Audit outcome recorded
- **WHEN** a run completes with the audit
- **THEN** the run's block records the audit's exit code and, per entity, rows checked and violations
