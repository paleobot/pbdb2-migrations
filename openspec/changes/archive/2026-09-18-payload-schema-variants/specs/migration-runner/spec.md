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
3. **Dictionaries.** All 22 `dictionaries.*` tables — `genders`, `roles`, `interval_types`, `zone_types`,
   `taxonomy_ranks`, `reference_types`, `book_types`, `parts_preserved`, `notable_features`,
   `namechange_reasons`, `nomenclatural_statuses`, `admin0`, `admin1`, `maritime`, and the payload
   vocabularies `collection_methods`, `coordinate_bases`, `geographic_scales`, `lithologies`,
   `lithology_adjectives`, `dating_methods`, `preservation_modes`, `institution_codes` — exist and are
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

#### Scenario: Unseeded payload vocabulary is caught up front
- **WHEN** the target database has the schema created but `dictionaries.lithologies` is empty
- **THEN** preflight fails naming that table, rather than the `collections` step failing at enum resolution after eight steps have loaded


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
