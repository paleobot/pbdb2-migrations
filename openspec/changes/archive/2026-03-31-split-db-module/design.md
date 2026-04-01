## Context

`db.js` is a monolithic module that creates both a MariaDB pool and a PostgreSQL pool, validates env vars for both, and exports them together. Scripts that only need PostgreSQL (the `migrate-pbot-*` scripts) can't use it without providing MariaDB credentials, so they duplicate the Pool setup inline. The recent `add-pg-ssl` change showed this causes configuration drift.

## Goals / Non-Goals

**Goals:**
- Allow scripts to import only the PostgreSQL pool without requiring MariaDB configuration
- Centralize all connection configuration (including SSL) in one place per database
- Maintain backward compatibility for scripts that import from `db.js`

**Non-Goals:**
- Changing the connection pool libraries (`pg`, `mysql2`)
- Adding connection retry logic or health checks
- Modifying MariaDB connection configuration

## Decisions

**1. Two new modules: `pg-pool.js` and `mariadb-pool.js`**

Each module owns its database's pool creation, env validation, and export. This is simpler than a single module with conditional initialization, and makes the dependency graph explicit at the import level.

Alternative considered: Lazy initialization in `db.js` (only create MariaDB pool on first access). Rejected because it hides the dependency and makes errors surface at query time rather than at startup.

**2. `db.js` becomes a thin re-export**

`db.js` imports from both modules and re-exports `{ mariadb, pg, closeAll }`. Existing scripts (`migrate-persons.js`, `migrate-refs.js`) continue working with no changes.

**3. Env validation stays in each module**

`pg-pool.js` validates `PG_*` vars. `mariadb-pool.js` validates `MARIADB_*` vars. `dotenv/config` is imported in each module — Node's module cache ensures the `.env` file is only read once regardless of import order.

**4. `migrate-pbot-*` scripts import from `pg-pool.js`**

These scripts replace their inline Pool creation with `import { pg } from './pg-pool.js'` and remove their own dotenv/env-validation/Pool code.

## Risks / Trade-offs

- **Double dotenv import** → No real risk; `dotenv/config` is idempotent and cached by Node's module system.
- **Breaking change if external code imports from `db.js`** → Low risk; these are local migration scripts, not a published package. `db.js` re-exports maintain the same API.
