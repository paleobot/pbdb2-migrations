import { pg, closePg } from '../lib/pg-pool.js';
import { uuidv7 } from '../lib/uuidv7.js';
import { personSource } from '../../payloadSchemas/person.schema.js';
import { resolveEnums } from '../../payloadSchemas/lib/enums.js';
import { deriveVariant } from '../../payloadSchemas/lib/variants.js';
import { createAjv } from '../../payloadSchemas/lib/ajv.js';

if (!process.env.PBOT_TOKEN) {
  console.error('Missing required .env variable: PBOT_TOKEN');
  process.exit(1);
}

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

// The whole `person` object is selected, not just the two properties the
// cascade compares: the backfills are applied to it in memory and it is written
// back entire, so that one validated UPDATE replaces the three jsonb_set
// statements this script used to issue. See
// openspec/specs/pbot-person-migration/spec.md.
const MATCH_COLUMNS = `id, person`;

async function matchPerson(person, normalizedOrcid) {
  // 1. ORCID match
  if (normalizedOrcid) {
    const { rows } = await pg.query(
      `SELECT ${MATCH_COLUMNS} FROM persons WHERE person->>'orcid' = $1`,
      [normalizedOrcid]
    );
    if (rows.length > 0) {
      return { match: rows[0], method: 'orcid' };
    }
  }

  // 2. Email match (case-insensitive)
  if (person.email && person.email.trim()) {
    const { rows } = await pg.query(
      `SELECT ${MATCH_COLUMNS} FROM persons WHERE lower(person->>'email') = lower($1)`,
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
      `SELECT ${MATCH_COLUMNS} FROM persons WHERE lower(person->>'givenName') = lower($1) AND lower(person->>'familyName') = lower($2)`,
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

  // --- Resolve the schema (before any PBot data is fetched) ---

  // Every `person` object this script writes -- inserted or backfilled -- is
  // validated against the db variant first. Resolving up front means an empty or
  // missing dictionary aborts before the GraphQL request rather than part way
  // through the cascade. See openspec/specs/pbot-person-migration/spec.md.
  const validate = createAjv().compile(deriveVariant(await resolveEnums(pg, personSource), 'db'));
  console.log('  Person db schema resolved and compiled');

  const validated = (person, label) => {
    if (validate(person)) return person;
    console.error(`  VALIDATION FAILED for ${label}`);
    console.error('  errors:', JSON.stringify(validate.errors, null, 2));
    console.error('  person:', JSON.stringify(person, null, 2));
    throw new Error('payload failed person db-schema validation');
  };

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
    pbotIdBackfill: 0,
    unchanged: 0,
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
      // Matched — apply the ORCID, email and pbotID backfills to the stored
      // object in memory, then validate and write it once. Three jsonb_set
      // statements wrote a shape no validator ever saw, and a validator at the
      // insert site alone would never have covered them.
      const pgPerson = result.match;
      counts[`${result.method}Match`]++;
      console.log(`  Matched ${given} ${surname} → PG id=${pgPerson.id} (via ${result.method})`);

      const updated = structuredClone(pgPerson.person);
      let changed = false;

      // Backfill ORCID
      if (normalizedOrcid && !updated.orcid?.trim()) {
        updated.orcid = normalizedOrcid;
        changed = true;
        console.log(`    Backfilled ORCID → ${normalizedOrcid}`);
        counts.orcidBackfill++;
      }

      // Backfill email (only for ORCID or name matches — email matches already have it)
      if (result.method !== 'email' && !updated.email?.trim()) {
        updated.email = email;
        changed = true;
        console.log(`    Backfilled email → ${email}`);
        counts.emailBackfill++;
      }

      // Backfill legacyIDs.pbotID, preserving any existing legacyIDs (oldpbdbID)
      if (updated.legacyIDs?.pbotID !== person.pbotID) {
        updated.legacyIDs = { ...updated.legacyIDs, pbotID: person.pbotID };
        changed = true;
        console.log(`    Backfilled legacyIDs.pbotID → ${person.pbotID}`);
        counts.pbotIdBackfill++;
      }

      if (changed) {
        await pg.query(
          `UPDATE persons SET person = $1 WHERE id = $2`,
          [validated(updated, `PG id=${pgPerson.id}`), pgPerson.id]
        );
      } else {
        counts.unchanged++;
      }
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

      // A minted permid, NOT the pbotID. pbotID is itself a UUID and is
      // therefore tempting to reuse here, but permid-uuidv7 forbids adopting an
      // externally-sourced identifier as a permid; pbotID stays in legacyIDs,
      // where the cross-entity lookups expect to find it.
      //
      // This is the only place this script mints a permid. Persons matched by
      // the ORCID/email/name cascade keep the permid migrate-persons.js gave
      // them -- minting a second one would contradict the match just made.
      const { rows: inserted } = await pg.query(
        `INSERT INTO persons (permid, password, role_id, person, authorizer_person_id, active, total_hours)
         VALUES ($1, NULL, $2, $3, $4, true, NULL)
         RETURNING id`,
        [
          uuidv7(),                // $1 permid (minted; never the pbotID)
          PERSON_ROLE_ID,          // $2 role_id
          validated(personJsonb, `PBot ${person.pbotID} (${given} ${surname})`), // $3 person (JSONB)
          AUTHORIZER_PERSON_ID,    // $4 authorizer_person_id
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
  console.log(`  Backfills: ${counts.orcidBackfill} ORCIDs, ${counts.emailBackfill} emails, ${counts.pbotIdBackfill} pbotIDs`);
  console.log(`  Matched persons needing no write: ${counts.unchanged}`);
  console.log(`[${endTime.toISOString()}] PBot persons migration complete in ${elapsed}s`);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exitCode = 1;
}).finally(() => closePg());
