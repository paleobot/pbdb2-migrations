import { pg, closePg } from '../lib/pg-pool.js';
import { uuidv7 } from '../lib/uuidv7.js';
import { referenceSource, PUBLICATION_TYPES, SHARED_FIELDS } from '../../payloadSchemas/reference.schema.js';
import { resolveEnums } from '../../payloadSchemas/lib/enums.js';
import { deriveVariant } from '../../payloadSchemas/lib/variants.js';
import { createAjv } from '../../payloadSchemas/lib/ajv.js';

// --- Constants ---

const PBOT_GRAPHQL_URL = 'https://pbot.paleobiodb.org/graphql';
const AUTHORIZER_PERSON_ID = 1106; // Douglas Meredith

// PBot publication types that are not values of referenceSource's enum.
const PUB_TYPE_ALIASES = {
  'contributed article in edited book': 'article in edited collection',
  'edited book of contributed articles': 'edited collection',
};

// --- GraphQL fetch ---

const PBOT_QUERY = `{
  Reference {
    pbotID
    title
    year
    publicationType
    firstPage
    lastPage
    journal
    bookTitle
    publicationVolume
    publicationNumber
    publisher
    description
    bookType
    editors
    notes
    doi
    pbdbid
    enteredBy {
      type
      timestamp { formatted }
      Person {
        pbotID
        given
        surname
        email
        orcid
        registered
      }
    }
    authoredBy {
      order
      Person {
        pbotID
        given
        surname
      }
    }
  }
}`;

async function fetchPbotReferences() {
  const response = await fetch(PBOT_GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: PBOT_QUERY }),
  });

  if (!response.ok) {
    throw new Error(`GraphQL request failed: ${response.status} ${response.statusText}`);
  }

  const json = await response.json();
  if (json.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
  }

  return json.data.Reference;
}

// --- Enterer resolution ---

function resolveEnterer(ref) {
  const entries = ref.enteredBy || [];
  if (entries.length === 0) {
    console.warn(`  WARNING: Reference ${ref.pbotID} has no enteredBy entries`);
    return null;
  }

  // Prefer type='CREATE'
  const createEntry = entries.find((e) => e.type === 'CREATE');
  if (createEntry) return createEntry;

  // Fallback: earliest timestamp
  console.warn(`  WARNING: Reference ${ref.pbotID} has no CREATE enteredBy — using earliest timestamp`);
  const sorted = [...entries].sort((a, b) => {
    const ta = a.timestamp?.formatted || '';
    const tb = b.timestamp?.formatted || '';
    return ta.localeCompare(tb);
  });
  return sorted[0];
}

// --- Publication type ---

// A value of the publicationType enum: as given, aliased, or "other".
function normalizePublicationType(ref) {
  const given = ref.publicationType || null;
  if (!given) return 'other';
  if (given in PUBLICATION_TYPES) return given;
  if (given in PUB_TYPE_ALIASES) return PUB_TYPE_ALIASES[given];
  console.warn(`  WARNING: Reference ${ref.pbotID} unmapped publicationType '${given}' → "other"`);
  return 'other';
}

// Keep only the fields the type allows, per PUBLICATION_TYPES. PBot's extras are
// entry noise from a UI that never enforced types (publisher "PBot", "self" on
// unpublished workbench entries), so they are dropped, each one logged.
function dropDisallowedFields(jsonb, pbotID) {
  const { fields, unrestricted } = PUBLICATION_TYPES[jsonb.publicationType];
  if (unrestricted) return [];
  const allowed = new Set([...SHARED_FIELDS, ...fields]);
  const dropped = [];
  for (const [field, value] of Object.entries(jsonb)) {
    if (allowed.has(field)) continue;
    console.warn(`  DROPPED: Reference ${pbotID} ${field}=${JSON.stringify(value)} (not allowed on '${jsonb.publicationType}')`);
    delete jsonb[field];
    dropped.push(field);
  }
  return dropped;
}

// --- Reference JSONB builder ---

function buildReferenceJsonb(ref, pubType) {
  const jsonb = {};

  jsonb.publicationType = pubType;

  // title
  if (ref.title && ref.title.trim()) {
    jsonb.title = ref.title.trim();
  } else {
    console.warn(`  WARNING: Reference ${ref.pbotID} has no title`);
  }

  // publicationYear
  if (ref.year && ref.year.trim()) {
    jsonb.publicationYear = ref.year.trim();
  }

  // Type-dependent fields
  if (pubType === 'journal article') {
    if (ref.journal) jsonb.journalTitle = ref.journal.trim();
    if (ref.publicationVolume) jsonb.journalVolume = ref.publicationVolume.trim();
    if (ref.publicationNumber) jsonb.journalNumber = ref.publicationNumber.trim();
  } else if (pubType === 'serial monograph') {
    if (ref.journal) jsonb.seriesTitle = ref.journal.trim();
    if (ref.publicationVolume) jsonb.seriesVolume = ref.publicationVolume.trim();
  }

  // bookTitle, bookType
  if (ref.bookTitle && ref.bookTitle.trim()) jsonb.bookTitle = ref.bookTitle.trim();
  if (ref.bookType && ref.bookType.trim()) jsonb.bookType = ref.bookType.trim();

  // publisher
  if (ref.publisher && ref.publisher.trim()) jsonb.publisher = ref.publisher.trim();

  // editors
  if (ref.editors && ref.editors.trim()) jsonb.editors = ref.editors.trim();

  // doi
  if (ref.doi && ref.doi.trim()) jsonb.doi = ref.doi.trim();

  // pages
  if (ref.firstPage && ref.firstPage.trim()) {
    const first = parseInt(ref.firstPage.trim(), 10);
    if (isNaN(first)) {
      console.warn(`  WARNING: Reference ${ref.pbotID} non-numeric firstPage: '${ref.firstPage}'`);
    } else {
      let last = first;
      if (ref.lastPage && ref.lastPage.trim()) {
        const parsed = parseInt(ref.lastPage.trim(), 10);
        if (!isNaN(parsed)) last = parsed;
      }
      jsonb.pages = { first, last };
    }
  }

  // notes → comments
  if (ref.notes && ref.notes.trim()) {
    jsonb.comments = ref.notes.trim();
  }

  // description (unpublished references)
  if (ref.description && ref.description.trim()) {
    jsonb.description = ref.description.trim();
  }

  // language — always unknown for PBot sources
  jsonb.language = 'unknown';

  // authors from authoredBy
  const authoredBy = ref.authoredBy || [];
  if (authoredBy.length > 0) {
    const sorted = [...authoredBy].sort((a, b) => {
      const oa = parseInt(a.order || '0', 10);
      const ob = parseInt(b.order || '0', 10);
      return oa - ob;
    });
    jsonb.authors = sorted.map((a) => ({
      familyName: a.Person?.surname || '',
      givenName: a.Person?.given || '',
    }));
  }

  // pbotID for traceability
  jsonb.legacyIDs = { pbotID: ref.pbotID };

  return jsonb;
}

// --- Main ---

async function main() {
  const startTime = new Date();
  console.log(`[${startTime.toISOString()}] Starting PBot refs migration...`);

  // --- Validator, resolved before fetching so an empty dictionary aborts up front ---

  const resolved = await resolveEnums(pg, referenceSource);
  const validate = createAjv().compile(deriveVariant(resolved, 'db'));
  // PBot's book types are not PBDB's ("thesis", "other"); one with no match in
  // dictionaries.book_types is stored as "other".
  const bookTypes = new Set(resolved.properties.bookType.enum);
  console.log('  Resolved and compiled the reference db variant');

  // --- 2.1 Fetch PBot data ---

  console.log(`  Fetching references from ${PBOT_GRAPHQL_URL}...`);
  const allRefs = await fetchPbotReferences();
  console.log(`  Fetched ${allRefs.length} references from PBot`);

  // --- 2.2 Filter out refs with pbdbid ---

  const pbotOnlyRefs = allRefs.filter((r) => !r.pbdbid || !r.pbdbid.trim());
  const skippedCount = allRefs.length - pbotOnlyRefs.length;
  console.log(`  Skipped ${skippedCount} references with pbdbid (already migrated from MariaDB)`);
  console.log(`  Processing ${pbotOnlyRefs.length} PBot-only references`);

  // --- 6.3 Ensure permid unique constraint exists ---
  // Backstop only: guarantees permid uniqueness. Logical idempotency (avoiding
  // duplicate references on re-run) is enforced by the legacyIDs.pbotID lookup
  // in the upsert below, since permid is now a generated UUIDv7.

  await pg.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'refs'::regclass
          AND conname = 'references_permid_key'
      ) THEN
        ALTER TABLE refs ADD CONSTRAINT references_permid_key UNIQUE (permid);
      END IF;
    END
    $$;
  `);
  console.log('  Ensured permid unique constraint on references');

  // --- 4.1–4.4 + 5.1 Transform and insert references ---

  let upsertCount = 0;
  let warningCount = 0;
  let droppedFieldCount = 0;
  let droppedRefCount = 0;

  for (const ref of pbotOnlyRefs) {
    // 4.1 Resolve enterer — look up in persons table
    const enteredByEntry = resolveEnterer(ref);
    if (!enteredByEntry || !enteredByEntry.Person) {
      console.warn(`  WARNING: Skipping reference ${ref.pbotID} — no enterer found`);
      warningCount++;
      continue;
    }

    const entererPbotID = enteredByEntry.Person.pbotID;
    const { rows: personRows } = await pg.query(
      `SELECT id FROM persons WHERE person->'legacyIDs'->>'pbotID' = $1`,
      [entererPbotID]
    );
    if (personRows.length === 0) {
      console.warn(`  WARNING: Skipping reference ${ref.pbotID} — enterer pbotID ${entererPbotID} not found in persons table`);
      warningCount++;
      continue;
    }
    const entererPgId = personRows[0].id;

    // Build JSONB from the normalized type, keep what the type allows, validate
    const pubType = normalizePublicationType(ref);
    const jsonb = buildReferenceJsonb(ref, pubType);
    const dropped = dropDisallowedFields(jsonb, ref.pbotID);
    if (dropped.length) {
      droppedFieldCount += dropped.length;
      droppedRefCount++;
    }
    if (jsonb.bookType && !bookTypes.has(jsonb.bookType)) {
      console.warn(`  WARNING: Reference ${ref.pbotID} bookType '${jsonb.bookType}' → "other"`);
      jsonb.bookType = 'other';
    }
    if (!validate(jsonb)) {
      console.error(`  Validation failed for pbotID=${ref.pbotID}`);
      console.error(JSON.stringify(validate.errors, null, 2));
      console.error(JSON.stringify(jsonb, null, 2));
      throw new Error('payload failed reference db-schema validation');
    }

    // 5.1 Idempotent upsert keyed on legacyIDs.pbotID.
    // permid is now a generated UUIDv7 (a fresh value each run), so we can no
    // longer rely on ON CONFLICT (permid). Match on the stable pbotID instead:
    // update in place when the ref already exists (preserving its id + permid),
    // otherwise insert a new row with a freshly generated permid.
    const { rows: existingRows } = await pg.query(
      `SELECT id FROM refs WHERE reference->'legacyIDs'->>'pbotID' = $1`,
      [ref.pbotID]
    );

    if (existingRows.length > 0) {
      await pg.query(
        `UPDATE refs SET
           authorizer_person_id = $2,
           enterer_person_id = $3,
           reference = $4,
           removed = false
         WHERE id = $1`,
        [
          existingRows[0].id,      // $1
          AUTHORIZER_PERSON_ID,    // $2
          entererPgId,             // $3
          JSON.stringify(jsonb),   // $4
        ]
      );
    } else {
      await pg.query(
        `INSERT INTO refs (permid, authorizer_person_id, enterer_person_id,
                                   reference, preceded_by_id, succeeded_by_id, removed)
         VALUES ($1, $2, $3, $4, NULL, NULL, false)`,
        [
          uuidv7(),                // $1 — generated UUIDv7 permid
          AUTHORIZER_PERSON_ID,    // $2
          entererPgId,             // $3
          JSON.stringify(jsonb),   // $4
        ]
      );
    }
    upsertCount++;
  }

  console.log(`  Upserted ${upsertCount} references`);

  // --- 5.2 Reset references identity sequence ---

  await pg.query(
    `SELECT setval(pg_get_serial_sequence('refs', 'id'), (SELECT MAX(id) FROM refs))`
  );
  console.log('  References identity sequence reset');

  // --- 6.2 Verification ---

  const { rows: countResult } = await pg.query(
    `SELECT COUNT(*)::int AS count FROM refs WHERE reference->'legacyIDs'->>'pbotID' = ANY($1)`,
    [pbotOnlyRefs.map((r) => r.pbotID)]
  );
  const pgCount = countResult[0].count;
  const expectedCount = pbotOnlyRefs.length;

  if (pgCount === expectedCount) {
    console.log(`  Verification PASSED: ${pgCount} PBot references in PostgreSQL matches ${expectedCount} expected`);
  } else {
    console.warn(`  Verification WARNING: PostgreSQL has ${pgCount} PBot references but expected ${expectedCount}`);
  }

  // --- 6.1 Summary ---

  const endTime = new Date();
  const elapsed = ((endTime - startTime) / 1000).toFixed(1);
  console.log(`  Upserted: ${upsertCount}, Warnings: ${warningCount}`);
  console.log(`  Dropped ${droppedFieldCount} fields from ${droppedRefCount} references`);
  console.log(`[${endTime.toISOString()}] PBot refs migration complete in ${elapsed}s`);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exitCode = 1;
}).finally(() => closePg());
