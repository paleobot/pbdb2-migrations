import 'dotenv/config';

import { Pool } from 'pg';

// --- PG-only connection (no MariaDB dependency) ---

const REQUIRED_VARS = ['PG_HOST', 'PG_USER', 'PG_PASSWORD', 'PG_DATABASE', 'PBOT_TOKEN'];
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
const PERSON_ROLE_ID = 6; // "Person" role

// --- GraphQL fetch ---

const PBOT_QUERY = `{
  Person {
    pbotID
    given
    surname
    email
    orcid
    registered
  }
}`;

async function fetchPbotPersons() {
  const response = await fetch(PBOT_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.PBOT_TOKEN}`,
    },
    body: JSON.stringify({ query: PBOT_QUERY }),
  });

  if (!response.ok) {
    throw new Error(`GraphQL request failed: ${response.status} ${response.statusText}`);
  }

  const json = await response.json();
  if (json.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
  }

  return json.data.Person;
}

// --- ORCID normalization ---

function normalizeOrcid(orcid) {
  if (!orcid || !orcid.trim()) return null;
  return orcid.trim().replace(/^https?:\/\/orcid\.org\//, '');
}

// --- Match cascade ---

async function matchPerson(person, normalizedOrcid) {
  // 1. ORCID match
  if (normalizedOrcid) {
    const { rows } = await pg.query(
      `SELECT id, email, orcid FROM persons WHERE orcid = $1`,
      [normalizedOrcid]
    );
    if (rows.length > 0) {
      return { match: rows[0], method: 'orcid' };
    }
  }

  // 2. Email match (case-insensitive)
  if (person.email && person.email.trim()) {
    const { rows } = await pg.query(
      `SELECT id, email, orcid FROM persons WHERE lower(email) = lower($1)`,
      [person.email.trim()]
    );
    if (rows.length > 0) {
      return { match: rows[0], method: 'email' };
    }
  }

  // 3. Name match (case-insensitive)
  const given = (person.given || '').trim();
  const surname = (person.surname || '').trim();
  if (given && surname) {
    const { rows } = await pg.query(
      `SELECT id, email, orcid FROM persons WHERE lower(given_name) = lower($1) AND lower(family_name) = lower($2)`,
      [given, surname]
    );
    if (rows.length === 1) {
      return { match: rows[0], method: 'name' };
    }
    if (rows.length > 1) {
      return { match: null, method: 'ambiguous', pgIds: rows.map((r) => r.id) };
    }
  }

  return { match: null, method: 'none' };
}

// --- Main ---

async function main() {
  const startTime = new Date();
  console.log(`[${startTime.toISOString()}] Starting PBot persons migration...`);

  // --- Load dictionary lookups ---

  const { rows: genderRows } = await pg.query(
    `SELECT id, genders FROM dictionaries.genders`
  );
  const genderMap = Object.fromEntries(genderRows.map((r) => [r.genders, r.id]));
  const anonymousGenderId = genderMap['Anonymous'];
  if (!anonymousGenderId) throw new Error('Anonymous gender not found in dictionaries.genders');
  console.log(`  Anonymous gender_id: ${anonymousGenderId}`);

  // --- Fetch PBot persons ---

  console.log(`  Fetching persons from ${PBOT_GRAPHQL_URL}...`);
  const allPersons = await fetchPbotPersons();
  console.log(`  Fetched ${allPersons.length} persons from PBot`);

  // --- Filter by email ---

  const personsWithEmail = allPersons.filter((p) => p.email && p.email.trim());
  const filteredCount = allPersons.length - personsWithEmail.length;
  console.log(`  Filtered out ${filteredCount} persons without email`);
  console.log(`  Processing ${personsWithEmail.length} persons with email`);

  // --- Process each person ---

  const counts = {
    orcidMatch: 0,
    emailMatch: 0,
    nameMatch: 0,
    ambiguousSkip: 0,
    inserted: 0,
    orcidBackfill: 0,
    emailBackfill: 0,
  };

  for (const person of personsWithEmail) {
    const normalizedOrcid = normalizeOrcid(person.orcid);
    const given = (person.given || '').trim();
    const surname = (person.surname || '').trim();
    const email = person.email.trim();

    const result = await matchPerson(person, normalizedOrcid);

    if (result.method === 'ambiguous') {
      console.warn(`  WARNING: Ambiguous name match for PBot ${person.pbotID} (${given} ${surname}) — PG ids: [${result.pgIds.join(', ')}]. Skipping.`);
      counts.ambiguousSkip++;
      continue;
    }

    if (result.match) {
      // Matched — backfill ORCID and email if needed
      const pgPerson = result.match;
      counts[`${result.method}Match`]++;
      console.log(`  Matched ${given} ${surname} → PG id=${pgPerson.id} (via ${result.method})`);

      // Backfill ORCID
      if (normalizedOrcid && (!pgPerson.orcid || !pgPerson.orcid.trim())) {
        await pg.query(
          `UPDATE persons SET orcid = $1 WHERE id = $2`,
          [normalizedOrcid, pgPerson.id]
        );
        console.log(`    Backfilled ORCID → ${normalizedOrcid}`);
        counts.orcidBackfill++;
      }

      // Backfill email (only for ORCID or name matches — email matches already have it)
      if (result.method !== 'email' && (!pgPerson.email || !pgPerson.email.trim())) {
        await pg.query(
          `UPDATE persons SET email = $1 WHERE id = $2`,
          [email, pgPerson.id]
        );
        console.log(`    Backfilled email → ${email}`);
        counts.emailBackfill++;
      }
    } else {
      // No match — insert new person
      const { rows: inserted } = await pg.query(
        `INSERT INTO persons (given_name, family_name, middle, email, password, orcid,
                              role_id, authorizer_person_id, gender_id, country_code,
                              institution, active, total_hours)
         VALUES ($1, $2, NULL, $3, NULL, $4,
                 $5, $6, $7, NULL,
                 NULL, true, NULL)
         RETURNING id`,
        [
          given,                   // $1 given_name
          surname,                 // $2 family_name
          email,                   // $3 email
          normalizedOrcid,         // $4 orcid
          PERSON_ROLE_ID,          // $5 role_id
          AUTHORIZER_PERSON_ID,    // $6 authorizer_person_id
          anonymousGenderId,       // $7 gender_id
        ]
      );

      console.log(`  Inserted ${given} ${surname} → PG id=${inserted[0].id} (email=${email}, orcid=${normalizedOrcid || 'NULL'})`);
      counts.inserted++;
    }
  }

  // --- Reset identity sequence if inserts occurred ---

  if (counts.inserted > 0) {
    await pg.query(
      `SELECT setval(pg_get_serial_sequence('persons', 'id'), (SELECT MAX(id) FROM persons))`
    );
    console.log('  Persons identity sequence reset');
  }

  // --- Summary ---

  const endTime = new Date();
  const elapsed = ((endTime - startTime) / 1000).toFixed(1);
  console.log(`  Match summary: ${counts.orcidMatch} by ORCID, ${counts.emailMatch} by email, ${counts.nameMatch} by name`);
  console.log(`  Ambiguous name matches skipped: ${counts.ambiguousSkip}`);
  console.log(`  New persons inserted: ${counts.inserted}`);
  console.log(`  Backfills: ${counts.orcidBackfill} ORCIDs, ${counts.emailBackfill} emails`);
  console.log(`[${endTime.toISOString()}] PBot persons migration complete in ${elapsed}s`);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exitCode = 1;
}).finally(() => pg.end());
