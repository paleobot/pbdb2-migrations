## Why

The schema API endpoint (`/schema/:permid`) returns all versions of sub-characters and sub-states instead of only the latest. The recursive CTEs in `SCHEMA_QUERY` filter `succeeded_by_id IS NULL` in their anchor terms but omit this filter in their recursive terms, causing every version of nested entities to be included in results.

## What Changes

- Add `AND c.succeeded_by_id IS NULL` to the recursive term of the `char_tree` CTE in `play/server.js`
- Add `AND s.succeeded_by_id IS NULL` to the recursive term of the `state_tree` CTE in `play/server.js`

## Capabilities

### New Capabilities

### Modified Capabilities

## Impact

- **play/server.js**: Two lines added to the `SCHEMA_QUERY` SQL string
- No schema changes, no API contract changes — this is a bug fix that reduces the result set to what was already intended
