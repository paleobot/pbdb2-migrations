// x-enumFrom resolution: a schema node carrying
//   "x-enumFrom": { table, column }
// receives an `enum` of the non-NULL values of dictionaries.<table>.<column>,
// ordered by id, first occurrence kept. Resolve the annotated source BEFORE
// deriving variants (deriveVariant in ./variants.js): the out variant drops
// dictionary enums on purpose, and resolving it afterwards would put them back,
// so applyEnums refuses a derived schema. See
// openspec/specs/payload-schema-enums/spec.md.

const IDENT = /^[a-z_][a-z0-9_]*$/;
const keyOf = (table, column) => `${table}.${column}`;

// Visit every plain object in a schema tree, depth first.
function eachNode(node, visit) {
  if (Array.isArray(node)) {
    for (const n of node) eachNode(n, visit);
  } else if (node && typeof node === 'object') {
    visit(node);
    for (const v of Object.values(node)) eachNode(v, visit);
  }
}

function checkAnnotation(node) {
  const ann = node['x-enumFrom'];
  const shown = JSON.stringify(ann);
  if (!ann || typeof ann !== 'object' || Array.isArray(ann)) {
    throw new Error(`x-enumFrom must be an object { table, column }: ${shown}`);
  }
  const keys = Object.keys(ann).sort().join(',');
  if (keys !== 'column,table') {
    throw new Error(`x-enumFrom must have exactly the keys table and column: ${shown}`);
  }
  if (!IDENT.test(ann.table) || !IDENT.test(ann.column)) {
    throw new Error(`x-enumFrom table/column must match ${IDENT} (dictionaries schema implied): ${shown}`);
  }
  if ('enum' in node) {
    throw new Error(`x-enumFrom and a literal enum on the same schema: ${shown}`);
  }
  return ann;
}

// Distinct { table, column } pairs referenced by the schema.
export function collectEnumSources(schema) {
  const seen = new Map();
  eachNode(schema, (node) => {
    if (!('x-enumFrom' in node)) return;
    const { table, column } = checkAnnotation(node);
    seen.set(keyOf(table, column), { table, column });
  });
  return [...seen.values()];
}

// Map "table.column" -> values, one query per pair.
export async function loadEnums(pg, sources) {
  const map = new Map();
  for (const { table, column } of sources) {
    const key = keyOf(table, column);
    if (map.has(key)) continue;
    if (!IDENT.test(table) || !IDENT.test(column)) throw new Error(`Unsafe dictionary identifier: ${key}`);
    let rows;
    try {
      ({ rows } = await pg.query(
        `SELECT "${column}" AS v FROM dictionaries."${table}" WHERE "${column}" IS NOT NULL ORDER BY id`,
      ));
    } catch (err) {
      throw new Error(`Cannot read dictionaries.${key}: ${err.message}`);
    }
    map.set(key, [...new Set(rows.map((r) => r.v))]);
  }
  return map;
}

// Pure: a deep clone of `schema` with each x-enumFrom node given its `enum`.
export function applyEnums(schema, map) {
  if (schema && schema['x-variant']) {
    throw new Error(`applyEnums on a derived '${schema['x-variant']}' variant: resolve the source first, then derive`);
  }
  const out = structuredClone(schema);
  eachNode(out, (node) => {
    if (!('x-enumFrom' in node)) return;
    const { table, column } = checkAnnotation(node);
    const key = keyOf(table, column);
    const values = map.get(key);
    if (!values) throw new Error(`No enum values supplied for dictionaries.${key}`);
    if (values.length === 0) throw new Error(`Enum resolution failed: dictionaries.${key} is empty`);
    node.enum = [...values];
  });
  return out;
}

export async function resolveEnums(pg, schema) {
  return applyEnums(schema, await loadEnums(pg, collectEnumSources(schema)));
}
