import 'dotenv/config';

import { readFileSync } from 'fs';
import { Pool } from 'pg';

// READ-ONLY: this points at a shared remote database (pbdb2_migration_test).
// The credentials carry write access, but nothing in this codebase should ever
// write to it -- treat it strictly as a source to read already-migrated
// reference data from. queryReadOnly() below is the only sanctioned way to hit
// it; it rejects anything that isn't a SELECT/WITH/EXPLAIN/SHOW statement.
const REQUIRED_VARS = [
  'PG_MIGRATED_HOST',
  'PG_MIGRATED_USER',
  'PG_MIGRATED_PASSWORD',
  'PG_MIGRATED_DATABASE',
];
const missing = REQUIRED_VARS.filter((v) => !process.env[v]);
if (missing.length > 0) {
  console.error(`Missing required .env variables: ${missing.join(', ')}`);
  process.exit(1);
}

const pgMigratedSsl = process.env.PG_MIGRATED_CA_CERT
  ? { ca: readFileSync(process.env.PG_MIGRATED_CA_CERT) }
  : undefined;

const pgMigrated = new Pool({
  host: process.env.PG_MIGRATED_HOST,
  port: parseInt(process.env.PG_MIGRATED_PORT || '5432', 10),
  user: process.env.PG_MIGRATED_USER,
  password: process.env.PG_MIGRATED_PASSWORD,
  database: process.env.PG_MIGRATED_DATABASE,
  max: 5,
  ssl: pgMigratedSsl,
});

const READ_ONLY_PATTERN = /^\s*(select|with|explain|show)\b/i;

// The only query entry point this module exposes for application code.
// Throws before ever reaching the network if the statement isn't read-only.
async function queryReadOnly(text, params) {
  const sql = typeof text === 'string' ? text : text?.text;
  if (!sql || !READ_ONLY_PATTERN.test(sql)) {
    throw new Error(
      `pg-migrated-pool: refusing non-read-only statement against pg_migrated (strictly read-only): ${String(sql).slice(0, 200)}`,
    );
  }
  return pgMigrated.query(text, params);
}

async function closePgMigrated() {
  await pgMigrated.end();
}

export { queryReadOnly as pgMigrated, closePgMigrated };
