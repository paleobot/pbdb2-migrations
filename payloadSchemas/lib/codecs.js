// Named codecs for x-storage fields that do not map one-to-one to a column.
// A codec receives every sibling property that names it:
//   split(values, storage, ctx) -> { columns?, children? }
//   merge({ columns, children }, storage, ctx) -> values   (only the keys it can rebuild)
// Row ids are carried as strings (bigint-safe, as node-postgres returns them).
//
// A codec that cannot be computed from the payload alone declares the tables it
// reads in `sources`: { table, key, value }. The caller collects those with
// collectCodecSources, loads them with loadCodecContext (both in ./storage.js),
// and passes the resulting Map as `ctx`. split and merge stay pure and
// synchronous: a hand-built Map substitutes for a loaded one in tests, exactly
// as applyEnums takes one in place of loadEnums.
// See openspec/specs/payload-schema-variants/spec.md.

// Look up one side of a codec's source, throwing rather than dropping the value.
function lookup(codecName, source, ctx, direction, value) {
  const entry = ctx?.get(source.table);
  if (!entry) {
    throw new Error(`${codecName}: no codec context loaded for ${source.table}`);
  }
  const map = direction === 'byKey' ? entry.byKey : entry.byValue;
  const got = map?.get(value);
  if (got === undefined) {
    throw new Error(
      `${codecName}: ${source.table}.${direction === 'byKey' ? source.key : source.value} has no entry for ${JSON.stringify(value)}`,
    );
  }
  return got;
}

// { latitude, longitude } <-> a geography column. split emits EWKT text, which a
// geography column accepts on insert; merge expects the column selected as
// ST_AsGeoJSON(<column>)::json.
const wgs84Point = {
  split({ latitude, longitude }, storage) {
    const hasLat = latitude !== undefined && latitude !== null;
    const hasLng = longitude !== undefined && longitude !== null;
    if (!hasLat && !hasLng) return { columns: { [storage.column]: null } };
    if (hasLat !== hasLng) throw new Error('wgs84Point: latitude and longitude must be given together');
    return { columns: { [storage.column]: `SRID=4326;POINT(${longitude} ${latitude})` } };
  },
  merge({ columns }, storage) {
    let geo = columns?.[storage.column];
    if (geo === null || geo === undefined) return {};
    if (typeof geo === 'string') geo = JSON.parse(geo);
    const [longitude, latitude] = geo.coordinates;
    return { latitude, longitude };
  },
};

// references[] <-> collections.reference_id (the primary) + child rows. The child
// table has no order column, so order is normalized: split sorts by numeric
// `order`, the first goes to the column, the rest become child rows in sequence;
// merge emits the primary as order "1" and child rows by ascending id as "2"...
//
// referenceID is the reference's permid; the columns hold refs.id. refs is
// versioned and every version shares one permid, so the source is read from
// lineage heads only, which is what makes permid -> id a function. refs.id is a
// bigint, which node-postgres returns as a string, so ids are keyed as strings.
const REFS_SOURCE = { table: 'refs', key: 'id', value: 'permid', versioned: true };
const collectionReferences = {
  sources: [REFS_SOURCE],
  split({ references }, storage, ctx) {
    if (references === undefined || references === null) return {};
    const sorted = [...references].sort((a, b) => Number(a.order) - Number(b.order));
    const toId = (r) => String(lookup('collectionReferences', REFS_SOURCE, ctx, 'byValue', r.referenceID));
    const [primary, ...rest] = sorted;
    return {
      columns: { reference_id: primary ? toId(primary) : null },
      children: { [storage.table]: rest.map((r) => ({ reference_id: toId(r) })) },
    };
  },
  merge({ columns, children }, storage, ctx) {
    const primary = columns?.reference_id;
    if (primary === null || primary === undefined) return {};
    const toPermid = (id) => lookup('collectionReferences', REFS_SOURCE, ctx, 'byKey', String(id));
    const rows = [...(children?.[storage.table] ?? [])].sort((a, b) => Number(a.id) - Number(b.id));
    const references = [{ referenceID: toPermid(primary), order: '1' }];
    rows.forEach((r, i) => references.push({ referenceID: toPermid(r.reference_id), order: String(i + 2) }));
    return { references };
  },
};

// reference permid <-> a single refs.id column (authorities.reference_id). The
// scalar counterpart of collectionReferences, over the same heads-only source.
const referencePermid = {
  sources: [REFS_SOURCE],
  split({ reference }, storage, ctx) {
    if (reference === undefined || reference === null) return {};
    return { columns: { [storage.column]: String(lookup('referencePermid', REFS_SOURCE, ctx, 'byValue', reference)) } };
  },
  merge({ columns }, storage, ctx) {
    const id = columns?.[storage.column];
    if (id === undefined || id === null) return {};
    return { reference: lookup('referencePermid', REFS_SOURCE, ctx, 'byKey', String(id)) };
  },
};

// role name <-> persons.role_id. The payload carries the role's name and never
// its id: this project exposes permids rather than internal ids, dictionaries.roles
// has no permid, and a bare id means nothing to a client without a roles route.
const ROLES_SOURCE = { table: 'dictionaries.roles', key: 'id', value: 'name' };
const roleName = {
  sources: [ROLES_SOURCE],
  split({ role }, storage, ctx) {
    if (role === undefined || role === null) return {};
    return { columns: { [storage.column]: lookup('roleName', ROLES_SOURCE, ctx, 'byValue', role) } };
  },
  merge({ columns }, storage, ctx) {
    const id = columns?.[storage.column];
    if (id === undefined || id === null) return {};
    return { role: lookup('roleName', ROLES_SOURCE, ctx, 'byKey', Number(id)) };
  },
};

// authorizer permid <-> persons.authorizer_person_id. Exact in both directions:
// persons is unversioned and its permid is NOT NULL UNIQUE, so permid -> id is a
// function. That does not carry over to a versioned table, where every version
// shares one permid; see REFS_SOURCE for how that case is made exact.
const PERSONS_SOURCE = { table: 'persons', key: 'id', value: 'permid' };
const personPermid = {
  sources: [PERSONS_SOURCE],
  split({ authorizer }, storage, ctx) {
    if (authorizer === undefined || authorizer === null) return {};
    return { columns: { [storage.column]: lookup('personPermid', PERSONS_SOURCE, ctx, 'byValue', authorizer) } };
  },
  merge({ columns }, storage, ctx) {
    const id = columns?.[storage.column];
    if (id === undefined || id === null) return {};
    return { authorizer: lookup('personPermid', PERSONS_SOURCE, ctx, 'byKey', Number(id)) };
  },
};

export const codecs = { wgs84Point, collectionReferences, referencePermid, roleName, personPermid };

export function getCodec(name) {
  const codec = codecs[name];
  if (!codec) throw new Error(`Unknown codec '${name}'; known: ${Object.keys(codecs).join(', ')}`);
  return codec;
}
