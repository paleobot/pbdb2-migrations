// Derive the per-use variants of an annotated payload source:
//
//   db           the jsonb at rest: x-storage properties removed, base required only
//   in-create    a create body: readOnly properties removed, x-create merged in
//   out          a full response: everything kept, dictionary enums not enforced
//   patch-guard  screens a JSON Merge Patch body (object, no readOnly keys); the
//                merged document is validated separately (payloadSchemas/DESIGN_NOTES.md)
//
// Resolve enums on the source first (./enums.js), then derive. Recurses through
// properties, items, allOf/anyOf/oneOf, if/then/else and not. $defs/$ref are not
// followed. They would be needed only if the API created a schema's whole
// character/state tree in one call (the sketch at the end of schema.schema.js).
// See openspec/specs/payload-schema-variants/spec.md.

export const VARIANTS = ['db', 'in-create', 'patch-guard', 'out'];

const COMBINATORS = ['allOf', 'anyOf', 'oneOf'];
const SUBSCHEMAS = ['if', 'then', 'else', 'not'];

function isSchema(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

// readOnly may appear only on the source's root properties (so patch-guard,
// which checks root keys, covers every read-only field).
function assertRootOnlyReadOnly(source) {
  const check = (node, path) => {
    if (Array.isArray(node)) return node.forEach((n, i) => check(n, `${path}[${i}]`));
    if (!isSchema(node)) return;
    if (node.readOnly) throw new Error(`readOnly is allowed only on root properties; found at ${path}`);
    for (const [k, v] of Object.entries(node)) check(v, `${path}.${k}`);
  };
  for (const [name, prop] of Object.entries(source.properties ?? {})) {
    const { readOnly, ...rest } = prop;
    check(rest, name);
  }
  for (const [k, v] of Object.entries(source)) {
    if (k !== 'properties') check(v, k);
  }
}

// Remove `names` from required lists at this node and in the applicators that
// constrain the same object (combinators, if/then/else, x-create).
function pruneRequired(schema, names) {
  if (!isSchema(schema) || names.size === 0) return;
  if (Array.isArray(schema.required)) {
    schema.required = schema.required.filter((n) => !names.has(n));
    if (schema.required.length === 0) delete schema.required;
  }
  for (const k of COMBINATORS) (schema[k] ?? []).forEach((s) => pruneRequired(s, names));
  for (const k of [...SUBSCHEMAS, 'x-create']) pruneRequired(schema[k], names);
}

function transform(node, variant) {
  if (!isSchema(node)) return node;
  const out = { ...node };

  if (isSchema(out.properties)) {
    const removed = new Set();
    const props = {};
    for (const [name, prop] of Object.entries(out.properties)) {
      const drop = (variant === 'db' && prop['x-storage']) || (variant === 'in-create' && prop.readOnly);
      if (drop) removed.add(name);
      else props[name] = transform(prop, variant);
    }
    out.properties = props;
    pruneRequired(out, removed);
  }

  if (Array.isArray(out.items)) out.items = out.items.map((s) => transform(s, variant));
  else if (isSchema(out.items)) out.items = transform(out.items, variant);
  for (const k of COMBINATORS) if (Array.isArray(out[k])) out[k] = out[k].map((s) => transform(s, variant));
  for (const k of SUBSCHEMAS) if (isSchema(out[k])) out[k] = transform(out[k], variant);

  if ('x-create' in out) {
    const extra = out['x-create'];
    delete out['x-create'];
    if (variant === 'in-create') out.allOf = [...(out.allOf ?? []), transform(extra, variant)];
  }

  if (variant === 'out' && 'x-enumFrom' in out) delete out.enum;
  return out;
}

function variantId(source, variant) {
  if (typeof source.$id !== 'string' || !source.$id.endsWith('.json')) {
    throw new Error(`source needs a $id ending in .json to derive variant ids (got ${source.$id})`);
  }
  return source.$id.replace(/\.json$/, `.${variant}.json`);
}

export function deriveVariant(source, variant) {
  if (!VARIANTS.includes(variant)) {
    throw new Error(`Unknown variant '${variant}'; expected one of ${VARIANTS.join(', ')}`);
  }
  assertRootOnlyReadOnly(source);
  const $id = variantId(source, variant);

  if (variant === 'patch-guard') {
    const readOnly = Object.entries(source.properties ?? {}).filter(([, p]) => p.readOnly).map(([n]) => n);
    const guard = { $schema: source.$schema, $id, 'x-variant': variant, type: 'object' };
    if (!guard.$schema) delete guard.$schema;
    if (readOnly.length) guard.propertyNames = { not: { enum: readOnly } };
    return guard;
  }

  const out = transform(structuredClone(source), variant);
  out.$id = $id;
  out['x-variant'] = variant;
  out.unevaluatedProperties = false;
  return out;
}
