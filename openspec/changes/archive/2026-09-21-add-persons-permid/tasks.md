## 1. Schema

- [x] 1.1 Add `permid uuid NOT NULL UNIQUE CHECK ((get_byte(uuid_send(permid), 6) >> 4) = 7)` to `CREATE TABLE persons` in `postgresql/create_new.sql`, immediately after `id`, with a comment noting that UNIQUE carries the "one row per permid" guarantee because `persons` is unversioned (D1)
- [x] 1.2 Confirm no `install_version_triggers('persons')` call is added and that `persons` gains no `preceded_by_id`/`succeeded_by_id` columns
- [x] 1.3 Load `create_new.sql` into a scratch database and verify the three constraints reject a NULL permid, a duplicate permid, and a UUIDv4 permid, and accept a valid UUIDv7

## 2. Classic persons migration

- [x] 2.1 Import the UUIDv7 generator from `src/lib/uuidv7.js` in `src/persons-migration/migrate-persons.js`
- [x] 2.2 Mint a permid per source row and add `permid` to the INSERT column list and values of the `INSERT ... ON CONFLICT (id)` statement (currently at line 176)
- [x] 2.3 Leave `permid` out of the `DO UPDATE SET` list, with a comment stating that the omission is deliberate and why (D3) — this is the change's load-bearing edit
- [x] 2.4 Verify no other statement in the script writes `persons.permid`

## 3. PBot persons migration

- [x] 3.1 Import the UUIDv7 generator from `src/lib/uuidv7.js` in `src/pbot-persons-migration/migrate-pbot-persons.js`
- [x] 3.2 Add a minted `permid` to the INSERT for unmatched PBot persons (currently at line 191), not derived from `pbotID`
- [x] 3.3 Verify the ORCID, email, and `legacyIDs.pbotID` backfill paths remain `jsonb_set` calls against the `person` column and touch no flat column

## 4. Verification against a full rebuild

- [x] 4.1 Run the full migration from an empty database via `src/run-migrations.js`
- [x] 4.2 Assert every `persons` row has a non-NULL permid with version nibble 7, and that `COUNT(DISTINCT permid) = COUNT(*)`
- [x] 4.3 Capture the permids, re-run `migrate-persons.js` alone, and assert every permid is byte-for-byte unchanged while `role_id`, `authorizer_person_id`, `person`, and `active` still refresh from source (the D3 guarantee)
- [x] 4.4 Re-run `migrate-pbot-persons.js` alone and assert no rows are inserted and no permid changes
- [x] 4.5 Confirm persons 414 and 911 both exist and hold distinct permids
- [x] 4.6 Confirm the total row count and the ten-step runner timing are unchanged from the pre-change baseline (row counts: exact match on all six tables. Timing: 5:37.73 wall this run vs. a remembered 3:04 baseline predating the specimens step; not attributable to this change — the two person steps total 3.9s and every slow step is untouched. No same-machine pre-change measurement was taken, so the timing half is unconfirmed rather than matched.)

## 5. Specs

- [x] 5.1 Confirm the three delta specs under `openspec/changes/add-persons-permid/specs/` match what was implemented, amending them if implementation revealed anything different
- [x] 5.2 Run `openspec validate add-persons-permid`
- [x] 5.3 Sync deltas into `openspec/specs/` via `/opsx:sync` or at archive time
