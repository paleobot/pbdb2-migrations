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

A migration directory SHALL be named `<subject>-migration` — singular `migration`, regardless of the
migration's source system and regardless of whether a related migration writes the same target table. A
directory name SHALL NOT be pluralised to distinguish one migration from another; where two migrations
write the same table, the `<subject>` distinguishes them (`persons-migration` and `pbot-persons-migration`),
not a difference in the trailing noun.

A directory name is nonetheless literal: it changes only by a deliberate decision recorded in this
specification, and SHALL NOT be changed as incidental cleanup by a reader who takes it for a mistake. This
rule protects a name against drive-by correction; it does not freeze a name against a decision to change the
convention, which is what this requirement's own history demonstrates.

#### Scenario: Migration directory layout
- **WHEN** the opinions migration is located
- **THEN** its entry point is `src/opinions-migration/migrate-opinions.js` and its harnesses are under `src/opinions-migration/tests/`

#### Scenario: Singular naming regardless of source system
- **WHEN** a PBot-sourced migration is placed under `src/` alongside a PBDB-sourced migration that writes the same target table
- **THEN** both directories end in `-migration`, and the two are distinguished by their `<subject>` prefix rather than by pluralising one of them

#### Scenario: A name is not corrected by a passing reader
- **WHEN** a contributor believes a migration directory is misnamed
- **THEN** the name is left as it stands until a change records the decision to alter it, because this specification's inventory — not a passing reader's judgement — is what establishes a directory's name

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
| `src/pbot-persons-migration/` | `migrate-pbot-persons.js` |
| `src/refs-migration/` | `migrate-refs.js` |
| `src/pbot-refs-migration/` | `migrate-pbot-refs.js` |
| `src/pbot-schemas-migration/` | `migrate-pbot-schemas.js` |
| `src/authorities-migration/` | `migrate-authorities.js` |

Remaining at the repository root (two scripts):

`migrate-authorities-opinions.js`, `migrate-collections.js`

#### Scenario: Inventory reflects a completed relocation
- **WHEN** a change relocates a root-level `migrate-*.js` script under `src/`
- **THEN** that change moves the script's entry from the root list to the `src/` table in this specification

#### Scenario: Root scripts keep their existing conventions
- **WHEN** a script is still listed as remaining at the repository root
- **THEN** it continues to import root-level connection modules and is not required to follow the `src/` layout until it is relocated

#### Scenario: Relocation resolves a deliberate duplication
- **WHEN** a script is relocated whose code was previously copied into `src/lib/` so that a `src/` module could avoid importing from the repository root
- **THEN** the relocating change deletes the copy from the relocated script and imports the `src/lib/` definition, because the shared-utility requirement admits only one home for code two migrations under `src/` both use

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

### Requirement: A migration's input files live under its own directory
A file that a migration reads from disk SHALL live under that migration's directory, and SHALL NOT be left
at the repository root. This completes the set of rules governing a migration directory's contents, which
until now covered the entry point, harnesses, and outputs but never inputs — the reason two such files sat
at the repository root through four relocation slices.

Placement follows what reads the file:

| File is read by | Location |
|---|---|
| the migration at run time | `<migration>/inputs/` |
| a harness in `tests/` | `<migration>/tests/`, beside the harness that reads it |

Run artifacts are unaffected and stay where the run-artifact requirement already puts them — at the
migration directory's root, or in `tests/` for harness output. An `inputs/` subdirectory therefore
separates hand-maintained, version-controlled inputs from regenerated outputs by position rather than by
requiring a reader to consult `.gitignore`.

An input file SHALL be resolved relative to the reading script's own location, never relative to the
working directory, so that a migration produces the same result however it is invoked — directly, or
spawned by `src/run-migrations.js`.

Where `src/run-migrations.js` declares a step's `inputs` for its preflight check, that declaration SHALL
name the file's path under the migration's directory.

#### Scenario: Run-time input placement
- **WHEN** `src/opinions-migration/migrate-opinions.js` reads its pre-computed `mistagged-original-spelling.csv` worklist
- **THEN** that file lives at `src/opinions-migration/inputs/mistagged-original-spelling.csv`, not at the repository root

#### Scenario: Harness input placement
- **WHEN** `src/opinions-migration/tests/run-migration.js` reads `reset-opinions.sql` to reset the opinion output tables
- **THEN** that file lives at `src/opinions-migration/tests/reset-opinions.sql`, beside the harness that reads it, rather than in the migration's `inputs/` directory

#### Scenario: Inputs are separated from outputs by position
- **WHEN** a reader lists a migration's directory
- **THEN** the version-controlled files it reads are under `inputs/`, while the files it regenerates on each run sit at the directory root, so the two are distinguishable without consulting `.gitignore`

#### Scenario: Input resolution is script-relative
- **WHEN** a migration is spawned by `src/run-migrations.js` rather than invoked directly
- **THEN** it resolves its input files identically, because their paths derive from the script's own location and not from the working directory

#### Scenario: Runner declaration names the relocated path
- **WHEN** the runner's `opinions` step declares the input its preflight must check
- **THEN** the declared path is the file's location under `src/opinions-migration/`, so preflight fails on a missing input before any database work rather than inside the step
