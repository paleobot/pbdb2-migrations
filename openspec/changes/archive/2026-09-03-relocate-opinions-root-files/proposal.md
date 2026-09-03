## Why

`src/opinions-migration/` is fully relocated but still reaches two levels up for two of its own files:
`migrate-opinions.js` line 26 resolves `mistagged-original-spelling.csv` from the repository root, and
`src/opinions-migration/tests/run-migration.js` line 25 resolves `reset-opinions.sql` from the same place.
Neither is a migration script, so neither was in scope for the four `move-*-to-src` slices that relocated
the scripts themselves.

They were missed because `migration-script-layout` has never had anything to say about a migration's
**input** files. It requires an entry point at the directory root, harnesses in `tests/`, and run artifacts
beside the producing script — three rules covering scripts and outputs, and nothing covering the files a
migration reads. Each relocation slice moved exactly what the specification told it to move.

The gap surfaced during `create-migration-runner`, whose preflight had to declare
`inputs: ['mistagged-original-spelling.csv']` as a repository-root path for the `opinions` step. That is
the only remaining reason the runner's step table names a root-level path for a migration already living
under `src/`.

## What Changes

- **`mistagged-original-spelling.csv` moves to `src/opinions-migration/inputs/`** — a new subdirectory for
  files a migration reads at run time. It is a hand-curated 50-row worklist (22 `duplicate-or-homonym`,
  16 `reranked`, 10 `recombination`, 1 `correction`); nothing in the repository generates it, and one
  commit has ever touched it.

- **`reset-opinions.sql` moves to `src/opinions-migration/tests/`** — it is read only by
  `tests/run-migration.js`, so it belongs with the harness that consumes it rather than in a second input
  directory.

- **`migration-script-layout` gains one requirement** covering a migration's non-script files: run-time
  inputs in `inputs/`, harness inputs alongside the harnesses in `tests/`, and outputs unchanged at the
  directory root. Stated as one requirement rather than by amending the existing `tests/` sentence, which
  says *harnesses* and would otherwise have to be stretched to cover a `.sql` fixture.

- **Four path references updated:** `migrate-opinions.js:26`, `tests/run-migration.js:25`,
  `src/run-migrations.js:169` (the runner's `inputs` declaration), and `payloadSchemas/mappings/opinions.md`
  line 88, which asserts "(repo root, git-tracked)" and is therefore a source-of-truth citation under the
  layout spec's citation rule.

- **`reset-opinions.sql`'s header comment is corrected.** It currently cites `migrate-name-opinions.js` as
  needing "a small update first" — that script was renamed to `migrate-authorities-opinions.js` in
  `reconcile-authorities-opinions-migration`, and `run-migration.js:26` already calls the new name. The
  header also refers the reader to "the note in the accompanying message," which is not in the repository,
  and credits a generator, `scratch-build-reset.mjs`, that is not in the repository either.

- **Bare filename mentions are left alone.** The three in `openspec/specs/opinions-migration/spec.md`, the
  two in `openspec/specs/migration-runner/spec.md`, the one in `docs/taxa-opinions-migration-mapping.md`,
  and the error and log strings at `migrate-opinions.js:105` and `:124` assert no location, so the
  citation rule leaves them unqualified.

- **`migration_exploration/opinions/belongs-to/original-spelling.js` line 37 will break** and is
  deliberately not updated. That harness is superseded by the table-driven `migrate-opinions.js`, and
  `src/lib/db.js` already describes `migration_exploration` as "the harness this structure does not carry
  forward."

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `migration-script-layout`: one requirement added, placing a migration's non-script input files under its
  own directory — run-time inputs in an `inputs/` subdirectory, harness inputs in `tests/` — and recording
  that run artifacts stay where the existing artifacts requirement already puts them.

## Impact

**Moved:** `mistagged-original-spelling.csv` → `src/opinions-migration/inputs/`;
`reset-opinions.sql` → `src/opinions-migration/tests/`. Both are `git mv` at 100% similarity; the CSV's
content is unchanged, and `reset-opinions.sql` changes only in its header comment.

**Modified:** `src/opinions-migration/migrate-opinions.js` (one path constant),
`src/opinions-migration/tests/run-migration.js` (one path constant), `src/run-migrations.js` (one `inputs`
entry), `payloadSchemas/mappings/opinions.md` (one citation).

**Knowingly broken:** `migration_exploration/opinions/belongs-to/original-spelling.js`.

**Source tables (MariaDB `pbdb_archive`):** none. **Target tables (PostgreSQL):** none. No migration is
re-run by this change and no row is written, so there are no type mappings, no 0-as-NULL handling, and no
data-integrity risk from transformation — the files move, their content does not.

**Data-integrity risk that does exist:** `mistagged-original-spelling.csv` supplies the `inferred_reason`
override for the 50 opinions where `spelling_reason='original spelling'` is mistagged
(`child_spelling_no != child_no`). If the path resolves incorrectly, `migrate-opinions.js` throws at line
95 rather than silently skipping, so the failure mode is loud. The runner's preflight check 5 catches it
earlier still, before any database work.

**Verification is cheap and needs no migration run.** `node src/run-migrations.js --only opinions` performs
preflight check 5 against the declared input path before touching either database; a wrong path is named in
about a second. The `reset-opinions.sql` reference is verified by resolving the harness constant, without
executing the destructive `--full` path.

**Out of scope:** relocating the three migration scripts still at the repository root, including the
`migrate-authorities-opinions.js` reference at `tests/run-migration.js:26`; reconstructing either file's
missing generator; `tests/run-reference-handlers.js`, which exists only to spawn `migration_exploration`
handlers and is vestigial once that directory is allowed to break; and any change to how
`migrate-opinions.js` interprets the worklist.
