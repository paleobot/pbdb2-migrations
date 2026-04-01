## Context

The `pg.Pool` in `db.js` is created without SSL configuration. AWS Aurora enforces encrypted connections via `pg_hba.conf`, rejecting plaintext connections. The `pg` npm package does not enable SSL by default, unlike GUI tools such as pgAdmin which typically enable it automatically.

A CA certificate (`global-bundle.pem`, the AWS RDS root CA bundle) has already been obtained and placed in the project root. A `PG_CA_CERT` variable has been added to `.env`.

## Goals / Non-Goals

**Goals:**
- Enable SSL connections to Aurora by reading a CA certificate when `PG_CA_CERT` is set
- Preserve the current no-SSL behavior for local development when `PG_CA_CERT` is not set

**Non-Goals:**
- Client certificate authentication (mTLS) — Aurora uses password auth over TLS, not client certs
- Validating the certificate hostname (`rejectUnauthorized` enforcement) — deferred; AWS RDS certs validate correctly by default when `ca` is provided
- SSL support for the MariaDB connection — not needed at this time

## Decisions

**1. Opt-in SSL via `PG_CA_CERT` environment variable**

The `ssl` option on `pg.Pool` is only set when `PG_CA_CERT` is present in the environment. This avoids breaking local development where PostgreSQL may not have SSL configured.

Alternative considered: Always enable SSL with `ssl: { rejectUnauthorized: false }`. Rejected because it weakens security and is unnecessary — when connecting to Aurora, we should verify the server certificate.

**2. Read certificate synchronously at module load**

Use `readFileSync` to read the CA cert at import time, alongside the rest of the pool configuration. The certificate is small and read once, so synchronous I/O is appropriate here. This keeps the pool construction simple and avoids async initialization complexity.

**3. Pass certificate as `ssl.ca` (not `ssl: true`)**

Using `ssl: true` or `ssl: { rejectUnauthorized: false }` connects with encryption but skips certificate verification. Passing `ssl: { ca: <cert> }` enables both encryption and server identity verification against the AWS RDS CA.

## Risks / Trade-offs

- **Missing or wrong cert path** → Pool construction will throw on `readFileSync`. This is desirable: fail fast with a clear error rather than a cryptic connection timeout. The error message from `readFileSync` includes the path.
- **Cert expiration** → AWS rotates the RDS root CA periodically. The `global-bundle.pem` contains multiple root CAs to handle rotation. No mitigation needed beyond using the bundle rather than a single cert file.
