## 1. Update SQL query CTEs

- [x] 1.1 Add `sort_order` to the SELECT list in the `char_tree` CTE (both base and recursive parts)
- [x] 1.2 Add `sort_order` to the SELECT list in the `state_tree` CTE (both base and recursive parts)

## 2. Update character/state JSON aggregation

- [x] 2.1 In the characters `json_build_object`, replace `'order', (ct.character->>'order')::int` with `'sortOrder', ct.sort_order`
- [x] 2.2 In the characters `ORDER BY`, replace `(ct.character->>'order')::int` with `ct.sort_order`
- [x] 2.3 In the states `json_build_object`, replace `'order', (st.state->>'order')::int` with `'sortOrder', st.sort_order`
- [x] 2.4 In the states `ORDER BY`, replace `(st.state->>'order')::int` with `st.sort_order`

## 3. Update buildSchemaTree JS sort

- [x] 3.1 Update `sortByOrder` comparator to use `sortOrder` property instead of `order`
- [x] 3.2 Remove `sortOrder` from the final tree output objects (strip after sorting, or don't spread it)
