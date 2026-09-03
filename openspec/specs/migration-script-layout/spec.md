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

### Requirement: Script citations are path-qualified only where they assert a source of truth
When a specification, code comment, or document refers to a migration script by filename, it SHALL be
path-qualified (for example `src/refs-migration/migrate-refs.js`) if and only if the reference directs the
reader to that file as the source of a stated guarantee. A reference that names a script as a comparative or
stylistic aside — "same fallback as", "same pattern as", "logging style matches" — SHALL remain an
unqualified bare filename.

A relocation change SHALL therefore update only the qualified citations of the scripts it moves, plus any
executable or tooling path that names the script's location. Bare filename mentions SHALL be left unchanged,
because a bare filename does not become inaccurate when a file moves.

Where a specification names several scripts together in one list and only some of them have been relocated,
that list SHALL remain entirely unqualified until every script in it has moved, so that the list does not
imply the unqualified entries live somewhere other than the repository root.

The authoritative answer to where any migration script lives is the inventory in this specification, not a
citation embedded in prose elsewhere.

#### Scenario: Source-of-guarantee citation is qualified
- **WHEN** a requirement states that persons ids equal legacy `person_no` "by construction" and names the migration that established it
- **THEN** that citation carries the script's full path under `src/`, because the reader is being sent to that file to verify the guarantee

#### Scenario: Comparative aside stays bare
- **WHEN** a requirement notes that a script's zero-sentinel fallback is the "same fallback as `migrate-refs.js`"
- **THEN** the mention remains an unqualified bare filename, and a relocation of `migrate-refs.js` does not edit it

#### Scenario: Mixed list stays unqualified until fully relocated
- **WHEN** a scenario names five scripts as actors and only two of them have been relocated under `src/`
- **THEN** all five remain unqualified bare filenames, and the list is path-qualified in a single later change once the last of them has moved

#### Scenario: Executable path is always updated
- **WHEN** a tooling configuration or permission entry names a script as an executable path, such as `node migrate-refs.js`
- **THEN** the relocation change updates it to the new path, regardless of the citation-form rule, because the old path no longer resolves

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
| `src/refs-migration/` | `migrate-refs.js` |
| `src/pbot-refs-migrations/` | `migrate-pbot-refs.js` |
| `src/pbot-schemas-migration/` | `migrate-pbot-schemas.js` |

Remaining at the repository root (three scripts):

`migrate-authorities.js`, `migrate-authorities-opinions.js`, `migrate-collections.js`

#### Scenario: Inventory reflects a completed relocation
- **WHEN** a change relocates a root-level `migrate-*.js` script under `src/`
- **THEN** that change moves the script's entry from the root list to the `src/` table in this specification

#### Scenario: Root scripts keep their existing conventions
- **WHEN** a script is still listed as remaining at the repository root
- **THEN** it continues to import root-level connection modules and is not required to follow the `src/` layout until it is relocated

#### Scenario: A PBot-sourced migration without a PBDB sibling is named in the singular
- **WHEN** `migrate-pbot-schemas.js` is relocated and the two existing PBot directories (`src/pbot-persons-migrations/`, `src/pbot-refs-migrations/`) both carry a trailing `s` on `migrations`
- **THEN** its directory is nonetheless `src/pbot-schemas-migration/`, singular, because the trailing `s` marked a contrast with a paired PBDB-sourced sibling and the schemas migration has no such sibling — and the inventory, not the surface pattern of neighbouring names, is the authority on the literal directory name
