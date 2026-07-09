import { mariadb, pg, closeAll } from './db.js';
import { uuidv7 } from './uuidv7.js';
import Ajv from 'ajv/dist/2019.js';
import { authoritySchema } from './payloadSchemas/authority.schema.js';

const INSERT_BATCH_SIZE = 1000;
const LOG_SAMPLE_LIMIT = 20;

const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(authoritySchema);

// ---------- decodeEntities ----------
function decodeEntities(s) {
  if (!s) return s;
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

// ---------- Pure transforms ----------
export function classifyScenario({ ref_is_authority, author1last }) {
  const ria = ref_is_authority === 'YES';
  const hasAuth1 = (author1last || '').trim() !== '';
  if (ria && !hasAuth1) return '1';
  if (ria && hasAuth1)  return '2';
  if (!ria && hasAuth1) return '3';
  return '4';
}

export function buildDescriptorsFromFields({ author1last, author2last, otherauthors }) {
  const out = [];
  for (const raw of [author1last, author2last, otherauthors]) {
    if (!raw) continue;
    const decoded = decodeEntities(raw);
    for (const tok of decoded.split(/[,;:&]/)) {
      const t = tok.trim();
      if (!t || t === 'et al.') continue;
      out.push(t);
    }
  }
  return out;
}

export function buildDescriptorsFromRef(refAuthors) {
  if (!Array.isArray(refAuthors)) return [];
  return refAuthors
    .map((a) => a && typeof a.familyName === 'string' ? a.familyName : null)
    .filter((n) => n !== null);
}

export function buildCitationFromFields({ author1last, author2last, otherauthors, pubyr }) {
  const a1 = author1last || '';
  const a2 = author2last || '';
  const oa = otherauthors || '';
  const yr = pubyr || '';
  let mid = '';
  if (oa !== '') mid = ' et al.';
  else if (a2 !== '') mid = ' and ' + a2;
  return (a1 + mid + ' ' + yr).trim();
}

export function buildCitationFromRef({ refAuthors, publicationYear }) {
  const authors = Array.isArray(refAuthors) ? refAuthors : [];
  const n = authors.length;
  let joined = '';
  if (n === 1) joined = authors[0]?.familyName || '';
  else if (n === 2) joined = (authors[0]?.familyName || '') + ' and ' + (authors[1]?.familyName || '');
  else if (n >= 3) joined = (authors[0]?.familyName || '') + ' et al.';
  const yr = publicationYear || '';
  return (joined + ' ' + yr).trim();
}

export function buildAuthorityPayload(src, scenario, refData) {
  const taxonNoStr = String(src.taxon_no);
  const payload = {
    legacyIDs: { oldpbdbIDs: [taxonNoStr] },
    publishedInReference: scenario === '1' || scenario === '2',
  };
  if (scenario === '1') {
    payload.citation = buildCitationFromRef(refData);
    payload.descriptors = buildDescriptorsFromRef(refData.refAuthors);
    if (refData.publicationYear) payload.year = refData.publicationYear;
  } else {
    payload.citation = buildCitationFromFields(src);
    payload.descriptors = buildDescriptorsFromFields(src);
    if (src.pubyr) payload.year = src.pubyr;
  }
  return payload;
}

export function dedupKey(payload, reference_id) {
  return JSON.stringify([
    reference_id,
    payload.citation,
    payload.year ?? '',
    payload.descriptors,
  ]);
}

// ---------- Sample logger (bucketed to avoid log flooding) ----------
function makeSampleLogger(label) {
  let n = 0;
  return (msg) => {
    n++;
    if (n <= LOG_SAMPLE_LIMIT) {
      console.warn(`  [${label}] ${msg}`);
    } else if (n === LOG_SAMPLE_LIMIT + 1) {
      console.warn(`  [${label}] ... (further occurrences suppressed; final count at end of run)`);
    }
  };
}

// ---------- Main ----------
async function main() {
  const startTime = new Date();
  console.log(`[${startTime.toISOString()}] Starting authorities migration...`);

  // Pre-load: refs (head version only)
  const { rows: refRows } = await pg.query(`
    SELECT id,
           reference->'legacyIDs'->>'oldpbdbID' AS legacy,
           reference->'authors' AS authors,
           reference->>'publicationYear' AS pubyear
    FROM refs
    WHERE succeeded_by_id IS NULL
      AND reference->'legacyIDs'->>'oldpbdbID' IS NOT NULL
  `);
  const refMap = new Map();
  for (const r of refRows) {
    refMap.set(r.legacy, {
      id: r.id,
      refAuthors: r.authors || [],
      publicationYear: r.pubyear || '',
    });
  }
  console.log(`  Loaded ${refMap.size} refs (current head versions)`);

  // Persons: persons.id == legacy person_no by construction (migrate-persons.js).
  // No pre-load needed; legacy authorizer_no/enterer_no are used directly as FK values.
  // Same pattern as migrate-refs.js.

  // Counters
  let sourceRows = 0;
  let scenario1 = 0, scenario2 = 0, scenario3 = 0;
  let scenario4Skipped = 0;
  let orphanRefSkipped = 0;
  let bothPersonsZero = 0;
  let mergesAbsorbed = 0;

  const logScenario4 = makeSampleLogger('scenario④ skip');
  const logOrphan = makeSampleLogger('orphan ref');
  const logBothZero = makeSampleLogger('both auth/ent 0');
  const logMerge = makeSampleLogger('merge');

  // Stream from MariaDB
  const conn = await mariadb.getConnection();
  const stream = conn.connection.query(`
    SELECT taxon_no, ref_is_authority, author1last, author2last, otherauthors, pubyr,
           reference_no, authorizer_no, enterer_no
    FROM authorities
    ORDER BY taxon_no ASC
  `).stream();

  const survivors = new Map();

  try {
    for await (const src of stream) {
      sourceRows++;
      if (sourceRows % 50000 === 0) {
        console.log(`  Processed ${sourceRows} source rows, ${survivors.size} survivors, ${mergesAbsorbed} merges so far...`);
      }

      const scenario = classifyScenario(src);
      if (scenario === '4') {
        scenario4Skipped++;
        logScenario4(`taxon_no=${src.taxon_no}`);
        continue;
      }

      const refEntry = refMap.get(String(src.reference_no));
      if (!refEntry) {
        orphanRefSkipped++;
        logOrphan(`taxon_no=${src.taxon_no} reference_no=${src.reference_no}`);
        continue;
      }
      const reference_id = refEntry.id;

      // Resolve persons with 0-fallback (mirrors migrate-refs.js)
      let authNo = src.authorizer_no || 0;
      let entNo = src.enterer_no || 0;
      if (authNo === 0 && entNo !== 0) authNo = entNo;
      else if (entNo === 0 && authNo !== 0) entNo = authNo;
      else if (authNo === 0 && entNo === 0) {
        bothPersonsZero++;
        logBothZero(`taxon_no=${src.taxon_no} both 0, using person_no=1 fallback`);
        authNo = 1; entNo = 1;
      }
      const authorizerPersonId = authNo;
      const entererPersonId = entNo;

      const payload = buildAuthorityPayload(src, scenario, scenario === '1' ? refEntry : null);

      // Pre-DB-write validation (abort on failure)
      const wrapper = { authority: payload };
      if (!validate(wrapper)) {
        console.error(`\n  VALIDATION FAILED for taxon_no=${src.taxon_no}`);
        console.error('  errors:', JSON.stringify(validate.errors, null, 2));
        console.error('  payload:', JSON.stringify(payload, null, 2));
        conn.release();
        process.exit(1);
      }

      const key = dedupKey(payload, reference_id);
      if (!survivors.has(key)) {
        if (scenario === '1') scenario1++;
        else if (scenario === '2') scenario2++;
        else scenario3++;
        survivors.set(key, {
          payload,
          reference_id,
          authorizerPersonId,
          entererPersonId,
        });
      } else {
        // Merge: append this taxon_no to the survivor's oldpbdbIDs
        const s = survivors.get(key);
        s.payload.legacyIDs.oldpbdbIDs.push(String(src.taxon_no));
        mergesAbsorbed++;
        if (scenario === '1') scenario1++;
        else if (scenario === '2') scenario2++;
        else scenario3++;
        logMerge(`absorbed taxon_no=${src.taxon_no} into survivor taxon_no=${s.payload.legacyIDs.oldpbdbIDs[0]}`);
      }
    }
  } finally {
    conn.release();
  }

  console.log('');
  console.log(`  Source rows read:       ${sourceRows}`);
  console.log(`  Scenario ① (ref-driven):   ${scenario1}`);
  console.log(`  Scenario ② (ria, *last):   ${scenario2}`);
  console.log(`  Scenario ③ (¬ria, *last):  ${scenario3}`);
  console.log(`  Scenario ④ skipped:        ${scenario4Skipped}`);
  console.log(`  Orphan ref skipped:        ${orphanRefSkipped}`);
  console.log(`  Both auth/ent = 0:         ${bothPersonsZero}`);
  console.log(`  Survivors after dedup:     ${survivors.size}`);
  console.log(`  Merges absorbed:           ${mergesAbsorbed}`);

  const accounted = survivors.size + mergesAbsorbed + scenario4Skipped + orphanRefSkipped;
  if (accounted !== sourceRows) {
    console.warn(`  WARNING: counter mismatch! accounted ${accounted} != sourceRows ${sourceRows}`);
  } else {
    console.log(`  Counter check: ${accounted} == ${sourceRows} ✓`);
  }

  // Transaction-wrapped bulk insert
  const pgClient = await pg.connect();
  let inserted = 0;
  try {
    await pgClient.query('BEGIN');
    const allSurvivors = [...survivors.values()];
    for (let i = 0; i < allSurvivors.length; i += INSERT_BATCH_SIZE) {
      const batch = allSurvivors.slice(i, i + INSERT_BATCH_SIZE);
      const values = [];
      const params = [];
      let pIdx = 1;
      for (const s of batch) {
        values.push(`($${pIdx}, $${pIdx+1}, $${pIdx+2}, $${pIdx+3}, $${pIdx+4})`);
        params.push(
          uuidv7(),
          s.authorizerPersonId,
          s.entererPersonId,
          JSON.stringify(s.payload),
          s.reference_id,
        );
        pIdx += 5;
      }
      await pgClient.query(
        `INSERT INTO authorities (permid, authorizer_person_id, enterer_person_id, authority, reference_id)
         VALUES ${values.join(', ')}`,
        params,
      );
      inserted += batch.length;
      if (i / INSERT_BATCH_SIZE % 20 === 0) {
        console.log(`  Inserted ${inserted}/${allSurvivors.length}...`);
      }
    }
    await pgClient.query('COMMIT');
    console.log(`  Inserted ${inserted} survivor rows (transaction committed)`);
  } catch (err) {
    await pgClient.query('ROLLBACK').catch(() => {});
    console.error('  Insert failed, transaction rolled back:', err.message);
    pgClient.release();
    process.exit(1);
  }
  pgClient.release();

  // Reset identity
  await pg.query(`SELECT setval(pg_get_serial_sequence('authorities','id'), (SELECT MAX(id) FROM authorities))`);

  const { rows: cnt } = await pg.query('SELECT COUNT(*)::int AS n FROM authorities');
  console.log(`  Final authorities row count in PG: ${cnt[0].n}`);

  const elapsed = ((new Date() - startTime) / 1000).toFixed(1);
  console.log(`[${new Date().toISOString()}] Authorities migration complete in ${elapsed}s`);
}

// Only run main() when invoked directly, so pure transforms can be imported for unit tests
const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((err) => {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  }).finally(() => closeAll());
}
