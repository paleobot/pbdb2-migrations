## 1. Add pg-classic-pool.js

- [x] 1.1 Create `pg-classic-pool.js` modeled on `pg-pool.js`: imports `dotenv/config`, validates
      required vars (`PG_CLASSIC_HOST`, `PG_CLASSIC_USER`, `PG_CLASSIC_PASSWORD`,
      `PG_CLASSIC_DATABASE`), supports optional `PG_CLASSIC_CA_CERT` → `ssl.ca`, creates and exports
      the `pgClassic` Pool and a `closePgClassic()` function

## 2. Update configuration documentation

- [x] 2.1 Add a `PG_CLASSIC_*` block to `.env.example` with a comment explaining it's the alternate
      path for a Postgres-ported Classic copy (vs. the `MARIADB_*` block for real MariaDB access)

## 3. Verify

- [x] 3.1 Confirm importing `pg-classic-pool.js` alone never requires any `MARIADB_*` or target
      `PG_*` (non-classic) env var to be set
- [x] 3.2 Confirm `db.js`, `mariadb-pool.js`, and the 4 existing MariaDB-dependent scripts
      (`migrate-collections.js`, `migrate-persons.js`, `migrate-refs.js`, `migrate-authorities.js`)
      are unchanged
- [x] 3.3 With real `PG_CLASSIC_*` values in `.env`, run a one-off query (e.g. `SELECT count(*) FROM
      opinions`) to confirm connectivity — confirmed live 2026-08-18, `opinions` count 998,565,
      matching the known count from `docs/taxa-opinions-migration-mapping.md`
