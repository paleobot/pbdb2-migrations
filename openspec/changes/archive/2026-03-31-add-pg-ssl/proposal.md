## Why

The Aurora (AWS Postgres) instance requires encrypted connections. The `pg` npm package does not enable SSL by default, so the migration scripts fail with `no pg_hba.conf entry ... no encryption`. This blocks all migration work against the AWS environment.

## What Changes

- Configure the `pg.Pool` instance in `db.js` to use SSL when a CA certificate is provided
- Add `PG_CA_CERT` as an optional `.env` variable pointing to the CA certificate file (e.g., AWS RDS `global-bundle.pem`)
- When `PG_CA_CERT` is set, read the certificate file and pass it as `ssl.ca` to the Pool configuration
- When `PG_CA_CERT` is not set, behavior remains unchanged (no SSL), preserving local development workflow
- Update `.env.example` to document the new variable

## Capabilities

### New Capabilities

_(none)_

### Modified Capabilities

- `db-connection-config`: Adding optional SSL/TLS support for the PostgreSQL connection via a new `PG_CA_CERT` environment variable

## Impact

- **Code**: `db.js` — Pool construction gains an `ssl` option
- **Dependencies**: Uses Node.js built-in `fs.readFileSync` — no new npm packages
- **Configuration**: New optional `PG_CA_CERT` variable in `.env` / `.env.example`
- **Environments**: Local dev (no cert) continues to work unchanged; AWS Aurora (with cert) becomes functional
