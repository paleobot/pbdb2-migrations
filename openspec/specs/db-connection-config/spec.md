# db-connection-config Specification

## Purpose
Defines how migration scripts obtain and configure database connections: environment-variable-based
credentials via `.env`, the set of connection-pool modules available (`pg-pool.js`,
`mariadb-pool.js`, `pg-classic-pool.js`, `db.js`), and the full `.env` variable schema each expects.

## Requirements
### Requirement: Environment-based connection configuration
The system SHALL read database connection parameters from a `.env` file using the `dotenv` package. The `.env` file MUST NOT be committed to version control. A `.env.example` file with placeholder values SHALL be committed as documentation.

#### Scenario: .env file present with valid values
- **WHEN** a migration script is executed and a `.env` file exists with all required variables populated
- **THEN** the script connects to both MariaDB and PostgreSQL using those values

#### Scenario: .env file missing or incomplete
- **WHEN** a migration script is executed and the `.env` file is missing or has empty required variables
- **THEN** the script exits with a clear error message indicating which variables are missing

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

### Requirement: Postgres-ported Classic connection module
The system SHALL provide an optional `pg-classic-pool.js` module, independent of `mariadb-pool.js`
and `db.js`, for contributors whose access to Classic (`pbdb_archive`-shaped data) is a
Postgres-ported copy rather than a live MariaDB instance. It SHALL expose a `pgClassic` pool and a
`closePgClassic()` function, and SHALL support the same optional CA-certificate SSL mechanism as
`pg-pool.js` via `PG_CLASSIC_CA_CERT`.

#### Scenario: Classic-via-Postgres script imports pg-classic-pool.js
- **WHEN** a script imports `{ pgClassic, closePgClassic }` from `pg-classic-pool.js` and the
  `PG_CLASSIC_*` env vars are set
- **THEN** the Postgres-ported Classic pool is available for queries without requiring any
  `MARIADB_*` or target `PG_*` env vars

#### Scenario: Missing PG_CLASSIC env vars
- **WHEN** a script imports from `pg-classic-pool.js` and required `PG_CLASSIC_*` variables are
  missing
- **THEN** the module exits with an error listing the missing variables

#### Scenario: PG_CLASSIC_CA_CERT set
- **WHEN** `PG_CLASSIC_CA_CERT` is set to a path containing a valid CA certificate file
- **THEN** the `pgClassic` pool is created with `ssl.ca` set to the file contents

#### Scenario: PG_CLASSIC_CA_CERT not set
- **WHEN** `PG_CLASSIC_CA_CERT` is not set
- **THEN** the `pgClassic` pool is created without SSL configuration

### Requirement: .env variable schema
The `.env` file SHALL support the following variables:

| Variable | Required | Default |
|----------|----------|---------|
| MARIADB_HOST | yes (if using real MariaDB) | — |
| MARIADB_PORT | no | 3306 |
| MARIADB_USER | yes (if using real MariaDB) | — |
| MARIADB_PASSWORD | yes (if using real MariaDB) | — |
| MARIADB_DATABASE | no | pbdb_archive |
| PG_HOST | yes | — |
| PG_PORT | no | 5432 |
| PG_USER | yes | — |
| PG_PASSWORD | yes | — |
| PG_DATABASE | yes | — |
| PG_CA_CERT | no | — |
| PG_CLASSIC_HOST | yes (if using Postgres-ported Classic) | — |
| PG_CLASSIC_PORT | no | 5432 |
| PG_CLASSIC_USER | yes (if using Postgres-ported Classic) | — |
| PG_CLASSIC_PASSWORD | yes (if using Postgres-ported Classic) | — |
| PG_CLASSIC_DATABASE | yes (if using Postgres-ported Classic) | — |
| PG_CLASSIC_CA_CERT | no | — |

When `PG_CA_CERT` (or `PG_CLASSIC_CA_CERT`) is set, the system SHALL read the file at that path and
use its contents as the CA certificate for the corresponding PostgreSQL SSL connection.
`MARIADB_*` and `PG_CLASSIC_*` are independent, mutually optional blocks: an environment may set
either, both, or neither, depending on which Classic-access path (real MariaDB vs. Postgres-ported
copy) it uses.

#### Scenario: Default port values
- **WHEN** `MARIADB_PORT`, `PG_PORT`, or `PG_CLASSIC_PORT` is not set in `.env`
- **THEN** the connection module uses 3306, 5432, and 5432 respectively

#### Scenario: Default MariaDB database name
- **WHEN** `MARIADB_DATABASE` is not set in `.env`
- **THEN** the connection module connects to `pbdb_archive`

#### Scenario: PG_CA_CERT / PG_CLASSIC_CA_CERT not set
- **WHEN** `PG_CA_CERT` or `PG_CLASSIC_CA_CERT` is not set in `.env`
- **THEN** the corresponding PostgreSQL connection pool is created without SSL configuration

#### Scenario: PG_CA_CERT / PG_CLASSIC_CA_CERT set to a valid certificate path
- **WHEN** `PG_CA_CERT` or `PG_CLASSIC_CA_CERT` is set to a path containing a valid CA certificate
  file
- **THEN** the corresponding PostgreSQL connection pool is created with `ssl.ca` set to the file
  contents, enabling encrypted and CA-verified connections

#### Scenario: PG_CA_CERT / PG_CLASSIC_CA_CERT set to a nonexistent path
- **WHEN** `PG_CA_CERT` or `PG_CLASSIC_CA_CERT` is set but the file does not exist at that path
- **THEN** the system SHALL fail immediately with an error indicating the file could not be read

#### Scenario: PG_CLASSIC_* vars unset in a MariaDB-only environment
- **WHEN** `PG_CLASSIC_*` variables are not set and no script imports `pg-classic-pool.js`
- **THEN** the environment behaves exactly as before this change, with no new requirement imposed
