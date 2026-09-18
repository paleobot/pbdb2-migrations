import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { collectEnumSources, loadEnums, applyEnums, resolveEnums } from '../lib/enums.js';
import { createAjv } from '../lib/ajv.js';
import { pg } from '../../src/lib/pg-pool.js';

after(() => pg.end());

const source = () => ({
  type: 'object',
  properties: {
    institutionCode: { type: 'string', 'x-enumFrom': { table: 'institution_codes', column: 'code' } },
    modes: { type: 'array', items: { type: 'string', 'x-enumFrom': { table: 'preservation_modes', column: 'name' } } },
    other: { type: 'array', items: { type: 'string', 'x-enumFrom': { table: 'preservation_modes', column: 'name' } } },
    unit: { type: 'string', enum: ['meters', 'feet'] },
  },
});
const fixtures = new Map([
  ['institution_codes.code', ['none specified', 'AMNH']],
  ['preservation_modes.name', ['body', 'cast']],
]);

test('collects distinct pairs', () => {
  assert.deepEqual(collectEnumSources(source()), [
    { table: 'institution_codes', column: 'code' },
    { table: 'preservation_modes', column: 'name' },
  ]);
});

test('applyEnums fills markers, keeps x-enumFrom, leaves inline enums, compiles', () => {
  const src = source();
  const resolved = applyEnums(src, fixtures);
  assert.deepEqual(resolved.properties.institutionCode.enum, ['none specified', 'AMNH']);
  assert.deepEqual(resolved.properties.institutionCode['x-enumFrom'], { table: 'institution_codes', column: 'code' });
  assert.deepEqual(resolved.properties.modes.items.enum, resolved.properties.other.items.enum);
  assert.deepEqual(resolved.properties.unit.enum, ['meters', 'feet']);
  assert.ok(createAjv().compile(resolved));
});

test('source object is not mutated', () => {
  const src = source();
  const before = structuredClone(src);
  applyEnums(src, fixtures);
  applyEnums(src, fixtures);
  assert.deepEqual(src, before);
  assert.equal('enum' in src.properties.institutionCode, false);
});

test('incomplete fixture map throws naming the pair', () => {
  assert.throws(() => applyEnums(source(), new Map([['institution_codes.code', ['x']]])), /preservation_modes\.name/);
});

test('empty enum throws naming the pair', () => {
  const m = new Map(fixtures);
  m.set('preservation_modes.name', []);
  assert.throws(() => applyEnums(source(), m), /dictionaries\.preservation_modes\.name is empty/);
});

test('unsafe or schema-qualified identifiers rejected', () => {
  for (const ann of [{ table: 'public.persons', column: 'x' }, { table: 'x', column: 'code; DROP TABLE x' }, { table: 'x' }, { table: 'x', column: 'y', where: 'z' }]) {
    assert.throws(() => collectEnumSources({ properties: { a: { type: 'string', 'x-enumFrom': ann } } }), /x-enumFrom/);
  }
});

test('marker alongside a literal enum throws', () => {
  assert.throws(
    () => collectEnumSources({ properties: { a: { type: 'string', enum: ['x'], 'x-enumFrom': { table: 't', column: 'c' } } } }),
    /literal enum/,
  );
});

test('refuses a derived variant', () => {
  assert.throws(() => applyEnums({ 'x-variant': 'out', properties: {} }, fixtures), /resolve the source first/);
});

test('loadEnums reads in id order, one query per pair (real DB)', async () => {
  let queries = 0;
  const counting = { query: (...a) => { queries++; return pg.query(...a); } };
  const map = await loadEnums(counting, collectEnumSources(source()));
  assert.equal(queries, 2);
  assert.equal(map.get('institution_codes.code')[0], 'none specified');
  assert.equal(map.get('preservation_modes.name').length, 37);
});

test('missing table throws naming it (real DB)', async () => {
  await assert.rejects(
    resolveEnums(pg, { properties: { a: { type: 'string', 'x-enumFrom': { table: 'no_such_table', column: 'name' } } } }),
    /dictionaries\.no_such_table\.name/,
  );
});
