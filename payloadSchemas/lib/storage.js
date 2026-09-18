// Split an API-shaped payload into its storage parts, and merge them back, as
// declared by x-storage on the annotated source:
//   split(source, payload) -> { jsonb, columns, children }
//   merge(source, { jsonb, columns, children }) -> payload
// x-storage is followed through nested `properties` only. A property with
// { column } and no codec maps one-to-one; codec groups go through ./codecs.js.
// An object left empty only because its stored-elsewhere fields were split out
// is dropped from the jsonb, and recreated on merge when those fields return.
// See openspec/specs/payload-schema-variants/spec.md.
import { getCodec } from './codecs.js';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

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

function addParts(parts, { columns, children }) {
  Object.assign(parts.columns, columns ?? {});
  for (const [table, rows] of Object.entries(children ?? {})) {
    parts.children[table] = [...(parts.children[table] ?? []), ...rows];
  }
}

function splitNode(schema, value, parts) {
  const out = { ...value };
  let removedAny = false;
  for (const { storage, names } of storageGroups(schema.properties)) {
    const picked = {};
    for (const n of names) if (n in out) { picked[n] = out[n]; delete out[n]; removedAny = true; }
    if (storage.codec) addParts(parts, getCodec(storage.codec).split(picked, storage));
    else if (names[0] in picked) parts.columns[storage.column] = picked[names[0]];
  }
  for (const [name, prop] of Object.entries(schema.properties ?? {})) {
    if (prop['x-storage'] || !isObject(out[name]) || !isObject(prop.properties)) continue;
    const child = splitNode(prop, out[name], parts);
    if (child === undefined) delete out[name];
    else out[name] = child;
  }
  return removedAny && Object.keys(out).length === 0 ? undefined : out;
}

export function split(source, payload) {
  const parts = { columns: {}, children: {} };
  const jsonb = splitNode(source, payload, parts) ?? {};
  return { jsonb, ...parts };
}

function mergeNode(schema, value, parts) {
  const out = value === undefined ? {} : { ...value };
  for (const { storage, names } of storageGroups(schema.properties)) {
    if (storage.codec) {
      const rebuilt = getCodec(storage.codec).merge(parts, storage);
      for (const n of names) if (rebuilt[n] !== undefined) out[n] = rebuilt[n];
    } else {
      const v = parts.columns?.[storage.column];
      if (v !== undefined && v !== null) out[names[0]] = v;
    }
  }
  for (const [name, prop] of Object.entries(schema.properties ?? {})) {
    if (prop['x-storage'] || !isObject(prop.properties)) continue;
    if (out[name] !== undefined && !isObject(out[name])) continue;
    const child = mergeNode(prop, out[name], parts);
    if (child !== undefined) out[name] = child;
  }
  return value === undefined && Object.keys(out).length === 0 ? undefined : out;
}

export function merge(source, { jsonb, columns = {}, children = {} }) {
  return mergeNode(source, jsonb ?? {}, { columns, children }) ?? {};
}
