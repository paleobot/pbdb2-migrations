## Why

All migration scripts currently mint `permid` values as UUIDv4 (via Node's `crypto.randomUUID()`), or — in the pbot migrations — reuse the external `pbotID` as the permid. UUIDv4's fully-random layout scatters inserts across the `permid` unique indexes, causing page splits and index bloat on both the bulk load and future API inserts. UUIDv7's time-ordered layout keeps inserts on the right edge of the index. Since we are already dropping and re-running the migrations for the bigint surrogate-key change, this is the natural moment to switch permid generation to UUIDv7 and add a database-level guard that the layout is actually v7.

## What Changes

- Add the `uuid` npm package and a single shared ESM helper that generates UUIDv7 permids; all migration scripts import it instead of `crypto.randomUUID()`.
- Switch permid generation to UUIDv7 for the six in-scope tables: **authorities, collections, refs, schemas, characters, states**.
- **BREAKING (pbot migrations):** `migrate-pbot-refs.js` and `migrate-pbot-schemas.js` stop using the external `pbotID` as the permid and generate a fresh UUIDv7 instead. The pbotID is already preserved in the jsonb `legacyIDs.pbotID` field, so no identifier is lost.
- **Re-key idempotency/verification off `legacyIDs.pbotID`, not permid.** The pbot scripts currently rely on `permid == pbotID` for `ON CONFLICT (permid)` upserts and count verification; with generated permids these must key on `reference->'legacyIDs'->>'pbotID'` (the mechanism cross-entity lookups already use).
- Add a `CHECK ((get_byte(uuid_send(permid), 6) >> 4) = 7)` constraint on the permid column of the six in-scope tables in `create_new.sql`, rejecting any non-v7 permid at write time. (This works on the current PostgreSQL 16; it will be swapped for `uuid_extract_version(permid) = 7` when the DB moves to PG18.)
- **Out of scope:** `timescales` and `intervals` permid columns are left unchanged (their migration design is still TBD), so they receive neither the generation change nor the CHECK constraint.

## Capabilities

### New Capabilities
- `permid-uuidv7`: Cross-cutting permid identity strategy — permids are UUIDv7 generated app-side via a shared helper, external legacy IDs are preserved in `legacyIDs`, and the target schema enforces the v7 version via a CHECK constraint on in-scope permid columns.

### Modified Capabilities
- `pbot-refs-migration`: permid is now a generated UUIDv7 rather than the reused `pbotID`; idempotency and the post-insert verification key on `legacyIDs.pbotID`.
- `pbot-schema-migration`: schemas/characters/states permids are now generated UUIDv7 rather than the reused `pbotID`; any idempotency/verification keys on `legacyIDs.pbotID`.

## Impact

- **Dependencies:** adds `uuid` to `package.json`.
- **New code:** shared ESM `uuidv7` helper module imported by all migration scripts that mint permids.
- **Migration scripts:** `migrate-authorities.js`, `migrate-collections.js`, `migrate-refs.js` (simple v4→v7 swap); `migrate-pbot-refs.js`, `migrate-pbot-schemas.js` (pbotID→generated v7 + idempotency rework).
- **Target schema:** `postgresql/create_new.sql` — CHECK constraints on `refs`, `collections`, `schemas`, `characters`, `states`, `authorities` permid columns.
- **Data integrity risks:**
  - *Idempotency regression (HIGH):* if the pbot scripts are not re-keyed off `legacyIDs.pbotID`, generated permids make `ON CONFLICT (permid)` never fire, duplicating every pbot ref/schema/character/state on re-run. This is the primary risk and must be handled in the same change.
  - *Cross-entity resolution:* schemas resolve their refs via `refs.reference->'legacyIDs'->>'pbotID'` (`lookupRefByPbotID`), not via permid, so fresh permids do not break those lookups — but this must be verified, not assumed.
  - *No source data transformation:* this change does not touch the MariaDB reads or any value mapping; it only changes how the target-side permid identifier is produced and constrained.
- **Ordering semantics (non-risk):** migrated permids encode migration time, not historical record dates; chronological/insertion ordering is already served by the `bigint` identity `id` and `created_at` columns, so this is an accepted characteristic, not a regression.
