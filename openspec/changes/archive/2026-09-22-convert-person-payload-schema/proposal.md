## Why

`payloadSchemas/` holds nine payload schemas. Two — `collection.schema.js` and `specimen.schema.js` — were
converted to the annotated-source form by `payload-schema-variants`. The other seven still carry an envelope,
hardcoded enums, and in some cases hand-maintained `createSchema`/`editSchema` variants.
`payloadSchemas/person.schema.js` is the third to convert, not the last.

It goes next for four reasons. `add-persons-permid` (archived 2026-09-21) was written specifically to unblock
it and states that as a goal. At 68 lines it is much the smallest of the seven, against
`reference.schema.js`'s 507 and `schema.schema.js`'s 208. Its `gender` enum is a hardcoded four-value array
annotated `//TODO: pull from dictionaries.genders`, and `dictionaries.genders` already holds exactly those
four values in that order, so resolving it cannot change a validation outcome. And it forces the two
mechanisms the remaining schemas will need — which is the argument for meeting them on the small one:

- **A codec that cannot be computed from the payload alone.** `persons` is the first *converted* entity whose
  non-jsonb columns are part of the entity as the API sees it (`role_id`, `authorizer_person_id`, `active`,
  `total_hours`) rather than plumbing. It is not the only entity of that kind — `refs.reference_type_id` is
  the same shape and will want the same treatment — so the mechanism is built to generalise rather than to
  serve `role`.
- **An audit that can read an unversioned table.** `persons` has no `succeeded_by_id`, and
  `src/audit-payloads.js` selects one for every entity it reads.

Nothing imports `person.schema.js` — `personSchema` has exactly one occurrence in the repository, its own
`export` line — so neither person migration validates the jsonb it writes and the audit cannot check a stored
person row. The same is true of `reference`, `schema`, `character` and `state`; it is what the conversion
queue exists to work through, one entity at a time.

## What Changes

- **One annotated source.** `person.schema.js` exports `personSource` — the person object as the API sees
  it, no envelope, no hand-maintained variants. `db`, `in-create`, `patch-guard` and `out` are derived.
- **Column-backed fields enter the payload.** `role`, `authorizer`, `active` and `totalHours` carry
  `x-storage`, joining `permid`. Every one of them is *removed* by the `db` variant, so the stored jsonb,
  and what the migrations validate, are unchanged by their arrival.
- **Codecs gain a context.** `role` is exposed as a name, not a `role_id`, and `authorizer` as a person's
  permid, not a `persons.id` — this project exposes permids, and a bare `role_id` of 3 means nothing to a
  client without a roles route. Both need a lookup a pure function of the payload cannot do. `split` and
  `merge` take a third argument carrying the maps, built by `collectCodecSources` / `loadCodecContext`,
  mirroring the `collectEnumSources` / `loadEnums` / `applyEnums` split the enum resolver already uses.
  Sources are declared by each codec, not by the annotation, so `x-storage` keeps its current shape.
  Resolution is per batch, so the mechanism does not assume the mapped table fits in memory.
- **Three more `x-enumFrom` markers**: `gender` from `dictionaries.genders`, `role` from
  `dictionaries.roles`, `countryCode` from `dictionaries.admin0.iso`.
- **Two dictionary columns are renamed** to the convention every table added by `payload-schema-variants`
  follows: `dictionaries.genders.genders` → `name`, `dictionaries.roles.role` → `name`. Both predate that
  convention; `roles.role` has one reader and `genders.genders` has none.
- **`@countrystatecity/countries` is dropped.** `migrate-persons.js` resolves `country` through
  `dictionaries.admin0` instead, using the normalize-then-alias pipeline `migrate-collections.js` already
  implements, which moves to `src/lib/` as `migration-script-layout` requires of any helper two migrations
  share. The package leaves `package.json`; that script is its only consumer.
- **Both person migrations validate.** `migrate-persons.js` validates against the resolved `db` variant
  before writing. `migrate-pbot-persons.js`'s three `jsonb_set` backfills become read-modify-write through
  the same validator. Several migrations still write a payload jsonb unvalidated — `migrate-refs.js`,
  `migrate-pbot-refs.js` and `migrate-pbot-schemas.js` among them, each awaiting its own conversion — but the
  backfills are a distinct case: they mutate a stored payload in place from SQL, so a validator at the insert
  site alone would never cover them.
- **The audit learns about unversioned entities.** `REGISTRY` gains `person`. Its shared row query selects
  `succeeded_by_id IS NULL AS head`, which `persons` does not have, so the entry declares itself unversioned
  and the query and report adapt.
- **`heir_no` leaves the source query.** `migrate-persons.js` selects it and has never read it, and
  `person-migration` mandates selecting it.
- **BREAKING (internal):** `personSchema` is removed. It has no importers.

## Capabilities

### New Capabilities

None. Every behaviour this change adds belongs to a capability that already owns behaviour of the same kind.

### Modified Capabilities

- `payload-schema-variants`: the split/merge contract gains a context argument and the rule that a codec
  declares its own lookup sources; `roleName` and `personPermid` join `wgs84Point` and
  `collectionReferences`; `person` joins collection and specimen as a converted entity, and is the first whose
  annotations must say that a stored-elsewhere field can be writable without being server-assigned.
- `payload-schema-enums`: the open-vocabulary assignment table gains the three person rows, and its closing
  "every other enum on these two sources" sentence widens to three sources. The renamed `genders` and
  `roles` columns join the seed-fidelity requirement — `genders` with a snapshot, because it replaces a real
  inline enum, and `roles` without one, because it was never written into a schema.
- `payload-audit`: the registry describes whether an entity is versioned; the report drops the head /
  superseded split for one that is not. The requirement's "Unknown entity" scenario currently asserts that
  `--entity person` is an error, which is exactly what stops being true.
- `person-migration`: country resolution moves from `@countrystatecity/countries` to `dictionaries.admin0`;
  `heir_no` leaves the source query; the built jsonb is validated against the `db` variant before it is
  written.
- `pbot-person-migration`: the ORCID, email and `legacyIDs.pbotID` backfills stop being `jsonb_set`
  statements — all three requirements name `jsonb_set` and echo the SQL in their scenarios — and become a
  validated read-modify-write of the whole `person` object.

## Impact

**Payload schemas** — `payloadSchemas/person.schema.js` rewritten. `payloadSchemas/lib/storage.js` and
`lib/codecs.js` gain the context argument and the two codecs. `payloadSchemas/tests/` gains person source,
variant and codec coverage, and a `genders` entry in `tests/fixtures/legacy-enums.json`.

**Migration scripts** — `src/persons-migration/migrate-persons.js` and
`src/pbot-persons-migration/migrate-pbot-persons.js`. The country resolver (`normalizeName`,
`COUNTRY_ALIASES`, the `dictionaries.admin0` loader), currently exported from
`src/collections-migration/migrate-collections.js`, moves to `src/lib/` and both migrations import it from
there. `migrate-collections.js` changes only its imports; its behaviour is unchanged, which the collections
row count re-verifies.

**Audit** — `src/audit-payloads.js`: `REGISTRY`, the row query, the report, and the round trip, which must
now build a codec context.

**Database** — `postgresql/create_new.sql`: two column renames in `dictionaries`, no table added, no change
to `persons`. Both renamed columns are read by name (`SELECT id, role FROM dictionaries.roles` in
`migrate-persons.js`) rather than by FK, so nothing else moves.

**Source data** — no new MariaDB columns are read; one (`heir_no`) stops being read. No anomaly from
`anomaly-report.md` applies: the source table is `person` (1.3K rows), which carries none of the coordinate,
timestamp or nested-set anomalies.

**Data integrity** — the risk is the country switch. `@countrystatecity/countries` and `dictionaries.admin0`
spell countries differently (`'The Netherlands'`, `'Czechia'`, `'South Korea'`, `'Russia'`), so a naive swap
could silently drop `countryCode` from rows that resolve today. Every currently stored `countryCode` is
already present in `admin0.iso` (verified), which makes the stored values a usable baseline: the new
resolution is diffed against them per `person_no`, and must map everything that maps today. Separately,
adding `x-enumFrom` to `countryCode` turns any unmapped code into a validation failure at migration time
rather than a silent NULL.

**Verification** — re-run both person steps and the audit: 1,304 classic persons plus the PBot inserts, the
same `countryCode` per `person_no` as before, zero audit violations for person, collection and specimen, and
a clean `--round-trip`.

**Dependencies** — `@countrystatecity/countries` removed. Nothing added.
