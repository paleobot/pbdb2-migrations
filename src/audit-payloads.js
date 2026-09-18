// Audits stored jsonb payloads against the db variant of their annotated source
// (payloadSchemas/), with enums resolved from dictionaries. Every row is checked,
// superseded versions included. --round-trip additionally rebuilds each head row's
// API shape (merge), validates it against the out variant, splits it back and
// compares with what is stored. See openspec/specs/payload-audit/spec.md.
//
//   node src/audit-payloads.js [--entity <name>]... [--sample <n>] [--round-trip]
//
// Writes src/audit-payloads.log (the latest report) and prints one summary line
// per entity, `audit <entity>: checked=<n> violations=<n>`, which the migration
// runner parses. Exit 0 clean, 1 on any violation, 2 on usage or resolution errors.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { collectionSource } from '../payloadSchemas/collection.schema.js';
import { specimenSource } from '../payloadSchemas/specimen.schema.js';
import { resolveEnums } from '../payloadSchemas/lib/enums.js';
import { deriveVariant } from '../payloadSchemas/lib/variants.js';
import { createAjv } from '../payloadSchemas/lib/ajv.js';
import { split, merge } from '../payloadSchemas/lib/storage.js';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPORT_PATH = join(SCRIPT_DIR, 'audit-payloads.log');
const BATCH_SIZE = 5000;

// `columns` are the extra selections the round trip needs to rebuild the API
// shape; `children` are child tables keyed back to the row by `fk`.
export const REGISTRY = [
  {
    entity: 'collection',
    table: 'collections',
    column: 'collection',
    source: collectionSource,
    columns: ['permid', 'reference_id', 'ST_AsGeoJSON(location)::json AS location'],
    children: [{ table: 'additional_collection_refs', fk: 'collection_id', columns: ['id', 'reference_id'] }],
  },
  {
    entity: 'specimen',
    table: 'specimens',
    column: 'specimen',
    source: specimenSource,
    columns: ['permid'],
    children: [],
  },
];

export class UsageError extends Error {}

export function parseArgs(argv) {
  const known = REGISTRY.map((r) => r.entity);
  const opts = { entities: [], sample: 10, roundTrip: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--round-trip') opts.roundTrip = true;
    else if (arg === '--entity' || arg === '--sample') {
      const value = argv[++i];
      if (value === undefined) throw new UsageError(`${arg} needs a value`);
      if (arg === '--sample') {
        opts.sample = Number(value);
        if (!Number.isInteger(opts.sample) || opts.sample < 0) throw new UsageError(`--sample must be a non-negative integer, got ${value}`);
      } else {
        if (!known.includes(value)) throw new UsageError(`Unknown entity '${value}'; valid: ${known.join(', ')}`);
        if (!opts.entities.includes(value)) opts.entities.push(value);
      }
    } else throw new UsageError(`Unknown argument '${arg}'`);
  }
  if (opts.entities.length === 0) opts.entities = known;
  return opts;
}

const rootReadOnly = (source) =>
  Object.entries(source.properties).filter(([, p]) => p.readOnly).map(([n]) => n);

const withoutKeys = (obj, keys) => Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)));

// Compare a split result with the stored row, after codec normalization.
export function roundTripDifferences(entry, row, parts, childRows) {
  const diffs = [];
  const readOnly = rootReadOnly(entry.source);
  if (!isDeepStrictEqual(parts.jsonb, withoutKeys(row.payload, readOnly))) diffs.push('jsonb');
  for (const [col, value] of Object.entries(parts.columns)) {
    const stored = row[col] ?? null;
    if (col === 'location') {
      const got = value === null ? null : value.match(/POINT\(([^ ]+) ([^)]+)\)/).slice(1).map(Number);
      const want = stored === null ? null : stored.coordinates;
      if (!isDeepStrictEqual(got, want)) diffs.push(col);
    } else if (String(value ?? '') !== String(stored ?? '')) diffs.push(col);
  }
  for (const child of entry.children) {
    const got = (parts.children[child.table] ?? []).map((r) => String(r.reference_id));
    const want = (childRows[child.table] ?? []).map((r) => String(r.reference_id));
    if (!isDeepStrictEqual(got, want)) diffs.push(child.table);
  }
  return diffs;
}

async function auditEntity(pg, entry, opts) {
  const resolved = await resolveEnums(pg, entry.source);
  const ajv = createAjv();
  const validateDb = ajv.compile(deriveVariant(resolved, 'db'));
  const validateOut = opts.roundTrip ? ajv.compile(deriveVariant(resolved, 'out')) : null;
  const readOnly = rootReadOnly(entry.source);

  const result = {
    entity: entry.entity, table: entry.table,
    heads: 0, superseded: 0, violations: 0, violationsHeads: 0, violationsSuperseded: 0, sample: [],
    roundTrip: opts.roundTrip ? { checked: 0, differences: 0, sample: [] } : null,
  };
  const extra = opts.roundTrip ? entry.columns.map((c) => `, ${c}`).join('') : '';
  let lastId = 0;
  for (;;) {
    const { rows } = await pg.query(
      `SELECT id, permid AS row_permid, succeeded_by_id IS NULL AS head, ${entry.column} AS payload${extra}
         FROM ${entry.table} WHERE id > $1 ORDER BY id LIMIT $2`,
      [lastId, BATCH_SIZE],
    );
    if (rows.length === 0) break;
    lastId = rows[rows.length - 1].id;

    const children = {};
    if (opts.roundTrip) {
      const ids = rows.filter((r) => r.head).map((r) => r.id);
      for (const child of entry.children) {
        const { rows: childRows } = await pg.query(
          `SELECT ${child.fk} AS parent, ${child.columns.join(', ')} FROM ${child.table}
            WHERE ${child.fk} = ANY($1) ORDER BY id`,
          [ids],
        );
        const byParent = new Map();
        for (const r of childRows) {
          if (!byParent.has(r.parent)) byParent.set(r.parent, []);
          byParent.get(r.parent).push(r);
        }
        children[child.table] = byParent;
      }
    }

    for (const row of rows) {
      if (row.head) result.heads++;
      else result.superseded++;
      if (!validateDb(row.payload)) {
        result.violations++;
        if (row.head) result.violationsHeads++;
        else result.violationsSuperseded++;
        if (result.sample.length < opts.sample) {
          result.sample.push({ id: row.id, permid: row.row_permid, head: row.head, errors: validateDb.errors });
        }
      }
      if (!opts.roundTrip || !row.head) continue;

      result.roundTrip.checked++;
      const childRows = Object.fromEntries(entry.children.map((c) => [c.table, children[c.table].get(row.id) ?? []]));
      const stored = { jsonb: row.payload, columns: row, children: childRows };
      const diffs = [];
      const merged = merge(entry.source, stored);
      if (!validateOut(merged)) diffs.push(`out: ${ajv.errorsText(validateOut.errors)}`);
      try {
        diffs.push(...roundTripDifferences(entry, row, split(entry.source, withoutKeys(merged, readOnly)), childRows));
      } catch (err) {
        diffs.push(`split: ${err.message}`);
      }
      if (diffs.length) {
        result.roundTrip.differences++;
        if (result.roundTrip.sample.length < opts.sample) {
          result.roundTrip.sample.push({ id: row.id, permid: row.row_permid, differences: diffs });
        }
      }
    }
  }
  return result;
}

function formatReport(startedAt, opts, results) {
  const lines = [`payload audit ${startedAt.toISOString()}  entities=${opts.entities.join(',')}${opts.roundTrip ? '  --round-trip' : ''}`];
  for (const r of results) {
    lines.push('', `== ${r.entity} (${r.table})`);
    lines.push(`   rows checked ${r.heads + r.superseded} (heads ${r.heads}, superseded ${r.superseded})`);
    lines.push(`   violations   ${r.violations} (heads ${r.violationsHeads}, superseded ${r.violationsSuperseded})`);
    for (const s of r.sample) {
      lines.push(`   - id=${s.id} permid=${s.permid}${s.head ? '' : ' (superseded)'}`);
      for (const e of s.errors) lines.push(`       ${e.instancePath || '/'} ${e.message}${e.params?.allowedValues ? '' : ` ${JSON.stringify(e.params)}`}`);
    }
    if (r.roundTrip) {
      lines.push(`   round trip   ${r.roundTrip.checked} head rows, ${r.roundTrip.differences} with differences`);
      for (const s of r.roundTrip.sample) lines.push(`   - id=${s.id} permid=${s.permid}: ${s.differences.join('; ')}`);
    }
  }
  lines.push('');
  for (const r of results) {
    const violations = r.violations + (r.roundTrip?.differences ?? 0);
    lines.push(`audit ${r.entity}: checked=${r.heads + r.superseded} violations=${violations}`);
  }
  return lines.join('\n') + '\n';
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  const startedAt = new Date();
  const { pg } = await import('./lib/pg-pool.js');
  let results;
  try {
    results = [];
    for (const entity of opts.entities) {
      results.push(await auditEntity(pg, REGISTRY.find((r) => r.entity === entity), opts));
    }
  } catch (err) {
    console.error(`audit failed: ${err.message}`);
    await pg.end();
    process.exit(2);
  }
  await pg.end();
  const report = formatReport(startedAt, opts, results);
  writeFileSync(REPORT_PATH, report);
  process.stdout.write(report);
  const bad = results.some((r) => r.violations > 0 || (r.roundTrip?.differences ?? 0) > 0);
  process.exit(bad ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
