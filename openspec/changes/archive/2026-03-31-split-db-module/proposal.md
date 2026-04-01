## Why

Three migration scripts (`migrate-pbot-persons.js`, `migrate-pbot-refs.js`, `migrate-pbot-schemas.js`) create their own `pg.Pool` instead of using the shared `db.js` module. This means connection configuration changes (like the SSL fix in `add-pg-ssl`) must be duplicated across every script. These scripts only need PostgreSQL, but `db.js` currently forces a MariaDB connection too, which is why they bypassed it.

## What Changes

- Split `db.js` into two modules: `pg-pool.js` (PostgreSQL only) and `mariadb-pool.js` (MariaDB only)
- `db.js` re-exports both pools and `closeAll()` for backward compatibility with existing scripts
- `pg-pool.js` includes the SSL/CA cert support from `add-pg-ssl`
- Update the three `migrate-pbot-*` scripts to import from `pg-pool.js` instead of creating their own Pool
- Remove duplicated connection logic, env validation, and `dotenv/config` imports from those scripts

## Capabilities

### New Capabilities

_(none)_

### Modified Capabilities

- `db-connection-config`: Splitting the shared connection module into separate PG and MariaDB modules so scripts can import only what they need, while `db.js` remains as a convenience re-export

## Impact

- **Code**: `db.js` (refactored), new `pg-pool.js` and `mariadb-pool.js`, three `migrate-pbot-*` scripts updated
- **Imports**: `migrate-persons.js` and `migrate-refs.js` continue to use `db.js` unchanged
- **Dependencies**: No new npm packages
