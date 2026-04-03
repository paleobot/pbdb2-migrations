## Context

The `SCHEMA_QUERY` in `play/server.js` uses two recursive CTEs (`char_tree` and `state_tree`) to walk the character/state hierarchy under a schema. Both CTEs correctly filter `succeeded_by_id IS NULL` in their anchor terms (top-level entities) but omit this filter in their recursive terms (nested entities), causing all versions of sub-characters and sub-states to appear in results.

## Goals / Non-Goals

**Goals:**
- Filter the recursive terms to only include the latest version of each nested entity

**Non-Goals:**
- Refactoring the query structure
- Changing the API response format

## Decisions

### 1. Add `succeeded_by_id IS NULL` to recursive terms

**Decision:** Add the same filter already used in the anchor terms to the recursive terms of both CTEs.

**Rationale:** This is a consistency fix. The anchor terms already express the correct intent; the recursive terms simply missed the filter.

## Risks / Trade-offs

- None. This is a straightforward bug fix with no behavioral trade-offs.
