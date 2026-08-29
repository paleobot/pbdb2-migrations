import 'dotenv/config';

import { Pool } from 'pg';

const REQUIRED_VARS = ['PG_PLAY_HOST', 'PG_PLAY_USER', 'PG_PLAY_DATABASE'];
const missing = REQUIRED_VARS.filter((v) => !process.env[v]);
if (missing.length > 0) {
  console.error(`Missing required .env variables: ${missing.join(', ')}`);
  process.exit(1);
}

const pgPlay = new Pool({
  host: process.env.PG_PLAY_HOST,
  port: parseInt(process.env.PG_PLAY_PORT || '5432', 10),
  user: process.env.PG_PLAY_USER,
  password: process.env.PG_PLAY_PASSWORD,
  database: process.env.PG_PLAY_DATABASE,
  max: 5,
});

async function closePgPlay() {
  await pgPlay.end();
}

export { pgPlay, closePgPlay };
