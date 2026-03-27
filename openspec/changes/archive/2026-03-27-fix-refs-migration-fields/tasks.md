## 1. migrate-refs.js (PBDB)

- [x] 1.1 Add `comments` to the MariaDB SELECT query in `main()`
- [x] 1.2 In `buildJsonb`, add mapping: `ref.comments` → `jsonb.comments` (trim, omit if empty)
- [x] 1.3 In `buildJsonb`, change `jsonb.oldpbdbID = String(ref.reference_no)` to `jsonb.legacyIDs = { oldpbdbID: String(ref.reference_no) }`

## 2. migrate-pbot-refs.js (PBot)

- [x] 2.1 In `buildReferenceJsonb`, add mapping: `ref.notes` → `jsonb.comments` (trim, omit if empty)
- [x] 2.2 In `buildReferenceJsonb`, change `ref.description` mapping from `jsonb.notes` to `jsonb.description`
- [x] 2.3 In `buildReferenceJsonb`, change `jsonb.pbotID = ref.pbotID` to `jsonb.legacyIDs = { pbotID: ref.pbotID }`
- [x] 2.4 Replace name-based enterer lookup query with `SELECT id FROM persons WHERE person->'legacyIDs'->>'pbotID' = $1`, passing the enteredBy Person's `pbotID`
- [x] 2.5 Simplify enterer resolution: remove extraction of `entererGiven`/`entererSurname`, pass `enteredByEntry.Person.pbotID` directly to the lookup query

## 3. Verification

- [x] 3.1 Run `migrate-refs.js` and verify: comments populated where source has data, legacyIDs nested correctly, row count matches (manual)
- [x] 3.2 Run `migrate-pbot-refs.js` and verify: notes → comments, description → description, legacyIDs nested, enterer lookup works via pbotID (manual)
