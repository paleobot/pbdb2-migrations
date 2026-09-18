// Seed fidelity: each x-enumFrom dictionary table must hold exactly the values
// its schema enum held before the move, in the same order (see
// openspec/specs/payload-schema-enums/spec.md). Needs a database built from
// postgresql/create_new.sql.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pg } from '../../src/lib/pg-pool.js';

const legacy = JSON.parse(readFileSync(new URL('./fixtures/legacy-enums.json', import.meta.url), 'utf8'));

after(() => pg.end());

for (const [key, expected] of Object.entries(legacy)) {
  const [table, column] = key.split('.');
  test(`dictionaries.${key} matches the legacy enum`, async () => {
    const { rows } = await pg.query(`SELECT "${column}" AS v FROM dictionaries."${table}" ORDER BY id`);
    assert.deepEqual(rows.map((r) => r.v), expected);
  });
}
