## Context

The MariaDB `refs` table (93,863 rows) stores bibliographic references as flat columns. The PostgreSQL `references` table stores most bibliographic data in a `reference` jsonb column conforming to the schema defined in `payloadSchemas/reference.schema.js`. Two auxiliary tables — `ref_authors` (14,144 rows) and `ref_editors` (414 rows) — provide normalized author/editor lists that supplement the flat author fields on `refs`.

This is the second migration script after `migrate-persons.js` and reuses the shared `db.js` connection module.

**Source** (MariaDB `refs` — key columns):
| Column | Type | Notes |
|--------|------|-------|
| reference_no | int unsigned PK | |
| authorizer_no, enterer_no, modifier_no | int unsigned | → person.person_no |
| author1init, author1last | varchar | Primary author |
| author2init, author2last | varchar | Secondary author |
| otherauthors | varchar(255) | Free-text additional authors |
| pubyr | varchar(4) | Publication year |
| reftitle | mediumtext | Reference title |
| pubtitle | mediumtext | Publication/journal/book title |
| editors | varchar(255) | Editors as free text |
| publisher | varchar(255) | |
| pubcity | varchar(80) | |
| pubvol, pubno | varchar(10) | Volume and number |
| firstpage, lastpage | varchar(10) | |
| publication_type | enum(13 values) | |
| language | enum(14 values) | |
| doi | varchar(80) | |

**Target** (PostgreSQL `references`):
| Column | Type | Notes |
|--------|------|-------|
| id | integer IDENTITY PK | ← reference_no |
| permid | varchar NOT NULL | New UUID |
| reference_type_id | integer FK → dictionaries.reference_types | |
| authorizer_person_id | integer FK → persons NOT NULL | |
| enterer_person_id | integer FK → persons NOT NULL | |
| reference | jsonb | Bibliographic data per reference.schema.js |
| preceded_by_id | integer FK → references | NULL for migrated records |
| succeeded_by_id | integer FK → references | NULL for migrated records |
| removed | boolean | false for migrated records |

## Goals / Non-Goals

**Goals:**
- Migrate all 93,863 refs with correct ID preservation
- Assemble valid jsonb payloads conforming to `reference.schema.js`
- Map all 13 legacy publication types to the 7 target types
- Build structured `authors` arrays from flat fields + `ref_authors` table
- Handle the 1,201 NULL publication_type records gracefully
- Make the script idempotent

**Non-Goals:**
- Populating the succession model (`preceded_by_id`/`succeeded_by_id`) — no legacy equivalent
- Validating jsonb payloads against the full JSON Schema at migration time — too complex for a migration script; the schema has syntax issues that would need fixing first
- Migrating `ref_summary` cache table (not part of the new schema)
- Migrating `secondary_refs` (separate migration, references `collections` which hasn't been migrated yet)

## Decisions

### 1. Script structure

`migrate-refs.js` at project root, following the same pattern as `migrate-persons.js`:
- Import `{ mariadb, pg, closeAll }` from `./db`
- Async main with try/catch/finally
- Pre-load lookup data, then stream/batch source rows

### 2. Publication type mapping

```
Legacy value              → Target reference_type        → jsonb bookType
─────────────────────────────────────────────────────────────────────────
"journal article"         → "journal article"            → —
"serial monograph"        → "serial monograph"           → —
"unpublished"             → "unpublished"                → —
"book/book chapter"       → "edited collection"          → —
"book chapter"            → "article in edited collection" → —
"book"                    → "standalone book"            → "monograph"
"compendium"              → "standalone book"            → "compendium"
"Ph.D. thesis"            → "standalone book"            → "Ph.D. thesis"
"M.S. thesis"             → "standalone book"            → "M.S. thesis"
"guidebook"               → "standalone book"            → "guidebook"
"news article"            → "other"                      → —
"abstract"                → "other"                      → —
NULL                      → "other"                      → —
any other                 → "other"                      → —
```

The `reference_type_id` column stores the FK to `dictionaries.reference_types`. The `publicationType` string is also stored inside the jsonb payload for the API schema.

**Rationale:** This mapping preserves maximum information. The legacy subtypes that collapse into "standalone book" retain their specificity via the `bookType` field. Truly unmappable types go to "other".

### 3. Author assembly

The legacy schema has two author sources:

1. **Flat fields on `refs`**: `author1init`, `author1last`, `author2init`, `author2last`, `otherauthors`
2. **Normalized `ref_authors` table** (14,144 rows): `reference_no`, `place` (order), plus author name fields

Strategy:
- Pre-load all `ref_authors` rows grouped by `reference_no` into a Map
- For each ref, check if `ref_authors` entries exist for that `reference_no`
- If yes: use `ref_authors` (already ordered by `place`) to build the authors array
- If no: build from flat fields — author1 as first entry, author2 as second, parse `otherauthors` for additional entries
- Each author becomes `{surname, givenName}` where `surname` ← `*last` and `givenName` ← `*init`

**Rationale:** `ref_authors` is the normalized source and should be preferred when available. It only covers ~14K refs out of 94K, so the flat fields are the primary source for most records.

### 4. Editor handling

Similarly, `ref_editors` (414 rows) provides normalized editor data. However, the jsonb schema defines `editors` as a simple string, not a structured array. Strategy:
- Pre-load `ref_editors` grouped by `reference_no`
- If `ref_editors` entries exist: concatenate into a single string
- Otherwise: use the `editors` varchar field from `refs` directly

### 5. pubtitle → type-specific field mapping

The legacy `pubtitle` column serves different purposes depending on publication type:

| Target reference_type | jsonb field | Source |
|---|---|---|
| journal article | `journalTitle` | `pubtitle` |
| standalone book | (title is `reftitle`) | — |
| serial monograph | `seriesTitle` | `pubtitle` |
| article in edited collection | `bookTitle` | `pubtitle` |
| edited collection | (title is `reftitle`) | — |
| unpublished | — | — |
| other | — | — |

`pubvol` maps similarly: `journalVolume` for journal articles, `seriesVolume` for serial monographs. `pubno` maps to `journalNumber` (journal articles only).

### 6. Pages handling

Legacy `firstpage` and `lastpage` are varchar(10). The target schema expects `pages: {first: integer, last: integer}`.

Strategy:
- Parse both as integers
- If either is non-numeric (e.g. "iv", "A1"), store as-is in a `notes` field or skip the pages object and log a warning
- If `lastpage` is empty but `firstpage` is valid, set `last = first`

**Rationale:** Some page numbers in paleontology publications use Roman numerals or letter prefixes. With ~94K records, we can't assume all are numeric.

### 7. Language mapping

Legacy has 14 values, target has 11: Chinese, English, French, German, Italian, Japanese, Portugese, Russian, Spanish, other, unknown.

Legacy values not in target (e.g. Dutch, Polish, Czech, etc.) → "other". NULL → "unknown".

### 8. Person ID mapping

- `authorizer_no` → `authorizer_person_id`: direct FK to `persons.id` (IDs were preserved)
- `enterer_no` → `enterer_person_id`: same
- Both are NOT NULL in the target. If either is 0 in the source, we need a fallback — use the other field if non-zero, or a designated system user if both are zero

### 9. permid generation

Use `crypto.randomUUID()` (Node.js built-in) to generate a v4 UUID for each reference. This is a one-time assignment during migration.

For idempotent re-runs: on `ON CONFLICT (id) DO UPDATE`, do NOT overwrite `permid` — preserve the UUID assigned on first insert.

### 10. Batched inserts

With 93,863 rows, inserting one-by-one is slow. Use batched inserts:
- Read all source data upfront (fits in memory at ~94K rows)
- Pre-load `ref_authors` and `ref_editors` into Maps keyed by `reference_no`
- Transform all rows
- Upsert in batches (e.g. 500 rows per batch using multi-value INSERT)

**Rationale:** 94K individual INSERTs would take minutes. Batching significantly reduces round-trips.

### 11. Idempotency

Use `INSERT ... ON CONFLICT (id) DO UPDATE SET ...` with all columns except `id` and `permid`. The `permid` is preserved from the first insert to maintain UUID stability.

### 12. oldpbdbID

Store `reference_no` (as a string) in the jsonb payload as `oldpbdbID` for traceability back to the legacy database.

## Risks / Trade-offs

- **Non-numeric page numbers** → Mitigation: Log warnings for non-parseable pages. Store them in `notes` or skip the `pages` object. Review after migration.
- **`otherauthors` free-text parsing is imprecise** → Mitigation: Best-effort parsing (split on commas/semicolons, extract "and"). Log unparseable entries. With only ~94K refs, edge cases can be reviewed.
- **`ref_authors` covers only ~15% of refs** → Mitigation: Fall back to flat author fields for the remaining 85%. The flat fields are the original data for those records.
- **authorizer_no or enterer_no = 0** → Mitigation: Log these cases. Use the other field as fallback; if both are 0, use a designated system user ID (requires deciding which person_no).
- **jsonb payloads are not schema-validated at migration time** → Mitigation: Acceptable for migration. The API will validate on subsequent edits. Post-migration spot-checks verify correctness.
- **Batch upsert with permid preservation** → Mitigation: The ON CONFLICT clause explicitly excludes `permid` from the UPDATE SET, so re-runs preserve UUIDs.
