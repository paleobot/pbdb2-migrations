import 'dotenv/config';

import { readFileSync } from 'fs';
import { Pool } from 'pg';

const REQUIRED_VARS = [
  'PG_CLASSIC_HOST',
  'PG_CLASSIC_USER',
  'PG_CLASSIC_PASSWORD',
  'PG_CLASSIC_DATABASE',
];
const missing = REQUIRED_VARS.filter((v) => !process.env[v]);
if (missing.length > 0) {
  console.error(`Missing required .env variables: ${missing.join(', ')}`);
  process.exit(1);
}

const pgClassicSsl = process.env.PG_CLASSIC_CA_CERT
  ? { ca: readFileSync(process.env.PG_CLASSIC_CA_CERT) }
  : undefined;

const pgClassic = new Pool({
  host: process.env.PG_CLASSIC_HOST,
  port: parseInt(process.env.PG_CLASSIC_PORT || '5432', 10),
  user: process.env.PG_CLASSIC_USER,
  password: process.env.PG_CLASSIC_PASSWORD,
  database: process.env.PG_CLASSIC_DATABASE,
  max: 5,
  ssl: pgClassicSsl,
});

async function closePgClassic() {
  await pgClassic.end();
}

export { pgClassic, closePgClassic };
