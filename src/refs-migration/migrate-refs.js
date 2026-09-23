import { mariadb, pg, closeAll } from '../lib/db.js';
import { uuidv7 } from '../lib/uuidv7.js';
import { referenceSource } from '../../payloadSchemas/reference.schema.js';
import { resolveEnums } from '../../payloadSchemas/lib/enums.js';
import { deriveVariant } from '../../payloadSchemas/lib/variants.js';
import { createAjv } from '../../payloadSchemas/lib/ajv.js';

// --- Publication type mapping ---
// Legacy value → { referenceType (jsonb publicationType), bookType (jsonb field or null) }.
// The targets are values of referenceSource's inline publicationType enum; no table backs them.
const PUB_TYPE_MAP = {
  'journal article':   { referenceType: 'journal article', bookType: null },
  'serial monograph':  { referenceType: 'serial monograph', bookType: null },
  'unpublished':       { referenceType: 'unpublished', bookType: null },
  'book/book chapter': { referenceType: 'edited collection', bookType: null },
  'book chapter':      { referenceType: 'article in edited collection', bookType: null },
  'book':              { referenceType: 'standalone book', bookType: 'monograph' },
  'compendium':        { referenceType: 'standalone book', bookType: 'compendium' },
  'Ph.D. thesis':      { referenceType: 'standalone book', bookType: 'Ph.D. thesis' },
  'M.S. thesis':       { referenceType: 'standalone book', bookType: 'M.S. thesis' },
  'guidebook':         { referenceType: 'standalone book', bookType: 'guidebook' },
  'news article':      { referenceType: 'other', bookType: null },
  'abstract':          { referenceType: 'other', bookType: null },
};

// Target language vocabulary: dictionaries.languages.name. The legacy enum spells
// Portuguese 'Portugese'; the dictionary corrects it.
const TARGET_LANGUAGES = new Set([
  'Chinese', 'English', 'French', 'German', 'Italian',
  'Japanese', 'Portuguese', 'Russian', 'Spanish', 'other', 'unknown',
]);
const LANGUAGE_CORRECTIONS = { Portugese: 'Portuguese' };

// Types whose title legacy PBDB may keep in pubtitle, with reftitle empty: a
// whole book. pubtitle has no other destination for these two.
const PUBTITLE_TITLE_TYPES = new Set(['standalone book', 'edited collection']);

// --- Transform functions ---

function mapPublicationType(legacyType) {
  if (!legacyType) {
    return { referenceTypeName: 'other', bookType: null };
  }
  const mapping = PUB_TYPE_MAP[legacyType];
  if (mapping) {
    return { referenceTypeName: mapping.referenceType, bookType: mapping.bookType };
  }
  console.warn(`  WARNING: unmapped publication_type '${legacyType}' → "other"`);
  return { referenceTypeName: 'other', bookType: null };
}

function buildAuthors(ref, refAuthorsMap) {
  const refNo = ref.reference_no;
  const normalizedAuthors = refAuthorsMap.get(refNo);

  if (normalizedAuthors && normalizedAuthors.length > 0) {
    return normalizedAuthors.map((a) => ({
      familyName: a.lastname || '',
      givenName: a.firstname || '',
    }));
  }

  // Fall back to flat fields
  const authors = [];
  if (ref.author1last) {
    authors.push({ familyName: ref.author1last.trim(), givenName: (ref.author1init || '').trim() });
  }
  if (ref.author2last) {
    authors.push({ familyName: ref.author2last.trim(), givenName: (ref.author2init || '').trim() });
  }

  // Parse otherauthors
  if (ref.otherauthors && ref.otherauthors.trim()) {
    const raw = ref.otherauthors.trim();
    // Split on ", and ", " and ", "; ", or ", " — common separators
    const parts = raw.split(/,\s*and\s+|\s+and\s+|;\s*|,\s+(?=[A-Z])/);
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      // Try "Last, Init" or "Init Last" patterns
      if (trimmed.includes(',')) {
        const [last, ...rest] = trimmed.split(',');
        authors.push({ familyName: last.trim(), givenName: rest.join(',').trim() });
      } else {
        const tokens = trimmed.split(/\s+/);
        if (tokens.length === 1) {
          authors.push({ familyName: tokens[0], givenName: '' });
        } else {
          // Assume last token is familyName
          authors.push({
            familyName: tokens[tokens.length - 1],
            givenName: tokens.slice(0, -1).join(' '),
          });
        }
      }
    }
  }

  if (authors.length === 0) {
    console.warn(`  WARNING: reference_no=${refNo} has no author data`);
  }

  return authors;
}

function buildEditors(ref, refEditorsMap) {
  const refNo = ref.reference_no;
  const normalizedEditors = refEditorsMap.get(refNo);

  if (normalizedEditors && normalizedEditors.length > 0) {
    return normalizedEditors
      .map((e) => `${e.firstname ? e.firstname + ' ' : ''}${e.lastname}`.trim())
      .join(', ');
  }

  return ref.editors ? ref.editors.trim() || null : null;
}

function mapPubtitle(ref, referenceTypeName) {
  const pubtitle = ref.pubtitle ? ref.pubtitle.trim() : null;
  if (!pubtitle) return {};

  switch (referenceTypeName) {
    case 'journal article':
      return { journalTitle: pubtitle };
    case 'serial monograph':
      return { seriesTitle: pubtitle };
    case 'article in edited collection':
      return { bookTitle: pubtitle };
    default:
      return {};
  }
}

function mapVolNo(ref, referenceTypeName) {
  const pubvol = ref.pubvol ? ref.pubvol.trim() : null;
  const pubno = ref.pubno ? ref.pubno.trim() : null;
  const result = {};

  if (referenceTypeName === 'journal article') {
    if (pubvol) result.journalVolume = pubvol;
    if (pubno) result.journalNumber = pubno;
  } else if (referenceTypeName === 'serial monograph') {
    if (pubvol) result.seriesVolume = pubvol;
  }

  return result;
}

function buildPages(firstpage, lastpage) {
  if (!firstpage || !firstpage.trim()) return null;

  let first = parseInt(firstpage.trim(), 10);
  if (isNaN(first)) {
    return null; // caller logs warning
  }
  // Pages are numbered from 1; a range starting at 0 means the first page. Caller logs.
  if (first === 0) first = 1;

  let last = first;
  if (lastpage && lastpage.trim()) {
    const parsed = parseInt(lastpage.trim(), 10);
    if (!isNaN(parsed)) {
      last = parsed;
    }
    // If lastpage is non-numeric, just use first=last
  }

  return { first, last };
}

function mapLanguage(legacyLang) {
  if (!legacyLang) return 'unknown';
  const trimmed = LANGUAGE_CORRECTIONS[legacyLang.trim()] ?? legacyLang.trim();
  if (TARGET_LANGUAGES.has(trimmed)) return trimmed;
  return 'other';
}

function mapPersonIds(ref) {
  let authorizerPersonId = ref.authorizer_no || 0;
  let entererPersonId = ref.enterer_no || 0;

  if (authorizerPersonId === 0 && entererPersonId !== 0) {
    console.warn(`  WARNING: reference_no=${ref.reference_no} authorizer_no=0, using enterer_no=${entererPersonId} as fallback`);
    authorizerPersonId = entererPersonId;
  } else if (entererPersonId === 0 && authorizerPersonId !== 0) {
    console.warn(`  WARNING: reference_no=${ref.reference_no} enterer_no=0, using authorizer_no=${authorizerPersonId} as fallback`);
    entererPersonId = authorizerPersonId;
  } else if (authorizerPersonId === 0 && entererPersonId === 0) {
    console.warn(`  WARNING: reference_no=${ref.reference_no} both authorizer_no and enterer_no are 0`);
    // Will need a fallback — use 1 as a placeholder system user
    authorizerPersonId = 1;
    entererPersonId = 1;
  }

  return { authorizerPersonId, entererPersonId };
}

// reftitle, or for a whole book with no reftitle its pubtitle, verbatim.
function mapTitle(ref, referenceTypeName) {
  const reftitle = ref.reftitle ? ref.reftitle.trim() : '';
  if (reftitle) return reftitle;
  const pubtitle = ref.pubtitle ? ref.pubtitle.trim() : '';
  if (pubtitle && PUBTITLE_TITLE_TYPES.has(referenceTypeName)) return pubtitle;
  return null;
}

const isPubtitleTitle = (ref, referenceTypeName) =>
  !(ref.reftitle && ref.reftitle.trim()) && !!mapTitle(ref, referenceTypeName);

function buildJsonb(ref, authors, editors, pubType, pages, pubtitleFields, volNoFields, language) {
  const jsonb = {};

  jsonb.publicationType = pubType.referenceTypeName;
  const title = mapTitle(ref, pubType.referenceTypeName);
  if (title) {
    jsonb.title = title;
  } else {
    console.warn(`  WARNING: reference_no=${ref.reference_no} has NULL/empty reftitle`);
  }

  if (authors.length > 0) jsonb.authors = authors;
  if (ref.pubyr && ref.pubyr.trim()) jsonb.publicationYear = ref.pubyr.trim();
  if (pages) jsonb.pages = pages;
  if (ref.doi && ref.doi.trim()) jsonb.doi = ref.doi.trim();
  jsonb.language = language;
  jsonb.legacyIDs = { oldpbdbID: String(ref.reference_no) };

  // Type-specific fields
  Object.assign(jsonb, pubtitleFields);
  Object.assign(jsonb, volNoFields);

  if (pubType.bookType) jsonb.bookType = pubType.bookType;
  if (editors) jsonb.editors = editors;

  // Publisher/city for applicable types
  if (ref.publisher && ref.publisher.trim()) {
    jsonb.publisher = ref.publisher.trim();
  }
  if (ref.pubcity && ref.pubcity.trim()) {
    jsonb.publicationCity = ref.pubcity.trim();
  }

  if (ref.comments && ref.comments.trim()) {
    jsonb.comments = ref.comments.trim();
  }

  return jsonb;
}

// --- Main ---

async function main() {
  const startTime = new Date();
  console.log(`[${startTime.toISOString()}] Starting refs migration...`);

  // Resolved before any source row is read, so an empty dictionary aborts up front.
  const validate = createAjv().compile(deriveVariant(await resolveEnums(pg, referenceSource), 'db'));
  console.log('  Resolved and compiled the reference db variant');

  // 2.1 Read all refs
  const [refs] = await mariadb.query(
    `SELECT reference_no, authorizer_no, enterer_no,
            author1init, author1last, author2init, author2last, otherauthors,
            pubyr, reftitle, pubtitle, editors, publisher, pubcity,
            pubvol, pubno, firstpage, lastpage,
            publication_type, language, doi, comments
     FROM refs`
  );
  console.log(`  Read ${refs.length} rows from MariaDB refs`);

  // 2.2 Read ref_authors, group by reference_no
  const [rawAuthors] = await mariadb.query(
    `SELECT reference_no, place, lastname, firstname FROM ref_authors ORDER BY reference_no, place`
  );
  const refAuthorsMap = new Map();
  for (const row of rawAuthors) {
    if (!refAuthorsMap.has(row.reference_no)) refAuthorsMap.set(row.reference_no, []);
    refAuthorsMap.get(row.reference_no).push(row);
  }
  console.log(`  Read ${rawAuthors.length} ref_authors rows (${refAuthorsMap.size} references)`);

  // 2.3 Read ref_editors, group by reference_no
  const [rawEditors] = await mariadb.query(
    `SELECT reference_no, place, lastname, firstname FROM ref_editors ORDER BY reference_no, place`
  );
  const refEditorsMap = new Map();
  for (const row of rawEditors) {
    if (!refEditorsMap.has(row.reference_no)) refEditorsMap.set(row.reference_no, []);
    refEditorsMap.get(row.reference_no).push(row);
  }
  console.log(`  Read ${rawEditors.length} ref_editors rows (${refEditorsMap.size} references)`);

  // 5.1 Transform all rows
  const pubTypeCounts = {};
  let nonNumericPageCount = 0;
  let pageZeroCount = 0;
  let pubtitleTitleCount = 0;
  let warningCount = 0;

  const targetRows = refs.map((ref) => {
    const pubType = mapPublicationType(ref.publication_type);
    pubTypeCounts[pubType.referenceTypeName] = (pubTypeCounts[pubType.referenceTypeName] || 0) + 1;

    const authors = buildAuthors(ref, refAuthorsMap);
    const editors = buildEditors(ref, refEditorsMap);
    const pubtitleFields = mapPubtitle(ref, pubType.referenceTypeName);
    const volNoFields = mapVolNo(ref, pubType.referenceTypeName);
    const pages = buildPages(ref.firstpage, ref.lastpage);
    if (!pages && ref.firstpage && ref.firstpage.trim()) {
      console.warn(`  WARNING: reference_no=${ref.reference_no} non-numeric pages: firstpage='${ref.firstpage}' lastpage='${ref.lastpage}'`);
      nonNumericPageCount++;
      warningCount++;
    }
    if (pages && parseInt(ref.firstpage.trim(), 10) === 0) {
      console.warn(`  WARNING: reference_no=${ref.reference_no} firstpage=0 written as 1`);
      pageZeroCount++;
    }
    if (isPubtitleTitle(ref, pubType.referenceTypeName)) {
      console.log(`  reference_no=${ref.reference_no} title taken from pubtitle`);
      pubtitleTitleCount++;
    }
    const language = mapLanguage(ref.language);
    const { authorizerPersonId, entererPersonId } = mapPersonIds(ref);

    const jsonb = buildJsonb(ref, authors, editors, pubType, pages, pubtitleFields, volNoFields, language);
    // PBDB refs keep fields their type would not allow on create: the db variant
    // applies no per-type rule, and those fields are bibliographic history.
    if (!validate(jsonb)) {
      console.error(`  Validation failed for reference_no=${ref.reference_no}`);
      console.error(JSON.stringify(validate.errors, null, 2));
      console.error(JSON.stringify(jsonb, null, 2));
      throw new Error('payload failed reference db-schema validation');
    }

    return {
      id: ref.reference_no,
      permid: uuidv7(),
      authorizer_person_id: authorizerPersonId,
      enterer_person_id: entererPersonId,
      reference: jsonb,
      preceded_by_id: null,
      succeeded_by_id: null,
      removed: false,
    };
  });

  console.log(`  Transformed ${targetRows.length} rows`);

  // 5.2 Batched upsert
  const BATCH_SIZE = 500;
  let upsertCount = 0;

  for (let i = 0; i < targetRows.length; i += BATCH_SIZE) {
    const batch = targetRows.slice(i, i + BATCH_SIZE);
    const values = [];
    const params = [];
    let paramIdx = 1;

    for (const row of batch) {
      values.push(
        `($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, $${paramIdx + 5}, $${paramIdx + 6}, $${paramIdx + 7})`
      );
      params.push(
        row.id,
        row.permid,
        row.authorizer_person_id,
        row.enterer_person_id,
        JSON.stringify(row.reference),
        row.preceded_by_id,
        row.succeeded_by_id,
        row.removed,
      );
      paramIdx += 8;
    }

    await pg.query(
      `INSERT INTO refs (id, permid, authorizer_person_id, enterer_person_id, reference, preceded_by_id, succeeded_by_id, removed)
       VALUES ${values.join(', ')}
       ON CONFLICT (id) DO UPDATE SET
         authorizer_person_id = EXCLUDED.authorizer_person_id,
         enterer_person_id = EXCLUDED.enterer_person_id,
         reference = EXCLUDED.reference,
         preceded_by_id = EXCLUDED.preceded_by_id,
         succeeded_by_id = EXCLUDED.succeeded_by_id,
         removed = EXCLUDED.removed`,
      params
    );

    upsertCount += batch.length;
    if ((i / BATCH_SIZE) % 20 === 0) {
      console.log(`  Upserted ${upsertCount}/${targetRows.length} rows...`);
    }
  }

  console.log(`  Upserted ${upsertCount} rows into references`);

  // 5.3 Reset identity sequence
  await pg.query(
    `SELECT setval(pg_get_serial_sequence('refs', 'id'), (SELECT MAX(id) FROM refs))`
  );
  console.log('  Identity sequence reset');

  // 6.1 Row count verification
  const { rows: countResult } = await pg.query(`SELECT COUNT(*)::int AS count FROM refs`);
  const pgCount = countResult[0].count;

  if (pgCount === refs.length) {
    console.log(`  Verification PASSED: ${pgCount} rows in PostgreSQL matches ${refs.length} source rows`);
  } else {
    console.warn(`  Verification WARNING: PostgreSQL has ${pgCount} rows but source had ${refs.length} rows`);
    warningCount++;
  }

  // 6.2 Publication type mapping summary
  console.log('  Publication type mapping summary:');
  for (const [type, count] of Object.entries(pubTypeCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${type}: ${count}`);
  }

  // 6.3 Overall summary
  const endTime = new Date();
  const elapsed = ((endTime - startTime) / 1000).toFixed(1);
  console.log(`  Non-numeric page warnings: ${nonNumericPageCount}`);
  console.log(`  First page 0 written as 1: ${pageZeroCount}`);
  console.log(`  Titles taken from pubtitle: ${pubtitleTitleCount}`);
  console.log(`  Total warnings: ${warningCount}`);
  console.log(`[${endTime.toISOString()}] Refs migration complete in ${elapsed}s`);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exitCode = 1;
}).finally(() => closeAll());
