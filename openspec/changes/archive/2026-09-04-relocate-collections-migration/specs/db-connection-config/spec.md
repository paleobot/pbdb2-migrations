## MODIFIED Requirements

### Requirement: Shared connection module
The system SHALL provide database connection pools as separate modules that can be imported
independently.

**`src/lib/` is the connection-module set.** Every migration script lives under `src/` and SHALL import its
pools from `src/lib/`:
- `src/lib/pg-pool.js` — exports a `pg.Pool` instance for the target PostgreSQL database and a `closePg()` function
- `src/lib/mariadb-pool.js` — exports a `mysql2/promise` connection pool for the source MariaDB database and a `closeMariadb()` function
- `src/lib/db.js` — re-exports `mariadb` from `src/lib/mariadb-pool.js`, `pg` from `src/lib/pg-pool.js`, and a `closeAll()` function that closes both pools

The parallel root-level set that existed while migration scripts were being relocated under `src/` has been
retired. Root `db.js`, `uuidv7.js`, and `mariadb-pool.js` were deleted once the last migration script moved;
`uuidv7.js`, `pg-pool.js`, and `mariadb-pool.js` were byte-identical to their `src/lib/` counterparts, and
root `db.js` differed only by a `MIGRATION_TEST_MODE` branch belonging to the superseded
`migration_exploration/` harness.

**What remains at the repository root is pools, and only pools:**

| Module | Why it remains |
|---|---|
| `pg-pool.js` | `play/server.js`, a demo API outside `src/`, imports it. It is PostgreSQL-only and must keep working. |
| `pg-classic-pool.js`, `pg-migrated-pool.js`, `pg-play-pool.js` | Specialty pools with no `src/lib/` counterpart. |

A root module with a named live consumer is a retained module, not a leftover. Root `pg-pool.js` SHALL NOT be
deleted as cleanup while `play/server.js` imports it, and this requirement names that consumer so the reason
survives the reader who finds the module and takes it for drift.

**The repository root has no dual-database entry point,** because no script outside `src/` needs both pools.
A future script that needs `mariadb` and `pg` together SHALL be placed under `src/` and import
`src/lib/db.js`; root `db.js` SHALL NOT be restored. This is a decision, not an omission.

The specialty pools exist at the repository root only, and a script under `src/` that needs one SHALL import
it from the root until a counterpart is added. This is a scoped rule, not a prohibition on referencing
anything above `src/`: `src/lib/` also imports payload schemas from `payloadSchemas/`, which are contracts
rather than utilities and are deliberately not copied.

Regardless of which module is used, a script that only needs PostgreSQL SHALL import from the `pg-pool.js`
module directly rather than from `db.js`, avoiding any dependency on MariaDB configuration.

#### Scenario: PG-only script imports pg-pool.js
- **WHEN** a script imports `{ pg, closePg }` from `pg-pool.js` and only `PG_*` env vars are set
- **THEN** the PostgreSQL pool is available for queries without requiring MariaDB env vars

#### Scenario: Dual-database script imports db.js
- **WHEN** a script imports `{ mariadb, pg, closeAll }` from `src/lib/db.js`
- **THEN** both pools are available for queries and `closeAll()` cleanly shuts down both connections

#### Scenario: Missing PG env vars
- **WHEN** a script imports from `pg-pool.js` and required `PG_*` variables are missing
- **THEN** the module exits with an error listing the missing variables

#### Scenario: Missing MariaDB env vars
- **WHEN** a script imports from `mariadb-pool.js` and required `MARIADB_*` variables are missing
- **THEN** the module exits with an error listing the missing variables

#### Scenario: Migration script imports the src/lib/ module
- **WHEN** a migration script under `src/` needs a connection pool
- **THEN** it imports from `../lib/pg-pool.js`, `../lib/mariadb-pool.js`, or `../lib/db.js`, because no root-level counterpart to those three exists any more

#### Scenario: Script under src/ needs a specialty pool with no src/lib/ counterpart
- **WHEN** a script under `src/` needs `pg-classic-pool.js`, `pg-migrated-pool.js`, or `pg-play-pool.js`
- **THEN** it imports that module from the repository root, because `src/lib/` provides no counterpart for it

#### Scenario: Retained root pool is not cleaned up
- **WHEN** a contributor finds `pg-pool.js` at the repository root and takes it for a leftover of the relocation
- **THEN** it is left in place, because `play/server.js` imports it and this requirement records that consumer by name

#### Scenario: A future dual-database script is placed under src/
- **WHEN** a new script needs both the MariaDB and PostgreSQL pools
- **THEN** it is written under `src/` and imports `src/lib/db.js`, rather than a root-level `db.js` being reintroduced
