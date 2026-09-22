## 1. Dictionary column renames

- [x] 1.1 Rename `dictionaries.genders.genders` → `name` and `dictionaries.roles.role` → `name` in `postgresql/create_new.sql`, leaving both tables' rows, order and `id` values untouched (D5)
- [x] 1.2 Update the one reader: `SELECT id, role FROM dictionaries.roles` in `src/persons-migration/migrate-persons.js`
- [x] 1.3 Add a `genders` entry to `payloadSchemas/tests/fixtures/legacy-enums.json` holding `["Male","Female","Other","Anonymous"]`, snapshotted from the inline enum before `person.schema.js` is rewritten; add no `roles` entry (D5)
- [x] 1.4 Extend the seed-fidelity test to cover `genders`, and confirm it asserts nothing about `roles`

## 2. Codec context

- [x] 2.1 Add a `sources` array to the codec contract in `payloadSchemas/lib/codecs.js`: `{ table, key, value }` entries declared by the codec, not by the annotation (D2)
- [x] 2.2 Implement `collectCodecSources(source)` — walk the source's `x-storage` codecs, union their declared sources, de-duplicate
- [x] 2.3 Implement `loadCodecContext(pg, sources, selection)` returning `Map: table → { byKey, byValue }`, both populated from one read per source (D3)
- [x] 2.4 Make `selection` restrict on either the source's `key` or its `value` column — `merge` starts from a stored column, `split` from a payload value such as a permid — and read a source in full when it is omitted
- [x] 2.5 Read a source in the `dictionaries` schema once per run rather than per selection; restrict only non-dictionary sources per batch (D3)
- [x] 2.6 Thread an optional `ctx` through `split(source, payload, ctx)` and `merge(source, parts, ctx)` in `payloadSchemas/lib/storage.js`, and through each codec's `split`/`merge`; keep both functions pure and synchronous (D1)
- [x] 2.7 Confirm `wgs84Point` and `collectionReferences` are unchanged and still work with no `ctx` argument
- [x] 2.8 Make a codec throw, naming itself and the unresolved value, when the context lacks a mapping it needs — and make `split` throw rather than silently drop a property when a source needs a context and none was given
- [x] 2.9 Add the source-validation check: a property carrying both `x-enumFrom` and a codec declaring a `dictionaries.*` source must have the two name the same table, else throw naming the property (D2)

## 3. The two codecs

- [x] 3.1 Implement `roleName`: source `{ table: "dictionaries.roles", key: "id", value: "name" }`; split maps `role` name → `columns.role_id`, merge maps `role_id` → name; absent `role` emits no column
- [x] 3.2 Implement `personPermid`: source `{ table: "persons", key: "id", value: "permid" }`; split maps `authorizer` permid → `columns.authorizer_person_id`, merge maps the id → that person's permid; absent `authorizer` emits no column
- [x] 3.3 Unit-test both from a hand-built fixture `Map` with no database connection, including the unknown-name and unknown-permid throws

## 4. The person source

- [x] 4.1 Rewrite `payloadSchemas/person.schema.js` as `personSource` (default export): envelope removed, `personSchema` gone, `$id .../person.json`, `unevaluatedProperties: false`, base `required: ["familyName","givenName","gender"]`
- [x] 4.2 Annotate: `permid` readOnly + `x-storage { column: "permid" }`; `legacyIDs` readOnly; `totalHours` readOnly + `x-storage { column: "total_hours" }`
- [x] 4.3 Annotate: `role` → `x-enumFrom { roles, name }` + `x-storage { column: "role_id", codec: "roleName" }`; `authorizer` → `x-storage { column: "authorizer_person_id", codec: "personPermid" }`; `active` → `x-storage { column: "active" }`; none of the three readOnly (D4)
- [x] 4.4 Annotate `gender` → `x-enumFrom { genders, name }` and `countryCode` → `x-enumFrom { admin0, iso }`; add the `orcid` pattern
- [x] 4.5 Add `x-create: { required: ["email"] }`; define no `password` and no `createdAt`, with a comment recording that credentials are a separate flow
- [x] 4.6 Add source/variant tests: all four variants compile under `createAjv()`; `db` has none of the five `x-storage` properties; `in-create` rejects `permid`, `legacyIDs`, `totalHours` and requires `email`; `patch-guard`'s `propertyNames.not.enum` is exactly those three
- [x] 4.7 Verify a `db` variant compiled from the current database validates all 1,304 stored person rows before any migration is touched — the conversion should change no validation outcome

## 5. Shared country resolution

- [x] 5.1 Move `normalizeName`, `COUNTRY_ALIASES` and the `dictionaries.admin0` loader out of `src/collections-migration/migrate-collections.js` into `src/lib/`, as `migration-script-layout` requires of a helper two migrations share (D6)
- [x] 5.2 Update `migrate-collections.js` to import them; change nothing else in it
- [x] 5.3 Add `'untied states' → US` and `'england' → GB` to `COUNTRY_ALIASES`, the two variants `migrate-persons.js`'s `COUNTRY_NORMALIZE` carried that the shared map does not
- [x] 5.4 Re-run the collections migration and confirm 275,554 rows and an unchanged toponym breakdown — the move must be behaviour-preserving

## 6. Classic persons migration

- [x] 6.1 Remove the `@countrystatecity/countries` import and `COUNTRY_NORMALIZE` from `src/persons-migration/migrate-persons.js`; resolve `country` through the shared `src/lib/` pipeline
- [x] 6.2 Drop `@countrystatecity/countries` from `package.json` and `package-lock.json`; confirm no other consumer
- [x] 6.3 Remove `heir_no` from the source query
- [x] 6.4 Resolve and compile the person `db` variant before the first source row is read, and validate every `person` object before writing; report `person_no` and ajv errors on failure
- [x] 6.5 Keep building the jsonb and the flat columns separately — do not route writes through `split()` (D9)
- [x] 6.6 Diff the new `countryCode` per `person_no` against the values stored by the previous implementation; every person that resolves today must resolve to the same country, and record any added matches

## 7. PBot persons migration

- [x] 7.1 Resolve and compile the person `db` variant before the GraphQL request is issued
- [x] 7.2 Replace the three backfill statements (`jsonb_set` for `orcid`, `jsonb_set` for `email`, `person || jsonb_build_object(...)` for `legacyIDs.pbotID`) with a read of the stored `person` object, the backfills applied in JS, one `validate()`, and one `UPDATE` of the whole object (D7)
- [x] 7.3 Issue no `UPDATE` at all when no backfill applies
- [x] 7.4 Validate the insert branch's `person` object before the INSERT; leave the minted permid behaviour from `add-persons-permid` untouched
- [x] 7.5 Re-run and confirm the match cascade counts (ORCID/email/name/ambiguous/inserted) are unchanged from the pre-change run

## 8. Payload audit

- [x] 8.1 Add `versioned` to the `REGISTRY` entry shape; mark collection and specimen versioned and add the person entry as unversioned (D8)
- [x] 8.2 Make the shared row query select `succeeded_by_id IS NULL AS head` only for a versioned entry, keeping `permid` for every entry
- [x] 8.3 Report a single rows-checked count for an unversioned entity instead of the head/superseded split
- [x] 8.4 Pass a codec context to `merge` and `split` in `--round-trip`: select `persons` per batch from the ids that batch holds, alongside the existing child-row pre-load, and read `dictionaries.roles` once for the run
- [x] 8.5 Confirm `--entity person` now audits rather than erroring, and that an unknown name lists all three entities

## 9. Verification

- [x] 9.1 Full run from an empty database via `src/run-migrations.js`
- [x] 9.2 Confirm row counts: 1,304 classic persons plus the PBot inserts, 275,554 collections, 167,150 specimens
- [x] 9.3 `node src/audit-payloads.js` — zero violations across person, collection and specimen
- [x] 9.4 `node src/audit-payloads.js --round-trip` — zero differences, with person's `role`, `authorizer`, `active`, `totalHours` and `permid` rebuilt from columns
- [x] 9.5 Re-run `migrate-persons.js` and `migrate-pbot-persons.js` alone and confirm idempotence: no duplicate rows, no permid changes, no repeated backfill writes
    - Verified: 1,375 rows before and after, 0 permid changes, 0 `role_id`/`authorizer_person_id`/`active`
      changes, and a matched person with nothing to backfill draws no `UPDATE` (93 of 95 on a repeat run).
    - **Exception, pre-existing and out of scope:** two distinct PBot Person records (both "Làm Nguyễn",
      pbotIDs `b71d0464…` and `322f8f2a…`) match the same PG person by email, so each run writes its own
      `legacyIDs.pbotID` to `persons.id = 1371` and the stored value alternates — 2 writes per run that never
      converge. `legacyIDs.pbotID` is a scalar and cannot hold both. The old code issued its
      `person || jsonb_build_object(...)` unconditionally for every match and had the same collision; the
      read-modify-write only makes it visible by counting it. Deciding what `pbotID` means when two PBot
      persons collapse onto one PG person belongs to `pbot-person-migration`'s match cascade, not here.
- [x] 9.6 Confirm the `countryCode` baseline diff from 6.6 shows no losses

## 10. Specs

- [x] 10.1 Confirm the five delta specs match what was implemented, amending them if implementation revealed anything different
- [x] 10.2 Run `openspec validate convert-person-payload-schema`
- [x] 10.3 Sync deltas into `openspec/specs/` via `/opsx:sync` or at archive time
