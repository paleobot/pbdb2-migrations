// The real collection and specimen sources: every variant resolves and compiles
// in strict mode, and the variant rules hold on them. DB-free (fixture enums).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as collectionModule from '../collection.schema.js';
import * as specimenModule from '../specimen.schema.js';
import { applyEnums } from '../lib/enums.js';
import { deriveVariant, VARIANTS } from '../lib/variants.js';
import { createAjv } from '../lib/ajv.js';

const legacy = JSON.parse(readFileSync(new URL('./fixtures/legacy-enums.json', import.meta.url), 'utf8'));
const specimenExample = JSON.parse(readFileSync(new URL('./fixtures/specimen-example.json', import.meta.url), 'utf8'));
const enums = new Map(Object.entries(legacy));
enums.set('admin0.iso', ['US', 'CN', 'RU', 'AU', 'CA', 'FR']);
enums.set('admin1.iso', ['US-MT', 'CA-AB']);
enums.set('maritime.iho_name', ['Arctic Ocean']);

const sources = { collection: collectionModule.collectionSource, specimen: specimenModule.specimenSource };
const compile = (entity, variant) => createAjv().compile(deriveVariant(applyEnums(sources[entity], enums), variant));

test('modules export only the annotated source', () => {
  assert.deepEqual(Object.keys(collectionModule).sort(), ['collectionSource', 'default']);
  assert.deepEqual(Object.keys(specimenModule).sort(), ['default', 'specimenSource']);
});

test('every variant of both entities compiles in strict mode', () => {
  for (const entity of Object.keys(sources)) for (const v of VARIANTS) assert.ok(compile(entity, v), `${entity}.${v}`);
});

const createCollection = (administrativeArea) => ({
  name: 'c',
  context: {},
  references: [{ referenceID: '1', order: '1' }],
  location: {
    toponym: { administrativeArea },
    coordinates: { latitude: 1, longitude: 2 },
    scale: 'outcrop',
  },
});

test('in-create: admin1 required for listed countries only', () => {
  const validate = compile('collection', 'in-create');
  assert.equal(validate(createCollection({ admin0: 'CA' })), false);
  assert.ok(validate.errors.some((e) => e.params?.missingProperty === 'admin1'));
  assert.equal(validate(createCollection({ admin0: 'CA', admin1: 'CA-AB' })), true, JSON.stringify(validate.errors));
  assert.equal(validate(createCollection({ admin0: 'FR' })), true, JSON.stringify(validate.errors));
});

test('in-create: coordinates, references and context required', () => {
  const validate = compile('collection', 'in-create');
  const c = createCollection({ admin0: 'FR' });
  delete c.location.coordinates.longitude;
  assert.equal(validate(c), false);
  const { references, ...noRefs } = createCollection({ admin0: 'FR' });
  assert.equal(validate(noRefs), false);
});

test('in-create rejects read-only fields', () => {
  const validate = compile('collection', 'in-create');
  assert.equal(validate({ ...createCollection({ admin0: 'FR' }), permid: 'x' }), false);
  assert.equal(validate({ ...createCollection({ admin0: 'FR' }), legacyIDs: { oldpbdbID: '1' } }), false);
});

test('db: legacy-shaped row passes; top-level permid fails; admin1 rule absent', () => {
  const validate = compile('collection', 'db');
  const row = {
    name: 'c',
    legacyIDs: { oldpbdbID: '1' },
    location: { toponym: { administrativeArea: { admin0: 'US' } }, coordinates: { basis: 'estimated from map' }, scale: 'unspecified' },
  };
  assert.equal(validate(row), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...row, permid: 'x' }), false);
  // Nested objects don't reject unknown keys yet (design non-goal), so check the
  // stored-elsewhere coordinates are absent from the db schema itself.
  const coords = deriveVariant(applyEnums(sources.collection, enums), 'db').properties.location.properties.coordinates;
  assert.deepEqual(Object.keys(coords.properties), ['basis', 'altitude']);
  assert.equal('allOf' in coords, false, 'x-create not merged into db');
});

test('patch-guard on the real sources', () => {
  for (const entity of Object.keys(sources)) {
    const validate = compile(entity, 'patch-guard');
    assert.equal(validate({ notes: null, name: 'x' }), true);
    assert.equal(validate({ legacyIDs: { oldpbdbID: '1' } }), false);
    assert.equal(validate({ permid: 'x' }), false);
    assert.equal(validate([]), false);
  }
  assert.equal(compile('collection', 'patch-guard')({ location: { coordinates: { latitude: 10, longitude: 20 } } }), true);
});

test('specimen example is a valid stored payload', () => {
  const validate = compile('specimen', 'db');
  assert.equal(validate(specimenExample), true, JSON.stringify(validate.errors));
});
