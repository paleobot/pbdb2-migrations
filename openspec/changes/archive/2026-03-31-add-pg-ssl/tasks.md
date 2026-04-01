## 1. Add SSL support to db.js

- [x] 1.1 Import `readFileSync` from `fs` in `db.js`
- [x] 1.2 Build the `ssl` config object conditionally: when `PG_CA_CERT` is set, read the file and set `ssl: { ca: contents }`; otherwise omit `ssl`
- [x] 1.3 Pass the `ssl` option to the `pg.Pool` constructor

## 2. Update configuration documentation

- [x] 2.1 Add `PG_CA_CERT` entry to `.env.example` with a comment explaining its purpose

## 3. Verify

- [x] 3.1 Confirm local dev still works without `PG_CA_CERT` set (comment it out in `.env`, run a migration script)
- [x] 3.2 Confirm Aurora connection works with `PG_CA_CERT=global-bundle.pem` set in `.env`
