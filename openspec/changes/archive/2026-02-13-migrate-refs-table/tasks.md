## 1. Setup and Lookups

- [x] 1.1 Create `migrate-refs.js` with async main, importing `{ mariadb, pg, closeAll }` from `./db` and `crypto` for UUID generation
- [x] 1.2 Load `dictionaries.reference_types` from PostgreSQL into a name→id map (7 values including "other")
- [x] 1.3 Define the publication type mapping object: legacy value → `{referenceType, bookType}` per the design table

## 2. Source Data Loading

- [x] 2.1 Query all rows from MariaDB `refs` (93,863 rows) — select all bibliographic columns plus `authorizer_no`, `enterer_no`, `reference_no`; log count
- [x] 2.2 Query all rows from MariaDB `ref_authors` and group into a Map keyed by `reference_no`, ordered by `place`; log count
- [x] 2.3 Query all rows from MariaDB `ref_editors` and group into a Map keyed by `reference_no`, ordered by `place`; log count

## 3. Transform Functions

- [x] 3.1 Implement `mapPublicationType(legacyType)` — returns `{referenceTypeName, referenceTypeId, bookType}` using the mapping table; logs warnings for unmapped values
- [x] 3.2 Implement `buildAuthors(ref, refAuthorsMap)` — if `ref_authors` entries exist for `reference_no`, build array from those; otherwise build from `author1init`/`author1last`, `author2init`/`author2last`, and parse `otherauthors`; return `[{surname, givenName}, ...]`; log warnings for unparseable `otherauthors` and missing authors
- [x] 3.3 Implement `buildEditors(ref, refEditorsMap)` — if `ref_editors` entries exist, concatenate into string; otherwise use `editors` field from refs directly
- [x] 3.4 Implement `mapPubtitle(ref, referenceTypeName)` — route `pubtitle` to `journalTitle`, `seriesTitle`, or `bookTitle` based on publication type
- [x] 3.5 Implement `mapVolNo(ref, referenceTypeName)` — route `pubvol` to `journalVolume`/`seriesVolume` and `pubno` to `journalNumber` based on publication type
- [x] 3.6 Implement `buildPages(firstpage, lastpage)` — parse as integers, return `{first, last}` or null with warning for non-numeric values; handle missing `lastpage` by setting `last = first`
- [x] 3.7 Implement `mapLanguage(legacyLang)` — map to target enum, unmapped values → "other", NULL → "unknown"
- [x] 3.8 Implement `mapPersonIds(ref)` — map `authorizer_no`/`enterer_no` to person IDs, handle 0-as-NULL with cross-fallback, log warnings

## 4. JSON Assembly

- [x] 4.1 Implement `buildJsonb(ref, authors, editors, pubType, pages, pubtitleField, volNoFields, language)` — assemble the full jsonb object with: `publicationType`, `title` (from `reftitle`), `authors`, `publicationYear` (from `pubyr`), `pages`, `doi`, `language`, `oldpbdbID` (reference_no as string), plus type-specific fields (`journalTitle`/`bookTitle`/`seriesTitle`, volume/number, `bookType`, `editors`, `publisher`, `publicationCity`); omit null/empty fields

## 5. Batched Upsert

- [x] 5.1 Transform all source rows into target row objects: `{id, permid, reference_type_id, authorizer_person_id, enterer_person_id, reference (jsonb), preceded_by_id, succeeded_by_id, removed}`
- [x] 5.2 Implement batched upsert (500 rows per batch) using multi-value `INSERT INTO references (...) VALUES (...) ON CONFLICT (id) DO UPDATE SET ...` — exclude `permid` from the UPDATE SET to preserve UUIDs on re-runs
- [x] 5.3 Reset the `references` identity sequence to `MAX(id) + 1` after all inserts

## 6. Verification and Logging

- [x] 6.1 Add row count verification: query `SELECT COUNT(*) FROM references`, compare to source count, log success or warning
- [x] 6.2 Log publication type mapping summary (count per target type)
- [x] 6.3 Log overall summary: start/end timestamps, elapsed time, source counts, upsert count, warning counts

## 7. Testing

- [x] 7.1 Run the migration script against the actual databases and confirm it completes without errors
- [x] 7.2 Verify row count: 93,863 rows in PostgreSQL `references`
- [x] 7.3 Spot-check records across publication types: verify jsonb structure, author arrays, page objects, pub type mapping, and oldpbdbID
- [x] 7.4 Run the script a second time to confirm idempotency (same row count, permids preserved, no errors)
