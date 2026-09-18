import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveVariant } from '../lib/variants.js';
import { applyEnums } from '../lib/enums.js';
import { createAjv } from '../lib/ajv.js';

const source = () => ({
  $schema: 'https://json-schema.org/draft/2019-09/schema',
  $id: 'https://pbdb2.example.com/schemas/thing.json',
  type: 'object',
  properties: {
    permid: { type: 'string', readOnly: true, 'x-storage': { column: 'permid' } },
    legacyIDs: { type: 'object', readOnly: true, properties: { oldpbdbID: { type: 'string' } } },
    name: { type: 'string' },
    kind: { type: 'string', 'x-enumFrom': { table: 'kinds', column: 'name' } },
    unit: { type: 'string', enum: ['meters', 'feet'] },
    place: {
      type: 'object',
      properties: {
        lat: { type: 'number', 'x-storage': { column: 'location', codec: 'wgs84Point' } },
        lng: { type: 'number', 'x-storage': { column: 'location', codec: 'wgs84Point' } },
        basis: { type: 'string' },
      },
      required: ['basis', 'lat'],
      'x-create': { required: ['lng'] },
    },
  },
  required: ['name', 'permid'],
  'x-create': { required: ['place'] },
  unevaluatedProperties: false,
});
const resolved = () => applyEnums(source(), new Map([['kinds.name', ['a', 'b']]]));
const compile = (variant) => createAjv().compile(deriveVariant(resolved(), variant));

test('source is not mutated by any variant', () => {
  const src = resolved();
  const before = structuredClone(src);
  for (const v of ['db', 'in-create', 'out', 'patch-guard']) deriveVariant(src, v);
  assert.deepEqual(src, before);
});

test('unknown variant lists the valid ones', () => {
  assert.throws(() => deriveVariant(source(), 'in-update'), /db, in-create, patch-guard, out/);
});

test('nested readOnly rejected with its path', () => {
  const s = source();
  s.properties.place.properties.basis.readOnly = true;
  assert.throws(() => deriveVariant(s, 'db'), /place\.properties\.basis/);
});

test('ids and root strictness per variant', () => {
  for (const v of ['db', 'in-create', 'out']) {
    const d = deriveVariant(resolved(), v);
    assert.equal(d.$id, `https://pbdb2.example.com/schemas/thing.${v}.json`);
    assert.equal(d.unevaluatedProperties, false);
  }
});

test('db: x-storage removed and pruned from required; readOnly-only kept; x-create dropped', () => {
  const d = deriveVariant(resolved(), 'db');
  assert.deepEqual(Object.keys(d.properties), ['legacyIDs', 'name', 'kind', 'unit', 'place']);
  assert.deepEqual(Object.keys(d.properties.place.properties), ['basis']);
  assert.deepEqual(d.required, ['name']);
  assert.deepEqual(d.properties.place.required, ['basis']);
  assert.equal(JSON.stringify(d).includes('x-create'), false);
  const validate = compile('db');
  assert.equal(validate({ name: 'n', legacyIDs: { oldpbdbID: '1' }, place: { basis: 'x' } }), true);
  assert.equal(validate({ name: 'n', permid: 'p' }), false);
  assert.equal(validate({ name: 'n', kind: 'zzz' }), false);
});

test('in-create: readOnly removed and rejected; x-create merged', () => {
  const d = deriveVariant(resolved(), 'in-create');
  assert.equal('permid' in d.properties, false);
  assert.equal('legacyIDs' in d.properties, false);
  assert.deepEqual(d.required, ['name']);
  const validate = compile('in-create');
  const ok = { name: 'n', place: { basis: 'x', lat: 1, lng: 2 } };
  assert.equal(validate(ok), true);
  assert.equal(validate({ ...ok, legacyIDs: {} }), false);
  assert.equal(validate({ name: 'n' }), false, 'root x-create requires place');
  assert.equal(validate({ name: 'n', place: { basis: 'x', lat: 1 } }), false, 'nested x-create requires lng');
});

test('out: everything kept, dictionary enums not enforced, inline enums kept', () => {
  const d = deriveVariant(resolved(), 'out');
  assert.ok(d.properties.permid && d.properties.place.properties.lat);
  assert.equal('enum' in d.properties.kind, false);
  assert.deepEqual(d.properties.kind['x-enumFrom'], { table: 'kinds', column: 'name' });
  assert.deepEqual(d.properties.unit.enum, ['meters', 'feet']);
  assert.deepEqual(d.required, ['name', 'permid']);
  assert.equal(compile('out')({ name: 'n', permid: 'p', kind: 'removed later', place: { basis: 'x', lat: 1 } }), true);
});

test('patch-guard: object without readOnly keys', () => {
  const validate = compile('patch-guard');
  assert.equal(validate({ place: { lat: 1, lng: 2 }, name: null }), true);
  assert.equal(validate({ legacyIDs: { oldpbdbID: '1' } }), false);
  assert.equal(validate({ permid: 'x' }), false);
  assert.equal(validate([]), false);
  assert.equal(validate('x'), false);
});

test('patch-guard omits propertyNames without readOnly properties', () => {
  const s = source();
  delete s.properties.permid;
  delete s.properties.legacyIDs;
  s.required = ['name'];
  const g = deriveVariant(s, 'patch-guard');
  assert.equal('propertyNames' in g, false);
  assert.equal(g.type, 'object');
});
