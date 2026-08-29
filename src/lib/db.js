// Simplified DB entry point for the standard src/ structure: exports
// { mariadb, pg, closeAll } built directly from the real localhost MARIADB_* /
// PG_* connections in .env. Unlike the root-level db.js, there is no
// MIGRATION_TEST_MODE shim — that branch belonged to the migration_exploration
// harness this structure does not carry forward.
import { mariadb, closeMariadb } from './mariadb-pool.js';
import { pg, closePg } from './pg-pool.js';

async function closeAll() {
  await closeMariadb();
  await closePg();
}

export { mariadb, pg, closeAll };
