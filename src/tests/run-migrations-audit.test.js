// Audit scoping in src/run-migrations.js: the audit covers only the audited
// entities whose tables the selected steps write.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditEntitiesFor, stepsByName, parseAuditSummary } from '../run-migrations.js';

const ALL = ['persons', 'pbot-persons', 'refs', 'pbot-refs', 'pbot-schemas', 'authorities',
  'authority-opinions', 'opinions', 'collections', 'specimens'];

test('full run audits every entity', () => {
  assert.deepEqual(auditEntitiesFor(stepsByName(ALL)), ['collection', 'specimen', 'person', 'reference', 'authority']);
});

test('--from collections audits both', () => {
  assert.deepEqual(auditEntitiesFor(stepsByName(['collections', 'specimens'])), ['collection', 'specimen']);
});

test('--only specimens audits specimen only', () => {
  assert.deepEqual(auditEntitiesFor(stepsByName(['specimens'])), ['specimen']);
});

test('the person steps audit person', () => {
  // persons became an audited table when person.schema.js was converted; both
  // steps that write it now pull the person entity into the audit's scope.
  assert.deepEqual(auditEntitiesFor(stepsByName(['persons'])), ['person']);
  assert.deepEqual(auditEntitiesFor(stepsByName(['pbot-persons'])), ['person']);
});

test('the refs steps audit reference', () => {
  assert.deepEqual(auditEntitiesFor(stepsByName(['refs'])), ['reference']);
  assert.deepEqual(auditEntitiesFor(stepsByName(['pbot-refs'])), ['reference']);
});

test('the authorities step audits authority', () => {
  assert.deepEqual(auditEntitiesFor(stepsByName(['authorities'])), ['authority']);
});

test('a step writing no audited table audits nothing', () => {
  assert.deepEqual(auditEntitiesFor(stepsByName(['authority-opinions'])), []);
});

test('summary lines are parsed per entity', () => {
  const stdout = 'noise\naudit collection: checked=275554 violations=0\naudit specimen: checked=167150 violations=3\n';
  assert.deepEqual(parseAuditSummary(stdout), {
    collection: { checked: 275554, violations: 0 },
    specimen: { checked: 167150, violations: 3 },
  });
});
