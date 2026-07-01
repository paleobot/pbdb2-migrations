## Context

The legacy MariaDB `collections` table (275,555 rows) spreads a fossil locality across ~50 flat, redundant columns: three coordinate representations (decimal `lat`/`lng`, a `coordinate` POINT, and DMS `latdeg`/`min`/`sec`/`dec`/`dir`), split lithology (`lithology1/2` + `lithadj`/`minor_lithology` + `fossilsfrom` + `lithification`), prefixed radiometric ages (`direct/max/min_ma*`), and free-text geography (`country`/`state`/`county`). The new PostgreSQL `collections` table consolidates this into one validated `collection` jsonb payload plus a PostGIS `geography` column and a set of externalized FK columns.

Two facts from live-data probing shape the whole design:
- **Coordinates are clean.** Decimal `lat`/`lng` is 100% populated, already signed (0 sign/direction mismatches), 0 null-island, 0 out-of-range. The `coordinate` POINT is only 44% populated and demonstrably imprecise; DMS is redundant and lossier.
- **Enums cover the data.** After fixing one schema typo (`clayston`→`claystone`), every mapped enum (including the merged `minor_lithology`+`lithadj` adjectives) matches the legacy values with zero unmatched.

Source contract: `payloadSchemas/mappings/collections.txt`. Target: `postgresql/create_new.sql` ~L4401 (`collections`, `additional_collection_refs`). Schema contract: `payloadSchemas/collection.schema.js` (hand-edited; exports strict `collectionSchema` and lenient `collectionMigrationSchema`).

## Goals / Non-Goals

**Goals:**
- Populate the new `collections` table for every legacy row whose admin geography resolves to ISO codes, building the `collection` jsonb and the PostGIS `location` geography.
- Externalize location coordinates and references out of the jsonb into columns (`location` geography, `reference_id`, `additional_collection_refs`) to avoid redundant data and enable spatial/relational query.
- Validate the stored jsonb against a lenient migration schema that matches what is actually stored — not the strict API schema.
- Preserve legacy identity via `collection.legacyIDs.oldpbdbID` for future backfills (age FKs, deferred jsonb objects).

**Non-Goals:**
- Age interval FKs (`early_age_id`/`late_age_id`) — deferred; interval handling is under redesign. Columns left NULL (now nullable).
- The `ages.intervals`, `environment`, and `paleontology` jsonb objects — deferred to a later pass.
- Paleocoordinates (`paleolat`/`paleolng`/`plate`/`paleocoords`) and `latlng_precision` provenance — out of scope.
- Cleaning or reconciling the DMS/decimal coordinate disagreement (90K rows >0.1°) — we take decimal as authoritative and discard DMS; no reconciliation.
- Dedup. Unlike the authorities migration, `collection_no` is a genuine unique locality; every surviving row inserts as one collection.

## Decisions

### D1. Two-schema validation: lenient migration view vs strict API view

The exported `collectionSchema` (built from `completeCollectionProperties`) is the API create/update contract: it requires `latitude`/`longitude` and `references`. But those are **externalized into columns** and are not present in the stored jsonb. Validating the stored payload against the API schema would fail every row.

Decision: validate the migration output against `collectionMigrationSchema` (built from the base `collectionProperties`), whose `required` is just `["name"]` and which has no lat/lng or `references` requirement. The strict schema stays the API contract and is untouched by the migration.

**Alternative considered:** inject lat/lng + a synthetic `references` into a throwaway copy of the payload just to validate against the strict schema, then strip them before insert. Rejected — more moving parts, and it validates a shape we never store.

### D2. Coordinates: decimal `lat`/`lng` only → PostGIS geography

Build `location` from decimal `lat`/`lng`:
```sql
ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
```
The `coordinate` POINT (44% coverage, imprecise) and DMS fields (redundant) are discarded. This matches the project convention that decimal coordinates are authoritative, and neutralizes the 90K-row DMS/decimal-mismatch anomaly by construction.

**Datum:** `gps_datum` is 87% null, then WGS84, with ~1,048 rows tagged NAD27 CONUS (1,031) / NAD83 (16) / WGS72 (1). Default null and WGS84 to WGS84 (SRID 4326 direct). For the tagged minority, `ST_Transform` from the source datum (`4267`/`4269`/`4322`) to `4326` before casting to geography. Coordinates go into the geography column **only**, never the jsonb.

**Alternative considered:** treat all rows as WGS84 and ignore datum. Rejected as unnecessary — the tagged subset is tiny and PostGIS makes the transform nearly free; doing it right costs almost nothing. (Null datum still assumes WGS84 — the only defensible default.)

### D3. References externalized: primary FK + secondary cross-ref

- **Primary:** legacy `reference_no` → `reference_id` (NOT NULL FK), resolved via the existing `refs.reference.legacyIDs.oldpbdbID` → `refs.id` head-version lookup (`succeeded_by_id IS NULL`), same as the authorities migration. On orphan (no surviving ref), **skip + log** the collection.
- **Secondary:** `secondary_refs` (375,845 rows; columns `collection_no`, `reference_no`) → `additional_collection_refs` rows. `secondary_refs` carries **no audit columns**, so the target's NOT NULL `authorizer_person_id`/`enterer_person_id` are **inherited from the parent collection**. There is no `order` column on either the source or the target `additional_collection_refs`; `references[].order` is an API-view concern generated on read, not stored. Secondary refs whose `reference_no` is orphaned are skipped + logged individually (they don't sink the collection).

`references` is never written to the jsonb.

### D4. Enum hydration before `ajv.compile`

Three enums in the schema are empty stubs and will not compile (`enum: []` is invalid): `administrativeAreas.admin0`, `administrativeAreas.admin1`, and the `if`-condition country list (US/China/Russia/Australia/Canada). The migration hydrates these from `dictionaries.admin0`/`admin1` (ISO codes) at startup, before compiling the migration schema. The IIFE stubs in the schema file can't do this themselves (synchronous, no DB handle), so hydration is the migration's responsibility.

### D5. Admin name → ISO resolution: normalize, then alias, then flag-and-skip

Legacy `country`/`state` are free text and do **not** cleanly equal the dictionary names — measuring against `dictionaries.admin0` showed 254 distinct countries with 27 unmatched by naïve exact match, covering ~46K rows. The unmatched split into two kinds: (a) **name variants that should resolve** (e.g. "Russian Federation"→RU with 11,427 rows, "Türkiye"→TR, accented forms like "Curaçao"/"Åland"), and (b) **ocean/marine values that are not administrative areas at all** (see the blocking open question below). So resolution needs real normalization plus an alias map, not exact match:

1. **Normalize** both sides with `normalizeName`: casefold + trim, Unicode NFD decompose and strip combining marks (diacritics), collapse internal whitespace/punctuation to a single space. This alone fixes accented/punctuated variants.
2. **Dictionary match:** `country` → normalized match against admin0 `name`/`iso`/`iso3`; `state` → normalized match against admin1 `name`/`alternate_name` scoped by the resolved `admin0_id`.
3. **Alias map:** for legacy variants that still don't normalize to a dictionary entry, a curated `COUNTRY_ALIASES`/`STATE_ALIASES` (normalized legacy string → ISO code) seeded from the measured unmatched set (Russian Federation→RU, Türkiye→TR, Netherlands→NL, Cape Verde→CV, Timor-Leste→TL, the two Congos, Micronesia, Falklands, Holy See, Palestine, the Virgin Islands, etc.). The map is data-driven and reviewable, and is the extension point when new variants surface.
4. **Still no match** → flag the row in output and do not migrate it. `admin2` (county) is free text, passed through. The `if/then` rule (admin1 required when admin0 ∈ {US, CN, RU, AU, CA}) applies in the strict API schema; for migration, an unresolved required admin1 in those countries is also a flag-and-skip.

**Alternative considered:** insert with a null/placeholder country. Rejected for genuine countries — it stores unqueryable, invalid geography and defeats ISO normalization. (The ocean/marine subset is a separate, unresolved case — see Open Questions; it is explicitly *not* resolved by "insert placeholder" either.)

### D6. Lithofacies: two objects, merged adjectives, boolean fossils

`lithofacies[]` is built from up to two legacy litho sets:
- object 1: `lithology1`, `adjectives` = (`lithadj` merged with `minor_lithology`), `fossils = fossilsfrom1==='Y'`, `lithification`
- object 2: `lithology2`, `adjectives` = (`lithadj2` merged with `minor_lithology2`), `fossils = fossilsfrom2==='Y'`, `lithification2`

Objects with no lithology are omitted; the array may be empty (schema requires `lithology` only per-object). Enum coverage for `lithology`, `lithification`, and the merged `adjectives` is verified green against live data.

### D7. Ages: `measurements[]` from prefixed columns

`ages.measurements[]` is built from the `direct_ma*`, `max_ma*`, `min_ma*` column groups (`_ma`, `_ma_error`, `_ma_unit`, `_ma_method`). The prefix maps to `measurementType` (`direct`/`max`/`min`). Groups with no `_ma` value are omitted. `unit` and `method` enum coverage verified green. This is **distinct** from the deferred age interval FKs (D-deferred): measurements are radiometric dates stored in jsonb; interval FKs are geologic stages deferred pending redesign.

### D8. Deferred: age FKs and TBD jsonb objects

`early_age_id`/`late_age_id` are left NULL (columns made nullable). `ages.intervals`, `environment`, `paleontology` are omitted from the jsonb. `collection.legacyIDs.oldpbdbID` (= `collection_no`) is the bridge for a later backfill pass, expected to re-run combined once interval handling is redesigned.

### D9. `collection_type` is not migrated

`collectionType` was removed from the collection schema (and the mapping), so `collection_type` is **not read or migrated**. This also retires the earlier `archaeological` vs `archaeologic` spelling question — the field no longer exists in the target, so there is nothing to normalize. If a collection-type concept returns later, it will be a separate change.

### D10. Script structure mirrors `migrate-authorities.js`

Stream from MariaDB, build + validate each payload, resolve FKs, batched transactional bulk insert, `randomUUID()` permid, identity-sequence reset, bucketed sample logging for each skip category. No dedup pass. Person `authorizer_no`/`enterer_no` use the refs/authorities 0-fallback. `install_version_triggers('collections')` is already wired; rows insert as single versions.

## Risks / Trade-offs

- **Admin-ISO match quality** → false positives silently corrupt country/state. Mitigation: conservative matching (normalized exact/near-exact against dictionary names), and report both the skip list (no match) and the match counts for review before committing the transaction.
- **High skip volume from unresolved admin names** → material row loss. Mitigation: dry-run the resolver first; surface per-country skip counts; decide whether to expand the dictionaries before the real run.
- **Age FKs NULL** → collections are not queryable by geologic age until the interval backfill lands. Accepted; explicitly deferred.
- **NAD27→WGS84 without NADCON grids** in PostGIS is a less-accurate transform. Accepted — ~1,031 rows, and the shift is within the data's own precision.
- **Re-run coupling** → like authorities, this script may re-run combined with the interval/TBD-object work. Mitigation: idempotent insert (truncate-and-reload), `oldpbdbID` bridge preserved.
- **Secondary-ref audit inheritance** → `additional_collection_refs` audit columns are inherited from the collection, not the original secondary_ref entry. Accepted; the source carries no audit data, and collection-level provenance is the best available.

## Migration Plan

1. Hand-edit `collection.schema.js` (already largely done): both schema exports compile; `claystone` fixed; migration `required=["name"]`.
2. Confirm PostGIS extension present; confirm `early_age_id`/`late_age_id` nullable.
3. At script startup: hydrate the three admin enums from `dictionaries`, then `ajv.compile(collectionMigrationSchema)`.
4. Dry-run the admin-ISO resolver; review skip/match report.
5. Stream, transform, validate, bulk-insert `collections`; then insert `additional_collection_refs`; reset identity sequences; print counters (inserted, skipped-orphan-ref, skipped-no-admin-match, altitude-dropped).
6. **Rollback:** the insert is transaction-wrapped; on failure it rolls back cleanly. To redo, `TRUNCATE collections, additional_collection_refs` and re-run.

## Open Questions

- **BLOCKING — ocean/marine collections (~32,117 rows).** Legacy `country` for many pelagic/deep-sea localities is a body of water — North Pacific (12,343), Indian Ocean (8,503), North Atlantic (5,393), South Pacific (4,159), Southern Ocean (1,354), South Atlantic (360), Arctic Ocean (5). These are **not countries and not administrative areas**, so they cannot be shoehorned into `admin0`. They do have valid coordinates. The handling is undecided and the owner is gathering feedback; candidate options: (1) skip them, (2) migrate them country-less with only a geography point (requires the schema/migration to allow a location with no `admin0`), (3) carry the water-body name in a non-admin field. **Implementation is paused on this decision.** Until then, these fall into `resolveAdmin`'s no-match path by default, but that default is not ratified.
- **Alias-map completeness** — the seed `COUNTRY_ALIASES`/`STATE_ALIASES` cover the measured unmatched set, but new variants (especially at admin1) may surface on a full dry-run; the map is the reviewable extension point rather than dropping rows.
