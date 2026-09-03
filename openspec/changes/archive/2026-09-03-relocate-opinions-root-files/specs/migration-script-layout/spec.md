## ADDED Requirements

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
