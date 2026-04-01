import { pg } from '../pg-pool.js';
import express from 'express';

const SCHEMA_QUERY = `
WITH RECURSIVE
target_schema AS (
  SELECT s.id, s.permid, s.schema, s.reference_id
  FROM schemas s
  WHERE s.permid = $1
    AND NOT COALESCE(s.removed, false)
),

char_tree AS (
  SELECT c.id, c.permid, c.character,
         c.parent_schema_id, c.parent_character_id,
         c.sort_order, 0 AS depth
  FROM characters c
  JOIN target_schema ts ON c.parent_schema_id = ts.id
  WHERE NOT COALESCE(c.removed, false)

  UNION ALL

  SELECT c.id, c.permid, c.character,
         c.parent_schema_id, c.parent_character_id,
         c.sort_order, ct.depth + 1
  FROM characters c
  JOIN char_tree ct ON c.parent_character_id = ct.id
  WHERE NOT COALESCE(c.removed, false)
),

state_tree AS (
  SELECT s.id, s.permid, s.state,
         s.parent_character_id, s.parent_state_id,
         s.sort_order, 0 AS depth
  FROM states s
  JOIN char_tree ct ON s.parent_character_id = ct.id
  WHERE NOT COALESCE(s.removed, false)

  UNION ALL

  SELECT s.id, s.permid, s.state,
         s.parent_character_id, s.parent_state_id,
         s.sort_order, st.depth + 1
  FROM states s
  JOIN state_tree st ON s.parent_state_id = st.id
  WHERE NOT COALESCE(s.removed, false)
)

SELECT
  ts.permid                              AS "pbotID",
  ts.schema->>'title'                    AS title,
  ts.schema->>'year'                     AS year,
  ts.schema->>'acknowledgments'          AS acknowledgments,
  ts.schema->>'purpose'                  AS purpose,
  ts.schema->'partsPreserved'            AS "partsPreserved",
  ts.schema->'notableFeatures'           AS "notableFeatures",
  ts.schema->'authors'                   AS authors,

  json_build_object(
    'pbotID', pr.permid,
    'title',  pr.reference->>'title',
    'year',   pr.reference->>'year'
  ) AS "primaryReference",

  (
    SELECT COALESCE(json_agg(json_build_object(
      'pbotID', ar.permid,
      'title',  ar.reference->>'title',
      'year',   ar.reference->>'year'
    )), '[]'::json)
    FROM additional_schema_refs asr
    JOIN refs ar ON asr.reference_id = ar.id
    WHERE asr.schema_id = ts.id
  ) AS "additionalReferences",

  (
    SELECT COALESCE(json_agg(json_build_object(
      'id',                ct.id,
      'pbotID',            ct.permid,
      'name',              ct.character->>'name',
      'definition',        ct.character->>'definition',
      'sortOrder',         ct.sort_order,
      'parentSchemaId',    ct.parent_schema_id,
      'parentCharacterId', ct.parent_character_id
    ) ORDER BY ct.depth, ct.sort_order NULLS LAST), '[]'::json)
    FROM char_tree ct
  ) AS characters,

  (
    SELECT COALESCE(json_agg(json_build_object(
      'id',                st.id,
      'pbotID',            st.permid,
      'name',              st.state->>'name',
      'definition',        st.state->>'definition',
      'sortOrder',         st.sort_order,
      'parentCharacterId', st.parent_character_id,
      'parentStateId',     st.parent_state_id
    ) ORDER BY st.depth, st.sort_order NULLS LAST), '[]'::json)
    FROM state_tree st
  ) AS states

FROM target_schema ts
LEFT JOIN refs pr ON ts.reference_id = pr.id;
`;

function buildSchemaTree(row) {
  const charMap = new Map();
  for (const c of row.characters) {
    charMap.set(c.id, { ...c, characters: [], states: [] });
  }

  const stateMap = new Map();
  for (const s of row.states) {
    stateMap.set(s.id, { ...s, states: [] });
  }

  for (const [, s] of stateMap) {
    if (s.parentStateId) {
      stateMap.get(s.parentStateId).states.push(s);
    } else if (s.parentCharacterId) {
      charMap.get(s.parentCharacterId).states.push(s);
    }
  }

  const topChars = [];
  for (const [, c] of charMap) {
    if (c.parentCharacterId) {
      charMap.get(c.parentCharacterId).characters.push(c);
    } else {
      topChars.push(c);
    }
  }

  const sortByOrder = (a, b) => (a.sortOrder ?? Infinity) - (b.sortOrder ?? Infinity);
  for (const [, c] of charMap) {
    c.characters.sort(sortByOrder);
    c.states.sort(sortByOrder);
  }
  for (const [, s] of stateMap) {
    s.states.sort(sortByOrder);
  }
  topChars.sort(sortByOrder);

  // Strip sortOrder from output — used only for sorting
  for (const [, c] of charMap) delete c.sortOrder;
  for (const [, s] of stateMap) delete s.sortOrder;

  return {
    pbotID: row.pbotID,
    title: row.title,
    year: row.year,
    acknowledgments: row.acknowledgments,
    purpose: row.purpose,
    partsPreserved: row.partsPreserved,
    notableFeatures: row.notableFeatures,
    authors: row.authors,
    primaryReference: row.primaryReference,
    additionalReferences: row.additionalReferences,
    characters: topChars,
  };
}

const app = express();

app.get('/schema/:permid', async (req, res) => {
  const { rows } = await pg.query(SCHEMA_QUERY, [req.params.permid]);

  if (rows.length === 0) {
    return res.status(404).json({ error: 'Schema not found' });
  }

  res.json(buildSchemaTree(rows[0]));
});

const PORT = process.env.PLAY_PORT || 3000;
app.listen(PORT, () => {
  console.log(`Listening on http://localhost:${PORT}`);
  console.log(`Try: GET http://localhost:${PORT}/schema/<permid>`);
});
