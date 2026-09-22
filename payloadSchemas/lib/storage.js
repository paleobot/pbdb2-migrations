// Split an API-shaped payload into its storage parts, and merge them back, as
// declared by x-storage on the annotated source:
//   split(source, payload, ctx) -> { jsonb, columns, children }
//   merge(source, { jsonb, columns, children }, ctx) -> payload
// x-storage is followed through nested `properties` only. A property with
// { column } and no codec maps one-to-one; codec groups go through ./codecs.js.
// An object left empty only because its stored-elsewhere fields were split out
// is dropped from the jsonb, and recreated on merge when those fields return.
//
// `ctx` is the codec context: a Map from a looked-up table to { byKey, byValue },
// needed by a codec that cannot be computed from the payload alone. Build it with
// collectCodecSources + loadCodecContext, or hand-build one in a test. split and
// merge remain pure and synchronous; a codec that declares no sources ignores it.
// See openspec/specs/payload-schema-variants/spec.md.
import { getCodec } from './codecs.js';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const IDENT = /^[a-z_][a-z0-9_]*$/;

// Group a node's x-storage properties: codec groups keyed by codec name, plain
// columns individually.
function storageGroups(properties) {
  const groups = new Map();
  for (const [name, prop] of Object.entries(properties ?? {})) {
    const storage = prop['x-storage'];
    if (!storage) continue;
    const key = storage.codec ? `codec:${storage.codec}` : `column:${name}`;
    if (!groups.has(key)) groups.set(key, { storage, names: [] });
    groups.get(key).names.push(name);
  }
  return [...groups.values()];
}

// ---------- The codec context ----------

const sourceKey = ({ table, key, value }) => `${table}.${key}->${value}`;

function checkSource(codecName, source) {
  const shown = JSON.stringify(source);
  if (!isObject(source)) throw new Error(`${codecName}: a declared source must be { table, key, value }: ${shown}`);
  const keys = Object.keys(source).sort().join(',');
  if (keys !== 'key,table,value') {
    throw new Error(`${codecName}: a declared source must have exactly the keys table, key and value: ${shown}`);
  }
  for (const part of [...String(source.table).split('.'), source.key, source.value]) {
    if (!IDENT.test(part)) throw new Error(`${codecName}: unsafe identifier in source ${shown}`);
  }
  return source;
}

// A property that carries both x-enumFrom and a codec reading a dictionaries
// table must have the two name the same table: otherwise the values the schema
// accepts and the keys the codec stores are free to drift apart.
function checkEnumAgreement(name, prop, sources) {
  const ann = prop['x-enumFrom'];
  if (!ann?.table) return;
  for (const source of sources) {
    if (!source.table.startsWith('dictionaries.')) continue;
    if (source.table !== `dictionaries.${ann.table}`) {
      throw new Error(
        `${name}: x-enumFrom names dictionaries.${ann.table} but codec '${prop['x-storage'].codec}' reads ${source.table}`,
      );
    }
  }
}

// Every distinct { table, key, value } the source's codecs declare.
export function collectCodecSources(schema) {
  const seen = new Map();
  const visit = (node) => {
    for (const [name, prop] of Object.entries(node.properties ?? {})) {
      const codecName = prop['x-storage']?.codec;
      if (codecName) {
        const sources = (getCodec(codecName).sources ?? []).map((s) => checkSource(codecName, s));
        checkEnumAgreement(name, prop, sources);
        for (const s of sources) if (!seen.has(sourceKey(s))) seen.set(sourceKey(s), s);
      }
      if (isObject(prop.properties)) visit(prop);
    }
  };
  visit(schema);
  return [...seen.values()];
}

// Which stored column's values are a source's keys, per looked-up table: what a
// caller reading rows in batches restricts that source to. Following x-storage
// rather than naming the columns keeps a batching caller out of the codecs'
// business.
export function codecKeyColumns(schema) {
  const byTable = new Map();
  const visit = (node) => {
    for (const prop of Object.values(node.properties ?? {})) {
      const storage = prop['x-storage'];
      if (storage?.codec && storage.column) {
        for (const source of getCodec(storage.codec).sources ?? []) {
          if (!byTable.has(source.table)) byTable.set(source.table, new Set());
          byTable.get(source.table).add(storage.column);
        }
      }
      if (isObject(prop.properties)) visit(prop);
    }
  };
  visit(schema);
  return byTable;
}

const quoted = (table) => table.split('.').map((p) => `"${p}"`).join('.');

// A curated vocabulary rather than an entity table: read in full, once per run.
export const isDictionarySource = (source) => source.table.startsWith('dictionaries.');

// Map each source's table to { byKey, byValue }, both filled by one read.
//
// `selection` is { <table>: { column, values } }: the column being restricted on
// — the source's `key` when the caller starts from a stored id, its `value` when
// it starts from a payload value such as a permid — and the values to restrict
// to. A source not named there is read in full. A source in the dictionaries
// schema is always read in full and is never restricted: those are curated
// vocabularies (dictionaries.roles holds six rows), and batching them would issue
// one pointless six-row query per batch.
//
// `reuse` seeds the result with an already-loaded context, and a source whose
// table it already holds is not read again. That is how a caller iterating in
// batches loads its dictionary sources once for the run and only its entity
// sources per batch: the returned Map is new each call, so a batch's selection
// never accumulates into the next one's.
export async function loadCodecContext(pg, sources, selection = {}, reuse) {
  const ctx = new Map(reuse);
  for (const source of sources) {
    const { table, key, value } = checkSource('loadCodecContext', source);
    if (ctx.has(table)) continue;
    const restrict = isDictionarySource(source) ? undefined : selection[table];
    let sql = `SELECT "${key}" AS k, "${value}" AS v FROM ${quoted(table)}`;
    const params = [];
    if (restrict) {
      if (restrict.column !== key && restrict.column !== value) {
        throw new Error(`loadCodecContext: ${table} can be restricted on ${key} or ${value}, not ${restrict.column}`);
      }
      sql += ` WHERE "${restrict.column}" = ANY($1)`;
      params.push([...restrict.values]);
    }
    let rows;
    try {
      ({ rows } = await pg.query(sql, params));
    } catch (err) {
      throw new Error(`Cannot read codec source ${table}: ${err.message}`);
    }
    const byKey = new Map();
    const byValue = new Map();
    for (const r of rows) {
      byKey.set(r.k, r.v);
      byValue.set(r.v, r.k);
    }
    ctx.set(table, { byKey, byValue });
  }
  return ctx;
}

// ---------- split / merge ----------

function addParts(parts, { columns, children }) {
  Object.assign(parts.columns, columns ?? {});
  for (const [table, rows] of Object.entries(children ?? {})) {
    parts.children[table] = [...(parts.children[table] ?? []), ...rows];
  }
}

function splitNode(schema, value, parts, ctx) {
  const out = { ...value };
  let removedAny = false;
  for (const { storage, names } of storageGroups(schema.properties)) {
    const picked = {};
    for (const n of names) if (n in out) { picked[n] = out[n]; delete out[n]; removedAny = true; }
    if (storage.codec) addParts(parts, getCodec(storage.codec).split(picked, storage, ctx));
    else if (names[0] in picked) parts.columns[storage.column] = picked[names[0]];
  }
  for (const [name, prop] of Object.entries(schema.properties ?? {})) {
    if (prop['x-storage'] || !isObject(out[name]) || !isObject(prop.properties)) continue;
    const child = splitNode(prop, out[name], parts, ctx);
    if (child === undefined) delete out[name];
    else out[name] = child;
  }
  return removedAny && Object.keys(out).length === 0 ? undefined : out;
}

export function split(source, payload, ctx) {
  const parts = { columns: {}, children: {} };
  const jsonb = splitNode(source, payload, parts, ctx) ?? {};
  return { jsonb, ...parts };
}

function mergeNode(schema, value, parts, ctx) {
  const out = value === undefined ? {} : { ...value };
  for (const { storage, names } of storageGroups(schema.properties)) {
    if (storage.codec) {
      const rebuilt = getCodec(storage.codec).merge(parts, storage, ctx);
      for (const n of names) if (rebuilt[n] !== undefined) out[n] = rebuilt[n];
    } else {
      const v = parts.columns?.[storage.column];
      if (v !== undefined && v !== null) out[names[0]] = v;
    }
  }
  for (const [name, prop] of Object.entries(schema.properties ?? {})) {
    if (prop['x-storage'] || !isObject(prop.properties)) continue;
    if (out[name] !== undefined && !isObject(out[name])) continue;
    const child = mergeNode(prop, out[name], parts, ctx);
    if (child !== undefined) out[name] = child;
  }
  return value === undefined && Object.keys(out).length === 0 ? undefined : out;
}

export function merge(source, { jsonb, columns = {}, children = {} }, ctx) {
  return mergeNode(source, jsonb ?? {}, { columns, children }, ctx) ?? {};
}
