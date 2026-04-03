## 1. Fix recursive CTE version filters

- [x] 1.1 Add `AND c.succeeded_by_id IS NULL` to the recursive term of `char_tree` in `play/server.js` (after the `NOT COALESCE(c.removed, false)` line in the UNION ALL branch)
- [x] 1.2 Add `AND s.succeeded_by_id IS NULL` to the recursive term of `state_tree` in `play/server.js` (after the `NOT COALESCE(s.removed, false)` line in the UNION ALL branch)
