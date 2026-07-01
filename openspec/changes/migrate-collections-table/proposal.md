## Why

The legacy `collections` table in MariaDB (`pbdb_archive`, 275,555 rows) stores a fossil locality's context, geography, stratigraphy, lithology, and age across ~50 flat, redundant columns (three separate coordinate representations, split litho/adjective/fossil fields, prefixed radiometric-age columns). The new PostgreSQL `collections` table consolidates this into a single validated `collection` jsonb payload plus a PostGIS `geography` column for spatial search. We need to populate the new table now for the fields that are fully defined, deferring the parts still under design (intervals, environment, paleontology).

## What Changes

- **BREAKING** — the new `collections` table has a different shape than the legacy one: one `collection` jsonb payload (per `payloadSchemas/collection.schema.js`) + externalized columns (`location` geography, `reference_id`, person FKs, age FKs). This is a structural rebuild, not an in-place migration.
- Migrate all 275,555 legacy rows that survive validation into the new `collections` table, building the `collection` jsonb from the mapping in `payloadSchemas/mappings/collections.txt`.
- **Coordinates → PostGIS geography.** Build `location` from the decimal `lat`/`lng` columns (100% populated, already signed, in-range, WGS84 DD) as `ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography`. The imprecise `coordinate` point column and the redundant DMS fields are **discarded** — decimal coordinates are the authoritative source per project convention. Latitude/longitude are **not** stored in the jsonb (avoiding redundant data; PostGIS owns location).
- **Datum:** default the ~87% null-datum and WGS84 rows to WGS84; `ST_Transform` the ~1,048 rows tagged with a non-WGS84 `gps_datum` (NAD27 CONUS=`4267`, NAD83=`4269`, WGS72=`4322`) into WGS84 before casting to geography.
- **Externalize references** (authorities/refs pattern): legacy `reference_no` → `reference_id` (primary FK); the legacy secondary-refs table → `additional_collection_refs` cross-ref rows. `references` is **not** stored in the jsonb.
- Build the jsonb sub-objects via defined transforms: `coll_meth` CSV → `context.collectionMethods` array; `lithofacies[]` from `lithology1/2` + (`lithadj` merged with `minor_lithology`) → `adjectives`, `fossilsfrom{1,2}==='Y'` → `fossils`, `lithification{,2}`; `ages.measurements[]` from the `direct/min/max`-prefixed `_ma*` columns (prefix → `measurementType`); stratigraphy stratonyms/scale/sections; repository, scale, comments.
- **Admin areas → ISO.** Map free-text `country`/`state` to `dictionaries.admin0`/`admin1` ISO codes via a normalize-then-alias pipeline (diacritic/punctuation normalization + a curated alias map for variants like "Russian Federation"→RU), since legacy values don't equal dictionary names verbatim. On **no match, flag in output and do not migrate that row.**
- **BLOCKED — ocean/marine collections (~32,117 rows).** Many legacy `country` values name a body of water (North Pacific, Indian Ocean, …), which are not administrative areas. Their handling is an open decision (skip / migrate country-less / other); implementation is paused on this subset pending owner feedback.
- **Altitude:** convert `altitude_value` to meters; if `altitude_unit` is blank/null, **do not migrate the altitude, flag in output** (no assumed unit).
- **Skip + log** on orphan primary reference (legacy `reference_no` that didn't survive the refs migration), mirroring the authorities migration.
- **Deferred (NULL / omitted for this pass):** `early_age_id` / `late_age_id` FK columns are left **NULL** — the columns are already nullable — because interval handling is undergoing a redesign. The `ages.intervals`, `environment`, and `paleontology` jsonb objects are likewise deferred and brought over in a later migration.
- Validation is against a dedicated lenient **`collectionMigrationSchema`** (built from the base `collectionProperties`), which matches the stored jsonb subset — no required `latitude`/`longitude` or `references`, which live in columns. The strict `collectionSchema` remains the API-layer contract and is not used for migration.

## Capabilities

### New Capabilities

- `collection-migration`: Migration of legacy MariaDB `collections` rows into the new PostgreSQL `collections` table — jsonb payload construction (context, location admin/coordinates-basis/altitude/scale/repository, lithofacies, stratigraphy, ages.measurements), PostGIS geography construction with datum handling, primary + secondary reference externalization into `reference_id`/`additional_collection_refs`, person FK resolution, admin-name→ISO resolution with flag-and-skip, deferred age FKs, and migration-schema validation.

### Modified Capabilities

None. The new `collections` table has no prior spec.

## Impact

- **Source (read):** MariaDB `pbdb_archive.collections` (275,555 rows, PK `collection_no`) and the legacy secondary-refs table. Relevant columns: identity/audit (`collection_no`, `reference_no`, `authorizer_no`, `enterer_no`), name (`collection_name`, `collection_aka`), context (`collectors`, `coll_meth`, `collection_dates`, `collection_comments`), geography (`country`, `state`, `county`, `lat`, `lng`, `gps_datum`, `latlng_basis`, `altitude_value`, `altitude_unit`, `geogscale`, `geogcomments`, `museum`), stratigraphy (`supergroup`, `geological_group`, `subgroup`, `formation`, `member`, `bed`, `stratscale`, `stratcomments`, `local_section`/`local_bed`/`local_bed_unit`/`local_order`), lithology (`lithology1/2`, `lithadj`/`lithadj2`, `minor_lithology`/`minor_lithology2`, `fossilsfrom1/2`, `lithification`/`lithification2`), age (`direct/max/min_ma*`).
- **Target (write):** PostgreSQL `collections` table and `additional_collection_refs` (both in `postgresql/create_new.sql` ~L4401). Requires the PostGIS extension (installed locally). `early_age_id`/`late_age_id` made nullable (`--NOT NULL`) to allow this pass.
- **Schema:** `payloadSchemas/collection.schema.js` — hand-edited (per OpenSpec-scope convention): exports both `collectionSchema` (strict API view) and `collectionMigrationSchema` (lenient migration view). Enum coverage across all mapped fields verified green (after fixing the `claystone` typo). The three DB-driven enums (`admin0`/`admin1`, and the `if`-condition country list) must be hydrated from `dictionaries` before `ajv.compile` — empty `enum: []` will not compile.
- **New script:** `migrate-collections.js` (new), patterned on `migrate-authorities.js`: stream from MariaDB, build+validate payload, resolve `reference_id` via the `refs.reference.legacyIDs.oldpbdbID` → `refs.id` head-version lookup, person 0-fallback, `randomUUID()` permid, batched transactional bulk insert, identity-sequence reset.
- **Versioning:** `install_version_triggers('collections')` is wired; rows insert as single versions (`succeeded_by_id IS NULL`), so no special handling.
- **Relevant anomalies** (from `mariadb/PBDBLegacy-DeepAnalysis/anomaly-report.md`):
  - 90K collections (32.8%) with DMS/decimal coordinate mismatch >0.1° — **neutralized** by using decimal coordinates as authoritative and discarding DMS.
  - `float(9,6)` vs `decimal(9,6)` precision mismatch between `collections.lat/lng` and derived tables — not relevant; we read `collections` directly.
  - 0-as-NULL sentinel in `authorizer_no`/`enterer_no` — handled via the authorities/refs fallback pattern.
- **Out of scope:** `collection_type` (removed from the schema — not migrated), age interval FKs, `ages.intervals`/`environment`/`paleontology` jsonb, paleocoordinates (`paleolat`/`paleolng`/`plate`/`paleocoords`), `latlng_precision` provenance, and every legacy column not in the mapping.
