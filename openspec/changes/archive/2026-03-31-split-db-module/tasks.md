## 1. Create new modules

- [x] 1.1 Create `pg-pool.js`: imports `dotenv/config`, validates `PG_*` env vars, creates and exports the `pg` Pool (with SSL support from `add-pg-ssl`), and exports `closePg()`
- [x] 1.2 Create `mariadb-pool.js`: imports `dotenv/config`, validates `MARIADB_*` env vars, creates and exports the `mariadb` pool, and exports `closeMariadb()`

## 2. Refactor db.js

- [x] 2.1 Replace `db.js` with a thin re-export module that imports from `pg-pool.js` and `mariadb-pool.js`, and exports `{ mariadb, pg, closeAll }`

## 3. Update pbot scripts

- [x] 3.1 Update `migrate-pbot-persons.js` to import `{ pg, closePg }` from `./pg-pool.js` and remove its inline Pool creation, env validation, and `dotenv/config` import
- [x] 3.2 Update `migrate-pbot-refs.js` to import `{ pg, closePg }` from `./pg-pool.js` and remove its inline Pool creation, env validation, and `dotenv/config` import
- [x] 3.3 Update `migrate-pbot-schemas.js` to import `{ pg, closePg }` from `./pg-pool.js` and remove its inline Pool creation, env validation, and `dotenv/config` import

## 4. Verify

- [x] 4.1 Confirm `migrate-persons.js` (uses `db.js`) still runs correctly
- [x] 4.2 Confirm `migrate-pbot-persons.js` (uses `pg-pool.js`) runs correctly against Aurora with SSL
