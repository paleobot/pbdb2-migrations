## MODIFIED Requirements

### Requirement: Related migrations stay in separate directories with documented run order
Migrations that write the same target table SHALL still occupy separate directories when they draw on
different source systems or require different database connections, so that their differing environment
requirements remain visible. Because separate directories do not imply an ordering, any run-order
dependency between such migrations SHALL be documented.

The authoritative statement of the full run order is the run-order table in the `migration-runner`
specification, implemented by `src/run-migrations.js`. That table covers all nine migrations, not only
those that share a target table, and it is enforced at execution time rather than only documented. This
specification SHALL NOT restate the full order, so that the two cannot drift apart.

One ordering constraint is nonetheless restated here, because it is a layout guarantee rather than only a
sequencing one — the identity relationship it establishes is cited by other specifications:

1. `src/persons-migration/migrate-persons.js` — establishes `persons.id = person_no` from MariaDB.
2. `src/pbot-persons-migration/migrate-pbot-persons.js` — matches against those rows, backfills ORCID,
   email, and `legacyIDs.pbotID`, and inserts PBot persons that do not match, drawing from the identity
   sequence.

Running these two in the opposite order does not merely reorder work: it destroys the
`persons.id = person_no` guarantee that `refs`, `authorities`, `opinions`, and `collections` all rely on
for their `authorizer_person_id` and `enterer_person_id` values.

#### Scenario: Persons migrations run in order
- **WHEN** the persons data is migrated from scratch
- **THEN** `migrate-persons.js` runs to completion first, and `migrate-pbot-persons.js` runs second against the rows it created

#### Scenario: Separate directories despite a shared target table
- **WHEN** two migrations both write the `persons` table but one requires `MARIADB_*` and the other is PostgreSQL-only
- **THEN** they occupy separate directories under `src/`, and their run order is documented rather than implied by co-location

#### Scenario: Full order is held in one place
- **WHEN** a reader needs the run order of all nine migrations
- **THEN** they consult the run-order table in the `migration-runner` specification, and this specification is not a second, potentially divergent copy of it

## ADDED Requirements

### Requirement: A non-migration script may live directly under `src/`
A script that orchestrates or operates on migrations rather than performing one SHALL be permitted to live
directly under `src/`, above the per-migration directories. Such a script SHALL NOT be given a `migrate-<subject>.js`
name and SHALL NOT be given a `<subject>-migration` directory, because both forms are reserved for
migrations themselves and would make the script indistinguishable from one in a directory listing or in
the inventory.

`src/run-migrations.js` is such a script. It SHALL NOT appear in this specification's inventory of
migration scripts, which records only migrations.

The rule that a migration imports shared code from `src/lib/` rather than from a sibling migration's
directory applies unchanged to a script placed here. A non-migration script MAY, however, reference
migration entry points by path, since invoking them is its purpose; such references are executable paths
and SHALL be updated whenever a referenced script is relocated.

#### Scenario: Runner is placed above the migration directories
- **WHEN** the migration runner is added to the repository
- **THEN** it is written to `src/run-migrations.js`, not to `src/migration-runner/migrate-runner.js`, so that its position above the per-migration directories reflects that it orchestrates them

#### Scenario: Name is distinguishable from a migration
- **WHEN** a reader lists `src/`
- **THEN** `run-migrations.js` is recognisable as not being one of the `migrate-<subject>.js` entry points, and the inventory confirms it is not a migration

#### Scenario: Entry-point references are executable paths
- **WHEN** a migration script named in `src/run-migrations.js` is relocated under `src/`
- **THEN** the relocating change updates the path in the runner, because it is an executable path rather than a prose citation

### Requirement: A non-migration script writes its run artifacts beside itself
The requirement that run artifacts are written beside the producing script SHALL extend to a script placed
directly under `src/`: its artifacts are written into `src/`, alongside the script, since it has no
migration directory of its own. Such a script SHALL NOT write artifacts to the repository root.

Its test and cross-check harnesses SHALL live in `src/tests/`, mirroring the `tests/` subdirectory rule
that applies within a migration's own directory. `src/tests/` is for harnesses covering scripts that sit
directly under `src/`, and SHALL NOT be used for a harness covering a migration, which belongs in that
migration's own `tests/` subdirectory.

#### Scenario: Runner log location
- **WHEN** `src/run-migrations.js` records the outcome of a run
- **THEN** it writes `src/run-migrations.log`, beside the script, rather than to the repository root or into any migration's directory

#### Scenario: Harness for a non-migration script
- **WHEN** a harness is written for `src/run-migrations.js`
- **THEN** it lives in `src/tests/`, not in the repository root and not in any migration's `tests/` subdirectory

#### Scenario: Migration harness is not displaced
- **WHEN** a harness covers `src/opinions-migration/migrate-opinions.js`
- **THEN** it stays in `src/opinions-migration/tests/`, because `src/tests/` covers only scripts directly under `src/`
