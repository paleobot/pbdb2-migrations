import { test } from 'node:test';
import assert from 'node:assert/strict';
import { split, merge } from '../lib/storage.js';
import { deriveVariant } from '../lib/variants.js';
import { createAjv } from '../lib/ajv.js';

const source = {
  $id: 'https://pbdb2.example.com/schemas/thing.json',
  type: 'object',
  properties: {
    permid: { type: 'string', readOnly: true, 'x-storage': { column: 'permid' } },
    name: { type: 'string' },
    location: {
      type: 'object',
      properties: {
        coordinates: {
          type: 'object',
          properties: {
            latitude: { type: 'number', 'x-storage': { column: 'location', codec: 'wgs84Point' } },
            longitude: { type: 'number', 'x-storage': { column: 'location', codec: 'wgs84Point' } },
            basis: { type: 'string' },
          },
        },
        scale: { type: 'string' },
      },
    },
    references: {
      type: 'array',
      items: { type: 'object', properties: { referenceID: { type: 'string' }, order: { type: 'string' } } },
      'x-storage': { table: 'additional_collection_refs', codec: 'collectionReferences' },
    },
  },
  required: ['name'],
  'x-create': { required: ['references'] },
  unevaluatedProperties: false,
};

test('coordinates to EWKT text; empty coordinates object dropped', () => {
  const { jsonb, columns } = split(source, { name: 'n', location: { coordinates: { latitude: 45.5, longitude: -110.25 }, scale: 'outcrop' } });
  assert.equal(columns.location, 'SRID=4326;POINT(-110.25 45.5)');
  assert.deepEqual(jsonb, { name: 'n', location: { scale: 'outcrop' } });
});

test('coordinates with other fields keep the object', () => {
  const { jsonb } = split(source, { name: 'n', location: { coordinates: { latitude: 1, longitude: 2, basis: 'b' } } });
  assert.deepEqual(jsonb.location.coordinates, { basis: 'b' });
});

test('half a coordinate pair throws', () => {
  assert.throws(() => split(source, { name: 'n', location: { coordinates: { latitude: 1 } } }), /together/);
});

test('primary reference goes to the column, the rest to child rows', () => {
  const { columns, children, jsonb } = split(source, {
    name: 'n',
    references: [{ referenceID: '12', order: '2' }, { referenceID: '7', order: '1' }],
  });
  assert.equal(columns.reference_id, '7');
  assert.deepEqual(children.additional_collection_refs, [{ reference_id: '12' }]);
  assert.equal('references' in jsonb, false);
});

test('reference order normalized on round trip', () => {
  const parts = split(source, { name: 'n', references: [{ referenceID: '3', order: '1' }, { referenceID: '9', order: '5' }] });
  parts.children.additional_collection_refs = parts.children.additional_collection_refs.map((r, i) => ({ id: String(100 + i), ...r }));
  assert.deepEqual(merge(source, parts).references, [{ referenceID: '3', order: '1' }, { referenceID: '9', order: '2' }]);
});

test('merge rebuilds coordinates from GeoJSON, creating missing objects', () => {
  const merged = merge(source, {
    jsonb: { name: 'n' },
    columns: { location: { type: 'Point', coordinates: [-110.25, 45.5] }, permid: 'p', reference_id: '7' },
    children: { additional_collection_refs: [] },
  });
  assert.deepEqual(merged, {
    name: 'n',
    permid: 'p',
    location: { coordinates: { latitude: 45.5, longitude: -110.25 } },
    references: [{ referenceID: '7', order: '1' }],
  });
});

test('null location merges to no coordinates', () => {
  assert.deepEqual(merge(source, { jsonb: { name: 'n' }, columns: { location: null } }), { name: 'n' });
});

test('unknown codec throws naming it', () => {
  const bad = { properties: { a: { type: 'string', 'x-storage': { column: 'a', codec: 'nope' } } } };
  assert.throws(() => split(bad, { a: 'x' }), /Unknown codec 'nope'/);
  assert.throws(() => merge(bad, { jsonb: {}, columns: { a: 'x' } }), /Unknown codec 'nope'/);
});

test('split of an in-create-valid payload yields db-valid jsonb', () => {
  const ajv = createAjv();
  const inCreate = ajv.compile(deriveVariant(source, 'in-create'));
  const db = ajv.compile(deriveVariant(source, 'db'));
  const payloads = [
    { name: 'a', references: [{ referenceID: '1', order: '1' }] },
    { name: 'b', location: { coordinates: { latitude: 1, longitude: 2 } }, references: [{ referenceID: '1', order: '1' }, { referenceID: '2', order: '2' }] },
    { name: 'c', location: { coordinates: { latitude: 1, longitude: 2, basis: 'x' }, scale: 's' }, references: [] },
  ];
  for (const p of payloads) {
    assert.equal(inCreate(p), true, JSON.stringify(inCreate.errors));
    assert.equal(db(split(source, p).jsonb), true, JSON.stringify(db.errors));
  }
});
