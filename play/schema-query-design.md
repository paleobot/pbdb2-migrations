# Schema Query Design: GraphQL to PostgreSQL

## Overview

This document describes how to replicate the PBot GraphQL `Schema` query using the PostgreSQL database. The GraphQL query returns a full schema including metadata, references, authors, and a recursively nested tree of characters and states.

## Field Mapping

| GraphQL Field | PostgreSQL Source |
|---|---|
| `Schema.pbotID` | `schemas.permid` |
| `Schema.title` | `schemas.schema->>'title'` |
| `Schema.year` | `schemas.schema->>'year'` |
| `Schema.acknowledgments` | `schemas.schema->>'acknowledgments'` |
| `Schema.purpose` | `schemas.schema->>'purpose'` |
| `Schema.partsPreserved` | `schemas.schema->'partsPreserved'` (jsonb string array) |
| `Schema.notableFeatures` | `schemas.schema->'notableFeatures'` (jsonb string array) |
| `Schema.references` | `schemas.reference_id` (primary) + `additional_schema_refs` (secondary) |
| `Schema.authoredBy` | `schemas.schema->'authors'` (jsonb array with givenName, familyName, order) |
| `Schema.characters` | `characters` table (recursive via `parent_character_id`) |
| `characters.states` | `states` table (recursive via `parent_state_id`) |
| `Schema.elementOf` | Not migrated (was for PBot group membership) |

### Notable Differences from GraphQL

- **References**: PBot has an ordered list; PG splits into a single `reference_id` (primary) and `additional_schema_refs` (secondaries).
- **Authors**: PBot links to Person nodes via `authoredBy`; PG embeds author name/order directly in the schema jsonb.
- **partsPreserved/notableFeatures**: PBot returns objects (`{type: "..."}`, `{name: "..."}`); PG stores plain string arrays in jsonb.

## SQL Query

Uses recursive CTEs to traverse the character and state trees. Returns characters and states as flat JSON arrays with parent pointers, rather than deeply nested JSON (see "Tree Assembly" below for rationale).

```sql
-- Parameters: $1 = schema permid (the pbotID)

WITH RECURSIVE
-- 1. Find the schema
target_schema AS (
  SELECT s.id, s.permid, s.schema, s.reference_id
  FROM schemas s
  WHERE s.permid = $1
    AND NOT COALESCE(s.removed, false)
),

-- 2. Recursively collect all characters in the schema's tree
char_tree AS (
  -- Top-level characters (direct children of schema)
  SELECT c.id, c.permid, c.character,
         c.parent_schema_id, c.parent_character_id,
         0 AS depth
  FROM characters c
  JOIN target_schema ts ON c.parent_schema_id = ts.id
  WHERE NOT COALESCE(c.removed, false)

  UNION ALL

  -- Sub-characters (children of characters)
  SELECT c.id, c.permid, c.character,
         c.parent_schema_id, c.parent_character_id,
         ct.depth + 1
  FROM characters c
  JOIN char_tree ct ON c.parent_character_id = ct.id
  WHERE NOT COALESCE(c.removed, false)
),

-- 3. Recursively collect all states in the character tree
state_tree AS (
  -- States directly owned by a character
  SELECT s.id, s.permid, s.state,
         s.parent_character_id, s.parent_state_id,
         0 AS depth
  FROM states s
  JOIN char_tree ct ON s.parent_character_id = ct.id
  WHERE NOT COALESCE(s.removed, false)

  UNION ALL

  -- Sub-states (children of states)
  SELECT s.id, s.permid, s.state,
         s.parent_character_id, s.parent_state_id,
         st.depth + 1
  FROM states s
  JOIN state_tree st ON s.parent_state_id = st.id
  WHERE NOT COALESCE(s.removed, false)
)

SELECT
  -- Schema fields
  ts.permid                              AS "pbotID",
  ts.schema->>'title'                    AS title,
  ts.schema->>'year'                     AS year,
  ts.schema->>'acknowledgments'          AS acknowledgments,
  ts.schema->>'purpose'                  AS purpose,
  ts.schema->'partsPreserved'            AS "partsPreserved",
  ts.schema->'notableFeatures'           AS "notableFeatures",
  ts.schema->'authors'                   AS authors,

  -- Primary reference
  json_build_object(
    'pbotID', pr.permid,
    'title',  pr.reference->>'title',
    'year',   pr.reference->>'year'
  ) AS "primaryReference",

  -- Additional references
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

  -- All characters (flat, with parent pointers for tree assembly)
  (
    SELECT COALESCE(json_agg(json_build_object(
      'id',                ct.id,
      'pbotID',            ct.permid,
      'name',              ct.character->>'name',
      'definition',        ct.character->>'definition',
      'order',             (ct.character->>'order')::int,
      'parentSchemaId',    ct.parent_schema_id,
      'parentCharacterId', ct.parent_character_id,
      'depth',             ct.depth
    ) ORDER BY ct.depth, (ct.character->>'order')::int NULLS LAST), '[]'::json)
    FROM char_tree ct
  ) AS characters,

  -- All states (flat, with parent pointers for tree assembly)
  (
    SELECT COALESCE(json_agg(json_build_object(
      'id',                st.id,
      'pbotID',            st.permid,
      'name',              st.state->>'name',
      'definition',        st.state->>'definition',
      'order',             (st.state->>'order')::int,
      'parentCharacterId', st.parent_character_id,
      'parentStateId',     st.parent_state_id,
      'depth',             st.depth
    ) ORDER BY st.depth, (st.state->>'order')::int NULLS LAST), '[]'::json)
    FROM state_tree st
  ) AS states

FROM target_schema ts
LEFT JOIN refs pr ON ts.reference_id = pr.id;
```

## Tree Assembly (Node.js)

The SQL query returns characters and states as flat arrays with parent pointers. This function assembles them into the nested tree structure matching the GraphQL response shape.

**Decision**: Tree assembly is done in Node.js rather than in-database (e.g., PL/V8) because:
- The assembly is O(n) and cheap; the recursive CTE dominates query time.
- Avoids a PL/V8 extension dependency (not always available on managed Postgres).
- Keeps all JS logic in one place for easier testing and debugging.
- API response shape changes are just application code, no DB migration needed.

```js
function buildSchemaTree(row) {
  // Index characters by id
  const charMap = new Map();
  for (const c of row.characters) {
    charMap.set(c.id, { ...c, characters: [], states: [] });
  }

  // Index states by id
  const stateMap = new Map();
  for (const s of row.states) {
    stateMap.set(s.id, { ...s, states: [] });
  }

  // Nest states under parent states or parent characters
  for (const [, s] of stateMap) {
    if (s.parentStateId) {
      stateMap.get(s.parentStateId).states.push(s);
    } else if (s.parentCharacterId) {
      charMap.get(s.parentCharacterId).states.push(s);
    }
  }

  // Nest characters under parent characters; collect top-level ones
  const topChars = [];
  for (const [, c] of charMap) {
    if (c.parentCharacterId) {
      charMap.get(c.parentCharacterId).characters.push(c);
    } else {
      topChars.push(c);
    }
  }

  // Sort children by order at each level
  const sortByOrder = (a, b) => (a.order ?? Infinity) - (b.order ?? Infinity);
  for (const [, c] of charMap) {
    c.characters.sort(sortByOrder);
    c.states.sort(sortByOrder);
  }
  for (const [, s] of stateMap) {
    s.states.sort(sortByOrder);
  }
  topChars.sort(sortByOrder);

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
```

### Result Shape

The assembled tree mirrors the GraphQL response:

```
schema
├── characters[]
│   ├── name, definition, order
│   ├── states[]
│   │   ├── name, definition, order
│   │   └── states[] (recursive)
│   └── characters[] (recursive)
├── primaryReference { pbotID, title, year }
├── additionalReferences[] { pbotID, title, year }
└── authors[] { givenName, familyName, order }
```
