## 1. Remove order from JSONB builders

- [x] 1.1 In `buildCharacterJsonb`, remove the block that parses `character.order` and sets `jsonb.order`
- [x] 1.2 In `buildStateJsonb`, remove the block that parses `state.order` and sets `jsonb.order`

## 2. Add sort_order to INSERT statements

- [x] 2.1 In the character INSERT (Phase 2), add `sort_order` to the column list and pass `parseInt(char.order, 10)` (or `null`) as the parameter
- [x] 2.2 In the state INSERT (Phase 3), add `sort_order` to the column list and pass `parseInt(state.order, 10)` (or `null`) as the parameter

## 3. Verification

- [x] 3.1 Run the migration script against the PBot API and verify that `sort_order` is populated on characters and states, and that `order` no longer appears in the JSONB payloads
