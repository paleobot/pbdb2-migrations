import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, roundTripDifferences, REGISTRY, UsageError } from '../audit-payloads.js';

test('defaults to every entity', () => {
  assert.deepEqual(parseArgs([]), { entities: ['collection', 'specimen', 'person', 'reference', 'authority', 'schema', 'character', 'state'], sample: 10, roundTrip: false });
});

test('single and repeated --entity', () => {
  assert.deepEqual(parseArgs(['--entity', 'specimen']).entities, ['specimen']);
  assert.deepEqual(parseArgs(['--entity', 'collection', '--entity', 'specimen']).entities, ['collection', 'specimen']);
  assert.deepEqual(parseArgs(['--entity', 'specimen', '--entity', 'specimen']).entities, ['specimen']);
});

test('person, reference, authority, schema, character and state are valid entities', () => {
  assert.deepEqual(parseArgs(['--entity', 'person']).entities, ['person']);
  assert.deepEqual(parseArgs(['--entity', 'reference']).entities, ['reference']);
  assert.deepEqual(parseArgs(['--entity', 'authority']).entities, ['authority']);
  assert.deepEqual(parseArgs(['--entity', 'schema']).entities, ['schema']);
  assert.deepEqual(parseArgs(['--entity', 'character', '--entity', 'state']).entities, ['character', 'state']);
});

test('unknown entity lists the valid names', () => {
  assert.throws(
    () => parseArgs(['--entity', 'opinion']),
    (err) => err instanceof UsageError && /collection, specimen, person, reference, authority, schema, character, state/.test(err.message),
  );
});

test('the registry states whether each entity is versioned', () => {
  assert.deepEqual(
    REGISTRY.map((r) => [r.entity, r.versioned]),
    [['collection', true], ['specimen', true], ['person', false], ['reference', true], ['authority', true], ['schema', true], ['character', true], ['state', true]],
  );
});

test('--sample, --round-trip, and bad arguments', () => {
  assert.equal(parseArgs(['--sample', '3']).sample, 3);
  assert.equal(parseArgs(['--round-trip']).roundTrip, true);
  assert.throws(() => parseArgs(['--sample', 'x']), UsageError);
  assert.throws(() => parseArgs(['--entity']), UsageError);
  assert.throws(() => parseArgs(['--bogus']), UsageError);
});

test('round-trip comparison catches a codec that swaps coordinates', () => {
  const entry = REGISTRY.find((r) => r.entity === 'collection');
  const row = { payload: { name: 'n', legacyIDs: { oldpbdbID: '1' } }, reference_id: '7', location: { type: 'Point', coordinates: [-98.98, 31.17] } };
  const good = { jsonb: { name: 'n' }, columns: { reference_id: '7', location: 'SRID=4326;POINT(-98.98 31.17)' }, children: { additional_collection_refs: [] } };
  assert.deepEqual(roundTripDifferences(entry, row, good, { additional_collection_refs: [] }), []);
  const swapped = { ...good, columns: { ...good.columns, location: 'SRID=4326;POINT(31.17 -98.98)' } };
  assert.deepEqual(roundTripDifferences(entry, row, swapped, { additional_collection_refs: [] }), ['location']);
});
