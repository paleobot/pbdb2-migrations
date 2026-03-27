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
      `SELECT id, person->>'email' AS email, person->>'orcid' AS orcid FROM persons WHERE person->>'orcid' = $1`,
      [normalizedOrcid]
    );
    if (rows.length > 0) {
      return { match: rows[0], method: 'orcid' };
    }
  }

  // 2. Email match (case-insensitive)
  if (person.email && person.email.trim()) {
    const { rows } = await pg.query(
      `SELECT id, person->>'email' AS email, person->>'orcid' AS orcid FROM persons WHERE lower(person->>'email') = lower($1)`,
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
      `SELECT id, person->>'email' AS email, person->>'orcid' AS orcid FROM persons WHERE lower(person->>'givenName') = lower($1) AND lower(person->>'familyName') = lower($2)`,
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
          `UPDATE persons SET person = jsonb_set(person, '{orcid}', to_jsonb($1::text)) WHERE id = $2`,
          [normalizedOrcid, pgPerson.id]
        );
        console.log(`    Backfilled ORCID → ${normalizedOrcid}`);
        counts.orcidBackfill++;
      }

      // Backfill email (only for ORCID or name matches — email matches already have it)
      if (result.method !== 'email' && (!pgPerson.email || !pgPerson.email.trim())) {
        await pg.query(
          `UPDATE persons SET person = jsonb_set(person, '{email}', to_jsonb($1::text)) WHERE id = $2`,
          [email, pgPerson.id]
        );
        console.log(`    Backfilled email → ${email}`);
        counts.emailBackfill++;
      }

      // Backfill legacyIDs.pbotID
      await pg.query(
        `UPDATE persons SET person = person || jsonb_build_object('legacyIDs',
          COALESCE(person->'legacyIDs', '{}'::jsonb) || jsonb_build_object('pbotID', $1::text)
        ) WHERE id = $2`,
        [person.pbotID, pgPerson.id]
      );
      console.log(`    Backfilled legacyIDs.pbotID → ${person.pbotID}`);
    } else {
      // No match — insert new person with JSONB
      const personJsonb = {
        givenName: given,
        familyName: surname,
        gender: 'Anonymous',
        legacyIDs: { pbotID: person.pbotID },
      };
      if (email) personJsonb.email = email;
      if (normalizedOrcid) personJsonb.orcid = normalizedOrcid;

      const { rows: inserted } = await pg.query(
        `INSERT INTO persons (password, role_id, person, authorizer_person_id, active, total_hours)
         VALUES (NULL, $1, $2, $3, true, NULL)
         RETURNING id`,
        [
          PERSON_ROLE_ID,          // $1 role_id
          personJsonb,             // $2 person (JSONB)
          AUTHORIZER_PERSON_ID,    // $3 authorizer_person_id
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
