// MIGRATION_TEST_MODE=1 swaps both connections for migration_exploration/testing/
// db-test-shim.js (pg_classic as source, pg_play as target) without touching any
// pair handler -- see that file for why. Dynamic imports so the untaken branch's
// required-env-var checks (mariadb-pool.js / pg-pool.js) never run.
let mariadb, pg, closeAll;

if (process.env.MIGRATION_TEST_MODE === '1') {
  ({ mariadb, pg, closeAll } = await import('./migration_exploration/testing/db-test-shim.js'));
} else {
  const [{ mariadb: realMariadb, closeMariadb }, { pg: realPg, closePg }] = await Promise.all([
    import('./mariadb-pool.js'),
    import('./pg-pool.js'),
  ]);
  mariadb = realMariadb;
  pg = realPg;
  closeAll = async () => {
    await closeMariadb();
    await closePg();
  };
}

export { mariadb, pg, closeAll };
