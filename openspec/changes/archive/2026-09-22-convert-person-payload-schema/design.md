## Context

`payloadSchemas/person.schema.js` is one of the seven schemas still in the pre-`payload-schema-variants`
form, and the next of them to convert; `proposal.md` gives the reasons it goes before the other six.
Converting it is mechanical in its first half — drop the `{ person }` envelope, mark `legacyIDs` read-only, point `gender` at the dictionary
table its own `//TODO` already names — and the stored jsonb needs nothing: every key the two migrations
write (`givenName`, `familyName`, `gender`, `legacyIDs`, `middle`, `email`, `countryCode`, `institution`,
`orcid`) is already a declared property, so a `db` variant compiled today validates all 1,304 rows.

The second half is not mechanical, because `persons` differs from `collections` and `specimens` in two ways
that the existing machinery has never met.

**Its columns are part of the entity.** Collection and specimen used `x-storage` for plumbing (`permid`) and
two awkward shapes (a geography column, a child ref table). `persons` has columns a reader of a person
expects to see:

```
persons
├── id                    internal; never leaves the API
├── permid                readOnly + x-storage           ← added by add-persons-permid
├── password              absent from the payload entirely
├── role_id      → dictionaries.roles                    ← "role", as a NAME
├── person  jsonb         everything the source describes today
├── authorizer_person_id → persons(id)                   ← "authorizer", as a PERMID
├── active       boolean
├── total_hours  numeric
└── created_at   timestamptz                             ← stays out of the payload
```

Two of those are not one-to-one with their column. This project exposes permids and not internal ids, and a
`role_id` of `3` means nothing to a client without a roles route, so `role` is a name and `authorizer` is a
person's permid. Both need a lookup, and `lib/codecs.js` currently defines a codec as a pure synchronous
function of the payload: `split(values, storage)`.

**It is unversioned.** `src/audit-payloads.js` reads every audited entity through one query
(`src/audit-payloads.js:114`) that selects `succeeded_by_id IS NULL AS head`. `persons` has no such column,
so adding a registry entry as it stands makes the audit raise *column does not exist* rather than audit
anything.

## Goals / Non-Goals

**Goals:**

- One annotated source for person, with every variant derived, matching what collection and specimen do.
- Both person migrations validating what they write, including the PBot backfills, which mutate a stored
  payload in place from SQL and so would escape a validator placed only at the insert site.
- A codec context mechanism general enough to serve the three lookups now foreseen — `dictionaries.roles`,
  `persons.id → permid`, and later `refs.id → permid` — without assuming the mapped table fits in memory.
- Person auditable: a registry entry, a clean full audit, and a clean `--round-trip`.

**Non-Goals:**

- Converting `collectionReferences` to expose a ref's permid instead of `refs.id`. That is a separate change;
  this one builds the rails it will run on (D3).
- Converting the other five schemas still in the old form: `reference.schema.js`, `schema.schema.js`,
  `character.schema.js`, `state.schema.js` and `authority.schema.js`, together with
  `opinionAttribution.schema.js`, which `payload-schema-variants` judged to need no conversion. Each is its
  own change. `schema.schema.js` additionally needs `$defs`/`$ref` support in `deriveVariant`, which it does
  not have, so it cannot be next whatever else is decided.
- Deciding which variant validates a merged PATCH document. That policy is open project-wide
  (`payloadSchemas/DESIGN_NOTES.md`) and person inherits whatever it becomes.
- Any change to `persons`, to credentials, or to the ~30 `authorizer_person_id`/`enterer_person_id` columns,
  which keep referencing `persons(id)` as `integer`.
- The deferred plv8 CHECK constraint.

## Decisions

### D1 — The codec context is an explicit argument, with a pure core

`split(source, payload, ctx)` and `merge(source, parts, ctx)` take a third argument; a codec receives it as
`split(values, storage, ctx)`. It is built by two functions that mirror the ones the enum resolver already
has:

```
  enums (exists)                          codecs (this change)
  ─────────────────                       ────────────────────
  collectEnumSources(schema)              collectCodecSources(source)
  loadEnums(pg, sources)    → Map         loadCodecContext(pg, sources) → Map
  applyEnums(schema, map)                 split / merge (source, …, ctx)
       ▲ pure; a fixture map                   ▲ pure; a fixture map
         replaces pg                             replaces pg
```

`wgs84Point` and `collectionReferences` ignore the third argument and keep working unchanged.

*Alternative considered: a module-level cache inside `codecs.js`, populated once.* Rejected. It makes the
codecs stateful, makes test isolation a matter of remembering to clear it, and hides an I/O dependency
behind a function that reads as pure.

*Alternative considered: an async resolver called per value.* Rejected. It makes `split` and `merge` async
and destroys the property that the enum tooling was deliberately given — a pure core testable from fixtures
with no database. `payload-schema-enums` states that property as a requirement; the codec half should not
be the exception.

### D2 — A codec declares its own lookup sources; the annotation does not

```js
const roleName = {
  sources: [{ table: 'dictionaries.roles', key: 'id', value: 'name' }],
  split({ role }, storage, ctx)   { … },   // name  → role_id
  merge({ columns }, storage, ctx) { … },  // role_id → name
};
const personPermid = {
  sources: [{ table: 'persons', key: 'id', value: 'permid' }],
  …
};
```

`collectCodecSources` walks the source's `x-storage` codecs and unions what they declare. `x-storage` keeps
exactly the shape `payload-schema-variants` specifies — `{ column }`, `{ column, codec }`, `{ table, codec }`
— so the annotation vocabulary does not change.

*Alternative considered: the codec reads the sibling `x-enumFrom`.* `role` carries both, and they would
name the same table, so the stored id and the accepted value could not drift apart. Rejected because it does
not generalise: `authorizer`'s lookup is `persons.id → persons.permid`, not a dictionary, and there is no
`x-enumFrom` to read. One mechanism that serves both is worth more than the coupling.

*Alternative considered: new keys on `x-storage`, e.g. `{ column, codec, dictionary: { table, column } }`.*
Rejected: it widens the annotation vocabulary for something the codec already knows about itself, and
`payload-schema-variants` fixes that vocabulary to three forms.

The drift that the rejected alternative would have prevented is closed directly instead: when a property
carries both `x-enumFrom` and a codec declaring a `dictionaries.*` source, they must name the same table,
and source validation throws when they do not.

### D3 — Lookups resolve per batch, not from one eager map

`loadCodecContext` accepts, per source, the values a caller is about to resolve, and issues one
`WHERE <column> = ANY($1)` for them. The audit already keyset-paginates in bounded batches of 5,000
(`BATCH_SIZE`), so it collects a batch's ids, loads that slice, and merges the batch — the same shape as the
child-row pre-load it already performs, which gathers a batch's parent ids and issues one
`WHERE <fk> = ANY($1)`.

The selection is given in either direction. `merge` starts from the stored column and needs `id → value`;
`split` starts from the payload and needs `value → id`, which for the future API create path means selecting
`WHERE permid = ANY($1)`, not `WHERE id = ANY($1)`. A caller therefore says which column it is restricting
on, and one read populates both `byKey` and `byValue`. The audit never needs a second query for the return
direction, because `split` only maps back the values `merge` has just produced from ids already loaded.

Batching is for entity tables, not for dictionaries. A source in the `dictionaries` schema is a curated
vocabulary — `dictionaries.roles` holds six rows — and is read once per run, in full; restricting it per
batch would issue 56 pointless six-row queries over a collections audit. Every other source is read per
selection. The rule follows the schema the table lives in, because that is the property that makes it small.

The sizes in play today do not require this: `dictionaries.roles` holds 6 rows and `persons` about 1,500,
and an eager map of either is trivial. The batching is for the lookup this mechanism exists to make possible
next — `refs.id → permid`, across 93,863 refs cited by 275,554 collections and 167,150 specimens — and for
not having to redesign when it arrives.

*Alternative considered: load each source table once, in full.* Simpler, and adequate at today's sizes.
Rejected because the first caller that is not adequate is already named and is the reason the mechanism
exists; a contract that is per-batch from the start costs one extra argument now instead of a rewrite later.

*Alternative considered: resolve in SQL, in the audit's row query.* The registry's `columns` list already
does exactly this kind of thing (`ST_AsGeoJSON(location)::json AS location`), so `merge` could be handed a
permid directly and need no context at all. Rejected because it only solves the read path: `split` must turn
a permid back into the head id, which no SELECT on the row being split can pre-compute.

A note on correctness that this decision rests on: an id and a permid name the same thing here. FKs into a
versioned table do not go stale, because `swing_fks_to_new_version()` UPDATEs every FK referencing the old
row id to the new one on each new version (skipping only `preceded_by_id`/`succeeded_by_id`). So
`collections.reference_id` and `persons.authorizer_person_id` always denote the lineage head, `id → permid`
is unambiguous, and `permid → head id` returns exactly the id that is stored. The round trip is exact.

### D4 — `readOnly` means server-assigned, not privilege-gated

| payload field | column | readOnly | on create |
|---|---|---|---|
| `permid` | `permid` | **yes** | server mints |
| `legacyIDs` | — (jsonb) | **yes** | rejected |
| `totalHours` | `total_hours` | **yes** | server-managed, accumulated |
| `role` | `role_id` | no | optional; defaults to `'Person'` |
| `authorizer` | `authorizer_person_id` | no | optional; derived from the authenticated caller |
| `active` | `active` | no | optional; defaults to `true` |
| `email` | — (jsonb) | no | **required** by `x-create` |

`role`, `active` and `authorizer` are fields only a privileged caller should set, but privilege is a route
concern that JSON Schema cannot express. Marking them `readOnly` to approximate it would be wrong twice: it
would reject them from `in-create` and block them in `patch-guard`, making them unsettable by anyone. So
`patch-guard` blocks exactly `permid`, `legacyIDs` and `totalHours`, and the route enforces who may write
the rest.

`authorizer_person_id` and `role_id` are both `NOT NULL`, so every create must yield a value for each. Since
neither is required by `in-create`, the route supplies both — the authenticated caller's authorizer, and
`'Person'` — which is what `migrate-pbot-persons.js` already does for its inserts.

`created_at` gets no payload field at all, matching collection and specimen.

*Alternative considered: `x-create: { required: ["role", "authorizer"] }`.* Rejected: it forces every client
to name an authorizer the server already knows, and to spell out the role that is the default for all but a
handful of people.

### D5 — Three new `x-enumFrom` markers, and two dictionary columns renamed

`gender` → `dictionaries.genders.name`, `role` → `dictionaries.roles.name`, `countryCode` →
`dictionaries.admin0.iso`. All three are vocabularies curators may extend without a code change, which is
`payload-schema-enums`' test for a table-backed enum.

`genders.genders` and `roles.role` are renamed to `name`, the convention every table that change added
follows. They predate it. The renames are cheap — `roles.role` has one reader
(`SELECT id, role FROM dictionaries.roles` in `migrate-persons.js`) and `genders.genders` has none — and
doing them now avoids `x-enumFrom: { table: "genders", column: "genders" }` becoming the thing the next
reader copies.

`genders` is seeded `('Male'),('Female'),('Other'),('Anonymous')`, byte-identical and in the same order as
the inline enum it replaces, so the resolved enum is unchanged and the conversion cannot alter validation
outcomes. It therefore joins the seed-fidelity snapshot. `roles` does not: it was never written into a
schema, so there is no legacy array to reproduce.

### D6 — Country resolution reuses the collections pipeline

`migrate-collections.js` already exports `normalizeName` and `COUNTRY_ALIASES` and loads
`dictionaries.admin0` indexed by normalized name, `iso` and `iso3`. That code moves to `src/lib/` and both
migrations import it, which `migration-script-layout` requires of any helper two migrations under `src/`
share, rather than being copied.

This matters beyond tidiness, because the two vocabularies disagree: `admin0` spells them
`'The Netherlands'`, `'Czechia'`, `'South Korea'`, `'Russia'`, where `@countrystatecity/countries` spells
them otherwise. `COUNTRY_ALIASES` already absorbs `netherlands → NL` and `russian federation → RU`.
`migrate-persons.js`'s own `COUNTRY_NORMALIZE` disappears into it, and the two variants it carries that
`COUNTRY_ALIASES` does not — `'untied states'` and `'england'` — move across as aliases.

The switch is verified against the data rather than by inspection: every currently stored `countryCode` is
present in `admin0.iso`, so the stored values are a valid baseline, and the new resolution is diffed against
them per `person_no`. Anything that maps today must still map; new matches are an improvement.

### D7 — The PBot backfills become one validated write

`migrate-pbot-persons.js` currently backfills a matched person with three separate statements —
`jsonb_set` for `orcid`, `jsonb_set` for `email`, and `person || jsonb_build_object(...)` for
`legacyIDs.pbotID` — each writing a shape no validator sees. They become a read of the `person` object, the
backfills applied in JS, one `validate()`, and one write of the whole object. Fewer round trips, and the
same guarantee the insert branch has.

This is a spec-level change, not an implementation detail: all three requirements in `pbot-person-migration`
name `jsonb_set` and echo the SQL in their scenarios.

### D8 — The audit registry states whether an entity is versioned

A registry entry declares `versioned: false`. The shared row query then omits `succeeded_by_id IS NULL AS
head`, and the report gives one row count instead of heads and superseded separately. `permid` is still
selected and still identifies an offending row — `persons.permid` is `NOT NULL UNIQUE`, so it identifies one
more precisely than on a versioned table.

Round-trip mode builds a codec context per batch and passes it to `merge` and `split`.

*Alternative considered: a separate code path for unversioned entities.* Rejected: the difference is one
expression in a SELECT and one line of the report.

### D9 — The migrations still do not use `split()`

`migrate-persons.js` and `migrate-pbot-persons.js` continue to build the jsonb and the column values
separately, as `migrate-collections.js` and `migrate-specimens.js` do, and validate the jsonb against the
`db` variant. They do not route their writes through `split()`.

So the two new codecs are exercised by the audit's round trip and by the future API, not by the migrations.
This is worth stating because it sizes the change correctly: the person migrations would validate exactly as
well with no codec at all. The codecs are needed because `role` and `authorizer` carry `x-storage`, and a
round trip that cannot rebuild them would report every person row as a difference.

## Risks / Trade-offs

**Country resolution regresses and silently drops a `countryCode`** → The diff against stored values per
`person_no` is the gate, not a spot check; and with `x-enumFrom` on `countryCode`, a code that resolves to
something outside `admin0.iso` becomes a validation failure at migration time rather than a quiet NULL.

**`x-enumFrom` on `countryCode` makes an unmapped country fatal** → Intended. The alternative is the current
behaviour, where an unmapped country produces a warning in a log nobody reads and a person with no country.
A hard failure at migration time is the point of resolving enums before the first source row is read.

**The audit's row query is shared, so changing it touches collection and specimen** → The change is
conditional on a registry flag both of them set the old way; their queries are byte-identical before and
after, and re-running the audit on all three entities with zero violations is the check.

**The codec context is designed for a caller that does not exist yet (D3)** → Accepted. The per-batch
contract costs one argument and one loop in the audit today. The named next caller is `refs.id → permid`
across 93,863 refs, and the alternative is discovering the contract is wrong with two codecs already written
against it.

**Renaming a dictionary column breaks an unknown reader** → Both are read by name and both readers are in
this repository (`roles.role` in `migrate-persons.js`; `genders.genders` nowhere). No FK references either
column; the FKs are to `id`. A full migration run after the rename is the check.

**`role` as a name couples the payload to a dictionary's contents** → A role renamed in `dictionaries.roles`
invalidates the stored `role_id` mapping for no one, because the name is not stored — but it does change
what the API returns for existing people, and it changes the resolved enum. This is the same append-only
discipline `DESIGN_NOTES.md` already states for dictionary values, now applying to a codec rather than to
stored jsonb.

## Migration Plan

`persons` is rebuilt from an empty database by `src/run-migrations.js`, whose first step already asserts
`empty('persons')`, so there is no deployment sequencing and no backfill. The change lands as a schema edit
(two renames), the payload-schema edits, the two migration edits, the shared-helper move, and the audit
edit. Rollback is reverting the commit and rebuilding.

Verification: a full runner pass; 1,304 classic persons plus the PBot inserts; the same `countryCode` per
`person_no` as the pre-change baseline; unchanged collection (275,554) and specimen (167,150) row counts
after the shared-helper move; and `node src/audit-payloads.js --round-trip` clean across person, collection
and specimen.

## Open Questions

None. The codec context (D1–D3), the read-only boundary and create-time defaults (D4), the enum assignments
and renames (D5), country resolution (D6), the backfill rewrite (D7) and the audit's unversioned support
(D8) were all settled before this change was written.

One policy remains open project-wide and is explicitly not this change's to settle: which variant validates
a merged PATCH document (`payloadSchemas/DESIGN_NOTES.md`). Person inherits whatever it becomes.
