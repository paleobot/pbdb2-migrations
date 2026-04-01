import { mariadb, closeMariadb } from './mariadb-pool.js';
import { pg, closePg } from './pg-pool.js';

async function closeAll() {
  await closeMariadb();
  await closePg();
}

export { mariadb, pg, closeAll };
