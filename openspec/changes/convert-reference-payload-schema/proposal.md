## Why

`payloadSchemas/reference.schema.js` is the last legacy-shaped schema a converted entity cites. It still wraps
the object in a `{ reference }` envelope, carries fastify `response` blocks, a stale example (`author1init`,
`publicationTitle`), and a 60-line hand-written `description` documenting per-type fields that has already
drifted from the rules beside it. No migration validates against it, and 15,643 of 93,944 stored refs (16.7%)
fail it.

Most of those failures are not bad data. They are the schema demanding at rest what it should demand only on
create: legacy refs lack a publisher, a volume, a title, because the records they came from did. What is left
once that is separated out is small and nameable: 2,351 rows carry a field their type does not allow, and 15
PBot rows (e.g. `publisher: "PBot"`, `"self"`, `"Ellen"` on unpublished workbench entries) carry values that
are placeholders, not bibliography.

It goes now because `expose-reference-permids` settled the id↔permid contract a converted `refs` sits on,
and because the conversion forces a question the three converted entities never raised: `publicationType`
is stored twice, in the jsonb and in `refs.reference_type_id`, and the schema's conditional rules branch on
it.

## What Changes

- **`reference.schema.js` becomes `referenceSource`**, an annotated source with no envelope, no
  `allowDuplicate`, no `response` blocks, no example, no ghosted code, and no hand-written per-type
  description. Every variant is derived. `permid` is `x-storage: { column: "permid" }` and `readOnly`;
  `legacyIDs` is `readOnly`.
- **One table in the schema file defines the publication types.** `publicationType`'s inline `enum`, each
  type's allowed fields, and each type's required fields are all generated from it. Adding a type is one
  entry.
- **Every field is declared at the top level; only the per-type rules are conditional.** The `db` variant
  accepts any declared field on any type, so legacy history validates as stored. The `in-create` variant, via
  `x-create`, enforces per type both the required fields and the allowed fields (`propertyNames`), so a
  client sending `publisher` on a journal article is rejected by name rather than silently stripped. The
  `bookType`-inside-`if` bug disappears with the structure it lived in.
- **Two allowed-field lists widen.** `serial monograph` allows `editors`, since edited volumes inside a
  series are real. `other`, the catch-all, allows every declared field and requires nothing beyond the
  shared rules. All other lists and every required list carry over as they are.
- **`title` moves from base `required` to `x-create`.** 542 refs have none even after the fix below.
- **`migrate-refs.js` stops discarding book titles.** Legacy PBDB keeps a whole book's title in `pubtitle`
  with `reftitle` empty, and the migration maps `pubtitle` to nothing for `standalone book` and `edited
  collection`. It now writes `pubtitle` to `title` in that case, restoring 1,468 titles (2,010 refs lack a
  title today).
- **BREAKING (DDL): `refs.reference_type_id` and `dictionaries.reference_types` are dropped.** Nothing reads
  the column; the types are a closed set the schema's branching depends on, which `payload-schema-enums`
  already says stays inline.
- **`bookType` becomes `x-enumFrom: book_types.name`**, with `dictionaries.book_types.book_type` renamed to
  `name`. It drives no logic, so it is an open vocabulary.
- **New `dictionaries.languages`** (`name`, correctly spelled), and `language` becomes `x-enumFrom` on it.
  The 363 refs stored as `"Portugese"` are written as `"Portuguese"` by the migration.
- **`migrate-refs.js`** stops writing `reference_type_id`, maps `Portugese` → `Portuguese`, and validates
  each jsonb against the `db` variant, as the collection, specimen and person migrations do.
- **`migrate-pbot-refs.js`** stops writing `reference_type_id`, applies its two type aliases
  (`contributed article in edited book` → `article in edited collection`, `edited book of contributed
  articles` → `edited collection`) to the jsonb `publicationType` instead, writes only fields the ref's type
  allows — logging each field dropped, with its `pbotID` — and validates against the `db` variant. This
  corrects the 15 PBot rows, including the 7 placeholder publishers on `unpublished` refs.
- **The audit covers `reference`**: a `REGISTRY` entry with `versioned: true`, round trip included.
- **Not exposed:** `authorizer_person_id` and `enterer_person_id`. They are provenance, as on collections,
  which keep both columns and expose neither.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `payload-schema-variants`: `reference.schema.js` joins the converted sources, unenveloped, with no
  hand-maintained variants.
- `payload-schema-enums`: `publicationType` is named as an inline closed set; `bookType` and `language` join
  the `x-enumFrom` assignment; `book_types.book_type` is renamed to `name`; `languages` is a new table whose
  seed deliberately diverges from the legacy array by one spelling, and so does not join the snapshot.
- `payload-audit`: `reference` is an audited entity, versioned, with a round trip.
- `refs-migration`: publication type mapping writes only the jsonb value; title mapping falls back to
  `pubtitle` for standalone books and edited collections with no `reftitle`, and publication title routing
  says so; language mapping corrects `Portugese`; the jsonb is validated against the `db` variant.
- `pbot-refs-migration`: the `reference_type_id` requirement becomes an alias mapping on the jsonb value;
  the jsonb builder writes only fields the type allows; the jsonb is validated against the `db` variant.
- `migration-runner`: `reference_types` leaves the required dictionary tables and `languages` joins them; the
  refs steps audit `reference`.
- `entity-versioning-triggers`: a scenario naming `reference_type_id` as its example FK column is updated.

## Impact

**Payload schemas**: `payloadSchemas/reference.schema.js` (rewritten); `payloadSchemas/tests/` (source,
variant and per-type rule coverage; seed fidelity for `book_types`); `payloadSchemas/tests/fixtures/
legacy-enums.json` gains `book_types`.

**Migrations**: `src/refs-migration/migrate-refs.js`, `src/pbot-refs-migration/migrate-pbot-refs.js`.

**Audit and runner**: `src/audit-payloads.js` (`REGISTRY`), `src/run-migrations.js` (dictionary list; audited
entities follow from `REGISTRY` with no code change).

**Database**: `postgresql/create_new.sql`, which drops `refs.reference_type_id` and
`dictionaries.reference_types`, renames `book_types.book_type`, and creates and seeds `dictionaries.languages`.
Rebuild from scratch; no ALTER against an existing database.

**Stored data**: every ref is rewritten by the re-run: 1,468 titles restored, 363 language values corrected, 17 aliased PBot
types normalized, and fields dropped from 15 PBot refs. PBDB-origin refs otherwise keep their jsonb, extras
included.

**Risk**: the drop list in `migrate-pbot-refs.js` discards user-entered PBot values. Every drop is logged
with its `pbotID`, and the count is known in advance (15 rows, 18 fields); a run that drops more is a
regression.
