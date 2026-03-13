import 'dotenv/config';

import { Pool } from 'pg';

// --- PG-only connection (no MariaDB dependency) ---

const REQUIRED_VARS = ['PG_HOST', 'PG_USER', 'PG_PASSWORD', 'PG_DATABASE'];
const missing = REQUIRED_VARS.filter((v) => !process.env[v]);
if (missing.length > 0) {
  console.error(`Missing required .env variables: ${missing.join(', ')}`);
  process.exit(1);
}

const pg = new Pool({
  host: process.env.PG_HOST,
  port: parseInt(process.env.PG_PORT || '5432', 10),
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE,
  max: 5,
});

// --- Constants ---

const PBOT_GRAPHQL_URL = 'https://pbot.paleobiodb.org/graphql';
const AUTHORIZER_PERSON_ID = 1106; // Douglas Meredith

// Hardcoded duplicate resolution: Nathan Jud → id=414 (not 911)
const NATHAN_JUD_PG_ID = 414;

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

// --- ORCID normalization ---

function normalizeOrcid(orcid) {
  if (!orcid || !orcid.trim()) return null;
  return orcid.trim().replace(/^https?:\/\/orcid\.org\//, '');
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

// --- Reference JSONB builder ---

function buildReferenceJsonb(ref, refTypeMap) {
  const jsonb = {};

  // publicationType
  const pubType = ref.publicationType || 'other';
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

  // notes (from description)
  if (ref.description && ref.description.trim()) {
    jsonb.notes = ref.description.trim();
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
  jsonb.pbotID = ref.pbotID;

  return jsonb;
}

// --- Main ---

async function main() {
  const startTime = new Date();
  console.log(`[${startTime.toISOString()}] Starting PBot refs migration...`);

  // --- 1.2 Load dictionary lookups ---

  const { rows: refTypeRows } = await pg.query(
    `SELECT id, reference_type FROM dictionaries.reference_types`
  );
  const refTypeMap = new Map(refTypeRows.map((r) => [r.reference_type, r.id]));
  // PBot publication type aliases → PG reference_type
  refTypeMap.set('contributed article in edited book', refTypeMap.get('article in edited collection'));
  refTypeMap.set('edited book of contributed articles', refTypeMap.get('edited collection'));
  console.log(`  Loaded ${refTypeRows.length} reference types`);

  const { rows: genderRows } = await pg.query(
    `SELECT id, genders FROM dictionaries.genders`
  );
  const genderMap = Object.fromEntries(genderRows.map((r) => [r.genders, r.id]));
  const anonymousGenderId = genderMap['Anonymous'];
  if (!anonymousGenderId) throw new Error('Anonymous gender not found');
  console.log(`  Anonymous gender_id: ${anonymousGenderId}`);

  // Ensure Unknown country exists
  await pg.query(
    `INSERT INTO dictionaries.countries (abbreviation, full_name)
     VALUES ('XX', 'Unknown')
     ON CONFLICT DO NOTHING`
  );
  const { rows: countryRows } = await pg.query(
    `SELECT id FROM dictionaries.countries WHERE abbreviation = 'XX'`
  );
  const unknownCountryId = countryRows[0].id;
  console.log(`  Unknown country_id: ${unknownCountryId}`);

  const PERSON_ROLE_ID = 6; // "Person" role

  // --- 2.1 Fetch PBot data ---

  console.log(`  Fetching references from ${PBOT_GRAPHQL_URL}...`);
  const allRefs = await fetchPbotReferences();
  console.log(`  Fetched ${allRefs.length} references from PBot`);

  // --- 2.2 Filter out refs with pbdbid ---

  const pbotOnlyRefs = allRefs.filter((r) => !r.pbdbid || !r.pbdbid.trim());
  const skippedCount = allRefs.length - pbotOnlyRefs.length;
  console.log(`  Skipped ${skippedCount} references with pbdbid (already migrated from MariaDB)`);
  console.log(`  Processing ${pbotOnlyRefs.length} PBot-only references`);

  // --- 3.1 Collect unique enterer persons ---

  const entererMap = new Map(); // pbotID → Person object
  for (const ref of pbotOnlyRefs) {
    const enteredByEntry = resolveEnterer(ref);
    if (enteredByEntry && enteredByEntry.Person) {
      const person = enteredByEntry.Person;
      if (!entererMap.has(person.pbotID)) {
        entererMap.set(person.pbotID, person);
      }
    }
  }
  console.log(`  Found ${entererMap.size} unique enterer persons`);

  // --- 3.2 Match enterers to existing PG persons ---

  const pbotIdToPgId = new Map(); // pbotID → PG person id
  let matchCount = 0;
  let insertCount = 0;
  let orcidUpdateCount = 0;

  for (const [pbotID, person] of entererMap) {
    const given = (person.given || '').trim();
    const surname = (person.surname || '').trim();

    // Hardcoded Nathan Jud duplicate resolution
    if (given.toLowerCase() === 'nathan' && surname.toLowerCase() === 'jud') {
      pbotIdToPgId.set(pbotID, NATHAN_JUD_PG_ID);
      console.log(`  Matched ${given} ${surname} → PG id=${NATHAN_JUD_PG_ID} (hardcoded)`);
      matchCount++;

      // --- 3.4 Update ORCID if needed ---
      const normalizedOrcid = normalizeOrcid(person.orcid);
      if (normalizedOrcid) {
        const { rowCount } = await pg.query(
          `UPDATE persons SET orcid = $1 WHERE id = $2 AND (orcid IS NULL OR orcid = '')`,
          [normalizedOrcid, NATHAN_JUD_PG_ID]
        );
        if (rowCount > 0) {
          console.log(`    Updated ORCID → ${normalizedOrcid}`);
          orcidUpdateCount++;
        }
      }
      continue;
    }

    // Name match
    const { rows } = await pg.query(
      `SELECT id, orcid FROM persons WHERE lower(given_name) = lower($1) AND lower(family_name) = lower($2)`,
      [given, surname]
    );

    if (rows.length > 0) {
      const pgId = rows[0].id;
      pbotIdToPgId.set(pbotID, pgId);
      console.log(`  Matched ${given} ${surname} → PG id=${pgId}`);
      matchCount++;

      // --- 3.4 Update ORCID if needed ---
      const normalizedOrcid = normalizeOrcid(person.orcid);
      if (normalizedOrcid) {
        const { rowCount } = await pg.query(
          `UPDATE persons SET orcid = $1 WHERE id = $2 AND (orcid IS NULL OR orcid = '')`,
          [normalizedOrcid, pgId]
        );
        if (rowCount > 0) {
          console.log(`    Updated ORCID → ${normalizedOrcid}`);
          orcidUpdateCount++;
        }
      }
    } else {
      // --- 3.3 Insert new person ---
      const normalizedOrcid = normalizeOrcid(person.orcid);

      // Insert with a temporary self-reference for authorizer_person_id
      // We first insert, then update authorizer_person_id to self
      const { rows: inserted } = await pg.query(
        `INSERT INTO persons (given_name, family_name, middle, email, password, orcid,
                              role_id, authorizer_person_id, gender_id, country_id,
                              institution, active, total_hours)
         VALUES ($1, $2, NULL, NULL, NULL, $3,
                 $4, $5, $6, $7,
                 NULL, true, NULL)
         RETURNING id`,
        [
          given,                   // $1 given_name
          surname,                 // $2 family_name
          normalizedOrcid,         // $3 orcid
          PERSON_ROLE_ID,          // $4 role_id
          AUTHORIZER_PERSON_ID,    // $5 authorizer_person_id (use Douglas Meredith temporarily)
          anonymousGenderId,       // $6 gender_id
          unknownCountryId,        // $7 country_id
        ]
      );

      const newId = inserted[0].id;

      // Update authorizer_person_id to self
      await pg.query(
        `UPDATE persons SET authorizer_person_id = $1 WHERE id = $1`,
        [newId]
      );

      pbotIdToPgId.set(pbotID, newId);
      console.log(`  Inserted ${given} ${surname} → PG id=${newId} (orcid=${normalizedOrcid || 'NULL'})`);
      insertCount++;
    }
  }

  // --- 3.5 Reset persons identity sequence ---

  if (insertCount > 0) {
    await pg.query(
      `SELECT setval(pg_get_serial_sequence('persons', 'id'), (SELECT MAX(id) FROM persons))`
    );
    console.log('  Persons identity sequence reset');
  }

  console.log(`  Person resolution: ${matchCount} matched, ${insertCount} inserted, ${orcidUpdateCount} ORCIDs updated`);

  // --- 3.6 pbotID → pgPersonId map is built (pbotIdToPgId) ---

  // --- 6.3 Ensure permid unique constraint exists ---

  await pg.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = '"references"'::regclass
          AND conname = 'references_permid_key'
      ) THEN
        ALTER TABLE "references" ADD CONSTRAINT references_permid_key UNIQUE (permid);
      END IF;
    END
    $$;
  `);
  console.log('  Ensured permid unique constraint on references');

  // --- 4.1–4.4 + 5.1 Transform and insert references ---

  let upsertCount = 0;
  let warningCount = 0;

  for (const ref of pbotOnlyRefs) {
    // 4.1 Resolve enterer
    const enteredByEntry = resolveEnterer(ref);
    if (!enteredByEntry || !enteredByEntry.Person) {
      console.warn(`  WARNING: Skipping reference ${ref.pbotID} — no enterer found`);
      warningCount++;
      continue;
    }

    const entererPbotId = enteredByEntry.Person.pbotID;
    const entererPgId = pbotIdToPgId.get(entererPbotId);
    if (!entererPgId) {
      console.warn(`  WARNING: Skipping reference ${ref.pbotID} — enterer ${entererPbotId} not resolved to PG id`);
      warningCount++;
      continue;
    }

    // 4.2 Map reference_type_id
    const pubType = ref.publicationType || null;
    let referenceTypeId = refTypeMap.get(pubType);
    if (!referenceTypeId) {
      if (pubType) {
        console.warn(`  WARNING: Reference ${ref.pbotID} unmapped publicationType '${pubType}' → "other"`);
        warningCount++;
      }
      referenceTypeId = refTypeMap.get('other');
    }

    // 4.3 + 4.4 Build JSONB
    const jsonb = buildReferenceJsonb(ref, refTypeMap);

    // 5.1 Upsert
    const permid = ref.pbotID;

    await pg.query(
      `INSERT INTO "references" (permid, reference_type_id, authorizer_person_id, enterer_person_id,
                                 reference, preceded_by_id, succeeded_by_id, removed)
       VALUES ($1, $2, $3, $4, $5, NULL, NULL, false)
       ON CONFLICT (permid) DO UPDATE SET
         reference_type_id = EXCLUDED.reference_type_id,
         authorizer_person_id = EXCLUDED.authorizer_person_id,
         enterer_person_id = EXCLUDED.enterer_person_id,
         reference = EXCLUDED.reference,
         removed = EXCLUDED.removed`,
      [
        permid,                  // $1
        referenceTypeId,         // $2
        AUTHORIZER_PERSON_ID,    // $3
        entererPgId,             // $4
        JSON.stringify(jsonb),   // $5
      ]
    );
    upsertCount++;
  }

  console.log(`  Upserted ${upsertCount} references`);

  // --- 5.2 Reset references identity sequence ---

  await pg.query(
    `SELECT setval(pg_get_serial_sequence('"references"', 'id'), (SELECT MAX(id) FROM "references"))`
  );
  console.log('  References identity sequence reset');

  // --- 6.2 Verification ---

  const { rows: countResult } = await pg.query(
    `SELECT COUNT(*)::int AS count FROM "references" WHERE permid = ANY($1)`,
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
  console.log(`  Warnings: ${warningCount}`);
  console.log(`[${endTime.toISOString()}] PBot refs migration complete in ${elapsed}s`);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exitCode = 1;
}).finally(() => pg.end());
