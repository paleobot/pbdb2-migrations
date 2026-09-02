## Why

The archived `create-opinions-migration` change stood up a standard `src/` layout (`src/lib/` utilities,
`src/opinions-migration/` for the migration) and explicitly deferred relocating the older root-level
`migrate-*.js` scripts: *"Relocating the older scripts under `src/` is a deliberate later refactor"*
(that change's `design.md:31-32`). This change opens that refactor.

The two persons scripts are the right first slice: between them they depend on exactly two root-level
modules, nothing in the repo imports them programmatically, and both are idempotent — so the move can be
verified by simply re-running them. Doing persons first establishes the layout and import conventions that
the remaining six root-level `migrate-*.js` scripts will follow, at near-zero risk.

## What Changes

- Move `migrate-persons.js` → `src/persons-migration/migrate-persons.js`, repointing its import from
  root `./db.js` to `../lib/db.js`.
- Move `migrate-pbot-persons.js` → `src/pbot-persons-migrations/migrate-pbot-persons.js`, repointing its
  import from root `./pg-pool.js` to `../lib/pg-pool.js`.
- Each script gets its own directory (not one shared persons folder), so the two scripts' differing
  connection requirements stay visible: `migrate-persons.js` needs `MARIADB_*` + `PG_*`;
  `migrate-pbot-persons.js` is PG-only plus `PBOT_TOKEN`.
- Delete the root-level originals. This is a move, not a copy — unlike `src/lib/`, which the opinions
  change deliberately created as a copy.
- Update the three inbound references to the old paths: the `Bash(node migrate-persons.js:*)` permission
  entry in `.claude/settings.local.json`, the comment at `migrate-authorities.js:150`, and the prose
  reference in `openspec/specs/authorities-migration/spec.md:259`.
- Correct the `db-connection-config` spec, which describes the connection modules as a single unprefixed
  set (`pg-pool.js`, `mariadb-pool.js`, `db.js`) because it was written before `src/lib/` existed.
- Record the `src/` layout convention as a capability spec, so the six remaining slices have a durable
  contract to cite rather than an archived change's design notes.

No behavior changes. No source or target database access changes. `migrate-pbot-persons.js`'s swap is a
pure path change — root `pg-pool.js` is byte-identical to `src/lib/pg-pool.js`. `migrate-persons.js` loses
only the `MIGRATION_TEST_MODE` branch that root `db.js` carries and `src/lib/db.js` deliberately dropped;
that shim was built for the opinions exploration harness and was never exercised by the persons migration.

## Capabilities

### New Capabilities
- `migration-script-layout`: The standard `src/` directory layout for migration scripts — one directory
  per migration under `src/`, shared utilities in `src/lib/`, run artifacts written beside the script that
  produces them — plus the record of which scripts have been migrated to it and which remain at root.

### Modified Capabilities
- `db-connection-config`: The "Shared connection module" requirement is rewritten to describe two parallel
  module sets (root-level, serving the not-yet-migrated root scripts; and `src/lib/`, the forward set) and
  the rule governing which a given script imports.
- `authorities-migration`: The requirement documenting `persons.id == legacy person_no` cites
  `migrate-persons.js` by path; the citation updates to the new location. Behavior is unchanged.

## Impact

**Code moved:** `migrate-persons.js`, `migrate-pbot-persons.js` (2 files, ~15.5 KB combined). One import
line changes in each. No other line of either script is touched.

**Code edited in place:** `migrate-authorities.js` (one comment), `.claude/settings.local.json` (one
permission entry).

**Databases:** none. This change performs no migration, alters no source or target schema, transforms no
data, and introduces no type mappings. The MariaDB `person` table and the PostgreSQL `persons` table are
untouched; the scripts that read and write them are only relocated. The anomaly classes tracked in
`anomaly-report.md` are therefore out of play here.

**Data-integrity risk:** minimal, and confined to one failure mode — a script that no longer resolves its
connection module would fail at import, loudly and before any query. The mitigating property is that both
scripts are idempotent (`migrate-persons.js` by spec, via `INSERT ... ON CONFLICT (id) DO UPDATE`;
`migrate-pbot-persons.js` by its ORCID → email → name match cascade), so verification is a re-run against
localhost confirming the `persons` row count is unchanged and no new inserts occur.

**Not in scope:** extracting `normalizeOrcid` into `src/lib/`; unifying the nine divergent
`setval(pg_get_serial_sequence(...))` call sites; adding `payloadSchemas/person.schema.js` validation;
the `pbot-person-migration` spec's cross-boundary reference to `migrate-pbot-refs.js`; moving the other
six root-level `migrate-*.js` scripts; renaming the `person-migration` / `pbot-person-migration`
capabilities to match the new directory names.
