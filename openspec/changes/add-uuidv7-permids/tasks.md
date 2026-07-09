## 1. Dependency and shared helper

- [x] 1.1 Add `uuid` to `package.json` dependencies and install (`npm install uuid`)
- [x] 1.2 Create a shared ESM helper module exporting a UUIDv7 generator backed by the `uuid` package's `v7` function
- [x] 1.3 Add a brief comment in the helper noting it is the single swap point (e.g. future native `uuidv7()`)

## 2. Simple v4 → v7 swaps

- [x] 2.1 `migrate-authorities.js`: import the shared helper and replace `randomUUID()` at the permid call site (line ~276); remove the now-unused `randomUUID` import
- [x] 2.2 `migrate-collections.js`: replace `randomUUID()` at `permid` (line ~509); remove unused `randomUUID` import
- [x] 2.3 `migrate-refs.js`: replace `randomUUID()` at `permid` (line ~301); remove unused `randomUUID` import

## 3. Convert pbot-refs migration

- [x] 3.1 `migrate-pbot-refs.js`: generate `permid` via the shared helper instead of `const permid = ref.pbotID` (confirm `jsonb.legacyIDs.pbotID` is still set — line ~181)
- [x] 3.2 Replace the `ON CONFLICT (permid)` upsert with idempotency keyed on `reference->'legacyIDs'->>'pbotID'` (chose explicit lookup-then-insert/update); preserve existing `id` and `permid` on update
- [x] 3.3 Update the post-insert verification query (was `WHERE permid = ANY($1)`) to count by `reference->'legacyIDs'->>'pbotID'`
- [x] 3.4 Reconcile the `references_permid_key` unique-constraint setup step (permid is now generated; ensure the pbotID-based idempotency key is what enforces logical uniqueness)

## 4. Convert pbot-schemas migration

- [x] 4.1 `migrate-pbot-schemas.js`: generate `permid` via the shared helper for the schemas INSERT (line ~348-352) instead of `schema.pbotID`
- [x] 4.2 Do the same for the characters and states INSERTs
- [x] 4.3 Confirm `legacyIDs.pbotID` remains set for schema/character/state payloads (lines ~218, 261, 273) and that parent-resolution maps still key on pbotID, not permid

## 5. Schema CHECK constraints

- [x] 5.1 In `postgresql/create_new.sql`, add `CHECK ((get_byte(uuid_send(permid), 6) >> 4) = 7)` to the `permid` column of `refs`, `collections`, `schemas`, `characters`, `states`, and `authorities`
- [x] 5.2 Add a comment noting the PG18 replacement (`uuid_extract_version(permid) = 7`)
- [x] 5.3 Leave `timescales` and `intervals` permid columns unconstrained (out of scope)

## 6. Verify

- [ ] 6.1 Drop the affected tables and re-run the migrations (combined with the bigint rebuild)
- [ ] 6.2 Verify every in-scope table has zero permids with version nibble ≠ 7 (e.g. `SELECT count(*) ... WHERE (get_byte(uuid_send(permid),6) >> 4) <> 7`)
- [ ] 6.3 Re-run `migrate-pbot-refs.js` a second time and confirm no duplicate references are created (idempotency holds on `legacyIDs.pbotID`)
- [ ] 6.4 Confirm cross-entity resolution still works (schemas resolve their refs; character/state parent trees build) after the permid change
