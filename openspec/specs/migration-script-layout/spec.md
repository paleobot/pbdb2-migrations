# migration-script-layout Specification

## Purpose
Define the standard `src/` directory layout for migration scripts — one directory per migration,
shared utilities in `src/lib/`, run artifacts written beside the script that produces them — and
record which scripts have been relocated under it and which remain at the repository root.

## Requirements

### Requirement: One directory per migration under `src/`
Each migration SHALL live in its own directory directly under `src/`, named for the migration it performs.
The migration's entry-point script SHALL be named `migrate-<subject>.js` and SHALL sit at the root of that
directory. Test and cross-check harnesses for a migration SHALL live in a `tests/` subdirectory of that
migration's directory.

Directory names are literal and SHALL NOT be normalized for consistency with one another. In particular,
`src/pbot-persons-migrations/` carries a trailing `s` on `migrations` that its sibling
`src/persons-migration/` does not; this asymmetry is deliberate and SHALL be preserved.

#### Scenario: Migration directory layout
- **WHEN** the opinions migration is located
- **THEN** its entry point is `src/opinions-migration/migrate-opinions.js` and its harnesses are under `src/opinions-migration/tests/`

#### Scenario: Deliberate name asymmetry preserved
- **WHEN** a contributor observes that `src/pbot-persons-migrations/` is pluralized differently from `src/persons-migration/`
- **THEN** the name is left as-is, because the asymmetry is intentional rather than a typo

### Requirement: Related migrations stay in separate directories with documented run order
Migrations that write the same target table SHALL still occupy separate directories when they draw on
different source systems or require different database connections, so that their differing environment
requirements remain visible. Because separate directories do not imply an ordering, any run-order
dependency between such migrations SHALL be documented in this specification.

The persons migrations SHALL be run in this order:

1. `src/persons-migration/migrate-persons.js` — establishes `persons.id = person_no` from MariaDB.
2. `src/pbot-persons-migrations/migrate-pbot-persons.js` — matches against those rows, backfills ORCID,
   email, and `legacyIDs.pbotID`, and inserts PBot persons that do not match.

#### Scenario: Persons migrations run in order
- **WHEN** the persons data is migrated from scratch
- **THEN** `migrate-persons.js` runs to completion first, and `migrate-pbot-persons.js` runs second against the rows it created

#### Scenario: Separate directories despite a shared target table
- **WHEN** two migrations both write the `persons` table but one requires `MARIADB_*` and the other is PostgreSQL-only
- **THEN** they occupy separate directories under `src/`, and their run order is documented here rather than implied by co-location

### Requirement: Shared utilities live in `src/lib/`
Code shared by more than one migration under `src/` SHALL live in `src/lib/`. A migration directory SHALL
NOT import from another migration's directory; anything two migrations need SHALL be promoted to
`src/lib/` first.

#### Scenario: Shared helper promoted
- **WHEN** a second migration under `src/` needs a helper currently private to one migration's directory
- **THEN** the helper is moved into `src/lib/` and both migrations import it from there

#### Scenario: Cross-migration import rejected
- **WHEN** a migration under `src/` would import directly from a sibling migration's directory
- **THEN** the shared code is promoted to `src/lib/` instead

### Requirement: Run artifacts are written beside the producing script
A migration that writes artifacts on each run SHALL write them into its own directory, or into its
`tests/` subdirectory for harness output, and SHALL NOT write them to the repository root. This covers
anomaly ledgers, run summaries, and cross-check reports.

#### Scenario: Anomaly ledger location
- **WHEN** `src/opinions-migration/migrate-opinions.js` records anomalies and a run summary
- **THEN** they are written to `src/opinions-migration/anomalies.csv` and `src/opinions-migration/run-summary.txt`

#### Scenario: Harness report location
- **WHEN** a cross-check harness under a migration's `tests/` directory produces a report
- **THEN** the report is written into that `tests/` directory

### Requirement: Inventory of migrated and not-yet-migrated scripts
This specification SHALL record which migration scripts have been relocated under `src/` and which remain
at the repository root, so that each successive relocation slice has an accurate starting point. Each
change that relocates a script SHALL update this inventory.

Under `src/`:

| Directory | Entry point |
|---|---|
| `src/opinions-migration/` | `migrate-opinions.js` |
| `src/persons-migration/` | `migrate-persons.js` |
| `src/pbot-persons-migrations/` | `migrate-pbot-persons.js` |

Remaining at the repository root (six scripts):

`migrate-authorities.js`, `migrate-authorities-opinions.js`, `migrate-collections.js`,
`migrate-pbot-refs.js`, `migrate-pbot-schemas.js`, `migrate-refs.js`

#### Scenario: Inventory reflects a completed relocation
- **WHEN** a change relocates a root-level `migrate-*.js` script under `src/`
- **THEN** that change moves the script's entry from the root list to the `src/` table in this specification

#### Scenario: Root scripts keep their existing conventions
- **WHEN** a script is still listed as remaining at the repository root
- **THEN** it continues to import root-level connection modules and is not required to follow the `src/` layout until it is relocated
