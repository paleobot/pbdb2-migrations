## MODIFIED Requirements

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

### Requirement: Environment-based connection configuration
The system SHALL read database connection parameters from a `.env` file using the `dotenv` package. The `.env` file MUST NOT be committed to version control. A `.env.example` file with placeholder values SHALL be committed as documentation.

#### Scenario: .env file present with valid values
- **WHEN** a migration script is executed and a `.env` file exists with all required variables populated
- **THEN** the script connects to both MariaDB and PostgreSQL using those values

#### Scenario: .env file missing or incomplete
- **WHEN** a migration script is executed and the `.env` file is missing or has empty required variables
- **THEN** the script exits with a clear error message indicating which variables are missing
