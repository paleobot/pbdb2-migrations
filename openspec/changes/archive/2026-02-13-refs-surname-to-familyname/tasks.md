## 1. Code Change

- [x] 1.1 Rename `surname` to `familyName` in all author object literals in `buildAuthors()` in `migrate-refs.js`

## 2. Testing

- [x] 2.1 Run the migration script and confirm it completes without errors
- [x] 2.2 Spot-check: verify a reference's jsonb `authors` array uses `familyName` (not `surname`)
- [x] 2.3 Run the script a second time to confirm idempotency
