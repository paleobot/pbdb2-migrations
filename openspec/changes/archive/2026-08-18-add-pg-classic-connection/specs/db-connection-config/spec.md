## ADDED Requirements

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

## MODIFIED Requirements

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
