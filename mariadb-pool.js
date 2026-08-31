import 'dotenv/config';

import mysql from 'mysql2/promise';

const REQUIRED_VARS = ['MARIADB_HOST', 'MARIADB_USER', 'MARIADB_PASSWORD', 'MARIADB_DATABASE'];
const missing = REQUIRED_VARS.filter((v) => !process.env[v]);
if (missing.length > 0) {
  console.error(`Missing required .env variables: ${missing.join(', ')}`);
  process.exit(1);
}

const mariadb = mysql.createPool({
  host: process.env.MARIADB_HOST,
  port: parseInt(process.env.MARIADB_PORT || '3306', 10),
  user: process.env.MARIADB_USER,
  password: process.env.MARIADB_PASSWORD,
  database: process.env.MARIADB_DATABASE,
  waitForConnections: true,
  connectionLimit: 5,
});

async function closeMariadb() {
  await mariadb.end();
}

export { mariadb, closeMariadb };
