## MODIFIED Requirements

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
