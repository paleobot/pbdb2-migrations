## 1. Script Setup

- [x] 1.1 Create `migrate-pbot-schemas.js` with PG connection setup, env var validation (`PG_*`, `PBOT_TOKEN`), and constants (`PBOT_GRAPHQL_URL`, `AUTHORIZER_PERSON_ID = 1106`)
- [x] 1.2 Implement authenticated GraphQL fetch helper (Bearer token from `PBOT_TOKEN`)

## 2. GraphQL Queries

- [x] 2.1 Write and test the Schema GraphQL query (pbotID, title, year, purpose, acknowledgments, partsPreserved, notableFeatures, references with order and pbotID, authoredBy with Person names and order, enteredBy with type/timestamp/Person pbotID)
- [x] 2.2 Write and test the Character GraphQL query (pbotID, name, definition, order, parent schema/character pbotID, enteredBy)
- [x] 2.3 Write and test the State GraphQL query (pbotID, name, definition, order, parent character/state pbotID, enteredBy)

## 3. Lookup Helpers

- [x] 3.1 Implement person lookup by pbotID (`persons.person->'legacyIDs'->>'pbotID'`)
- [x] 3.2 Implement reference lookup by pbotID (`refs.ref->'legacyIDs'->>'pbotID'`)
- [x] 3.3 Implement enterer resolution (prefer CREATE type, fallback to earliest timestamp)

## 4. Schema Migration

- [x] 4.1 Build schema JSONB payload (title, year, purpose, acknowledgments, authors with order, legacyIDs.pbotID)
- [x] 4.2 Implement case-insensitive partsPreserved enum mapping with warning for unmatched values
- [x] 4.3 Implement case-insensitive notableFeatures enum mapping with warning for unmatched values
- [x] 4.4 Implement reference resolution: sort by order, lowest → `reference_id`, rest → `additional_schema_refs`
- [x] 4.5 Insert schemas into PostgreSQL (permid, authorizer, enterer, schema jsonb, reference_id, removed=false, preceded_by_id=NULL, succeeded_by_id=NULL)
- [x] 4.6 Insert additional_schema_refs rows for secondary references

## 5. Character Migration

- [x] 5.1 Build character JSONB payload (name, definition, order when non-null, legacyIDs.pbotID)
- [x] 5.2 Implement level-by-level character insertion: level 0 (parent is schema), level 1+ (parent is character from prior level)
- [x] 5.3 Build pbotID-to-id map at each level for subsequent levels and state resolution
- [x] 5.4 Log orphan characters after all levels complete

## 6. State Migration

- [x] 6.1 Build state JSONB payload (name, definition, order when non-null, legacyIDs.pbotID)
- [x] 6.2 Implement level-by-level state insertion: level 0 (parent is character), level 1+ (parent is state from prior level)
- [x] 6.3 Set `quantitative = true` when state name equals "quantity" (case-insensitive)
- [x] 6.4 Build pbotID-to-id map at each level for subsequent levels
- [x] 6.5 Log orphan states after all levels complete

## 7. Finalization

- [x] 7.1 Reset identity sequences for schemas, characters, and states tables
- [x] 7.2 Implement summary logging (fetch counts, insert counts per table/level, orphan counts, skip counts, elapsed time)
- [x] 7.3 End-to-end test run against PBot API and PostgreSQL
