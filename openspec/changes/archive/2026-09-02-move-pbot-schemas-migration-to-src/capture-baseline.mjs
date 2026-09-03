// Capture the schemas/characters/states/additional_schema_refs baseline used to verify
// move-pbot-schemas-migration-to-src.
//
// migrate-pbot-schemas.js is not idempotent, so the move is verified by a clear-and-reload
// rather than by a re-run (see design.md decision 3). The reload renumbers every surrogate id
// -- the script's finalization does setval(..., MAX(id)) rather than RESTART IDENTITY -- and
// mints a fresh permid per row, so a naive column-wise diff reports every row as changed while
// nothing is actually wrong.
//
// Two forms are therefore captured (design.md decision 4):
//
//   <table>.json            payload form -- the JSONB document, with id and permid projected out
//   <table>_structure.json  structural form -- every FK resolved through to the target row's
//                           legacyIDs->>'pbotID', so it is invariant under renumbering
//
// The structural form is what actually proves the move preserved behavior. The payload form
// shows the documents round-tripped unchanged.
//
// Usage:  node openspec/changes/move-pbot-schemas-migration-to-src/capture-baseline.mjs [outDir]
//
// Re-runnable at any point before the TRUNCATE, since the relocation touches no data.

import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

import { pg, closePg } from '../../../src/lib/pg-pool.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(process.argv[2] || `${HERE}/baseline`);

const TABLES = ['schemas', 'characters', 'states', 'additional_schema_refs'];

// Payload form: id and permid deliberately omitted -- both change legitimately on reload.
const PAYLOAD_QUERIES = {
  schemas: `
    SELECT schema->'legacyIDs'->>'pbotID' AS pbot_id, authorizer_person_id, enterer_person_id,
           reference_id, removed, schema AS payload
    FROM schemas ORDER BY 1`,
  characters: `
    SELECT character->'legacyIDs'->>'pbotID' AS pbot_id, authorizer_person_id, enterer_person_id,
           parent_schema_id, parent_character_id, sort_order, character AS payload
    FROM characters ORDER BY 1`,
  states: `
    SELECT state->'legacyIDs'->>'pbotID' AS pbot_id, authorizer_person_id, enterer_person_id,
           parent_character_id, parent_state_id, sort_order, quantitative, state AS payload
    FROM states ORDER BY 1`,
  additional_schema_refs: `
    SELECT authorizer_person_id, enterer_person_id, schema_id, reference_id
    FROM additional_schema_refs ORDER BY schema_id, reference_id`,
};

// Structural form: every FK resolved to the target's pbotID, so it survives id renumbering.
const STRUCTURE_QUERIES = {
  schemas_structure: `
    SELECT s.schema->'legacyIDs'->>'pbotID'    AS pbot_id,
           r.reference->'legacyIDs'->>'pbotID' AS reference_pbot_id,
           p.person->'legacyIDs'->>'pbotID'    AS enterer_pbot_id,
           s.authorizer_person_id, s.removed
    FROM schemas s
    LEFT JOIN refs r    ON r.id = s.reference_id
    LEFT JOIN persons p ON p.id = s.enterer_person_id
    ORDER BY 1`,
  characters_structure: `
    SELECT c.character->'legacyIDs'->>'pbotID'  AS pbot_id,
           s.schema->'legacyIDs'->>'pbotID'     AS parent_schema_pbot_id,
           pc.character->'legacyIDs'->>'pbotID' AS parent_character_pbot_id,
           c.sort_order
    FROM characters c
    LEFT JOIN schemas s     ON s.id  = c.parent_schema_id
    LEFT JOIN characters pc ON pc.id = c.parent_character_id
    ORDER BY 1`,
  states_structure: `
    SELECT st.state->'legacyIDs'->>'pbotID'    AS pbot_id,
           c.character->'legacyIDs'->>'pbotID' AS parent_character_pbot_id,
           ps.state->'legacyIDs'->>'pbotID'    AS parent_state_pbot_id,
           st.sort_order, st.quantitative
    FROM states st
    LEFT JOIN characters c ON c.id  = st.parent_character_id
    LEFT JOIN states ps    ON ps.id = st.parent_state_id
    ORDER BY 1`,
  additional_schema_refs_structure: `
    SELECT s.schema->'legacyIDs'->>'pbotID'    AS schema_pbot_id,
           r.reference->'legacyIDs'->>'pbotID' AS reference_pbot_id,
           a.authorizer_person_id
    FROM additional_schema_refs a
    JOIN schemas s   ON s.id = a.schema_id
    LEFT JOIN refs r ON r.id = a.reference_id
    ORDER BY 1, 2`,
};

async function main() {
  mkdirSync(outDir, { recursive: true });

  const counts = {};
  for (const t of TABLES) {
    counts[t] = Number((await pg.query(`SELECT count(*) AS c FROM ${t}`)).rows[0].c);
  }
  writeFileSync(`${outDir}/counts.json`, JSON.stringify(counts, null, 2) + '\n');
  console.log('counts', JSON.stringify(counts));

  for (const [name, sql] of Object.entries({ ...PAYLOAD_QUERIES, ...STRUCTURE_QUERIES })) {
    const { rows } = await pg.query(sql);
    writeFileSync(`${outDir}/${name}.json`, JSON.stringify(rows, null, 2) + '\n');
    console.log(`wrote ${name}.json (${rows.length} rows)`);
  }

  // The structural diff is only meaningful if the joins are total; an unresolvable FK would
  // show up as a null on both sides and mask a real difference.
  const unresolved = await pg.query(`
    SELECT
      (SELECT count(*) FROM schemas s
         LEFT JOIN refs r ON r.id = s.reference_id WHERE r.id IS NULL)      AS schemas_no_ref,
      (SELECT count(*) FROM schemas s
         LEFT JOIN persons p ON p.id = s.enterer_person_id
         WHERE p.id IS NULL)                                               AS schemas_no_enterer,
      (SELECT count(*) FROM characters
         WHERE parent_schema_id IS NULL AND parent_character_id IS NULL)   AS characters_no_parent,
      (SELECT count(*) FROM states
         WHERE parent_character_id IS NULL AND parent_state_id IS NULL)    AS states_no_parent`);
  console.log('unresolved joins', JSON.stringify(unresolved.rows[0]));

  console.log(`\nbaseline written to ${outDir}`);
}

main()
  .catch((err) => {
    console.error('Baseline capture failed:', err);
    process.exitCode = 1;
  })
  .finally(() => closePg());
