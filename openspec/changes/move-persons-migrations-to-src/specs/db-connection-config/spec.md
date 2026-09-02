## MODIFIED Requirements

### Requirement: Shared connection module
The system SHALL provide database connection pools as separate modules that can be imported
independently. Two parallel sets of these modules exist while the relocation of migration scripts under
`src/` is in progress.

**Root-level set** — serves the migration scripts that still live at the repository root:
- `pg-pool.js` — exports a `pg.Pool` instance for the target PostgreSQL database and a `closePg()` function
- `mariadb-pool.js` — exports a `mysql2/promise` connection pool for the source MariaDB database and a `closeMariadb()` function
- `db.js` — re-exports `mariadb` from `mariadb-pool.js`, `pg` from `pg-pool.js`, and a `closeAll()` function that closes both pools

**`src/lib/` set** — the forward set, serving scripts under `src/`:
- `src/lib/pg-pool.js`, `src/lib/mariadb-pool.js`, `src/lib/db.js` — the same three modules, with the same
  exports and the same required-variable checks

Scripts under `src/` SHALL import connection modules from `src/lib/` where a counterpart exists there.
`src/lib/` currently provides counterparts for the target-PostgreSQL and source-MariaDB pools only; the
specialty pools (`pg-classic-pool.js`, `pg-migrated-pool.js`, `pg-play-pool.js`) exist at the repository
root only, and a script under `src/` that needs one SHALL import it from the root until a counterpart is
added. This is a scoped rule, not a prohibition on referencing anything above `src/`: `src/lib/` also
imports payload schemas from `payloadSchemas/`, which are contracts rather than utilities and are
deliberately not copied.

Scripts at the repository root SHALL continue to import the root-level modules.

Regardless of which set is used, a script that only needs PostgreSQL SHALL import from the `pg-pool.js`
module directly rather than from `db.js`, avoiding any dependency on MariaDB configuration.

#### Scenario: PG-only script imports pg-pool.js
- **WHEN** a script imports `{ pg, closePg }` from `pg-pool.js` and only `PG_*` env vars are set
- **THEN** the PostgreSQL pool is available for queries without requiring MariaDB env vars

#### Scenario: Dual-database script imports db.js
- **WHEN** a script imports `{ mariadb, pg, closeAll }` from `db.js`
- **THEN** both pools are available for queries and `closeAll()` cleanly shuts down both connections

#### Scenario: Missing PG env vars
- **WHEN** a script imports from `pg-pool.js` and required `PG_*` variables are missing
- **THEN** the module exits with an error listing the missing variables

#### Scenario: Missing MariaDB env vars
- **WHEN** a script imports from `mariadb-pool.js` and required `MARIADB_*` variables are missing
- **THEN** the module exits with an error listing the missing variables

#### Scenario: Script under src/ imports the src/lib/ counterpart
- **WHEN** a PostgreSQL-only migration script located under `src/` needs a connection pool
- **THEN** it imports `{ pg, closePg }` from `../lib/pg-pool.js` rather than from the root-level `pg-pool.js`

#### Scenario: Script under src/ needs a specialty pool with no src/lib/ counterpart
- **WHEN** a script under `src/` needs `pg-classic-pool.js`, `pg-migrated-pool.js`, or `pg-play-pool.js`
- **THEN** it imports that module from the repository root, because `src/lib/` provides no counterpart for it

#### Scenario: Root-level script keeps its root-level imports
- **WHEN** a migration script that has not yet been relocated under `src/` needs a connection pool
- **THEN** it imports the root-level module, and is not required to change until it is relocated
