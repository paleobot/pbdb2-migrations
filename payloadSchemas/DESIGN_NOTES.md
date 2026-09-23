# Payload Schema Design Notes

Decisions and patterns established during design review of `schema.schema.js`.
Apply these when rewriting all schema definition files.

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
| `in-create` | POST bodies, and (see below) merged PATCH documents |
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
  properties only.
- `x-create` — extra rules applied only in `in-create` (extra `required`,
  conditional rules such as the admin1-required country list).

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

### $defs must live inside body

> Applies to API route definitions that wrap a derived variant in a fastify
> envelope. Annotated sources themselves have no envelope. Note that
> `deriveVariant` does not follow `$defs`/`$ref`. It would need to only if the
> API created a schema's whole character/state tree in one call; separate
> schema, character and state routes need neither (see the sketch at the end of
> `schema.schema.js`).

AJV compiles `createSchema.body` as the root schema document. `#` in any
`$ref` resolves relative to that root. So `$defs` must be inside `body`, not
at the `createSchema` level.

```js
export const createSchema = {
    tags: ["Schema"],
    hide: true,
    body: {
        type: 'object',
        $defs: {           // ← here, so #/$defs/... resolves correctly
            state: { ... },
            character: { ... },
        },
        properties: {
            schema: {
                type: "object",
                properties: schemaProperties,
                unevaluatedProperties: false,
                required: ["title", "year", "schemaDefinition"]
            }
        }
    }
}
```

---

## Recursive schemas ($defs + $ref)

For nested structures like characters (which can contain sub-characters) and
states (which can contain sub-states), use `$defs` with `$ref`. The recursion
is expressed naturally:

```js
$defs: {
    state: {
        type: "object",
        properties: {
            name:       { type: "string" },
            definition: { type: "string" },
            order:      { type: "integer", minimum: 1 },
            states:     { type: "array", items: { $ref: "#/$defs/state" } }
        },
        // quantitative state convention
        if:   { properties: { name: { const: "quantity" } } },
        then: { properties: { value: { type: "string" } }, required: ["value"] }
    },
    character: {
        type: "object",
        properties: {
            name:       { type: "string" },
            definition: { type: "string" },
            order:      { type: "integer", minimum: 1 },
            states:     { type: "array", items: { $ref: "#/$defs/state" } },
            characters: { type: "array", items: { $ref: "#/$defs/character" } }
        }
    }
}
```

AJV supports this natively with Draft 2019-09. No extra configuration needed.

---

## Common bugs to avoid

- **`items` properties wrong format**: `familyName: "string"` is not valid JSON
  Schema. Must be `familyName: { type: "string" }`.
- **Unclosed strings**: `type: "string,` — easy to miss, crashes module load.
- **Copy-paste `title`**: check that the `title` metadata field reflects the
  actual resource, not a previous resource (e.g., "Collection" copied into a
  schema file).
- **`partsPreserved` casing**: enum values must match `dictionaries.parts_preserved`
  exactly. All lowercase (`"leaf"`, not `"Leaf"`).
- **Dictionary values are append-only in practice**: stored jsonb holds the
  string, with no FK protecting it. Renaming or deleting a dictionary value
  needs a data migration of the rows using it; `node src/audit-payloads.js`
  reports any that are orphaned.
