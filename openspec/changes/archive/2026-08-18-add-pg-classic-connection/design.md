## Context

`pg-pool.js` and `mariadb-pool.js` already split the shared connection layer by database
(`split-db-module`), with `pg-pool.js` gaining optional CA-cert SSL support (`add-pg-ssl`) for
Aurora. Both of those assume there are exactly two databases: MariaDB Classic (source) and Postgres
new-schema (target).

A contributor's environment can instead have Classic itself hosted as a Postgres-ported copy — a
third, distinct database, with its own credentials, holding `pbdb_archive`-shaped data rather than
the new schema. That contributor has no MariaDB endpoint at all. Meanwhile other contributors keep
using the real MariaDB path unchanged.

## Goals / Non-Goals

**Goals:**
- Let scripts (and ad hoc queries) reach a Postgres-ported copy of Classic without requiring any
  MariaDB credentials
- Keep the existing MariaDB-based path for Classic completely untouched, since other contributors
  depend on it

**Non-Goals:**
- Reconciling MySQL-vs-Postgres SQL dialect differences (backtick quoting, JSON functions, etc.) in
  the 4 existing MariaDB-dependent scripts — nobody is running those against Postgres-ported data
- Wiring `pg-classic-pool.js` into `db.js`'s `closeAll()` — would couple it to
  `mariadb-pool.js`'s required-var check, defeating the purpose

## Decisions

**1. A separate module, not a config flag on `pg-pool.js`.**
`pg-pool.js` already connects to the new-schema migration target; Classic-via-Postgres is a
distinct database with its own credentials, so it gets its own pool/module — the same split
precedent as `pg-pool.js` vs. `mariadb-pool.js` (`split-db-module`).
Alternative considered: a `PG_ROLE=classic|target` switch on `pg-pool.js`. Rejected — a script may
need both pools open at once (e.g. to cross-reference legacy and new-schema rows), which a single
switched pool can't do.

**2. Not wired into `db.js`.**
`db.js`'s `closeAll()` already assumes MariaDB is configured — `mariadb-pool.js` exits the process
if `MARIADB_*` vars are missing. Wiring `pg-classic-pool.js` into `db.js` would force contributors
without MariaDB access to fake MariaDB env vars just to use Classic-via-Postgres. A script that only
needs Classic-via-Postgres imports `pg-classic-pool.js` directly — the same pattern PG-only scripts
already use for `pg-pool.js` today.

**3. Same required-var / SSL shape as `pg-pool.js`.**
Reuses the `add-pg-ssl` CA-cert mechanism (`PG_CLASSIC_CA_CERT` → `ssl.ca`) and the same
required-var fail-fast behavior, for consistency rather than inventing a new pattern.

## Risks / Trade-offs

- Two independent Postgres pools open at once (target + classic) doubles connection count for
  scripts that need both — acceptable at `max: 5` per pool.
- Credentials for a third external database now live in `.env` — mitigated by using a **read-only**
  DB user for the classic copy, since it's a copy of source-of-truth data, not the primary source.
