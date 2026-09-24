# Payload Schema Design Notes

Decisions and patterns behind the annotated payload sources in this directory.
The normative rules are in `openspec/specs/payload-schema-variants/spec.md` and
`openspec/specs/payload-schema-enums/spec.md`. Questions left for the API design
are collected in `docs/api-design-backlog.md`.

---

## One annotated source per resource — variants are derived

Each resource has exactly **one** schema definition: an annotated source
(`collectionSource`, `specimenSource`, ...) describing the entity object as the
API sees it, with no fastify envelope. Every schema actually used is derived
from it with `deriveVariant` (`lib/variants.js`), after resolving dictionary
enums on the source with `resolveEnums` (`lib/enums.js`):

| Variant | Used for |
|---|---|
| `db` | the jsonb at rest; migrations and `src/audit-payloads.js` validate against it |
| `in-create` | POST bodies (whether it also validates merged PATCH documents is open; see below) |
| `patch-guard` | the first check on a PATCH body |
| `out` | responses; dictionary enums are documented, not enforced |

Annotations on the source:

- `x-enumFrom: { table, column }` — enum from `dictionaries.<table>.<column>`.
  Only for open vocabularies curators may extend; closed sets that code depends
  on stay as inline `enum`s.
- `x-storage: { column | table, codec? }` — not stored in the jsonb. `lib/storage.js`
  splits a payload into jsonb + columns + child rows and merges them back;
  `lib/codecs.js` handles fields that don't map one-to-one.
- `readOnly: true` — server-assigned (e.g. `permid`, `legacyIDs`). Root
  properties only. It does not mean "privileged": fields only some callers may
  set (person `role`, `authorizer`, `active`) stay writable, because `readOnly`
  would make them unsettable by anyone. Who may set them is a route concern.
- `x-create` — extra rules applied only in `in-create` (extra `required`,
  conditional rules such as the admin1-required country list, and create-only
  constraints such as a four-digit `year` or a non-empty `name`).

The `createSchema` / `editSchema` dichotomy is a PBot artifact and is not
carried forward.

### Edit route pattern (JSON Merge Patch)

```
PATCH request arrives
  → check the body against patch-guard (an object, with no readOnly keys)
  → merge the stored row into a full document (lib/storage.js merge)
  → apply the merge patch in memory
  → remove readOnly properties
  → validate the merged result as a whole document
  → if valid, split and commit; if not, return validation error
```

This works because JSON Merge Patch semantics mean the merged result must
always be a fully valid document. Validating the patch body field by field
would require allowing nulls everywhere and making all fields optional — a lot
of machinery that catches nothing you wouldn't catch anyway one step later,
and it would miss cross-field rules the merged document catches.

A bare `{ type: "object" }` guard is not quite enough: removing readOnly
properties before validation would silently hide a patch that tries to change
them. `patch-guard` is that bare guard plus "no readOnly keys", which is why
readOnly is allowed on root properties only.

**Open API policy:** which variant validates the merged document. Migrated rows
can have gaps (`scale`, age `error`/`method`, `admin1`) that `in-create`
rejects:

| Policy | Legacy row with gaps, typo fix | New gap introduced |
|---|---|---|
| merged vs. `in-create` | rejected until the gaps are filled | rejected |
| merged vs. `db` | accepted | accepted — edits can degrade records |
| ratchet: vs. `db` always, plus vs. `in-create` if the stored row already passed it | accepted | rejected if the row was complete |

Create-only rules make the `in-create` policy stricter still. An authority
migrated with the sentinel year `"0"` could not have only its `citation` edited,
because `in-create` requires a four-digit `year`. This question is also tracked in
`docs/api-design-backlog.md`.

---

## Schema file structure

### Properties map: no schema-level cruft

`schemaProperties` (or `referenceProperties`, etc.) must be a **flat map of
property names to their schemas only**. Do not include `$schema`, `$id`,
`title`, `description`, `type`, `$defs`, or `properties` as top-level keys —
AJV treats every key in this object as a property name, not a schema keyword.

```js
// correct
const schemaProperties = {
    title: { type: "string" },
    year:  { type: "string", maxLength: 4 },
    // ...
};

// wrong — schema keywords become property names, AJV ignores them
const schemaProperties = {
    $schema: "http://json-schema.org/draft-2019-09/schema#",
    type: "object",
    properties: {
        title: { type: "string" },
        // ...
    }
};
```

---

## Character/state trees

Characters and states form trees under a schema, stored as rows with parent and
`sort_order` columns. Their sources (`character.schema.js`, `state.schema.js`)
are flat: no parent, no order, no nesting. Whether the API creates each node on
its own (separate routes, with parent and order in the body) or a whole tree in
one call from a schemas route is undecided; see `docs/api-design-backlog.md`.

Only the one-call option needs `$defs`/`$ref`, and `deriveVariant` does not
follow them yet. A sketch of that option is kept as a comment at the end of
`schema.schema.js`. It predates `states.quantitative`: its `name = "quantity"
→ value` rule is not a state rule to revive, because a measured value belongs to
an observation of a state, not to the state.

---

## Common bugs to avoid

- **`items` properties wrong format**: `familyName: "string"` is not valid JSON
  Schema. Must be `familyName: { type: "string" }`.
- **Unclosed strings**: `type: "string,` — easy to miss, crashes module load.
- **Copy-paste `title`**: check that the `title` metadata field reflects the
  actual resource, not a previous resource (e.g., "Collection" copied into a
  schema file).
- **Dictionary values match exactly**: a stored value must equal a
  `dictionaries` row byte for byte (`"leaf"`, not `"Leaf"`). Sources carry
  `x-enumFrom`, not the values; a migration that receives other spellings maps
  them first, as the PBot schemas migration does case-insensitively for
  `partsPreserved` and `notableFeatures`.
- **Dictionary values are append-only in practice**: stored jsonb holds the
  string, with no FK protecting it. Renaming or deleting a dictionary value
  needs a data migration of the rows using it; `node src/audit-payloads.js`
  reports any that are orphaned.
