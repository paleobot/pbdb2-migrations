## Why

The `refs` table (93,863 rows) is the second entity in the FK dependency chain — every core data table (`authorities`, `collections`, `occurrences`, `opinions`) references it via `reference_no`. With `persons` now migrated, `refs` must be migrated next before any downstream tables can proceed. The target schema fundamentally restructures references: bibliographic data moves into a `jsonb` column conforming to `reference.schema.js`, legacy flat author fields become a structured authors array, and the new table introduces a succession model (`preceded_by_id`/`succeeded_by_id`) and `permid` (permanent UUID) not present in the source.

## What Changes

- Create a Node.js migration script that reads from MariaDB `refs` (93,863 rows) and writes to PostgreSQL `references`
- Also read from MariaDB `ref_authors` (14,144 rows) and `ref_editors` (414 rows) to build structured author/editor arrays for the jsonb payload
- Map legacy `publication_type` enum (13 values) to `dictionaries.reference_types` (7 values, including "other") — the `publicationType` enum in `reference.schema.js` now matches `dictionaries.reference_types` exactly. Consolidation mapping from legacy:
  - "journal article" → "journal article" (direct)
  - "serial monograph" → "serial monograph" (direct)
  - "unpublished" → "unpublished" (direct)
  - "book/book chapter" → "edited collection"
  - "book chapter" → "article in edited collection"
  - "compendium", "Ph.D. thesis", "M.S. thesis", "guidebook" → "standalone book" with the legacy value preserved as `bookType` in the jsonb payload
  - "book" → "standalone book" (with `bookType` = "monograph" as default)
  - "news article", "abstract", and any other legacy-only values → "other"
  - 1,201 refs (1.3%) with NULL `publication_type` → "other"
  - "other" is now in both the `publicationType` enum in `reference.schema.js` and `dictionaries.reference_types`
- Assemble the `reference` jsonb column from multiple source columns:
  - `reftitle` → `title`
  - `author1init`, `author1last`, `author2init`, `author2last`, `otherauthors` + `ref_authors` table → `authors` array of `{surname, givenName}` objects
  - `pubyr` → `publicationYear`
  - `pubtitle` → type-specific field (`journalTitle`, `bookTitle`, `seriesTitle`, etc.)
  - `pubvol` → `journalVolume` / `seriesVolume`
  - `pubno` → `journalNumber`
  - `firstpage`, `lastpage` → `pages` object `{first, last}`
  - `editors` + `ref_editors` table → `editors` string
  - `publisher`, `pubcity` → `publisher`, `publicationCity`
  - `doi` → `doi`
  - `language` → `language` (enum mapping needed — legacy has 14 values, target has 11)
  - `reference_no` → `oldpbdbID` (preserved inside jsonb for traceability)
- Map `authorizer_no` → `authorizer_person_id`, `enterer_no` → `enterer_person_id` (referencing already-migrated `persons` table), converting 0-as-NULL
- Generate a `permid` UUID for each reference (new concept, not in source)
- Preserve `reference_no` as `id` for FK consistency with downstream migrations
- Set `preceded_by_id` and `succeeded_by_id` to NULL (succession model is new, legacy has no equivalent)
- Set `removed` to false for all migrated records

## Capabilities

### New Capabilities
- `refs-migration`: Script to extract refs + ref_authors + ref_editors from MariaDB, transform into the new references schema with jsonb payload assembly, publication type mapping, and structured author arrays, then load into PostgreSQL `references` table

### Modified Capabilities
- `db-connection-config`: No spec-level changes — reuses existing `db.js` module as-is

## Impact

- **Source tables**: MariaDB `refs` (93,863 rows, 24 columns), `ref_authors` (14,144 rows), `ref_editors` (414 rows)
- **Target table**: PostgreSQL `references` (8 columns, with `reference` jsonb containing 10+ properties)
- **Dictionary dependency**: `dictionaries.reference_types` must be seeded before this migration runs
- **Person dependency**: `persons` table must be populated (completed in prior migration)
- **Column mapping complexity**:
  - Flat columns → jsonb assembly (most bibliographic fields move into the jsonb column)
  - Publication type consolidation (13 legacy values → 6 target values; `publicationType` in `reference.schema.js` now aligned with `dictionaries.reference_types`; subtypes like compendium/thesis preserved as `bookType` in jsonb)
  - Author fields: 5 flat columns + normalized `ref_authors` table → structured `authors` array
  - Language enum: 14 legacy values → 11 target values (some may need mapping to "other")
  - Pages: two varchar columns → object with integer `first`/`last`
- **Known anomalies affecting this migration**:
  - 1,201 refs with NULL `publication_type` (need fallback)
  - 11 orphaned `occurrences.reference_no` values (downstream concern)
  - 10 orphaned `opinions.reference_no` values (downstream concern)
  - 3 orphaned `authorities.reference_no` values (downstream concern)
  - 42 orphaned `secondary_refs.reference_no` values (downstream concern)
  - Denormalized person name fields on refs have ~2% mismatch rate with person table (use `_no` columns, not text fields)
- **Downstream impact**: `authorities`, `collections`, `occurrences`, `opinions`, and `secondary_refs` all reference `references.id`
- **New files**: `migrate-refs.js` script
- **No new dependencies** — reuses `db.js`, `dotenv`, `mysql2`, `pg`; uses Node.js built-in `crypto.randomUUID()` for permid generation
