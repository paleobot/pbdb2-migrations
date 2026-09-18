// Named codecs for x-storage fields that do not map one-to-one to a column.
// A codec receives every sibling property that names it:
//   split(values, storage) -> { columns?, children? }
//   merge({ columns, children }, storage) -> values   (only the keys it can rebuild)
// Row ids are carried as strings (bigint-safe, as node-postgres returns them).
// See openspec/specs/payload-schema-variants/spec.md.

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
const collectionReferences = {
  split({ references }, storage) {
    if (references === undefined || references === null) return {};
    const sorted = [...references].sort((a, b) => Number(a.order) - Number(b.order));
    const [primary, ...rest] = sorted;
    return {
      columns: { reference_id: primary ? String(primary.referenceID) : null },
      children: { [storage.table]: rest.map((r) => ({ reference_id: String(r.referenceID) })) },
    };
  },
  merge({ columns, children }, storage) {
    const primary = columns?.reference_id;
    if (primary === null || primary === undefined) return {};
    const rows = [...(children?.[storage.table] ?? [])].sort((a, b) => Number(a.id) - Number(b.id));
    const references = [{ referenceID: String(primary), order: '1' }];
    rows.forEach((r, i) => references.push({ referenceID: String(r.reference_id), order: String(i + 2) }));
    return { references };
  },
};

export const codecs = { wgs84Point, collectionReferences };

export function getCodec(name) {
  const codec = codecs[name];
  if (!codec) throw new Error(`Unknown codec '${name}'; known: ${Object.keys(codecs).join(', ')}`);
  return codec;
}
