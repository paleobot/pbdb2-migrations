## Context

Four archived slices relocated migration *scripts* under `src/`. None moved a migration's *input* files,
because `migration-script-layout` never mentioned them. The result is a directory that looks finished and
is not:

```
src/opinions-migration/
├── migrate-opinions.js        line 26 ──▶ ../../mistagged-original-spelling.csv    (repo root)
├── anomalies.csv              IGNORED
├── run-summary.txt            IGNORED
└── tests/
    ├── run-migration.js       line 25 ──▶ ../../../reset-opinions.sql              (repo root)
    │                          line 26 ──▶ ../../../migrate-authorities-opinions.js (repo root)
    ├── run-reference-handlers.js  line 27 ──▶ ../../../migration_exploration/opinions
    └── cross-check-{aurora,reference}.js
```

A sweep of every `REPO_ROOT`-relative path and every filesystem read under `src/` confirms this list is
complete. Of the four root-reaching references, two are this change's business. The third names a
migration script and belongs to the pending relocation of the three root-level scripts. The fourth points
into `migration_exploration`, which is superseded and may break.

Both files have lost their provenance, which is worth stating because it bears on how they are treated:
nothing in the repository generates `mistagged-original-spelling.csv` — every file mentioning
`inferred_reason` is a consumer or a document — and `reset-opinions.sql`'s header credits a generator,
`scratch-build-reset.mjs`, that is not in the repository. Both are hand-maintained artifacts now, whatever
they once were.

## Goals / Non-Goals

**Goals:**

- Move both files under `src/opinions-migration/`, and close the specification gap that let them sit at the
  root through four slices.
- Update every reference that asserts a location, and leave every reference that does not.
- Correct `reset-opinions.sql`'s header, which misnames a script that was renamed a week ago.

**Non-Goals:**

- Relocating the three migration scripts still at the repository root, or the
  `migrate-authorities-opinions.js` reference at `tests/run-migration.js:26` that points at one of them.
- Reconstructing either file's missing generator, or regenerating either file.
- Keeping `migration_exploration` working.
- Removing `tests/run-reference-handlers.js`, which is vestigial once `migration_exploration` is allowed to
  break.
- Re-running any migration, or changing how the worklist is interpreted.

## Decisions

### 1. Two destinations, chosen by what reads the file

```
mistagged-original-spelling.csv   read by the migration   →  inputs/
reset-opinions.sql                read by a harness       →  tests/
```

The alternative was one `inputs/` directory for both. Rejected: `reset-opinions.sql` has exactly one
consumer, `tests/run-migration.js`, and splitting a harness from the fixture it feeds makes both harder to
follow. The existing rule already puts harnesses in `tests/`; the fixture goes where its reader is.

The opposite alternative — no `inputs/` at all, both files flat in the migration directory — is the
stronger objection, since it is one file and `.gitignore` already distinguishes tracked input from ignored
output. What settles it is that **the outputs cannot move**: the run-artifact requirement mandates
`anomalies.csv` and `run-summary.txt` sit at the directory root. Inputs are the only free variable, so
`inputs/` is the sole subdirectory available without amending an existing requirement. Position then
carries the distinction that `.gitignore` currently carries invisibly.

### 2. One ADDED requirement, not an amendment to the `tests/` rule

The existing `tests/` sentence lives inside *"One directory per migration under `src/`"* and reads "Test
and cross-check **harnesses** … SHALL live in a `tests/` subdirectory." A `.sql` fixture is not a harness.
Stretching that sentence to cover fixtures would edit a requirement about directory structure to say
something about file kinds.

A single new requirement states the whole rule — run-time inputs in `inputs/`, harness inputs in `tests/`,
outputs unchanged — so the delta is one ADDED and zero MODIFIED, and a reader finds the complete answer in
one place rather than assembled from three requirements.

### 3. The citation rule decides every reference, and mostly says "leave it"

`migration-script-layout` already settles this: a filename is path-qualified if and only if the reference
directs the reader to that file as the source of a stated guarantee.

```
CHANGE — asserts a location
  src/opinions-migration/migrate-opinions.js:26      join(SCRIPT_DIR,'..','..', …)
  src/opinions-migration/tests/run-migration.js:25   join(REPO_ROOT,'reset-opinions.sql')
  src/run-migrations.js:169                          inputs: [...]        (executable path)
  payloadSchemas/mappings/opinions.md:88             "(repo root, git-tracked)"

LEAVE — no path claim
  openspec/specs/opinions-migration/spec.md          ×3   "the pre-computed … worklist"
  openspec/specs/migration-runner/spec.md            ×2   "the only such input at present is …"
  docs/taxa-opinions-migration-mapping.md:425
  src/opinions-migration/migrate-opinions.js:105,124       error text, log line
```

The `payloadSchemas/mappings/opinions.md` entry is the only prose case that changes, and it is
unambiguous: it names the file as the source of the 50 overrides *and* states where it lives.

The two mentions in the `migration-runner` spec are worth noting as a deliberate non-edit. That spec says
"the only such input at present is `mistagged-original-spelling.csv`, read by `opinions`" — true before
and after, because it names the input without claiming a path. Its adjacent requirement already says the
runner checks *declared* paths rather than inferring them, so the declaration moves and the requirement
does not.

### 4. The header correction is in scope because the file is already in motion

`reset-opinions.sql`'s header is wrong in three ways: it cites `migrate-name-opinions.js` as needing "a
small update first" (renamed to `migrate-authorities-opinions.js` in
`reconcile-authorities-opinions-migration`, and `run-migration.js:26` already calls the new name); it
refers the reader to "the note in the accompanying message," which is not in the repository; and it credits
`scratch-build-reset.mjs`, which is not either.

A comment naming a script that no longer exists is precisely the hazard the citation rule's
"drive-by correction" clause worries about — the next reader either follows a dead name or fixes it
incidentally in an unrelated change. Correcting it while the file is being moved costs nothing and stops
that.

The header's operational instruction is also now expressible as a command, which is worth recording in the
file itself:

```
psql -f src/opinions-migration/tests/reset-opinions.sql
node src/run-migrations.js --only authorities-opinions    # re-mints the root name_opinions
node src/run-migrations.js --only opinions
```

That is not incidental. `reset-opinions.sql` clears exactly the tables those two steps require to be
empty, so the runner's preconditions now *verify* the manual step the header previously only asked for.

### 5. `git mv`, so the moves stay reviewable

Both files move at 100% similarity. `mistagged-original-spelling.csv` is byte-for-byte unchanged;
`reset-opinions.sql` differs only in its header comment. Recording them as renames rather than
delete-plus-add keeps `git log --follow` working on a file whose single prior commit is its whole history.

## Risks / Trade-offs

- **[Risk] The moved input path is wrong and is not noticed until a migration run.** → Preflight check 5
  runs before any database work and names a missing declared input in about a second, so
  `node src/run-migrations.js --only opinions` verifies the path without running anything. Beyond that,
  `migrate-opinions.js` throws at line 95 on a missing file rather than skipping — the failure is loud
  either way.

- **[Risk] `reset-opinions.sql`'s new location breaks the harness silently.** → `run-migration.js` passes
  the path to `psql -f` with `ON_ERROR_STOP=1`; a missing file fails the spawn. The constant is verified
  without running the destructive `--full` path.

- **[Trade-off] `migration_exploration/opinions/belongs-to/original-spelling.js` breaks.** → Accepted and
  recorded rather than repaired. That handler was superseded by the table-driven `migrate-opinions.js`, and
  keeping it working would tax every future relocation for no benefit.

- **[Trade-off] An `inputs/` convention is established for a single file.** → Accepted. The alternative
  puts a curated input beside two regenerated outputs and defers the decision to whenever a second input
  appears, by which point the flat layout is the incumbent.

- **[Observation, not addressed] `tests/run-reference-handlers.js` becomes dead.** Its only purpose is
  spawning `migration_exploration` handlers. Once that directory is allowed to break, the harness is a
  tracked file driving code nobody maintains. Out of scope here; worth a slice of its own.

## Migration Plan

Nothing to migrate and no rollback beyond `git revert` — no database is touched and no migration is re-run.
Order within the change: move both files, update the four references, correct the header, then verify.

## Open Questions

None. Both destinations, the header correction, and the treatment of `migration_exploration` were settled
before this change was written.
