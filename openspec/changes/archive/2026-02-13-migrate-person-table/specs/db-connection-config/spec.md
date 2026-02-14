## ADDED Requirements

### Requirement: Environment-based connection configuration
The system SHALL read database connection parameters from a `.env` file using the `dotenv` package. The `.env` file MUST NOT be committed to version control. A `.env.example` file with placeholder values SHALL be committed as documentation.

#### Scenario: .env file present with valid values
- **WHEN** a migration script is executed and a `.env` file exists with all required variables populated
- **THEN** the script connects to both MariaDB and PostgreSQL using those values

#### Scenario: .env file missing or incomplete
- **WHEN** a migration script is executed and the `.env` file is missing or has empty required variables
- **THEN** the script exits with a clear error message indicating which variables are missing

### Requirement: Shared connection module
The system SHALL provide a `db.js` module that exports connection pools for both databases. The module SHALL export:
- `mariadb` — a `mysql2/promise` connection pool for the source database
- `pg` — a `pg.Pool` instance for the target database
- `closeAll()` — a function that closes both connection pools

#### Scenario: Module imported by a migration script
- **WHEN** a script runs `const { mariadb, pg, closeAll } = require('./db')`
- **THEN** both pools are available for queries and `closeAll()` cleanly shuts down both connections

#### Scenario: Clean shutdown after migration
- **WHEN** a migration script calls `closeAll()` after completing its work
- **THEN** all database connections are released and the Node.js process can exit cleanly

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

#### Scenario: Default port values
- **WHEN** `MARIADB_PORT` or `PG_PORT` is not set in `.env`
- **THEN** the connection module uses 3306 and 5432 respectively

#### Scenario: Default MariaDB database name
- **WHEN** `MARIADB_DATABASE` is not set in `.env`
- **THEN** the connection module connects to `pbdb_archive`
