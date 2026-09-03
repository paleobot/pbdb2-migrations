// Exercises the pbot-schemas summary parser in src/run-migrations.js against the
// real output shape of migrate-pbot-schemas.js (lines 591-595 of that script).
import { parsePbotSchemasSummary } from '../run-migrations.js';

const CLEAN = `
  === Migration Summary ===
  Schemas:    fetched=10, inserted=10, skipped=0
  Additional refs: inserted=1
  Characters: fetched=301, inserted=301, orphans=0, skipped=0
  States:     fetched=1183, inserted=1183, orphans=0, skipped=0
[2026-09-03T00:00:00.000Z] Migration complete in 12.3s
`;

// The failure documented in move-pbot-schemas-migration-to-src: exit 0, 5 of 8.
const SKIPPED = `
  WARNING: Skipping schema aeef6256 — no enterer resolved
  === Migration Summary ===
  Schemas:    fetched=8, inserted=5, skipped=3
  Additional refs: inserted=1
  Characters: fetched=336, inserted=168, orphans=0, skipped=168
  States:     fetched=1326, inserted=797, orphans=0, skipped=529
[2026-09-03T00:00:00.000Z] Migration complete in 9.9s
`;

const ORPHANS = `
  === Migration Summary ===
  Schemas:    fetched=10, inserted=10, skipped=0
  Characters: fetched=301, inserted=301, orphans=4, skipped=0
  States:     fetched=1183, inserted=1183, orphans=7, skipped=0
`;

const TRUNCATED = `
  === Migration Summary ===
  Schemas:    fetched=10, inserted=10, skipped=0
`;

let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log(`  ok   ${label}`); }
  else { console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); failures++; }
}

const clean = parsePbotSchemasSummary(CLEAN);
check('clean run passes', clean.ok === true, clean.reason);
check('clean run parses counts', clean.parsed.States.inserted === 1183);

const skipped = parsePbotSchemasSummary(SKIPPED);
check('skipped run fails', skipped.ok === false);
check('skipped run names all three groups',
  /schemas=3/.test(skipped.reason) && /characters=168/.test(skipped.reason) && /states=529/.test(skipped.reason),
  skipped.reason);

const orphans = parsePbotSchemasSummary(ORPHANS);
check('orphans alone do not fail the step', orphans.ok === true, orphans.reason);
check('orphans are parsed for the log',
  orphans.parsed.Characters.orphans === 4 && orphans.parsed.States.orphans === 7);

const truncated = parsePbotSchemasSummary(TRUNCATED);
check('unparseable summary fails rather than implying zero', truncated.ok === false);
check('unparseable summary names what is missing',
  /Characters/.test(truncated.reason) && /States/.test(truncated.reason), truncated.reason);

const empty = parsePbotSchemasSummary('');
check('empty output fails', empty.ok === false, empty.reason);

console.log(failures === 0 ? '\nAll parser checks passed.' : `\n${failures} check(s) failed.`);
process.exitCode = failures === 0 ? 0 : 1;
