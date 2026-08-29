// Test-mode replacement for db.js's { mariadb, pg, closeAll } trio, activated only
// when MIGRATION_TEST_MODE=1. Lets every pair handler in migration_exploration/opinions/
// run completely unmodified against real infrastructure:
//   - "mariadb" side -> pg_classic (read-only) -- either scoped to a pre-sampled
//     opinion_no list (MIGRATION_TEST_OPINION_NOS set, sample-test mode), or the
//     handler's full (status, spelling_reason) slice, keyset-paginated on
//     opinion_no to bound memory (MIGRATION_TEST_OPINION_NOS unset, full-run mode)
//   - "pg" side -> pg_play (the local scratch target), same as production shape
//
// Each handler does exactly one:
//   const conn = await mariadb.getConnection();
//   const stream = conn.connection.query(`...FROM opinions WHERE status = 'X' AND
//     spelling_reason = 'Y' ORDER BY opinion_no ASC`).stream();
// This shim intercepts that query text and answers it from pg_classic instead of
// a real MariaDB connection.
import { pgClassic, closePgClassic } from '../../pg-classic-pool.js';
import { pgPlay, closePgPlay } from '../../pg-play-pool.js';

const ORDER_BY_OPINION_NO = /ORDER BY opinion_no ASC/i;
const FULL_RUN_PAGE_SIZE = 5000;

function parseOpinionNos() {
  const raw = process.env.MIGRATION_TEST_OPINION_NOS;
  const nos = raw.split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n));
  if (nos.length === 0) {
    throw new Error(`db-test-shim: MIGRATION_TEST_OPINION_NOS parsed to zero rows from "${raw}"`);
  }
  return nos;
}

// Sample-test mode: fetch exactly the pre-sampled opinion_nos in one query.
async function* streamSampled(sqlText) {
  const opinionNos = parseOpinionNos();
  const scopedSql = sqlText.replace(
    ORDER_BY_OPINION_NO,
    'AND opinion_no = ANY($1::int[]) ORDER BY opinion_no ASC',
  );
  const { rows } = await pgClassic.query(scopedSql, [opinionNos]);
  for (const row of rows) yield row;
}

// Full-run mode: no opinion_no filter, but still bound memory -- keyset-paginate
// on opinion_no (5000 rows/page) instead of pulling a pair's entire slice (up to
// 743,712 rows for belongs-to/original-spelling) into memory in one query.
async function* streamFull(sqlText) {
  const pagedSql = sqlText.replace(
    ORDER_BY_OPINION_NO,
    'AND opinion_no > $1::bigint ORDER BY opinion_no ASC LIMIT $2',
  );
  let lastSeen = 0;
  while (true) {
    const { rows } = await pgClassic.query(pagedSql, [lastSeen, FULL_RUN_PAGE_SIZE]);
    if (rows.length === 0) return;
    for (const row of rows) yield row;
    lastSeen = Number(rows[rows.length - 1].opinion_no);
    if (rows.length < FULL_RUN_PAGE_SIZE) return;
  }
}

function streamRows(sqlText) {
  if (!ORDER_BY_OPINION_NO.test(sqlText)) {
    throw new Error(
      `db-test-shim: handler query doesn't match the expected "...ORDER BY opinion_no ASC" shape, ` +
        `refusing to guess a filter -- query was: ${sqlText}`,
    );
  }
  return process.env.MIGRATION_TEST_OPINION_NOS ? streamSampled(sqlText) : streamFull(sqlText);
}

const mariadb = {
  async getConnection() {
    return {
      connection: {
        query(sqlText) {
          return {
            // Returned synchronously (matching the real mariadb driver's
            // chainable .query().stream() shape); nothing hits pg_classic
            // until the caller actually starts iterating.
            stream: () => streamRows(sqlText),
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
