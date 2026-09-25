# Moving to a backend monorepo

*Status: direction decided 2026-09-25; nothing moved yet. Feedback welcome before any of it happens.*

This note explains a planned change to how the PBDB2 backend code is organized. It is written for
people who work in `pbdb2-migrations` on the DDL, payload schemas and database functions and weren't
part of the discussions. It covers why the change is happening, what the repo will look like, what
stays the same, and the steps to get there, including where your input is needed.

In short: `pbdb2-migrations` is renamed `pbdb2-backend`, and `pbdb2-api` moves into it as a
subdirectory. Your clone, the history, the issues and the commit hashes all carry over. What
changes is where files live.

---

## Why

The database schema, the payload schemas and the API describe the same thing from three sides, but
today they live in two repos:

```
 pbdb2-migrations                          pbdb2-api
 ┌──────────────────────────┐              ┌──────────────────────────┐
 │ postgresql/create_new.sql│◀─ ─ ─ ─ ─ ─ ─│ integration tests load it│  from a sibling
 │                          │              │ from ../pbdb2-migrations │  checkout on disk
 │ payloadSchemas/          │              │                          │
 │ play/server.js           │─ ─ ─ ─ ─ ─ ─▶│ schema-tree.js           │  copied, and now
 │ pg-pool.js               │─ ─ ─ ─ ─ ─ ─▶│ config.js                │  drifting
 └──────────────────────────┘              └──────────────────────────┘
```

Nothing makes the two repos move together, so they drift. A recent example: converting the
character and state payload schemas changed what the API returns for a schema GET, and nothing in
either repo noticed. The API had no way to see the change.

The API is about to rely much more heavily on the backend's work. The plan is for it to validate
POST and PATCH bodies against the same annotated payload schemas the migrations use, and to build
its responses with the same `merge()`/`split()` code. Once that happens, a change to a payload
schema or the DDL is a change to the API as well. It should land in one commit, be reviewed in one
PR, and be tested by one `npm test`.

## What stays the same

- **Your clone keeps working.** GitHub redirects a renamed repo, so `git pull` and `git push` keep
  going to the right place. You can update the remote URL whenever convenient.
- **History and commit hashes.** The existing history isn't rewritten. Files are moved in one
  ordinary commit, so every hash cited in docs, specs and issues stays valid, and
  `git log --follow` and blame trace files across the move.
- **Issues and PRs** stay where they are.
- **The work itself.** DDL, `derive_taxa()` and the other database functions, the payload schemas,
  the migration scripts and the runner behave the same. The full migration run must reproduce its
  current totals before the move is considered done.
- **OpenSpec.** Same workflow, same commands, one `openspec/` at the root. The existing specs keep
  their names. The API's specs are added beside them; no names collide.

## What changes: the layout

```
pbdb2-backend/
├── package.json          npm workspaces: one `npm install` at the root for everything
├── openspec/             one root: today's specs + the API's specs
├── docs/
├── db/
│   └── create_new.sql    the DDL: tables, triggers, derive_*/rebuild_* functions
├── payloadSchemas/       the annotated sources and lib/ (variants, codecs, enums, storage)
├── api/                  what is now pbdb2-api
└── migrations/           the migration scripts and everything specific to legacy data
    ├── src/              run-migrations.js, *-migration/ dirs
    ├── mariadb/          legacy DB analysis
    ├── migration_exploration/
    ├── play/
    └── pg-*.js
```

Where today's paths go:

| Today | After the move |
|---|---|
| `postgresql/create_new.sql` | `db/create_new.sql` |
| `payloadSchemas/*.schema.js`, `lib/`, `tests/` | unchanged, `payloadSchemas/` at the root |
| `payloadSchemas/mappings/*.md` (legacy → payload mappings) | `migrations/` |
| `src/` | `migrations/src/` |
| `mariadb/`, `play/`, `migration_exploration/`, `pg-*.js` | `migrations/` |
| `docs/`, `openspec/` | unchanged, at the root |
| the `pbdb2-api` repo | `api/` |

Why there are separate `db/` and `payloadSchemas/` directories at the top is explained in the next
section.

## The one new rule: nothing depends on `migrations/`

The migrations are temporary. Once PBDB Classic and PBot are shut down, which may be a couple of
years away, the migration code has done its job. The DDL, the payload schemas and the API are what
last.

So the layout follows one rule: `migrations/` may use anything else in the repo, and nothing else
may use `migrations/`.

```
db/create_new.sql          ◀──────┐
payloadSchemas/            ◀──┐   │     lasting
api/  ───────────────────────┼───┤
migrations/  ────────────────┴───┘     temporary: uses everything, nothing uses it
```

That is why the DDL and the payload schemas move out of the migration area to neutral ground: they
belong to the backend as a whole. When the migrations retire, `migrations/` and its specs are
removed in one change and nothing else breaks. The code remains in history, which will matter when
someone asks why a migrated record looks the way it does.

The same rule applies to specs. Almost a third of today's specs describe lasting parts of the
backend, not migration steps: `taxa-unified`, `taxa-clades`, `taxa-opinions`, `clade-attachments`,
`entity-versioning-triggers`, `payload-schema-variants` and `payload-schema-enums`. That's the main
reason for one OpenSpec root rather than one per app. Those specs, including the taxa work, stay
first-class and can be changed in the same proposal as a migration or an API route.

## How we get there

Two OpenSpec changes, with some housekeeping between them. Each is reviewed like any other change.

**1. Split `payloadSchemas/` into lasting and migration-only parts.** This happens first, inside
the current layout, and is the only step that changes code rather than moving it. For example,
`tests/enums.test.js` and `tests/dictionary-seeds.test.js` currently borrow the migrations'
database connection (`src/lib/pg-pool.js`). Under the rule above they need their own. The legacy
mapping docs move to the migration side.

**2. Housekeeping.** Before the move, in-flight work should be merged or parked, and branches that
are fully merged can go. *No branch is deleted without its owner agreeing.* Some remote branches
are yours (`clade-rework`, `graph-visuals`, `patch-derive-taxa`, `taxa-opinions-revise`), and I'd
like to go through them with you. The open `clade-hierarchy-user-guide` change (16 of 17 tasks) will
also be finished or parked.

**3. Agree a moment.** The move is quick (an afternoon), but it works best with nothing in flight.
We'll agree on a time together.

**4. The move (second change).**
- One commit moves everything into the new layout, with `create_new.sql` going to `db/`. The same
  change fixes every import and file path that pointed at the old locations, including
  `run-migrations.js` and the scripts in `migration_exploration/testing/` that read
  `create_new.sql`.
- The API's history is brought in under `api/`. Its 15 commits are the only history that gets
  rewritten, to move them into the subdirectory.
- The root `package.json` sets up npm workspaces. The migrations and the API keep their own
  `package.json`.
- Check: `npm test` passes, the full migration run reproduces its totals, and the API's
  integration tests build their database from `db/create_new.sql` in the same repo.

**5. Rename and archive.** `pbdb2-migrations` becomes `pbdb2-backend` on GitHub. `pbdb2-api` is
archived (read-only) with a pointer to its new home.

## What you'll need to do

Before the move:
- Push or merge what you're working on, or tell me what's in flight so we can time it.
- Let me know which of your branches to keep.

After the move:
- `git pull`. The move comes through as a normal commit.
- Run `npm install` once at the repo root.
- Update anything local that uses the old paths, such as a shell alias or a
  `psql -f postgresql/create_new.sql`, which becomes `db/create_new.sql`.
- Your `.env` may need copying into `migrations/`. The move change will say exactly where each
  `.env` goes.
- Optionally: `git remote set-url origin git@github.com:paleobot/pbdb2-backend.git`

If a branch does cross the move, git's rename detection usually carries edits to moved files across
a merge or rebase. Landing work first is still simpler.

## Alternatives we considered

- **A brand-new repo, with both histories rewritten into subdirectories.** This gives a slightly
  cleaner history, but every commit hash would change, issues would stay behind in the old repo,
  and everyone would have to re-clone. Rejected.
- **Move the DDL and payload schemas into `pbdb2-api`, and have migrations depend on it through a
  GitHub URL in `package.json`.** This aims straight at the long-term shape. But for the next couple
  of years most DDL and schema changes start in migrations work, so almost every change would span
  two repos and need a dependency bump in between. Rejected, because the monorepo reaches the same
  end state by deleting `migrations/` when the time comes.
- **Leave things as they are.** The drift described under [Why](#why) keeps happening, and it gets
  worse once the API validates writes against the payload schemas.

## Still open, and questions for you

- **`migration_exploration/testing/`.** Many of the `derive_taxa()` benchmark and diagnostic
  scripts are really tools for the database functions, not for migrations. They sit under
  `migrations/` in the plan above. If you still use them, they may belong next to `db/` instead.
  What do you think?
- **Your branches.** Which to keep (step 2).
- **Timing.** When a pause in DDL work would suit you.
- **The frontend** is expected to stay in its own repo, not yet confirmed, and to get the payload
  schemas from the API over HTTP. Either way, it doesn't affect day-to-day backend work.

The fuller record of the decision and its alternatives is in `docs/api-design-backlog.md`, under
"Repository boundary".
