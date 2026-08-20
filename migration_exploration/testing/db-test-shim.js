// Test-mode replacement for db.js's { mariadb, pg, closeAll } trio, activated only
// when MIGRATION_TEST_MODE=1. Lets every pair handler in migration_exploration/opinions/
// run completely unmodified against real infrastructure:
//   - "mariadb" side -> pg_classic (read-only), scoped to a pre-sampled opinion_no
//     list instead of the handler's full (status, spelling_reason) slice
//   - "pg" side -> pg_play (the local scratch target), same as production shape
//
// Each handler does exactly one:
//   const conn = await mariadb.getConnection();
//   const stream = conn.connection.query(`...FROM opinions WHERE status = 'X' AND
//     spelling_reason = 'Y' ORDER BY opinion_no ASC`).stream();
// This shim intercepts that query text, splices in an opinion_no filter (from
// MIGRATION_TEST_OPINION_NOS, set per-handler-invocation by the test runner), and
// answers it from pg_classic instead of a real MariaDB connection.
import { pgClassic, closePgClassic } from '../../pg-classic-pool.js';
import { pgPlay, closePgPlay } from '../../pg-play-pool.js';

const ORDER_BY_OPINION_NO = /ORDER BY opinion_no ASC/i;

function parseOpinionNos() {
  const raw = process.env.MIGRATION_TEST_OPINION_NOS;
  if (!raw) {
    throw new Error(
      'db-test-shim: MIGRATION_TEST_MODE=1 but MIGRATION_TEST_OPINION_NOS is unset -- ' +
        'refusing to run a handler unscoped against pg_classic.',
    );
  }
  const nos = raw.split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n));
  if (nos.length === 0) {
    throw new Error(`db-test-shim: MIGRATION_TEST_OPINION_NOS parsed to zero rows from "${raw}"`);
  }
  return nos;
}

async function runFilteredQuery(sqlText) {
  if (!ORDER_BY_OPINION_NO.test(sqlText)) {
    throw new Error(
      `db-test-shim: handler query doesn't match the expected "...ORDER BY opinion_no ASC" shape, ` +
        `refusing to guess a filter -- query was: ${sqlText}`,
    );
  }
  const opinionNos = parseOpinionNos();
  const scopedSql = sqlText.replace(
    ORDER_BY_OPINION_NO,
    'AND opinion_no = ANY($1::int[]) ORDER BY opinion_no ASC',
  );
  const { rows } = await pgClassic.query(scopedSql, [opinionNos]);
  return rows;
}

const mariadb = {
  async getConnection() {
    return {
      connection: {
        query(sqlText) {
          return {
            stream() {
              // Async generator: returned synchronously (matching the real
              // mariadb driver's chainable .query().stream() shape), the actual
              // pg_classic query only runs once the caller starts iterating.
              return (async function* () {
                const rows = await runFilteredQuery(sqlText);
                for (const row of rows) yield row;
              })();
            },
          };
        },
      },
      release() {},
    };
  },
};

async function closeAll() {
  await closePgPlay();
  await closePgClassic();
}

export { mariadb, pgPlay as pg, closeAll };
