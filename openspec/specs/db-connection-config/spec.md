# db-connection-config Specification

## Purpose
Define `.env`-based database connection configuration for the migration scripts (MariaDB source and PostgreSQL target).

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
The system SHALL provide database connection pools as separate modules that can be imported independently:
- `pg-pool.js` — exports a `pg.Pool` instance for the target PostgreSQL database and a `closePg()` function
- `mariadb-pool.js` — exports a `mysql2/promise` connection pool for the source MariaDB database and a `closeMariadb()` function
- `db.js` — re-exports `mariadb` from `mariadb-pool.js`, `pg` from `pg-pool.js`, and a `closeAll()` function that closes both pools

Scripts that only need PostgreSQL SHALL import from `pg-pool.js` directly, avoiding any dependency on MariaDB configuration.

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

### Requirement: .env variable schema
The `.env` file SHALL support the following variables:

| Variable | Required | Default |
|----------|----------|---------|
| MARIADB_HOST | yes | — |
| MARIADB_PORT | no | 3306 |
| MARIADB_USER | yes | — |
| MARIADB_PASSWORD | yes | — |
| MARIADB_DATABASE | no | pbdb_archive |
| PG_HOST | yes | — |
| PG_PORT | no | 5432 |
| PG_USER | yes | — |
| PG_PASSWORD | yes | — |
| PG_DATABASE | yes | — |
| PG_CA_CERT | no | — |

When `PG_CA_CERT` is set, the system SHALL read the file at that path and use its contents as the CA certificate for the PostgreSQL SSL connection.

#### Scenario: Default port values
- **WHEN** `MARIADB_PORT` or `PG_PORT` is not set in `.env`
- **THEN** the connection module uses 3306 and 5432 respectively

#### Scenario: Default MariaDB database name
- **WHEN** `MARIADB_DATABASE` is not set in `.env`
- **THEN** the connection module connects to `pbdb_archive`

#### Scenario: PG_CA_CERT not set
- **WHEN** `PG_CA_CERT` is not set in `.env`
- **THEN** the PostgreSQL connection pool is created without SSL configuration

#### Scenario: PG_CA_CERT set to a valid certificate path
- **WHEN** `PG_CA_CERT` is set to a path containing a valid CA certificate file
- **THEN** the PostgreSQL connection pool is created with `ssl.ca` set to the file contents, enabling encrypted and CA-verified connections

#### Scenario: PG_CA_CERT set to a nonexistent path
- **WHEN** `PG_CA_CERT` is set but the file does not exist at that path
- **THEN** the system SHALL fail immediately with an error indicating the file could not be read
