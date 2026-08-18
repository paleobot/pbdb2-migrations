## Why

The connection layer assumes Classic (`pbdb_archive`) is reachable as a live MariaDB instance
(`mariadb-pool.js`). Some contributors instead only have access to a **Postgres-ported copy** of
Classic (e.g. on a remote Aurora instance) — a separate database from the new-schema migration
target already reachable via `pg-pool.js` — with no real MariaDB endpoint available to them at all.
There is currently no way for such a contributor, or scripts/queries run on their behalf, to reach
Classic data without a real MariaDB connection.

## What Changes

- Add a new `pg-classic-pool.js` module, modeled on `pg-pool.js`, exporting `pgClassic` (a `pg.Pool`)
  and `closePgClassic()`
- Add new optional `.env` variables: `PG_CLASSIC_HOST`, `PG_CLASSIC_PORT` (default 5432),
  `PG_CLASSIC_USER`, `PG_CLASSIC_PASSWORD`, `PG_CLASSIC_DATABASE`, `PG_CLASSIC_CA_CERT` (optional,
  same CA-cert mechanism as `PG_CA_CERT` from `add-pg-ssl`)
- Update `.env.example` to document the new variables as an alternate path for environments without
  real MariaDB access
- `pg-classic-pool.js` is independent of `db.js` and `mariadb-pool.js` — it is not wired into
  `db.js`'s `closeAll()`, so importing it never triggers MariaDB's required-var check
- No changes to `mariadb-pool.js`, `db.js`, or the four existing MariaDB-dependent scripts
  (`migrate-collections.js`, `migrate-persons.js`, `migrate-refs.js`, `migrate-authorities.js`) —
  contributors with real MariaDB access are unaffected

## Capabilities

### New Capabilities

_(none — extends existing `db-connection-config`)_

### Modified Capabilities

- `db-connection-config`: Adding an optional, independent Postgres connection module for
  contributors whose Classic access is a Postgres-ported copy rather than a live MariaDB instance

## Impact

- **Code**: new `pg-classic-pool.js`; no changes to existing modules or scripts
- **Dependencies**: none new — reuses the existing `pg` package
- **Configuration**: new optional `PG_CLASSIC_*` variables in `.env` / `.env.example`
- **Environments**: contributors with real MariaDB access see no change; contributors with a
  Postgres-ported Classic copy gain a working connection path
