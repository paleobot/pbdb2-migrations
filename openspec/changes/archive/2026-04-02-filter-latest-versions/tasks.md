## 1. Add version filtering to SCHEMA_QUERY

- [x] 1.1 Add `AND s.succeeded_by_id IS NULL` to the `target_schema` CTE WHERE clause in `play/server.js`
- [x] 1.2 Add `AND c.succeeded_by_id IS NULL` to the `char_tree` base case WHERE clause
- [x] 1.3 Add `AND s.succeeded_by_id IS NULL` to the `state_tree` base case WHERE clause

## 2. Verify

- [x] 2.1 Run the schema API endpoint against the database and confirm results are unchanged (all current records have `succeeded_by_id = NULL`)
