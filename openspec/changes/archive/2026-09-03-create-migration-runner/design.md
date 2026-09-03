## Context

Nine migration scripts must run in a fixed order that exists nowhere except in the reader's head and in
the Postgres pre-loads at the top of each `main()`. `migration-script-layout` documents one edge of the
graph (the persons pair); the `move-pbot-schemas-migration-to-src` design deferred the rest with
"documenting or enforcing the run order in a capability spec (deferred to the `src/` runner script — see
decision 5)". This change is that deferral coming due, and decision 5's own words scope it: enforcement,
not correction of the scripts being enforced.

The current state the runner has to accommodate, rather than fix:

```
                     idempotent?   exit 0 == success?   entry guard        location
persons              yes (upsert)  yes                  unconditional      src/
pbot-persons         ~yes (match)  yes                  unconditional      src/
refs                 yes (upsert)  yes                  unconditional      src/
pbot-refs            ~yes (pbotID) yes                  unconditional      src/
pbot-schemas         NO            NO  ← warns, skips   unconditional      src/
authorities          NO            yes                  invokedDirectly    root
authorities-opinions NO            yes                  invokedDirectly    root
opinions             NO            yes                  invokedDirectly    root(src/)
collections          NO            yes                  invokedDirectly    root
```

Five scripts duplicate rows on a second run; one exits 0 while under-migrating; four guard `main()` and
five do not; three still live at the repository root and import root-level `db.js`. Every one of those
asymmetries is out of scope to fix and in scope to survive.

## Goals / Non-Goals

**Goals:**

- Freeze the nine-step order in executable form, and make the dependency edges that justify it into
  assertions rather than commentary.
- Make it impossible to silently double-load a non-idempotent step, or to run a step whose prerequisites
  are absent.
- Make `pbot-schemas`'s warn-and-exit-0 under-migration a hard failure without modifying that script.
- Provide `--createdb` for a from-scratch build and `--from` / `--only` for resuming a failed one.
- Leave a durable record of what each run actually produced.

**Non-Goals:**

- Making any migration idempotent, adding natural keys, or wrapping any migration in a transaction.
- Making `migrate-pbot-schemas.js` exit non-zero on skips — the correct fix, deliberately deferred.
- Normalising the `invokedDirectly` guards, or relocating the three root scripts.
- Any pipeline step after `collections`: the taxa build, and collections' deferred age FKs / intervals /
  environment / paleontology pass.
- `--dry-run`, `--force`, parallel step execution, or resuming *within* a step.
- Removing the `MIGRATION_TEST_MODE` branch in root `db.js`, or guarding against it.
- Any change to `postgresql/create_new.sql` beyond the single `CREATE EXTENSION IF NOT EXISTS postgis;`
  line that `--createdb` requires to work on a bare database.

## Decisions

### 1. A declarative step table, not a sequence of calls

The runner's core is data, not control flow. Each step is a record; the engine is a loop over it.

```js
{
  name: 'pbot-schemas',
  script: 'src/pbot-schemas-migration/migrate-pbot-schemas.js',
  env: ['PG', 'PBOT'],
  writes: ['schemas', 'characters', 'states', 'additional_schema_refs'],
  firstWriterOf: ['schemas', 'characters', 'states', 'additional_schema_refs'],
  preconditions: [
    empty('schemas'), empty('characters'), empty('states'),
    nonEmpty(pbotIdCoverage('persons')),
    nonEmpty(pbotIdCoverage('refs')),
  ],
  postcondition: skipCountersZero,   // step-specific, optional
}
```

Everything the specs require falls out of this shape: the preflight environment union is a union over
`env`; the first-writer emptiness tier is a union over `firstWriterOf`; the generic postcondition is a
delta check over `writes`; `--from` / `--only` are a slice of the array. `--list` prints `name`.

Alternative considered: nine explicit `await runStep(...)` calls. Rejected — it puts the order in control
flow where `--from` and the preflight union each have to re-derive it, and it invites per-step drift in
how assertions are applied.

The `firstWriterOf` field is separate from `writes` precisely because `persons`, `refs`, and
`name_opinions` each have two writers. Deriving "first writer" positionally would work today and break the
moment a step is inserted.

### 2. Preconditions are hand-written predicates, not a generic rule

The tempting rule is "every table this step writes must be empty." It is wrong for exactly three steps,
and wrong in two different directions:

```
step 2 pbot-persons   persons must be NON-empty  (and free of pbotID)
step 4 pbot-refs      refs must be NON-empty     (and free of pbotID)
step 8 opinions       name_opinions must be NON-empty
                      — its repeat-run guard is assignment_opinions/validity_opinions instead
```

So each step declares its own predicate list. This is more code than a generic rule and it is the honest
amount of code: the predicates *are* the dependency graph, and a generic rule would have to be qualified
into unreadability to express step 8.

Predicates are built from a small vocabulary — `empty(table)`, `nonEmpty(table)`, and a JSONB-key variant
`nonEmpty(pbotIdCoverage('refs'))` / `noneHave(pbotIdCoverage('persons'))` — so each is one `SELECT
COUNT(*)`, and a failure can report the predicate and the observed count.

### 3. `pbot-schemas` gets a structural primary guard and a textual backstop

The archived failure — 5 of 8 schemas, 168 of 336 characters, 797 of 1,326 states, exit 0 — happened
because localhost's PBot-sourced `persons` and `refs` were stale. That is a *precondition* failure
masquerading as a successful run:

```
step 4 pbot-refs      postcondition:  refs with legacyIDs.pbotID  > 0
                                       │  same query
step 5 pbot-schemas   precondition:   refs with legacyIDs.pbotID  > 0
```

Borrowing step 4's postcondition as step 5's precondition catches the whole documented failure class
before the step is spawned, with no output parsing. The `schemasSkipped` / `charactersSkipped` /
`statesSkipped` scrape is retained as a backstop for the residual case — a PBot record whose prerequisite
was never exposed to step 4 at all — not as the primary mechanism.

Alternative considered: assert observed counts against the known-good 10 / 301 / 1,183 / 1. Rejected as
brittle against upstream PBot growth, and it would have to be revised on every legitimate change to PBot's
data.

Alternative considered: parse stdout only. Rejected as the sole guard — it is the most fragile part of
this design and should not be load-bearing.

### 4. Spawn, never import

`child_process.spawn(process.execPath, [script], { env: process.env })`, stdout and stderr piped through
to the runner's own output *and* captured for the step-5 counter parse.

Import is not uniformly possible: five entry points call `main()` at module load with no guard, so
importing them to inspect their exports would run the migration as a side effect of the inspection.
Spawning also gives real exit codes, isolates each script's pool lifecycle (each already calls its own
`closeAll()` / `closePg()` in a `finally`), and means a step that hangs or crashes cannot take the
runner's assertion connection with it.

The runner opens one `pg` pool of its own, from `src/lib/pg-pool.js`, used only for `COUNT(*)` and the
`--createdb` apply, and closes it in a `finally`.

### 5. `--createdb` is one `pg.query()` of the whole file

`postgresql/create_new.sql` is 420K and was verified to contain no `psql` meta-commands, no `COPY`, and no
explicit `BEGIN`/`COMMIT`. PostgreSQL executes a multi-statement simple query with no transaction control
as a single implicit transaction, so:

```
readFileSync('postgresql/create_new.sql', 'utf8')  →  pg.query(sql)
   success → 37 tables + 14 dictionary seeds + functions, committed
   failure → complete rollback; database still empty
```

Alternative considered: `spawn('psql', ['-f', ...])`. Rejected on three counts — it needs `psql` on PATH,
it needs the Aurora connection string and `PG_CA_CERT` reassembled outside the pool config that already
works, and on failure it leaves a half-built schema that someone has to drop by hand.

**The flag initializes; it does not reset.** The file's first statements are `CREATE EXTENSION IF NOT
EXISTS ltree` and a bare `CREATE SCHEMA dictionaries` — no `IF NOT EXISTS`, and no top-level `DROP`
anywhere (every `DROP` in the file is a temp table inside a `derive_taxa`-family function body). Applied
to a populated database it fails on statement 2, before any row is touched. This is a safety property
obtained for free, and the naming and documentation must not imply more than it does: creating the
database remains a manual `createdb` step.

### 6. Steps are named, and the names outlive their paths

`--from authorities`, not `--from 6`. Two forces make positional identifiers rot:

- three scripts are pending relocation under `src/`, which changes their paths but not their identity;
- the pipeline is explicitly expected to grow past `collections`, which would shift every number above
  the insertion point and silently change the meaning of a `--from` in a shell history or runbook.

The step name is the one stable handle. The path is a field in the step record and is expected to change
three times; the layout spec's "executable path is always updated" rule already governs that.

### 7. Selection narrows preflight, never the per-step tier

This is the property that keeps the flags from becoming an escape hatch.

```
                          full run    --from authorities    --only opinions
env union                 all three   PG + MARIADB          PG + MARIADB
first-writer emptiness    9 steps     steps 6-9             step 8 only
per-step preconditions    enforced    enforced              enforced  ←
per-step postconditions   enforced    enforced              enforced  ←
```

`--only opinions` against a database where step 7 never ran fails on `name_opinions` being empty. The
flags let an operator skip *redoing work*; they cannot skip the graph. Consequently no `--force` is
provided: an override would make the assertions advisory, which is the one thing this runner exists not to
be.

### 8. Halt on first failure; append to the log

Continue-on-error is meaningless here — every later step consumes state an earlier one produces, so the
second failure would be noise caused by the first.

`src/run-migrations.log` appends a delimited block per run (start timestamp, argv, then per step: name,
timestamps, exit code, and before/after/delta for each written table; plus the four PBot counter groups
for step 5). Appending rather than overwriting because the log's value is diffing a failed run against the
last good one, which an overwrite destroys. This is the one place the run's real numbers are recorded, and
recording them is deliberately *not* the same as asserting them: the generic postcondition is only
`delta > 0`, so the log stays truthful as source data changes.

### 9. Location and name

`src/run-migrations.js`, above the per-migration directories — orchestration sits above what it
orchestrates. Deliberately not `migrate-runner.js` and deliberately not in a `runner-migration/`
directory: both forms are reserved by `migration-script-layout` for migrations, and a tenth
`migrate-*.js` in the tree would be read as a tenth migration. The layout spec gains a requirement for
this position and for where such a script's artifacts go, since its existing "beside the producing script"
rule assumes a migration directory.

## Risks / Trade-offs

- **[Risk] The step-5 stdout parse breaks if that script's summary lines are reworded.** → It is a
  backstop, not the primary guard (decision 3), so a silent parse failure degrades to the structural
  precondition rather than to nothing. Mitigate further by failing the step if the summary block is not
  found at all, rather than treating "no match" as "zero skips" — an unparseable summary is an unverified
  step.

- **[Risk] `delta > 0` is a weak postcondition.** → It catches the catastrophic case (a step that exits 0
  having written nothing) but not a partial load in steps 1–4 or 6–9, none of which expose skip counters.
  Accepted: the alternative is hard-coded expected counts, which drift. The log records the real numbers
  so a human can compare runs, and the specs explicitly forbid asserting against constants.

- **[Risk] Three entry-point paths in the step table are about to move.** → Known and scheduled; the
  runner is expected to be edited by each of the three relocation changes. Naming steps independently of
  paths (decision 6) confines each edit to one field.

- **[Risk] The run order now lives in two places — the spec's table and the step table in code.** →
  Mitigated by making the `migration-runner` spec the single authority and having
  `migration-script-layout` point at it rather than restate it, so there are two artifacts rather than
  three, and the code is the enforcement of the one spec that states the order.

- **[Trade-off] `--createdb` gives no progress output.** → 420K applied as one query returns only on
  completion or rollback. Accepted; it is seconds of work, and atomicity is worth more than a progress
  bar.

- **[Trade-off] Assertion `COUNT(*)`s add queries to a long pipeline.** → A few dozen counts against
  tables of 275K–517K rows, next to migrations that take minutes to hours. Negligible.

- **[Trade-off] A stray `MIGRATION_TEST_MODE=1` would split a run across two databases**, because root
  `db.js` swaps both connections for the `pg_classic`/`pg_play` test shim and `src/lib/db.js` has no such
  branch — affecting exactly the three root-resident steps. Recorded, deliberately not guarded: it
  requires someone to have exported the variable on purpose, and the branch disappears with the three
  pending relocations.

## Migration Plan

The runner is a new file; there is nothing to migrate and nothing to roll back but a deletion. Sequencing
within the change:

1. Step table and `--list` — verifiable with no database.
2. Argument parsing and the flag-conflict rejections — verifiable with no database.
3. Preflight tier, then the per-step predicate vocabulary.
4. Spawn loop, postconditions, step-5 counter parse.
5. `--createdb`.
6. Log writer.

Verification is against localhost, which currently holds a fully migrated database. That makes the
negative paths free and the positive path expensive: `--only <step>` against the populated database must
fail every first-writer precondition, and `--from`/`--only`/flag-conflict handling can all be exercised
without a load. A full green-field run needs an empty database created for the purpose, which is also the
only way to exercise `--createdb` meaningfully.

## Open Questions

- ~~Should the log capture each step's full stdout, or only the parsed summary values?~~ **Resolved during
  implementation: summary values plus a capped sample of `WARNING:` lines** (first 20, then a suppression
  note giving the true total). Full capture would bury the counts — `migrate-persons.js` alone emits a line
  per person, and `migrate-opinions.js` warns per record across 517K rows. The cap mirrors
  `LOG_SAMPLE_LIMIT` in `migrate-authorities.js` and `migrate-collections.js`, so the runner's log samples
  warnings the same way the scripts themselves do.
- Does `--from` need a matching `--to`? Not required by any current workflow, and easy to add later given
  the step table is a slice; left out rather than speculatively built.
- ~~**Does `--createdb` own the PostGIS extension?**~~ **Resolved: yes — one line added to the schema
  file.** `postgresql/create_new.sql`
  creates `ltree` with `CREATE EXTENSION IF NOT EXISTS` but not PostGIS, while line 4538 declares
  `location geography, -- make sure PostGIS is installed`. So `--createdb` fails on a genuinely bare
  database with `type "geography" does not exist`, and the transaction rolls back cleanly. Currently
  treated as a precondition of the database in the same category as the database's own existence, and
  reported as such by preflight 2/5. That was the stopgap; the decision taken was the real fix —
  `CREATE EXTENSION IF NOT EXISTS postgis;` now sits beside the existing `ltree` line, so `--createdb`
  builds a green-field database unaided. Preflight 2/5's message is retained for the database's own
  non-existence, which genuinely does remain outside the runner. The schema file's protection against a
  populated target is unchanged: the extension statements are idempotent and `CREATE SCHEMA dictionaries`
  still fails two lines later.
