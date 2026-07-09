import { pg, closePg } from './pg-pool.js';
import { uuidv7 } from './uuidv7.js';

if (!process.env.PBOT_TOKEN) {
  console.error('Missing required .env variable: PBOT_TOKEN');
  process.exit(1);
}

// --- Constants ---

const PBOT_GRAPHQL_URL = 'https://pbot.paleobiodb.org/graphql';
const AUTHORIZER_PERSON_ID = 1106; // Douglas Meredith

const PARTS_PRESERVED_ENUMS = [
  'root',
  'shoot/axis/wood',
  'leaf',
  'pollen/spore',
  'inflorescence/flower',
  'infructescence/fruit',
  'ovuliferous (seed) cone',
  'staminate (pollen) cone',
  'seed',
  'cuticle',
  'other',
  'unknown',
];

const NOTABLE_FEATURES_ENUMS = [
  'cuticle/epidermal features',
  'wood anatomy (secondary growth)',
  'internal anatomy',
  'trace fossils (e.g., insect damage)',
];

// Build lowercase lookup maps for case-insensitive matching
const PARTS_PRESERVED_MAP = new Map(PARTS_PRESERVED_ENUMS.map((v) => [v.toLowerCase(), v]));
const NOTABLE_FEATURES_MAP = new Map(NOTABLE_FEATURES_ENUMS.map((v) => [v.toLowerCase(), v]));

// --- GraphQL queries ---

const SCHEMA_QUERY = `{
  Schema {
    pbotID
    title
    year
    purpose
    acknowledgments
    partsPreserved {
      type
    }
    notableFeatures {
      name
    }
    references {
      order
      Reference {
        pbotID
      }
    }
    authoredBy {
      order
      Person {
        given
        surname
      }
    }
    enteredBy {
      type
      timestamp { formatted }
      Person {
        pbotID
      }
    }
  }
}`;

const CHARACTER_QUERY = `{
  Character {
    pbotID
    name
    definition
    order
    characterOf {
      ... on Schema { pbotID }
      ... on Character { pbotID }
    }
    enteredBy {
      type
      timestamp { formatted }
      Person {
        pbotID
      }
    }
  }
}`;

const STATE_QUERY = `{
  State {
    pbotID
    name
    definition
    order
    stateOf {
      ... on Character { pbotID }
      ... on State { pbotID }
    }
    enteredBy {
      type
      timestamp { formatted }
      Person {
        pbotID
      }
    }
  }
}`;

// --- GraphQL fetch ---

async function fetchPbot(query, entityName) {
  const response = await fetch(PBOT_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.PBOT_TOKEN}`,
    },
    body: JSON.stringify({ query }),
  });

  if (!response.ok) {
    throw new Error(`GraphQL request failed: ${response.status} ${response.statusText}`);
  }

  const json = await response.json();
  if (json.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
  }

  return json.data[entityName];
}

// --- Enterer resolution ---

function resolveEnterer(record, label) {
  const entries = record.enteredBy || [];
  if (entries.length === 0) {
    console.warn(`  WARNING: ${label} ${record.pbotID} has no enteredBy entries`);
    return null;
  }

  const createEntry = entries.find((e) => e.type === 'CREATE');
  if (createEntry) return createEntry;

  console.warn(`  WARNING: ${label} ${record.pbotID} has no CREATE enteredBy — using earliest timestamp`);
  const sorted = [...entries].sort((a, b) => {
    const ta = a.timestamp?.formatted || '';
    const tb = b.timestamp?.formatted || '';
    return ta.localeCompare(tb);
  });
  return sorted[0];
}

// --- Lookup helpers ---

async function lookupPersonByPbotID(pbotID) {
  const { rows } = await pg.query(
    `SELECT id FROM persons WHERE person->'legacyIDs'->>'pbotID' = $1`,
    [pbotID]
  );
  return rows.length > 0 ? rows[0].id : null;
}

async function lookupRefByPbotID(pbotID) {
  const { rows } = await pg.query(
    `SELECT id FROM refs WHERE reference->'legacyIDs'->>'pbotID' = $1`,
    [pbotID]
  );
  return rows.length > 0 ? rows[0].id : null;
}

async function resolveEntererPgId(record, label) {
  const enteredByEntry = resolveEnterer(record, label);
  if (!enteredByEntry || !enteredByEntry.Person) return null;

  const pgId = await lookupPersonByPbotID(enteredByEntry.Person.pbotID);
  if (!pgId) {
    console.warn(`  WARNING: ${label} ${record.pbotID} — enterer pbotID ${enteredByEntry.Person.pbotID} not found in persons table`);
  }
  return pgId;
}

// --- Enum mapping ---

function mapEnumValues(values, enumMap, fieldName, recordPbotID) {
  if (!values || values.length === 0) return undefined;

  const mapped = [];
  for (const v of values) {
    // Handle both string values and relationship objects (e.g., { type: "leaf" })
    const raw = typeof v === 'string' ? v : v?.type || v?.name || '';
    if (!raw) continue;

    // Normalize: lowercase and collapse spaces around slashes for matching
    const normalized = raw.toLowerCase().replace(/\s*\/\s*/g, '/');
    const match = enumMap.get(normalized);
    if (match) {
      mapped.push(match);
    } else {
      console.warn(`  WARNING: Schema ${recordPbotID} — unrecognized ${fieldName} value: '${raw}'`);
    }
  }
  return mapped.length > 0 ? mapped : undefined;
}

// --- Schema JSONB builder ---

function buildSchemaJsonb(schema) {
  const jsonb = {
    legacyIDs: { pbotID: schema.pbotID },
    title: schema.title,
    year: schema.year,
  };

  if (schema.purpose && schema.purpose.trim()) {
    jsonb.purpose = schema.purpose.trim();
  }

  if (schema.acknowledgments && schema.acknowledgments.trim()) {
    jsonb.acknowledgments = schema.acknowledgments.trim();
  }

  // partsPreserved — case-insensitive enum mapping
  const parts = mapEnumValues(schema.partsPreserved, PARTS_PRESERVED_MAP, 'partsPreserved', schema.pbotID);
  if (parts) jsonb.partsPreserved = parts;

  // notableFeatures — case-insensitive enum mapping
  const features = mapEnumValues(schema.notableFeatures, NOTABLE_FEATURES_MAP, 'notableFeatures', schema.pbotID);
  if (features) jsonb.notableFeatures = features;

  // authors from authoredBy, sorted by order, preserving order value
  const authoredBy = schema.authoredBy || [];
  if (authoredBy.length > 0) {
    const sorted = [...authoredBy].sort((a, b) => {
      const oa = parseInt(a.order || '0', 10);
      const ob = parseInt(b.order || '0', 10);
      return oa - ob;
    });
    jsonb.authors = sorted.map((a) => ({
      familyName: a.Person?.surname || '',
      givenName: a.Person?.given || '',
      order: parseInt(a.order || '0', 10),
    }));
  }

  return jsonb;
}

// --- Character JSONB builder ---

function buildCharacterJsonb(character) {
  const jsonb = {
    legacyIDs: { pbotID: character.pbotID },
    name: character.name,
    definition: character.definition,
  };

  return jsonb;
}

// --- State JSONB builder ---

function buildStateJsonb(state) {
  const jsonb = {
    legacyIDs: { pbotID: state.pbotID },
    name: state.name,
    definition: state.definition,
  };

  return jsonb;
}

// --- Main ---

async function main() {
  const startTime = new Date();
  console.log(`[${startTime.toISOString()}] Starting PBot schema/character/state migration...`);

  const stats = {
    schemasFetched: 0, schemasInserted: 0, schemasSkipped: 0,
    additionalRefsInserted: 0,
    charactersFetched: 0, charactersInserted: 0, characterOrphans: 0, charactersSkipped: 0,
    statesFetched: 0, statesInserted: 0, stateOrphans: 0, statesSkipped: 0,
  };

  // =====================================================================
  // PHASE 1: Schemas
  // =====================================================================

  console.log(`\n  Fetching schemas from ${PBOT_GRAPHQL_URL}...`);
  const allSchemas = await fetchPbot(SCHEMA_QUERY, 'Schema');
  stats.schemasFetched = allSchemas.length;
  console.log(`  Fetched ${allSchemas.length} schemas from PBot`);

  const schemaPbotIdToId = new Map(); // pbotID → PG id

  for (const schema of allSchemas) {
    // Resolve enterer
    const entererPgId = await resolveEntererPgId(schema, 'Schema');
    if (!entererPgId) {
      console.warn(`  WARNING: Skipping schema ${schema.pbotID} — no enterer resolved`);
      stats.schemasSkipped++;
      continue;
    }

    // Resolve references — sort by order, lowest = primary
    const refs = schema.references || [];
    if (refs.length === 0) {
      console.warn(`  WARNING: Skipping schema ${schema.pbotID} — no references`);
      stats.schemasSkipped++;
      continue;
    }

    const sortedRefs = [...refs].sort((a, b) => {
      const oa = parseInt(a.order || '0', 10);
      const ob = parseInt(b.order || '0', 10);
      return oa - ob;
    });

    // Primary reference (lowest order)
    const primaryRefPbotID = sortedRefs[0].Reference?.pbotID;
    if (!primaryRefPbotID) {
      console.warn(`  WARNING: Skipping schema ${schema.pbotID} — primary reference has no pbotID`);
      stats.schemasSkipped++;
      continue;
    }

    const primaryRefPgId = await lookupRefByPbotID(primaryRefPbotID);
    if (!primaryRefPgId) {
      console.warn(`  WARNING: Skipping schema ${schema.pbotID} — primary reference pbotID ${primaryRefPbotID} not found in refs table`);
      stats.schemasSkipped++;
      continue;
    }

    // Build JSONB
    const jsonb = buildSchemaJsonb(schema);

    // Insert schema
    const { rows } = await pg.query(
      `INSERT INTO schemas (permid, authorizer_person_id, enterer_person_id, schema, reference_id, preceded_by_id, succeeded_by_id, removed)
       VALUES ($1, $2, $3, $4, $5, NULL, NULL, false)
       RETURNING id`,
      [
        uuidv7(), // generated permid; pbotID preserved in schema.legacyIDs.pbotID
        AUTHORIZER_PERSON_ID,
        entererPgId,
        JSON.stringify(jsonb),
        primaryRefPgId,
      ]
    );
    const schemaId = rows[0].id;
    schemaPbotIdToId.set(schema.pbotID, schemaId);
    stats.schemasInserted++;

    // Insert additional references
    for (let i = 1; i < sortedRefs.length; i++) {
      const addlRefPbotID = sortedRefs[i].Reference?.pbotID;
      if (!addlRefPbotID) {
        console.warn(`  WARNING: Schema ${schema.pbotID} — additional reference at order ${sortedRefs[i].order} has no pbotID, skipping`);
        continue;
      }

      const addlRefPgId = await lookupRefByPbotID(addlRefPbotID);
      if (!addlRefPgId) {
        console.warn(`  WARNING: Schema ${schema.pbotID} — additional reference pbotID ${addlRefPbotID} not found in refs table, skipping`);
        continue;
      }

      await pg.query(
        `INSERT INTO additional_schema_refs (authorizer_person_id, enterer_person_id, schema_id, reference_id)
         VALUES ($1, $2, $3, $4)`,
        [AUTHORIZER_PERSON_ID, entererPgId, schemaId, addlRefPgId]
      );
      stats.additionalRefsInserted++;
    }
  }

  console.log(`  Inserted ${stats.schemasInserted} schemas (skipped ${stats.schemasSkipped})`);
  console.log(`  Inserted ${stats.additionalRefsInserted} additional schema refs`);

  // =====================================================================
  // PHASE 2: Characters (level-by-level)
  // =====================================================================

  console.log(`\n  Fetching characters from ${PBOT_GRAPHQL_URL}...`);
  const allCharacters = await fetchPbot(CHARACTER_QUERY, 'Character');
  stats.charactersFetched = allCharacters.length;
  console.log(`  Fetched ${allCharacters.length} characters from PBot`);

  const charPbotIdToId = new Map(); // pbotID → PG id
  let remaining = [...allCharacters];
  let level = 0;

  while (remaining.length > 0) {
    const nextRemaining = [];
    let insertedThisLevel = 0;

    for (const char of remaining) {
      // Determine parent — characterOf is a union (Schema | Character),
      // returns { pbotID } — disambiguate by checking known schema pbotIDs
      let parentSchemaId = null;
      let parentCharacterId = null;

      const parentPbotID = char.characterOf?.pbotID;

      if (!parentPbotID) {
        nextRemaining.push(char);
        continue;
      }

      if (schemaPbotIdToId.has(parentPbotID)) {
        // Parent is a schema
        parentSchemaId = schemaPbotIdToId.get(parentPbotID);
      } else if (charPbotIdToId.has(parentPbotID)) {
        // Parent is a character already inserted
        parentCharacterId = charPbotIdToId.get(parentPbotID);
      } else {
        // Parent not yet inserted — defer to next level
        nextRemaining.push(char);
        continue;
      }

      // Resolve enterer
      const entererPgId = await resolveEntererPgId(char, 'Character');
      if (!entererPgId) {
        console.warn(`  WARNING: Skipping character ${char.pbotID} — no enterer resolved`);
        stats.charactersSkipped++;
        continue;
      }

      const jsonb = buildCharacterJsonb(char);

      const sortOrder = char.order != null ? parseInt(char.order, 10) : null;

      const { rows } = await pg.query(
        `INSERT INTO characters (permid, authorizer_person_id, enterer_person_id, parent_schema_id, parent_character_id, sort_order, character, preceded_by_id, succeeded_by_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, NULL)
         RETURNING id`,
        [
          uuidv7(), // generated permid; pbotID preserved in character.legacyIDs.pbotID
          AUTHORIZER_PERSON_ID,
          entererPgId,
          parentSchemaId,
          parentCharacterId,
          isNaN(sortOrder) ? null : sortOrder,
          JSON.stringify(jsonb),
        ]
      );
      charPbotIdToId.set(char.pbotID, rows[0].id);
      insertedThisLevel++;
      stats.charactersInserted++;
    }

    console.log(`  Characters level ${level}: inserted ${insertedThisLevel}`);

    if (insertedThisLevel === 0) {
      // No progress — everything remaining is an orphan
      for (const orphan of nextRemaining) {
        const orphanParent = orphan.characterOf?.pbotID || 'unknown';
        console.warn(`  ORPHAN: Character ${orphan.pbotID} — unresolved parent ${orphanParent}`);
      }
      stats.characterOrphans = nextRemaining.length;
      break;
    }

    remaining = nextRemaining;
    level++;
  }

  console.log(`  Inserted ${stats.charactersInserted} characters total (${stats.characterOrphans} orphans, ${stats.charactersSkipped} skipped)`);

  // =====================================================================
  // PHASE 3: States (level-by-level)
  // =====================================================================

  console.log(`\n  Fetching states from ${PBOT_GRAPHQL_URL}...`);
  const allStates = await fetchPbot(STATE_QUERY, 'State');
  stats.statesFetched = allStates.length;
  console.log(`  Fetched ${allStates.length} states from PBot`);

  const statePbotIdToId = new Map(); // pbotID → PG id
  remaining = [...allStates];
  level = 0;

  while (remaining.length > 0) {
    const nextRemaining = [];
    let insertedThisLevel = 0;

    for (const state of remaining) {
      // Determine parent — stateOf is a union (Character | State),
      // returns { pbotID } — disambiguate by checking known character pbotIDs
      let parentCharacterId = null;
      let parentStateId = null;

      const parentPbotID = state.stateOf?.pbotID;

      if (!parentPbotID) {
        nextRemaining.push(state);
        continue;
      }

      if (charPbotIdToId.has(parentPbotID)) {
        // Parent is a character
        parentCharacterId = charPbotIdToId.get(parentPbotID);
      } else if (statePbotIdToId.has(parentPbotID)) {
        // Parent is a state already inserted
        parentStateId = statePbotIdToId.get(parentPbotID);
      } else {
        // Parent not yet inserted — defer to next level
        nextRemaining.push(state);
        continue;
      }

      // Resolve enterer
      const entererPgId = await resolveEntererPgId(state, 'State');
      if (!entererPgId) {
        console.warn(`  WARNING: Skipping state ${state.pbotID} — no enterer resolved`);
        stats.statesSkipped++;
        continue;
      }

      const jsonb = buildStateJsonb(state);

      // Quantitative flag
      const quantitative = (state.name || '').toLowerCase() === 'quantity';

      const sortOrder = state.order != null ? parseInt(state.order, 10) : null;

      const { rows } = await pg.query(
        `INSERT INTO states (permid, authorizer_person_id, enterer_person_id, parent_character_id, parent_state_id, sort_order, state, quantitative, preceded_by_id, succeeded_by_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, NULL)
         RETURNING id`,
        [
          uuidv7(), // generated permid; pbotID preserved in state.legacyIDs.pbotID
          AUTHORIZER_PERSON_ID,
          entererPgId,
          parentCharacterId,
          parentStateId,
          isNaN(sortOrder) ? null : sortOrder,
          JSON.stringify(jsonb),
          quantitative,
        ]
      );
      statePbotIdToId.set(state.pbotID, rows[0].id);
      insertedThisLevel++;
      stats.statesInserted++;
    }

    console.log(`  States level ${level}: inserted ${insertedThisLevel}`);

    if (insertedThisLevel === 0) {
      for (const orphan of nextRemaining) {
        const orphanParent = orphan.stateOf?.pbotID || 'unknown';
        console.warn(`  ORPHAN: State ${orphan.pbotID} — unresolved parent ${orphanParent}`);
      }
      stats.stateOrphans = nextRemaining.length;
      break;
    }

    remaining = nextRemaining;
    level++;
  }

  console.log(`  Inserted ${stats.statesInserted} states total (${stats.stateOrphans} orphans, ${stats.statesSkipped} skipped)`);

  // =====================================================================
  // PHASE 4: Finalization
  // =====================================================================

  // Reset identity sequences
  for (const table of ['schemas', 'characters', 'states']) {
    await pg.query(
      `SELECT setval(pg_get_serial_sequence('${table}', 'id'), (SELECT COALESCE(MAX(id), 1) FROM ${table}))`
    );
  }
  console.log('\n  Identity sequences reset for schemas, characters, states');

  // Summary
  const endTime = new Date();
  const elapsed = ((endTime - startTime) / 1000).toFixed(1);

  console.log('\n  === Migration Summary ===');
  console.log(`  Schemas:    fetched=${stats.schemasFetched}, inserted=${stats.schemasInserted}, skipped=${stats.schemasSkipped}`);
  console.log(`  Additional refs: inserted=${stats.additionalRefsInserted}`);
  console.log(`  Characters: fetched=${stats.charactersFetched}, inserted=${stats.charactersInserted}, orphans=${stats.characterOrphans}, skipped=${stats.charactersSkipped}`);
  console.log(`  States:     fetched=${stats.statesFetched}, inserted=${stats.statesInserted}, orphans=${stats.stateOrphans}, skipped=${stats.statesSkipped}`);
  console.log(`[${endTime.toISOString()}] Migration complete in ${elapsed}s`);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exitCode = 1;
}).finally(() => closePg());
