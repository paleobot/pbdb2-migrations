## Why

Nine migration scripts must run in a specific order, and nothing in the repository enforces it. The order
is currently reconstructible only by reading each script's Postgres pre-loads — `migrate-opinions.js`
resolves name permids out of `name_opinions`, so it must follow `migrate-authorities-opinions.js`;
`migrate-pbot-schemas.js` resolves its enterer and primary reference through
`persons.person->'legacyIDs'->>'pbotID'` and `refs.reference->'legacyIDs'->>'pbotID'`, so it must follow
both PBot predecessors. The `migration-script-layout` specification documents exactly one of these edges
(the persons pair) and the `move-pbot-schemas-migration-to-src` design explicitly deferred the rest to
"the `src/` runner script." This change is that deferral coming due.

The cost of leaving it undone is not hypothetical. During `move-pbot-schemas-migration-to-src`'s own
verification a clear-and-reload of `migrate-pbot-schemas.js` **exited 0 having inserted 5 of 8 schemas,
168 of 336 characters, and 797 of 1,326 states**, because localhost's PBot-sourced `persons` (70 of 313
upstream) and `refs` (174 of 280) were stale. Unresolved prerequisites are skipped with a `console.warn`
and the process still exits 0. A pipeline that checks only exit codes reproduces that silent
under-migration at full scale.

Five of the nine scripts also duplicate their rows outright on a second run, so the sequence is a
fresh-database pipeline whether or not anyone has written that down.

## What Changes

- **New `src/run-migrations.js`** — a runner that spawns the nine migrations as child processes in a
  frozen order and asserts the database state that order exists to produce.

  ```
  persons → pbot-persons → refs → pbot-refs → pbot-schemas
          → authorities → authorities-opinions → opinions → collections
  ```

- **Two-tier state assertion.** A preflight tier runs once (environment variables for the selected steps,
  both database connections reachable, the 14 `dictionaries.*` tables seeded, every first-writer target
  table empty). A per-step tier runs immediately before each spawn and asserts the prerequisites an
  earlier step was supposed to produce — this is the dependency graph re-expressed as executable
  assertions.

- **Per-step postconditions.** Exit code 0 is necessary but not sufficient. The runner snapshots row
  counts before and after each step, requires a positive delta on every table that step writes, and for
  `migrate-pbot-schemas.js` additionally requires its `schemasSkipped` / `charactersSkipped` /
  `statesSkipped` counters to be zero. The primary guard against that step's silent under-migration is
  structural rather than textual: `migrate-pbot-refs.js`'s pbotID-coverage postcondition *is*
  `migrate-pbot-schemas.js`'s precondition, so stale prerequisites are caught before the step runs.

- **`--createdb`** applies `postgresql/create_new.sql` through the existing `pg` pool before step one.
  The file contains no `psql` meta-commands, no `COPY`, and no explicit transaction control, so Postgres
  executes it as a single implicit transaction: it either lands complete or rolls back to an empty
  database. It has no top-level `DROP` and a bare `CREATE SCHEMA dictionaries`, so it initializes an
  empty database and **cannot** reset a populated one — the flag is non-destructive by construction.
  Creating the database itself stays outside the runner.

- **`--from <step>` and `--only <step>`**, addressing steps by name (`authorities`, not `6`) so that
  identifiers survive both the three pending relocations and the steps that will be appended after
  `collections`. These flags narrow the preflight tier to the selected steps; they do **not** narrow the
  per-step tier, so they can skip redoing work but cannot skip the dependency graph.

- **`src/run-migrations.log`**, appended per run with a delimited header, recording per-step row-count
  deltas so a failed run can be diffed against the last good one.

- **One line added to `postgresql/create_new.sql`** — `CREATE EXTENSION IF NOT EXISTS postgis;`, so that
  `--createdb` can build a green-field database rather than requiring the extension to be installed by
  hand first. The file's safety property is unaffected: `CREATE EXTENSION IF NOT EXISTS` is idempotent, and
  the unqualified `CREATE SCHEMA dictionaries` two lines below still fails against a populated database
  before any row is touched.

- No migration script is modified. `migrate-pbot-schemas.js`'s non-idempotency and warn-and-exit-0
  behavior, the mixed `invokedDirectly` guards, and the three scripts still at the repository root are
  all accommodated rather than corrected.

## Capabilities

### New Capabilities
- `migration-runner`: the frozen nine-step order and the dependency edges that justify it; the preflight
  and per-step assertion tiers; per-step postconditions including the pbot-schemas skip-counter backstop;
  `--createdb` semantics as initialization rather than reset; `--from` / `--only` scoping rules; the run
  log.

### Modified Capabilities
- `migration-script-layout`: two requirement changes. Its "Related migrations stay in separate directories
  with documented run order" requirement currently enumerates only the persons pair — it extends to name
  the runner as the authority for the full order. A new requirement permits a non-migration script to sit
  directly under `src/`, above the per-migration directories, named so it cannot be read as a tenth
  `migrate-<subject>.js`, and states where such a script writes its run artifacts given that the existing
  "beside the producing script" rule assumes a migration directory.

## Impact

**New file:** `src/run-migrations.js`. **New run artifact:** `src/run-migrations.log`.
**New harness:** `src/tests/pbot-schemas-summary.test.js`.

**Read, not modified:** all nine migration entry points.

**Modified:** `postgresql/create_new.sql` — one line, `CREATE EXTENSION IF NOT EXISTS postgis;`, beside the
existing `ltree` line. The file declares `location geography` at line 4538 with the comment
`-- make sure PostGIS is installed` but never created the extension, so `--createdb` against a genuinely
bare database failed with `type "geography" does not exist`. Discovered by this change's own green-field
verification.

**Source tables (MariaDB `pbdb_archive`):** none read directly by the runner. It reads `person`, `refs`,
`authorities`, `opinions`, `collections`, and `secondary_refs` only transitively, through the scripts it
spawns.

**Target tables (PostgreSQL):** the runner issues `COUNT(*)` and JSONB-predicate counts only — it writes
no domain rows. Assertions touch `persons`, `refs`, `schemas`, `characters`, `states`,
`additional_schema_refs`, `authorities`, `name_opinions`, `assignment_opinions`, `validity_opinions`,
`collections`, `additional_collection_refs`, and the 14 `dictionaries.*` tables. With `--createdb` it
additionally executes the full DDL and seed script.

**No data transformations.** The runner performs no type mapping and no value coercion; every
signed→unsigned, float→decimal, datetime→timestamptz, and 0→NULL decision stays inside the script that
already owns it.

**Data-integrity risks addressed:**
- *Silent under-migration* (the `migrate-pbot-schemas.js` failure above) — caught by the borrowed
  precondition and the skip-counter postcondition.
- *Silent double-load* — `migrate-pbot-schemas.js`, `migrate-authorities.js`,
  `migrate-authorities-opinions.js`, `migrate-opinions.js`, and `migrate-collections.js` all insert
  without a natural key or upsert. Caught by the first-writer-empty preflight tier.
- *Out-of-order execution* — `persons.id = person_no` holds only because `migrate-persons.js` inserts
  explicit ids before `migrate-pbot-persons.js` draws from the identity sequence. Reversing them corrupts
  the FK space that `refs`, `authorities`, `opinions`, and `collections` all depend on. Caught by step 2's
  precondition.

**Environment:** `PG_HOST` / `PG_USER` / `PG_PASSWORD` / `PG_DATABASE` (all steps, plus optional
`PG_PORT`, `PG_CA_CERT`); `MARIADB_HOST` / `MARIADB_USER` / `MARIADB_PASSWORD` / `MARIADB_DATABASE`
(persons, refs, authorities, authorities-opinions, opinions, collections); `PBOT_TOKEN` (pbot-persons,
pbot-schemas). Required sets are validated as the union over the *selected* steps, so `--from authorities`
does not demand `PBOT_TOKEN`.

**Dependencies:** none added. `node:child_process` and the existing `pg` pool.

**Out of scope:** making any script idempotent; making `migrate-pbot-schemas.js` exit non-zero on skips;
normalizing the `invokedDirectly` guards; relocating the three root scripts; any step after
`collections` (taxa build, collections' deferred age FKs / intervals / environment pass); a `--force`
precondition override; `--dry-run`.
