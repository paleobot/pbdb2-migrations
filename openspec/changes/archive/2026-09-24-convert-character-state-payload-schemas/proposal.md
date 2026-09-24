## Why

`character.schema.js` and `state.schema.js` are the last two payload schemas in the pre-`payload-schema-variants`
form that a migration writes. Each wraps its object in an envelope, neither is imported by anything, and the
stored payloads do not satisfy them: `definition` is declared a required string, yet `migrate-pbot-schemas.js`
writes `definition: null` whenever PBot has none, which is 249 of 336 characters and 284 of 1,325 states on
localhost `pbdb`. Nothing notices, because the migration does not validate characters or states and the audit
does not cover them. `states.quantitative` is also invisible to any payload, although it is the flag a future
observation layer will depend on.

They go now because the schema conversion settled every pattern they need, and deferred the one question they
touch, the character/state tree in the API, in a way that lets them go ahead without answering it.

## What Changes

- **`character.schema.js` becomes `characterSource`** and **`state.schema.js` becomes `stateSource`**,
  annotated sources with no envelope. Every variant is derived. `permid` is `x-storage: { column: "permid" }`
  and `readOnly`; `legacyIDs` is `readOnly`.
- **`definition` is optional.** The builders omit the key when PBot's definition is null instead of writing
  `null`. **The stored jsonb changes** on those 533 rows. A definition, when given, is a string.
- **`name` stays required, and must be non-empty on create** (`x-create`). No stored name is empty.
- **`quantitative` is exposed on state**, writable: `x-storage: { column: "quantitative" }`, not required,
  because the column defaults to false. It is a flag a client sets, not something derived from the name. The
  PBot migration still sets it from `name === "quantity"`, which is how PBot encoded it.
- **Parents and order are not exposed.** `parent_schema_id`, `parent_character_id`, `parent_state_id` and
  `sort_order` stay columns only. Whether they are payload fields depends on whether the API offers separate
  schema, character and state routes, or one call that creates the whole tree, which is undecided.
- **`migrate-pbot-schemas.js` fetches schemas, characters and states first, then validates every payload** of
  all three against its `db` variant, and inserts nothing if any fails. Today characters and states are fetched
  after schemas are inserted.
- **The audit covers `character` and `state`**: versioned `REGISTRY` entries with no child tables, round trip
  included. The `pbot-schemas` step then audits three entities.
- **The `$defs` sketch in `schema.schema.js`** gets a note that its `if name = quantity then value` rule predates
  the `quantitative` flag, and that a quantitative value belongs to a future description (observation) entity,
  not to the state.
- **Not exposed:** `authorizer_person_id` and `enterer_person_id`, as on every converted entity.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `payload-schema-variants`: `character.schema.js` and `state.schema.js` join the converted sources; the two
  sources' fields, annotations, required lists and create-time `name` rule are specified.
- `payload-audit`: `character` and `state` are audited, versioned entities with round trips; the unknown-entity
  example changes, because `character` becomes a valid name.
- `pbot-schema-migration`: character and state payloads omit a null `definition`; all three kinds of payload are
  fetched and validated before any insert.
- `migration-runner`: the `pbot-schemas` step audits `schema`, `character` and `state`; a full run audits eight
  entities.

## Impact

**Source and target**: the source is the PBot GraphQL API, not MariaDB, so no legacy MariaDB table, type
mapping, 0-as-NULL pattern or `anomaly-report.md` anomaly is involved. Target tables: `characters` (336 rows on
localhost `pbdb`) and `states` (1,325), all heads. `schemas` and `additional_schema_refs` are written by the same
step but their payloads do not change.

**Payload schemas**: `payloadSchemas/character.schema.js` and `payloadSchemas/state.schema.js` (rewritten), the
sketch comment in `payloadSchemas/schema.schema.js`, `payloadSchemas/tests/sources.test.js`.

**Migrations**: `src/pbot-schemas-migration/migrate-pbot-schemas.js` (fetch order, validation, the two builders;
level-by-level insertion, parent resolution, `sort_order` and `quantitative` are unchanged).

**Audit and runner**: `src/audit-payloads.js` (`REGISTRY`), `src/README.txt`, and the audit and runner tests.
`src/run-migrations.js` needs no code change.

**Database**: no DDL change. The stored jsonb changes on 533 rows, so localhost `pbdb` must catch up after
verification: rebuilt by the pipeline, or updated to drop the null keys.

**Risk to data integrity**: low. The only stored change is removing a key whose value is null, which loses no
information. As with schema, the migration now rejects payloads it used to insert unchecked, so a PBot record
with, for example, a null name would stop the step; the side-DB run against live PBot shows whether any does.
