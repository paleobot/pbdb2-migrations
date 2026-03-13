import 'dotenv/config';

const REQUIRED_VARS = [
  'MARIADB_HOST',
  'MARIADB_USER',
  'MARIADB_PASSWORD',
  'PG_HOST',
  'PG_USER',
  'PG_PASSWORD',
  'PG_DATABASE',
];

const missing = REQUIRED_VARS.filter((v) => !process.env[v]);
if (missing.length > 0) {
  console.error(`Missing required .env variables: ${missing.join(', ')}`);
  process.exit(1);
}

import mysql from 'mysql2/promise';
import { Pool } from 'pg';

const mariadb = mysql.createPool({
  host: process.env.MARIADB_HOST,
  port: parseInt(process.env.MARIADB_PORT || '3306', 10),
  user: process.env.MARIADB_USER,
  password: process.env.MARIADB_PASSWORD,
  database: process.env.MARIADB_DATABASE || 'pbdb_archive',
  waitForConnections: true,
  connectionLimit: 5,
});

const pg = new Pool({
  host: process.env.PG_HOST,
  port: parseInt(process.env.PG_PORT || '5432', 10),
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE,
  max: 5,
});

async function closeAll() {
  await mariadb.end();
  await pg.end();
}

export { mariadb, pg, closeAll };
