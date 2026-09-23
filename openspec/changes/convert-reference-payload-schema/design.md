## Context

`reference.schema.js` is legacy-shaped: `{ reference }` envelope, fastify `response` blocks, and six
`if`/`then` blocks under `allOf`, one per publication type, each adding that type's fields and required list.
No migration validates against it. Measured against the 93,944 stored refs on localhost (2026-09-22):

```
invalid 15,643 / 93,944 against today's schema
├── required-field gaps     publisher, editors, journalVolume, title (2,010), pages, …
└── fields a type forbids   2,782 rows (3.0%) against today's lists — measured directly, per type:
      journal article 2,161 · other 322 · standalone book 180 · serial monograph 109 · unpublished 8 · …
                            2,351 rows (2.5%) against the lists D2 adopts
```

Validating directly overcounts the second category: when a row fails a type's `then`, ajv stops treating that
type's fields as evaluated, so they are all reported by `unevaluatedProperties` too. The 2,782 figure comes
from checking each row's keys against its type's allowed list.

`publicationType` is stored twice, in the jsonb and in `refs.reference_type_id` → `dictionaries.reference_types`.
Both refs migrations write both; nothing reads the column. The 16 + 1 PBot rows typed `contributed article in
edited book` / `edited book of contributed articles` disagree between the two, reconciled only by aliases in
`migrate-pbot-refs.js` that map the column id and leave the jsonb string as PBot had it.

The conversions so far (collection, specimen, person) set the patterns reused here: an annotated source with
derived variants (`payload-schema-variants`), `x-enumFrom` for open vocabularies and inline enums for closed
sets (`payload-schema-enums`), and D9 of `convert-person-payload-schema`: migrations build the jsonb and
columns directly and validate against `db`, rather than routing through `split()`.

## Goals / Non-Goals

**Goals:**

- `referenceSource`, unenveloped, with every variant derived, and every stored ref valid against `db`.
- Publication types defined once, beside the logic that branches on them.
- A client creating a ref is told, by field name, when it sends a field its type does not allow.
- `language` and `bookType` backed by dictionaries; `"Portugese"` corrected.
- The 15 PBot rows with disallowed or placeholder fields corrected at migration.
- The 1,468 book titles the refs migration currently discards restored.

**Non-Goals:**

- Exposing `authorizer_person_id` / `enterer_person_id`. They are provenance; collections keep both
  columns and expose neither. `personPermid` is therefore not generalized here.
- Deciding which variant validates a merged PATCH document (DESIGN_NOTES "Open API policy"). No route is
  built. Refs is, however, the entity that forces the choice; see Risks.
- Reclassifying PBDB refs whose extras suggest a wrong type (e.g. journal articles carrying `editors`).
  They are valid at rest and stay as stored.
- Changing `collectionReferences` or anything else that reads `refs.permid`.

## Decisions

### D1 — `publicationType` stays in the jsonb; the column and its dictionary are dropped

The schema's per-type rules branch on `publicationType`, so it must be in the object they validate.
Moving it to a column behind a codec, the way `role` works on person, breaks the `db` variant:

```
db variant strips the root property (x-storage)      → stored jsonb has no publicationType
if: { properties: { publicationType: { const } } }   → vacuously true for an absent key
⇒ all six conditionals match every row                → every type's required fields on every row
                                                       → every type's fields allowed on every row
```

With the jsonb authoritative, `reference_type_id` is a denormalized copy nothing reads, whose only effect is a
second place for the value to disagree. It is dropped, and `dictionaries.reference_types` with it.

That also conforms to a rule the repo already has. `payload-schema-enums` puts a vocabulary in a table when
curators may extend it without a code change, and keeps "a closed set that code depends on" inline.
Publication types are the clearest case: inserting a row into `reference_types` would do nothing without a
matching rule in the schema, so the table invites an edit that silently has no effect.

*Alternative considered: keep the column, audit agreement.* Rejected: it adds a check to maintain for a
column with no reader.

*Alternative considered: codec-backed column, jsonb stripped.* Rejected: it breaks the conditionals as above,
and requires rewriting every stored ref to remove the key.

### D2 — One type table generates the enum, the allowed fields and the required fields

```js
const PUBLICATION_TYPES = {
  'journal article': { fields: ['journalTitle', 'journalVolume', 'journalNumber'],
                       required: ['journalTitle', 'journalVolume'] },
  …
};
```

From it, `publicationType.enum` is `Object.keys(PUBLICATION_TYPES)`, the top-level `properties` include the
union of every type's fields, and `x-create` holds one conditional per type. The required lists are carried over
from today's `then` blocks unchanged. The allowed lists are too, with three changes:

- `bookType` moves from the `if` it was misplaced in to `standalone book`'s allowed fields.
- **`serial monograph` allows `editors`.** 109 legacy refs are edited volumes inside a series (e.g. NMMNH
  Bulletins, "S. G. Lucas and M. Morales"), a real kind of publication the type list could not otherwise
  express. `editors` is optional; the required list is unchanged.
- **`other` allows every declared field.** It is the catch-all, and legacy `abstract` and `news article` refs
  mapped into it routinely carry a publisher, city and editors (234 / 242 / 216 rows). A catch-all that
  forbids fields forces a client either to mistype a ref or to discard what it knows. `other` gets no
  `propertyNames` rule and no required fields; its table entry says so explicitly rather than listing every
  field, so a field added to another type is allowed on `other` without a second edit.

Against these lists, 2,351 stored refs carry a field their type does not allow, down from 2,782.

The source is a JS module, so generating schema from data is ordinary. The 60-line `description` string is
deleted: it documented the same lists by hand and has already drifted (`publicationTitle`,
`contributed article in edited book`).

### D3 — Declare every field at the top level; per-type rules live in `x-create` only

| variant | all fields declared | type → required | type → allowed |
|---|---|---|---|
| `db` | yes | — | — |
| `in-create` | yes | yes | yes, via `propertyNames` |
| `out` | yes | — | — |

Each `x-create` conditional is
`if: { properties: { publicationType: { const: T } }, required: ["publicationType"] }` with
`then: { required: [...], propertyNames: { enum: [...shared, ...T.fields] } }`. The `required` in the `if`
matters: without it an absent `publicationType` satisfies every `if`, the failure D1 describes.

This is how the answer to "how is a client told" is carried: by a validation error naming the field, from
a rule that is also machine-readable. A client building a form can read the published `in-create` variant for
the fields each type takes, which is what the deleted description tried to be.

It also removes the problem the legacy TODO describes, where `unevaluatedProperties` cannot see properties
declared inside conditionals. Nothing is declared inside a conditional any more.

*Alternative considered: keep per-type properties inside `then`.* Rejected: `db` would then have to reject the
2,351 legacy rows, or carry a widened copy of every list.

### D4 — `title` is required on create only

2,010 stored refs have no `title`; after D9, 542 still will. It moves from base `required` into `x-create`
with the per-type rules. Base `required` keeps `publicationType` and `publicationYear`, which every stored
ref has.

### D5 — `bookType` and `language` are open vocabularies

`bookType` drives no logic, so it becomes `x-enumFrom: { table: "book_types", column: "name" }`. The column
`book_type` is renamed to `name`, the convention since `convert-person-payload-schema` D5.

PBot's book types are not PBDB's: 5 PBot standalone books carry `thesis` (3, with no level to choose between
`Ph.D. thesis` and `M.S. thesis`) or `other` (2), found when the new `db` variant was run over the stored refs.
`book_types` gains `other`, appended after the legacy values, and `migrate-pbot-refs.js` stores any PBot
`bookType` not in `book_types` as `other`, logging the original. The seed therefore extends the legacy enum,
and like `languages` it does not join the snapshot.

`language` becomes `x-enumFrom: { table: "languages", column: "name" }` on a new
`dictionaries.languages` (`id` identity, `name text NOT NULL UNIQUE`), seeded in the legacy order with one
change: `Portuguese` for `Portugese`. It does **not** join the snapshot. The spec records why, as it does for
`roles`, so the divergence is not "fixed" back. `unknown` (6,168 refs) and `other` (647) stay as rows: they
are values clients send, and treating absence as `unknown` would rewrite 6,168 rows for no gain.

`migrate-refs.js` maps `Portugese` → `Portuguese`. `migrate-pbot-refs.js` already writes `unknown`.

### D6 — The PBot migration writes only what the type allows, and logs what it drops

`migrate-pbot-refs.js` builds jsonb for 239 refs, of which 15 carry a field their type forbids (18 fields;
the 2 PBot `other` refs with a `publisher` keep it under D2). The values
are placeholders or noise: `publisher: "PBot"` / `"self"` / `"TBD"` / `"Ellen"` on `unpublished` workbench
entries, stray `bookType` on journal articles. The builder now:

1. applies its two aliases to the jsonb `publicationType`, so both 16 + 1 rows hold an enum value;
2. keeps only the shared fields and the type's allowed fields, from the same `PUBLICATION_TYPES` table, and
   logs each field dropped with its `pbotID`;
3. validates against `db`.

PBot refs get the create-time rule and PBDB refs do not, because PBot is a small, recent source curated
through a UI that never enforced types, so its extras are entry noise. PBDB's 2,336 are four decades of
bibliographic history, and many are true facts (the publisher of a journal) or evidence of a misclassified
type that a curator should resolve, not a migration.

### D7 — Both refs migrations validate against `db`

As collection, specimen and person already do. With D3 and D4, every PBDB-built jsonb is expected to pass;
one that does not is a migration defect, reported as the other migrations report theirs.

### D8 — `reference` joins the audit

A `REGISTRY` entry: table `refs`, column `reference`, `versioned: true`, round-trip columns `permid`, no
children. The runner derives audited entities from `REGISTRY` and each step's `writes`, so both refs steps
audit `reference` with no runner code change. `migration-runner`'s spec text naming today's pairs is updated.

### D9 — A book's `pubtitle` becomes its `title` when `reftitle` is empty

Legacy PBDB records a whole book with `reftitle` empty and the book's title in `pubtitle`. The
`refs-migration` routing table maps `pubtitle` to nothing for `standalone book` and `edited collection`
("title is `reftitle`"), so for those refs the title is discarded, not moved:

```
stored ref has no title, legacy pubtitle present
  standalone book     848  ┐ pubtitle dropped         ← restored here
  edited collection   620  ┘                            (1,468)
  journal article     344    → journalTitle (kept)
  serial monograph     85    → seriesTitle  (kept)
  article in ed. coll. 33    → bookTitle    (kept)
  other / unpublished  55    unmapped       (not a title: e.g. "GSA Abstracts with Programs")
```

For `standalone book` and `edited collection`, when `reftitle` is NULL or blank and `pubtitle` is not,
`migrate-refs.js` writes `pubtitle` (trimmed) to `title` and logs the `reference_no`. When `reftitle` is
present, `pubtitle` stays unmapped as today.

Values are taken verbatim. Of the 1,468, the median length is 72 characters and nearly all are titles
("Systema Naturae", "The Complete T. rex"). 13 begin with `in ` ("in Dort and Jones", "in Geologic
excursions...") and point at a containing volume rather than naming the ref; they are mapped too. Guessing
which curator-entered values are "real" would put a judgement in the migration that belongs to a curator,
and every mapped row is in the log.

`other` and `unpublished` are left alone. Their `pubtitle` names a container (a meeting abstracts volume),
and neither type has a field for one.

*Alternative considered: a separate change.* Rejected: this change already rebuilds and re-validates every
ref, and moves `title` into `x-create` on the strength of how many refs lack one. Fixing the loss here means
that count is measured once, on the corrected data.

### D10 — A first page of 0 is written as 1

Four PBDB refs (11244, 52520, 62283, 88689) have `firstpage = 0`, found when the new `db` variant was run
over the stored refs. `pages.first` has `minimum: 1`, so the refs migration would abort on them. Pages are
numbered from 1 and a range starting at 0 almost certainly means the first page, so the migration writes 1
and logs the `reference_no`. The schema's minimum is left as it is, so a create body still cannot send page 0.

## Risks / Trade-offs

**Refs forces the PATCH policy** → Around 15,600 stored refs would fail `in-create`. If merged PATCH documents
are validated against `in-create`, a typo fix on any of them is rejected until the ref is completed. The
"ratchet" policy in `DESIGN_NOTES.md` handles this. Not decided here; the proposal of the first refs route
must.

**`propertyNames` rejects fields a client may legitimately want** → The lists are inherited apart from the
two widenings in D2, which the stored data showed were too narrow. A list still too narrow costs a client a
rejected create, not lost data, and widening it is a one-line change to `PUBLICATION_TYPES`.

**PBot drops are data loss by design** → Mitigated by logging every drop with its `pbotID`, and by the
count being known in advance (15 rows, 18 fields). A run dropping more is a regression.

**Dropping `reference_types` breaks anything that reads it** → Verified no reader outside the two
migrations and `run-migrations.js`'s dictionary list. `migration_exploration/` references the column and may
break, which is accepted (it is superseded).

**13 restored titles are container references, not titles** → Mapped verbatim and logged (D9). Visible to
curators as a title beginning `in `; the stored value is what the legacy row held.

**`languages` diverges from its legacy array** → Excluded from the snapshot with the reason in the spec, so
the seed-fidelity test does not assert the misspelling.

## Migration Plan

Edit `postgresql/create_new.sql`, rebuild the target from scratch, and re-run the pipeline. There is no ALTER
path; Aurora databases are rebuilt, not patched. The collections step is unaffected: it resolves
`reference_no → refs.id` and `collectionReferences` reads `refs.permid`, neither of which changes.

Verify: seed fidelity passes (`book_types` and `languages` excluded); both refs migrations report zero
`db` violations; `migrate-pbot-refs.js` logs exactly the expected drops; `--round-trip` is clean across
collection, specimen, person and reference; no stored ref has `language = 'Portugese'` or a
`publicationType` outside the enum; exactly 542 refs have no `title`, and none is a standalone book or edited
collection whose legacy `pubtitle` was non-blank with a blank `reftitle`.
