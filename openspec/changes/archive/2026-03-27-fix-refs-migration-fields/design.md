## Context

Both `migrate-refs.js` (PBDB → PG) and `migrate-pbot-refs.js` (PBot → PG) have field mapping issues:
1. PBDB's `refs.comments` column is never selected or mapped to the jsonb.
2. PBot's `notes` field is fetched via GraphQL but never used. PBot's `description` is mapped to `jsonb.notes`, which no longer exists in the schema (replaced by `comments`).
3. Both scripts store legacy IDs (`oldpbdbID`, `pbotID`) as top-level jsonb properties instead of nesting them under the `legacyIDs` object defined in `reference.schema.js`.
4. `migrate-pbot-refs.js` resolves enterer persons by name matching against the `persons` table. Now that `migrate-pbot-persons.js` stores `legacyIDs.pbotID` in the persons jsonb, a direct ID lookup is possible and more reliable.
5. Both scripts reference the target table as `"references"` (double-quoted), but the table has been renamed to `refs` to avoid requiring quoting of the SQL reserved word.

## Goals / Non-Goals

**Goals:**
- Map PBDB `comments` → `jsonb.comments`
- Map PBot `notes` → `jsonb.comments`
- Map PBot `description` → `jsonb.description` (only populated for unpublished references in PBot)
- Nest `oldpbdbID` under `jsonb.legacyIDs` in `migrate-refs.js`
- Nest `pbotID` under `jsonb.legacyIDs` in `migrate-pbot-refs.js`
- Replace name-based enterer lookup with `legacyIDs.pbotID` lookup in `migrate-pbot-refs.js`
- Update target table name from `"references"` to `refs` in both scripts

**Non-Goals:**
- Modifying `reference.schema.js` (already correct)
- Changing any other field mappings or migration logic
- Adding new validation or error handling beyond what exists

## Decisions

### 1. PBDB comments: add column to SELECT, map in buildJsonb

Add `comments` to the MariaDB SELECT list (line ~241). In `buildJsonb`, add: `if (ref.comments && ref.comments.trim()) jsonb.comments = ref.comments.trim();`

This follows the same pattern as every other optional field in `buildJsonb`.

### 2. PBot notes → comments, description → description

In `buildReferenceJsonb`:
- Add: `if (ref.notes && ref.notes.trim()) jsonb.comments = ref.notes.trim();`
- Change the existing `description` mapping from `jsonb.notes = ref.description.trim()` to `jsonb.description = ref.description.trim()`

PBot's `notes` is a general-purpose annotation field (maps to `comments`). PBot's `description` only appears on unpublished references and maps to the schema's `description` field inside the `unpublished` conditional block.

### 3. Legacy IDs: nest under legacyIDs object

In `migrate-refs.js`, change:
```js
jsonb.oldpbdbID = String(ref.reference_no);
```
to:
```js
jsonb.legacyIDs = { oldpbdbID: String(ref.reference_no) };
```

In `migrate-pbot-refs.js`, change:
```js
jsonb.pbotID = ref.pbotID;
```
to:
```js
jsonb.legacyIDs = { pbotID: ref.pbotID };
```

This matches the `legacyIDs` object structure in `reference.schema.js`.

### 4. Enterer lookup via legacyIDs.pbotID

Replace the current name-based lookup:
```sql
SELECT id FROM persons WHERE lower(person->>'givenName') = lower($1) AND lower(person->>'familyName') = lower($2)
```
with:
```sql
SELECT id FROM persons WHERE person->'legacyIDs'->>'pbotID' = $1
```

The parameter is the PBot Person's `pbotID` from the `enteredBy` relationship. This eliminates name ambiguity issues and simplifies the enterer resolution flow — no need to extract `given`/`surname` from the enteredBy Person.

**Prerequisite:** `migrate-pbot-persons.js` must have run first so that PBot persons have `legacyIDs.pbotID` in their jsonb. This is already the required run order.

### 5. Target table rename: `"references"` → `refs`

The PostgreSQL target table was renamed from `references` to `refs` to avoid quoting the SQL reserved word `REFERENCES`. All SQL in both scripts is updated: `INSERT INTO`, `SELECT FROM`, `setval(pg_get_serial_sequence(...))`, and the `regclass` cast in the permid constraint check.

## Risks / Trade-offs

**[PBot persons without legacyIDs.pbotID will not match]** → If a PBot person was inserted by `migrate-persons.js` (from PBDB) and never processed by `migrate-pbot-persons.js`, they won't have a `legacyIDs.pbotID`. However, PBot references that have a `pbdbid` are already filtered out (line 226), so PBot-only references should only reference PBot-inserted persons. References that fall through will be skipped with a warning, same as today.

**[Re-run required after this change]** → Existing migrated references will have stale jsonb (missing `comments`, flat legacy IDs). Both scripts are idempotent, so a re-run corrects this.
