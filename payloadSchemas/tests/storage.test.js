import { test } from 'node:test';
import assert from 'node:assert/strict';
import { split, merge, collectCodecSources, loadCodecContext, isDictionarySource } from '../lib/storage.js';
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

// Reference permids stand in as short strings; ids are strings, as node-postgres
// returns a bigint. Built as a loaded context would be: from head rows only.
const refsContext = (heads) => new Map([['refs', {
  byKey: new Map(heads.map(([id, permid]) => [id, permid])),
  byValue: new Map(heads.map(([id, permid]) => [permid, id])),
}]]);
const refs = refsContext([['3', 'r-3'], ['7', 'r-7'], ['9', 'r-9'], ['12', 'r-12'], ['1', 'r-1'], ['2', 'r-2']]);

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
    references: [{ referenceID: 'r-12', order: '2' }, { referenceID: 'r-7', order: '1' }],
  }, refs);
  assert.equal(columns.reference_id, '7');
  assert.deepEqual(children.additional_collection_refs, [{ reference_id: '12' }]);
  assert.equal('references' in jsonb, false);
});

test('reference order normalized on round trip', () => {
  const parts = split(source, { name: 'n', references: [{ referenceID: 'r-3', order: '1' }, { referenceID: 'r-9', order: '5' }] }, refs);
  parts.children.additional_collection_refs = parts.children.additional_collection_refs.map((r, i) => ({ id: String(100 + i), ...r }));
  assert.deepEqual(merge(source, parts, refs).references, [{ referenceID: 'r-3', order: '1' }, { referenceID: 'r-9', order: '2' }]);
});

test('merge rebuilds coordinates from GeoJSON, creating missing objects', () => {
  const merged = merge(source, {
    jsonb: { name: 'n' },
    columns: { location: { type: 'Point', coordinates: [-110.25, 45.5] }, permid: 'p', reference_id: '7' },
    children: { additional_collection_refs: [] },
  }, refs);
  assert.deepEqual(merged, {
    name: 'n',
    permid: 'p',
    location: { coordinates: { latitude: 45.5, longitude: -110.25 } },
    references: [{ referenceID: 'r-7', order: '1' }],
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
    { name: 'a', references: [{ referenceID: 'r-1', order: '1' }] },
    { name: 'b', location: { coordinates: { latitude: 1, longitude: 2 } }, references: [{ referenceID: 'r-1', order: '1' }, { referenceID: 'r-2', order: '2' }] },
    { name: 'c', location: { coordinates: { latitude: 1, longitude: 2, basis: 'x' }, scale: 's' }, references: [] },
  ];
  for (const p of payloads) {
    assert.equal(inCreate(p), true, JSON.stringify(inCreate.errors));
    assert.equal(db(split(source, p, refs).jsonb), true, JSON.stringify(db.errors));
  }
});

test('collectionReferences merges stored ids to permids, and no refs.id reaches the payload', () => {
  const merged = merge(source, {
    jsonb: { name: 'n' },
    columns: { reference_id: '7' },
    children: { additional_collection_refs: [{ id: '501', reference_id: '12' }] },
  }, refs);
  assert.deepEqual(merged.references, [{ referenceID: 'r-7', order: '1' }, { referenceID: 'r-12', order: '2' }]);
});

test('collectionReferences throws naming itself on an unknown permid or id', () => {
  assert.throws(
    () => split(source, { name: 'n', references: [{ referenceID: 'r-nobody', order: '1' }] }, refs),
    /collectionReferences: refs.permid has no entry for "r-nobody"/,
  );
  assert.throws(
    () => merge(source, { jsonb: {}, columns: { reference_id: '7' }, children: { additional_collection_refs: [{ id: '1', reference_id: '404' }] } }, refs),
    /collectionReferences: refs.id has no entry for "404"/,
  );
  assert.throws(() => split(source, { name: 'n', references: [{ referenceID: 'r-7', order: '1' }] }), /collectionReferences: no codec context loaded for refs/);
});

test('a superseded reference is never cited: its permid resolves to the head', async () => {
  // Ref 7 was edited: version 7 is superseded by 20, and both carry permid r-7.
  // The succession filter is what the database applies; the fake honours it.
  const rows = [
    { k: '7', v: 'r-7', succeeded_by_id: '20' },
    { k: '20', v: 'r-7', succeeded_by_id: null },
    { k: '12', v: 'r-12', succeeded_by_id: null },
  ];
  const fakePg = {
    async query(sql) {
      const heads = sql.includes('succeeded_by_id IS NULL');
      return { rows: rows.filter((r) => !heads || r.succeeded_by_id === null) };
    },
  };
  const ctx = await loadCodecContext(fakePg, collectCodecSources(source));
  assert.equal(ctx.get('refs').byValue.get('r-7'), '20');
  assert.equal(ctx.get('refs').byKey.has('7'), false, 'the superseded row is in neither map');

  const { columns, children } = split(source, {
    name: 'n', references: [{ referenceID: 'r-7', order: '1' }, { referenceID: 'r-12', order: '2' }],
  }, ctx);
  assert.equal(columns.reference_id, '20');
  assert.deepEqual(children.additional_collection_refs, [{ reference_id: '12' }]);
  // A stored id naming a superseded row is a violated invariant, and says so.
  assert.throws(() => merge(source, { jsonb: {}, columns: { reference_id: '7' } }, ctx), /refs.id has no entry for "7"/);
});

// ---------- Codec context ----------
// A source shaped like person's column-backed half. The codecs resolve against a
// hand-built Map: split and merge do no I/O, so no database is involved.

const personish = {
  $id: 'https://pbdb2.example.com/schemas/personish.json',
  type: 'object',
  properties: {
    permid: { type: 'string', readOnly: true, 'x-storage': { column: 'permid' } },
    familyName: { type: 'string' },
    role: {
      type: 'string',
      'x-enumFrom': { table: 'roles', column: 'name' },
      'x-storage': { column: 'role_id', codec: 'roleName' },
    },
    authorizer: { type: 'string', 'x-storage': { column: 'authorizer_person_id', codec: 'personPermid' } },
  },
  unevaluatedProperties: false,
};

const fixtureContext = new Map([
  ['dictionaries.roles', {
    byKey: new Map([[3, 'Authorizer'], [6, 'Person']]),
    byValue: new Map([['Authorizer', 3], ['Person', 6]]),
  }],
  ['persons', {
    byKey: new Map([[1106, 'p-1106']]),
    byValue: new Map([['p-1106', 1106]]),
  }],
]);

test('collectCodecSources unions what the codecs declare, once each', () => {
  assert.deepEqual(collectCodecSources(personish), [
    { table: 'dictionaries.roles', key: 'id', value: 'name' },
    { table: 'persons', key: 'id', value: 'permid' },
  ]);
  assert.deepEqual(collectCodecSources(source), [{ table: 'refs', key: 'id', value: 'permid', versioned: true }]);
});

test('collectCodecSources rejects an x-enumFrom that disagrees with the codec', () => {
  const bad = structuredClone(personish);
  bad.properties.role['x-enumFrom'] = { table: 'genders', column: 'name' };
  assert.throws(() => collectCodecSources(bad), /role: x-enumFrom names dictionaries.genders but codec 'roleName' reads dictionaries.roles/);
});

test('roleName and personPermid resolve both directions from a fixture map', () => {
  const { jsonb, columns } = split(
    personish,
    { familyName: 'f', role: 'Authorizer', authorizer: 'p-1106' },
    fixtureContext,
  );
  assert.deepEqual(jsonb, { familyName: 'f' });
  assert.equal(columns.role_id, 3);
  assert.equal(columns.authorizer_person_id, 1106);

  const merged = merge(
    personish,
    { jsonb: { familyName: 'f' }, columns: { role_id: 6, authorizer_person_id: 1106, permid: 'x' } },
    fixtureContext,
  );
  assert.deepEqual(merged, { familyName: 'f', permid: 'x', role: 'Person', authorizer: 'p-1106' });
});

test('an absent role or authorizer emits no column', () => {
  const { columns } = split(personish, { familyName: 'f' }, fixtureContext);
  assert.deepEqual(columns, {});
});

test('an unresolved value throws naming the codec and the value', () => {
  assert.throws(
    () => split(personish, { role: 'Curator' }, fixtureContext),
    /roleName: dictionaries.roles.name has no entry for "Curator"/,
  );
  assert.throws(
    () => split(personish, { authorizer: 'p-nobody' }, fixtureContext),
    /personPermid: persons.permid has no entry for "p-nobody"/,
  );
  assert.throws(
    () => merge(personish, { jsonb: {}, columns: { role_id: 99 } }, fixtureContext),
    /roleName: dictionaries.roles.id has no entry for 99/,
  );
});

test('no context at all throws rather than dropping the property', () => {
  assert.throws(() => split(personish, { role: 'Person' }), /roleName: no codec context loaded for dictionaries.roles/);
  assert.throws(
    () => merge(personish, { jsonb: {}, columns: { authorizer_person_id: 1106 } }),
    /personPermid: no codec context loaded for persons/,
  );
});

test('loadCodecContext reads dictionaries in full and restricts entity sources', async () => {
  const issued = [];
  const fakePg = {
    async query(sql, params) {
      issued.push({ sql, params });
      if (sql.includes('roles')) return { rows: [{ k: 3, v: 'Authorizer' }, { k: 6, v: 'Person' }] };
      return { rows: [{ k: 1106, v: 'p-1106' }] };
    },
  };
  const sources = collectCodecSources(personish);
  const ctx = await loadCodecContext(fakePg, sources, {
    'dictionaries.roles': { column: 'id', values: [3] },  // ignored: dictionaries are never batched
    persons: { column: 'id', values: [1106] },
  });
  assert.equal(issued[0].sql.includes('WHERE'), false, 'dictionary source read in full');
  assert.match(issued[1].sql, /FROM "persons" WHERE "id" = ANY\(\$1\)/);
  assert.deepEqual(issued[1].params, [[1106]]);
  // One read fills both directions.
  assert.equal(ctx.get('persons').byKey.get(1106), 'p-1106');
  assert.equal(ctx.get('persons').byValue.get('p-1106'), 1106);
  assert.equal(ctx.get('dictionaries.roles').byValue.get('Person'), 6);

  // The restriction may run in the value direction, which is what split needs.
  issued.length = 0;
  await loadCodecContext(fakePg, sources, { persons: { column: 'permid', values: ['p-1106'] } });
  assert.match(issued[1].sql, /WHERE "permid" = ANY\(\$1\)/);

  await assert.rejects(
    () => loadCodecContext(fakePg, sources, { persons: { column: 'person', values: [] } }),
    /can be restricted on id or permid, not person/,
  );
});

test('a reused context is not re-read, and each call returns a fresh Map', async () => {
  let reads = 0;
  const fakePg = { async query() { reads++; return { rows: [{ k: 6, v: 'Person' }] }; } };
  const sources = collectCodecSources(personish);
  const dicts = sources.filter(isDictionarySource);
  const entities = sources.filter((s) => !isDictionarySource(s));

  const runCtx = await loadCodecContext(fakePg, dicts);           // once for the run
  assert.equal(reads, 1);
  const batch1 = await loadCodecContext(fakePg, entities, { persons: { column: 'id', values: [6] } }, runCtx);
  const batch2 = await loadCodecContext(fakePg, entities, { persons: { column: 'id', values: [6] } }, runCtx);
  assert.equal(reads, 3, 'the dictionary was not re-read per batch');
  assert.ok(batch1.has('dictionaries.roles') && batch2.has('dictionaries.roles'));
  assert.notEqual(batch1, batch2);
  assert.equal(runCtx.has('persons'), false, 'a batch does not accumulate into the run context');
});

test('a versioned source is read from heads only, alone or with a selection', async () => {
  const issued = [];
  const fakePg = { async query(sql, params) { issued.push({ sql, params }); return { rows: [] }; } };
  const refsSource = { table: 'refs', key: 'id', value: 'permid', versioned: true };
  const personsSource = { table: 'persons', key: 'id', value: 'permid' };

  await loadCodecContext(fakePg, [refsSource, personsSource]);
  assert.equal(issued[0].sql, 'SELECT "id" AS k, "permid" AS v FROM "refs" WHERE succeeded_by_id IS NULL');
  assert.equal(issued[1].sql.includes('succeeded_by_id'), false, 'an unversioned source is not filtered');

  issued.length = 0;
  await loadCodecContext(fakePg, [refsSource], { refs: { column: 'permid', values: ['r-7'] } });
  assert.match(issued[0].sql, /WHERE succeeded_by_id IS NULL AND "permid" = ANY\(\$1\)$/);
  assert.deepEqual(issued[0].params, [['r-7']]);

  await assert.rejects(
    () => loadCodecContext(fakePg, [{ ...refsSource, versioned: 'yes' }]),
    /versioned flag, when given, must be true/,
  );
});
