import 'dotenv/config';

import { readFileSync } from 'fs';
import { Pool } from 'pg';

const REQUIRED_VARS = ['PG_HOST', 'PG_USER', 'PG_PASSWORD', 'PG_DATABASE'];
const missing = REQUIRED_VARS.filter((v) => !process.env[v]);
if (missing.length > 0) {
  console.error(`Missing required .env variables: ${missing.join(', ')}`);
  process.exit(1);
}

const pgSsl = process.env.PG_CA_CERT
  ? { ca: readFileSync(process.env.PG_CA_CERT) }
  : undefined;

const pg = new Pool({
  host: process.env.PG_HOST,
  port: parseInt(process.env.PG_PORT || '5432', 10),
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE,
  max: 5,
  ssl: pgSsl,
});

async function closePg() {
  await pg.end();
}

export { pg, closePg };
