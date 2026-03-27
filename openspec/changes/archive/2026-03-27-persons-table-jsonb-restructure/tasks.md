## 1. Update `migrate-persons.js` (PBDB → PostgreSQL)

- [x] 1.1 Remove `dictionaries.genders` lookup and `anonymousGenderId`/`genderMap` logic. Replace with direct string mapping: `'M'→'Male'`, `'F'→'Female'`, default `'Anonymous'`.
- [x] 1.2 Build `person` JSONB object in the row loop: `givenName`, `familyName`, `gender` (always set); `middle`, `email`, `countryCode`, `institution` (omitted when empty); `legacyIDs: { oldpbdbID: String(person_no) }` (always set).
- [x] 1.3 Rewrite the INSERT/upsert SQL to target the new columns: `id`, `password`, `role_id`, `person` (JSONB), `authorizer_person_id`, `active`, `total_hours`. Update `ON CONFLICT (id) DO UPDATE` to set `role_id`, `authorizer_person_id`, `person`, `active`.
- [x] 1.4 Verify (deferred to end-to-end): run `migrate-persons.js` against the database and confirm 1,304 rows upserted with correct JSONB structure (spot-check a few rows with `SELECT id, person FROM persons WHERE id IN (...)` ).

## 2. Update `migrate-pbot-persons.js` (PBot GraphQL → PostgreSQL)

- [x] 2.1 Remove `dictionaries.genders` lookup. Gender is now `'Anonymous'` string in JSONB for all new PBot persons.
- [x] 2.2 Update match cascade queries to use JSONB paths: `person->>'orcid'`, `lower(person->>'email')`, `lower(person->>'givenName')` / `lower(person->>'familyName')`. Update SELECT lists to extract via `person->>'email' AS email`, `person->>'orcid' AS orcid`.
- [x] 2.3 Rewrite ORCID backfill to use `jsonb_set`: `UPDATE persons SET person = jsonb_set(person, '{orcid}', to_jsonb($1::text)) WHERE id = $2`.
- [x] 2.4 Rewrite email backfill to use `jsonb_set`: `UPDATE persons SET person = jsonb_set(person, '{email}', to_jsonb($1::text)) WHERE id = $2`.
- [x] 2.5 Add `legacyIDs.pbotID` backfill for matched persons: merge `pbotID` into existing `legacyIDs` using `person || jsonb_build_object('legacyIDs', COALESCE(person->'legacyIDs', '{}'::jsonb) || jsonb_build_object('pbotID', $1::text))`.
- [x] 2.6 Rewrite new person INSERT to build `person` JSONB: `givenName`, `familyName`, `email`, `gender: 'Anonymous'`, `legacyIDs: { pbotID }`, plus `orcid` when available. Insert flat columns: `role_id`, `authorizer_person_id`, `active`, `password = NULL`, `total_hours = NULL`.
- [x] 2.7 Verify: run `migrate-pbot-persons.js` after `migrate-persons.js` and confirm match counts, backfill counts, and new inserts are consistent with prior run (14 email matches, 7 name matches, ~66 inserts, 13 ORCID backfills).

## 3. Update downstream query in `migrate-pbot-refs.js`

- [x] 3.1 Update the enterer lookup query (around line 264) from `WHERE lower(given_name) = lower($1) AND lower(family_name) = lower($2)` to `WHERE lower(person->>'givenName') = lower($1) AND lower(person->>'familyName') = lower($2)`.

## 4. End-to-end verification

- [x] 4.1 Run full migration sequence (`migrate-persons.js` → `migrate-pbot-persons.js`) and verify: total row count in `persons`, spot-check JSONB structure for PBDB-sourced and PBot-sourced rows, confirm `legacyIDs.oldpbdbID` present on PBDB rows and `legacyIDs.pbotID` present on PBot rows (including matched persons that got both).
