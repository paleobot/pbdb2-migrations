# Payload Schema Design Notes

Decisions and patterns established during design review of `schema.schema.js`.
Apply these when rewriting all schema definition files.

---

## One schema per resource — drop editSchema entirely

Each resource needs exactly **one** schema definition. The `createSchema` /
`editSchema` dichotomy is a PBot artifact and should not be carried forward.

The `createSchema` defines the complete, valid shape of a resource document.
It is used for:

1. Validating the body on POST (create)
2. Validating the **merged result** on PATCH (edit), not the patch body itself

### Edit route pattern (JSON Merge Patch)

```
PATCH request arrives
  → apply merge patch to stored document in memory
  → validate merged result against createSchema
  → if valid, commit; if not, return validation error
```

This works because JSON Merge Patch semantics mean the merged result must
always be a fully valid document. Validating before the merge (i.e., the patch
body itself) would require allowing nulls everywhere and making all fields
optional — a lot of machinery that catches nothing you wouldn't catch anyway
one step later.

The only additional guard on a PATCH route is a bare `{ type: "object" }` on
the body to reject non-object payloads early. Nothing more is needed.

**`editSchema` exports in existing files should be removed when those files are
rewritten.**

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
