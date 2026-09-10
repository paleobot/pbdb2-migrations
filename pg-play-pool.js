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
  // This server doesn't support SSL at all (confirmed: pg throws "The server
  // does not support SSL connections" if `ssl` is set to anything truthy --
  // pg's `ssl` option means "require encryption," not "use it if offered,"
  // so there's no graceful fallback to reach for here). Plain connection.
});

async function closePgPlay() {
  await pgPlay.end();
}

export { pgPlay, closePgPlay };
