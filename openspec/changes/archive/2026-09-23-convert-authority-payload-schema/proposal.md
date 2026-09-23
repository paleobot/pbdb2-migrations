## Why

`payloadSchemas/authority.schema.js` is the last legacy-shaped schema for an entity that a migration writes and
the taxa build reads. It still wraps the object in an `{ authority }` envelope, and `migrate-authorities.js`
validates `{ authority: payload }` with a plain ajv compile rather than a derived `db` variant. The schema has
no `permid`, and it cannot see `authorities.reference_id`, which is NOT NULL and the only thing that gives
`publishedInReference` a meaning: the payload carries a boolean about a reference it does not name. And
`authorities` is not audited, so nothing checks the 163,067 stored payloads after the step that wrote them.

It goes now because the four converted entities (collection, specimen, person, reference) have settled every
pattern it needs, and because `refs` now exposes permids, so an authority can name its reference the way a
collection already does.

## What Changes

- **`authority.schema.js` becomes `authoritySource`**, an annotated source with no envelope. Every variant is
  derived. `permid` is `x-storage: { column: "permid" }` and `readOnly`; `legacyIDs` is `readOnly`.
- **Every jsonb key keeps its name and shape**, including the plural `legacyIDs.oldpbdbIDs` array that dedup
  fills with every absorbed `taxon_no`. `migrate-authority-opinions.js` reads these keys by name, and the
  stored jsonb does not change.
- **`reference` is exposed**: the permid of the authority's reference, stored in `authorities.reference_id`.
  It is required on every authority except in the `db` variant, where `x-storage` fields are absent by
  definition.
- **A new scalar codec, `referencePermid`**, maps `reference` ↔ `reference_id` through the same versioned
  `refs` source `collectionReferences` declares. It is the second codec reading `refs`, and the first scalar
  one.
- **`year` is strict on create only.** `db` keeps `maxLength: 4`, which the 1,299 migrated `"0"` sentinel years
  and the 898 authorities with no year satisfy. `x-create` requires four digits when a year is given. The
  sentinel citation `"authority unknown"` stays enterable; such an authority simply omits `year`.
- **`migrate-authorities.js`** validates each built payload, unwrapped, against the `db` variant of
  `authoritySource`, as the other converted migrations do.
- **The audit covers `authority`**: a `REGISTRY` entry with `versioned: true`, round trip included.
- **Not exposed:** `authorizer_person_id` and `enterer_person_id`, following collection and reference.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `payload-schema-variants`: `authority.schema.js` joins the converted sources, unenveloped; the
  `referencePermid` codec is added; the authority source's fields, required lists and create-time `year` rule
  are specified.
- `payload-audit`: `authority` is an audited entity, versioned, with a round trip that rebuilds `reference`
  as a permid and selects `refs` per batch.
- `authorities-migration`: payloads are validated unwrapped against the `db` variant of `authoritySource`; the
  scenario ④ requirement's reference to the schema file is updated.
- `migration-runner`: the `authorities` step audits `authority`, and the "writes no audited table" example
  moves to a step that still writes none.

## Impact

**Payload schemas**: `payloadSchemas/authority.schema.js` (rewritten), `payloadSchemas/lib/codecs.js` (new
codec), `payloadSchemas/tests/` (source, variant and codec coverage), and a stale `authoritySchema` mention in
`payloadSchemas/opinionAttribution.schema.js`.

**Migrations**: `src/authorities-migration/migrate-authorities.js` (validation only; payload construction,
dedup and insert are unchanged).

**Audit and runner**: `src/audit-payloads.js` (`REGISTRY`); `src/run-migrations.js` needs no code change,
because audited entities follow from `REGISTRY`; the audit and runner tests are updated.

**Database**: no DDL change. The stored jsonb is unchanged, so localhost `pbdb` does not need rebuilding;
verification runs the full pipeline into a side database.

**Risk**: low. The only behavior change to a migration is which schema object validates the same payloads. The
real risk is the reverse: a `db` variant looser than the old schema would validate payloads the old one
rejected. The old schema's constraints (`citation` and `publishedInReference` required, `year` a string of at
most four characters, `descriptors` an array of strings) carry over unchanged, and unit tests pin them.
