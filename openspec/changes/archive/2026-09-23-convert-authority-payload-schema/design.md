## Context

`authority.schema.js` is 49 lines in the pre-`payload-schema-variants` form: an `{ authority }` envelope around
five fields. `migrate-authorities.js:176` compiles it with a bare `new Ajv(...)` and validates
`{ authority: payload }`. Measured on localhost `pbdb` (2026-09-23):

```
authorities            163,067 rows, all heads (none superseded)
├── citation           163,067   none empty; 1,299 = "authority unknown" (scenario ④ sentinel)
├── descriptors        163,067   empty only on the 1,299 sentinel rows
├── year               160,870 four digits · 1,299 "0" (sentinel) · 898 absent
├── publishedInReference   43,351 true
└── legacyIDs.oldpbdbIDs   array; 83,182 hold one taxon_no, the rest were merged by dedup

columns: permid, authorizer_person_id, enterer_person_id, reference_id (NOT NULL → refs),
         preceded_by_id / succeeded_by_id, removed, created_at
```

The payload keys are read by name downstream: `migrate-authority-opinions.js:76-80` selects `legacyIDs`,
`citation`, `descriptors`, `publishedInReference` and `year` from the jsonb, and the commented GIN index at
`create_new.sql:5016` targets `authority->'legacyIDs'->'oldpbdbIDs'`.

Patterns reused from the four converted entities: an annotated source with derived variants; permids exposed
through codecs with a declared lookup source (`convert-person-payload-schema`); versioned sources read from
lineage heads only (`expose-reference-permids`); migrations build the jsonb directly and validate it against
`db` rather than going through `split()` (D9 of `convert-person-payload-schema`).

## Goals / Non-Goals

**Goals:**

- `authoritySource`, unenveloped, with every variant derived and every stored authority valid against `db`.
- An authority names its reference, by permid, in every variant but `db`.
- A new authority's `year`, when given, is four digits; migrated sentinel and absent years stay valid at rest.
- `authorities` is audited, round trip included.
- Stored jsonb is byte-for-byte unchanged, so nothing that reads it needs to change.

**Non-Goals:**

- **The duplication `publishedInReference: true` implies.** On 43,351 authorities, `citation`, `descriptors`
  and `year` were derived at migration time from the reference the authority was published in. They are a
  copy, and editing that reference's authors or year later leaves them stale. Deriving them on read, or
  checking agreement, is a modeling question for the authorities API, not for a schema conversion. It is
  recorded here so it is decided deliberately rather than discovered.
- Blocking the `"authority unknown"` sentinel on create. A client may enter it; it will not carry `year: "0"`,
  because of D3.
- Exposing `authorizer_person_id` / `enterer_person_id`. They are provenance; collections and refs keep both
  columns and expose neither.
- Renaming any jsonb key, including making `oldpbdbIDs` singular to match the other entities. It is plural
  because dedup merges several `taxon_no`s into one authority.
- Exposing `specimens.reference_id`. `referencePermid` is written so a later specimen change can reuse it
  (D2), but that change decides its own API.

## Decisions

### D1 — The source

```js
const authorityProperties = {
  permid:      { type: "string", readOnly: true, "x-storage": { column: "permid" } },
  legacyIDs:   { type: "object", readOnly: true,
                 properties: { oldpbdbIDs: { type: "array", items: { type: "string" } } } },
  reference:   { type: "string", "x-storage": { column: "reference_id", codec: "referencePermid" } },
  citation:    { type: "string" },
  descriptors: { type: "array", items: { type: "string" } },
  year:        { type: "string", maxLength: 4 },
  publishedInReference: { type: "boolean" },
};

authoritySource = { …, properties: authorityProperties,
  required: ["citation", "publishedInReference", "reference"],
  "x-create": { properties: { year: { type: "string", pattern: "^[0-9]{4}$" } } },
  unevaluatedProperties: false };
```

Field constraints carry over from the old schema unchanged. Nothing is added that the old schema did not
enforce, beyond `reference` and the create-time `year` pattern.

**`reference` goes in base `required`, not `x-create`.** `deriveVariant` removes `x-storage` properties from
`db` and prunes them from every `required` list, so a base requirement costs `db` nothing. Keeping it in the
base means `out` guarantees it too, which is true of every row, since the column is NOT NULL. Collection
requires `references` only in `x-create`, although `collections.reference_id` is also NOT NULL. This change
does not revisit that choice, and the authority source does not copy it.

**The name is `reference`, not `referenceID`.** It follows `authorizer` on person: a root-level field named
for what it points at, holding that entity's permid. `referenceID` on collection is the key inside a
`references[]` item, next to `order`, where the suffix tells the two apart.

### D2 — `referencePermid`, a scalar codec over the refs source

```
split:  { reference: <permid> }       → columns.reference_id = head refs.id for that permid
merge:  columns.reference_id = <id>   → { reference: <permid of that ref> }
source: REFS_SOURCE = { table: "refs", key: "id", value: "permid", versioned: true }   (shared)
```

It is the second codec that reads `refs`. Following "generalize on the second caller", it shares what is
actually common: the `REFS_SOURCE` constant and the `lookup` helper, which both already exist at module scope.
Array-versus-scalar and column-versus-child-rows are what differ, so `collectionReferences` is not changed and
no generic "permid codec" is built. Like `personPermid`, it reads and writes one named property, here
`reference`. Specimen will need exactly that name if it exposes its reference.

Ids are keyed as strings, as in `collectionReferences`: `refs.id` is a bigint, which node-postgres returns as
a string.

*Alternative considered: generalize `personPermid` into a `permid(table)` factory.* Rejected: it would need
`versioned` threaded through, it changes a codec with no new caller, and the sources differ in a way the
lookup already handles.

### D3 — `year`: loose at rest, four digits on create

| variant | `"1969"` | `"0"` (sentinel) | absent | `"abc"` |
|---|---|---|---|---|
| `db` | ✓ | ✓ | ✓ | ✓ (as today) |
| `in-create` | ✓ | ✗ | ✓ | ✗ |

The create-time rule lives in `x-create` as `properties: { year: { type: "string", pattern } }`.
`deriveVariant` already appends `x-create` to `allOf` in `in-create`, so no change to `variants.js` is needed.
The `type` is there because `createAjv` compiles in strict mode, which rejects `pattern` without a type in a
subschema that cannot see the root declaration (checked: `missing type "string" for keyword "pattern" at
"#/allOf/0/properties/year" (strictTypes)`).

*Alternative considered: `^([0-9]{4}|0)$` in `db`.* Rejected: it writes the migration's sentinel into the
schema as a permanent value. The sentinel is history, and `db` describing history loosely is what the other
conversions do (reference D4, collection scale and age gaps).

`db` still accepts `"abc"`, as the old schema did. No stored row has one, and tightening `db` is a separate
decision from this conversion.

### D4 — The migration validates the unwrapped payload against `db`

`migrate-authorities.js` compiles `deriveVariant(await resolveEnums(pg, authoritySource), 'db')` with
`createAjv()`, before reading MariaDB, and validates `payload`, not `{ authority: payload }`. `authoritySource`
declares no `x-enumFrom`, so `resolveEnums` is a no-op today; it is called anyway so the migration does not
silently skip resolution when a dictionary field is later added.

Construction, dedup, the validation point (as each survivor is finalized, before any write), the abort
behavior and the insert are all unchanged. The built payload never holds `permid` or `reference`: both are
columns, and `db` has neither.

### D5 — The audit registers `authority`

A `REGISTRY` entry: table `authorities`, column `authority`, `authoritySource`, `versioned: true`, columns
`['permid', 'reference_id']`, no children. Nothing else in the audit changes:

- `codecKeyColumns(authoritySource)` maps `refs` → `reference_id`, because `referencePermid` is annotated with a
  `column`. The round trip therefore selects `refs` per batch from the ids the batch holds, which is what the
  `payload-audit` rule prescribes for a keyed non-dictionary source. Collection still pre-loads `refs`, because
  `collectionReferences` offers no key column.
- The runner already derives its audited entities from `REGISTRY` and each step's `writes`, so the
  `authorities` step starts auditing `authority` with no runner code change. The runner test that used
  `--only authorities` as the "no audited table" example moves to `--only authority-opinions`, which writes
  only `name_opinions`.

## Risks / Trade-offs

- **[The new `db` variant accepts something the old schema rejected]** → The old schema's rules are carried
  over one for one (D1), and unit tests pin each: `citation` and `publishedInReference` required, `year` a
  string of length ≤ 4, `descriptors` an array of strings, `oldpbdbIDs` an array of strings, no unknown keys.
- **[Round trip is the first to select `refs` per batch]** → The selection logic already exists and is covered
  for `persons`. The verification round trip runs over all 163,067 authorities and must report zero
  differences.
- **[`publishedInReference` duplication]** → Out of scope (Non-Goals). Nothing in this change makes it worse.

## Migration Plan

No DDL change, and the stored jsonb does not change, so localhost `pbdb` needs no rebuild. Verification runs the
full pipeline into a side database with `PG_DATABASE=<side> node src/run-migrations.js --createdb`, as the
reference change did. It checks that every authority payload validates during the step, that the runner's
audit is clean for all five entities, and that the rebuilt `authorities` jsonb is identical to localhost
`pbdb`'s when matched on `legacyIDs`. The side database is dropped afterwards, with the user's go-ahead.

Rollback is `git revert`: no data or schema change reaches any database.

## Open Questions

None.
