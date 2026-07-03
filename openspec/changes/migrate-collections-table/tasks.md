> **UNBLOCKED — ready to implement.** The former blocker (ocean/marine collections, ~32,117 rows) is resolved: legacy water-body `country` values map to `toponym.maritimeArea` (the `iho_name` from the new `dictionaries.maritime` table), with a `MARITIME_ALIASES` bridge for the "North Pacific"→"North Pacific Ocean" mismatch. See design D11. Schema reshape (`location.toponym` with an `anyOf` over `administrativeArea`/`maritimeArea`, and `required: ["scale"]`) is done and the file loads clean.

## 1. Preconditions (schema + DB, hand-edited outside OpenSpec)

- [x] 1.1 Confirm `payloadSchemas/collection.schema.js` exports both `collectionSchema` (strict) and `collectionMigrationSchema` (lenient, `required: ["name"]`), both compile after empty-enum hydration, and the `claystone` fix is in place
- [x] 1.2 Confirm `postgresql/create_new.sql` `collections` has `early_age_id`/`late_age_id` nullable and `location geography`; confirm PostGIS extension is installed in the target DB
- [x] 1.3 Confirm `dictionaries.admin0`/`admin1`/`maritime` are populated (used for both enum hydration and name resolution)

## 2. Script Setup

- [x] 2.1 Create `migrate-collections.js` (ESM) with `mariadb`/`pg`/`closeAll` imports from `db.js`, `randomUUID` from `crypto`, and `Ajv` from `ajv/dist/2019.js`; add constants (`INSERT_BATCH_SIZE = 1000`, `LOG_SAMPLE_LIMIT = 20`, source table name)
- [x] 2.2 Add the `invokedDirectly` guard + `main().catch().finally(closeAll)` pattern from `migrate-authorities.js`, so pure transforms can be imported for unit tests in `play/`
- [x] 2.3 Add the bucketed `makeSampleLogger(label)` helper (copy from `migrate-authorities.js`) for each skip/flag category

## 3. Lookup Pre-loads

- [x] 3.1 Pre-load the legacy `reference_no` → new `refs.id` map: `SELECT id, reference->'legacyIDs'->>'oldpbdbID' AS legacy FROM refs WHERE succeeded_by_id IS NULL`; build `Map<string, number>`
- [x] 3.2 Pre-load `dictionaries.admin0` (`name`, `iso`, `iso3` → iso), `admin1` (`name`, `alternate_name` → iso, scoped by `admin0_id`), and `maritime` (`iho_name`) into normalized lookup maps for the toponym resolver; use directly (persons pattern — no versioning)
- [x] 3.3 Pre-load `secondary_refs` grouped by `collection_no` → array of `reference_no` (or stream-join later); confirm row count ~375,845

## 4. Enum Hydration + Schema Compile

- [x] 4.1 Import `collectionMigrationSchema`; hydrate the four DB-driven enums — `toponym.administrativeArea.admin0`, `.admin1`, the `if`-condition country list, and `toponym.maritimeArea` (from `dictionaries.maritime.iho_name`) — from the dictionaries maps before compiling
- [x] 4.2 Compile the migration schema with `new Ajv({ allErrors: true, strict: false })`; abort with a clear error if any enum is still empty (fail before reading source rows)

## 5. Pure Transforms (no DB; unit-testable in `play/`)

- [x] 5.1 `buildContext(src)` — `collectors`, `collectionMethods` (split `coll_meth` CSV/SET → array, trim, drop empties), `dates`, `comments`; omit empty/null (no `collection_type` — removed from schema)
- [x] 5.2 `normalizeName(s)` — casefold + trim, Unicode NFD decompose and strip combining marks (diacritics), collapse internal whitespace/punctuation to a single space; used on both legacy values and dictionary names/alternate_names so accented and punctuated variants (Curaçao, Åland, Cote D'Ivoire) match
- [x] 5.3 `COUNTRY_ALIASES` / `STATE_ALIASES` maps — normalized legacy variant → ISO code, for names that don't normalize to a dictionary entry. Seed from the measured unmatched set: e.g. `russian federation`→`RU`, `turkiye`→`TR`, `netherlands`→`NL`, `cape verde`→`CV`, `timor leste`→`TL`, `congo kinshasa`→`CD`, `congo brazzaville`→`CG`, `brunei darussalam`→`BN`, `micronesia federated states of`→`FM`, `falkland islands malvinas`→`FK`, `holy see vatican city state`→`VA`, `palestine`→`PS`, `bonaire sint eustatius and saba`→`BQ`, `virgin islands us`→`VI`, `virgin islands british`→`VG`, `cocos keeling islands`→`CC`, `aland islands`→`AX`, `saint barthelemy`→`BL`, `curacao`→`CW`. Keep the map data-driven and reviewable.
- [x] 5.3a `MARITIME_ALIASES` map — normalized legacy water-body `country` → `iho_name`, for the ocean values whose legacy string is shorter than the IHO name. Seed: `north pacific`→`North Pacific Ocean`, `south pacific`→`South Pacific Ocean`, `north atlantic`→`North Atlantic Ocean`, `south atlantic`→`South Atlantic Ocean`. The three that already match normalized (`indian ocean`, `southern ocean`, `arctic ocean`) need no alias.
- [x] 5.4 `resolveToponym(src, dicts, aliases)` — returns `{ administrativeArea?, maritimeArea?, skip?, flagReason? }`. **Land first:** `country`→admin0 iso via (1) `normalizeName` exact match against admin0 `name`/`iso`/`iso3`; (2) `COUNTRY_ALIASES`. For `state`→admin1 iso: normalized match against admin1 `name`/`alternate_name` scoped by the resolved `admin0_id`, then `STATE_ALIASES`. `county`→`admin2` passthrough. **Maritime fallback:** if `country` resolves to no admin0, try `normalizeName` match against `dictionaries.maritime.iho_name`, then `MARITIME_ALIASES` → set `maritimeArea` = `iho_name`. Signal skip only when `country` resolves to **neither** admin0 nor maritime, or when admin1 is unresolved for a country in the required-admin1 set. (Both branches may be populated — territorial waters — but legacy data carries only one.)
- [x] 5.5 `datumToSrid(gps_datum)` — map `''`/null/`'WGS84'`→4326, `'NAD27 CONUS'`→4267, `'NAD83'`→4269, `'WGS72'`→4322
- [x] 5.6 `buildAltitude({ altitude_value, altitude_unit })` — return `{ value, unit:'meters' }` converting feet→meters; return `{ drop:true }` (flag) when unit blank/null
- [x] 5.7 `buildCoordinates(src)` — `basis` from `latlng_basis` + altitude (from 5.6); never include latitude/longitude
- [x] 5.8 `buildLocation(src, toponym, coordinates)` — assemble `toponym` (`administrativeArea` and/or `maritimeArea` from 5.4), `coordinates`, `scale` (`geogscale`, coerced to `"unspecified"` when blank/null — `scale` is required), `comments` (`geogcomments`), `repository.institution` (`museum`); omit empty except the required `scale`
- [x] 5.9 `buildStratigraphy(src)` — `stratonyms` (supergroup/group←geological_group/subgroup/formation/member/bed), `scale`←stratscale, `comments`←stratcomments, `measuredSections` (section/bed/unit/order ← local_*)
- [x] 5.10 `buildLithofacies(src)` — up to two objects; `adjectives` = `lithadj`/`lithadj2` merged with `minor_lithology`/`minor_lithology2` (split+dedup); `fossils = fossilsfrom{1,2} === 'Y'`; omit objects without a lithology; allow empty array
- [x] 5.11 `buildAgesMeasurements(src)` — one object per non-empty `direct_ma`/`max_ma`/`min_ma` group (`age`/`error`/`unit`/`method`), `measurementType` from prefix; omit empty groups
- [x] 5.12 `buildCollectionPayload(src, admin)` — assemble the full `collection` jsonb from 5.1/5.8/5.9/5.10/5.11 + `name`/`akaName`/`legacyIDs.oldpbdbID`; never emit lat/lng, `references`, `ages.intervals`, `environment`, or `paleontology`

## 6. Stream, Build, Validate

- [x] 6.1 Open the source query selecting all in-scope columns (§spec Requirement "Read all source data") `ORDER BY collection_no ASC`; stream, do not buffer
- [x] 6.2 Resolve `reference_id` from the map; on orphan → increment counter, `logOrphanRef({collection_no, reference_no})`, continue (skip collection)
- [x] 6.3 Resolve persons with the 0-sentinel fallback (per `migrate-authorities.js:194-204`)
- [x] 6.4 Run `resolveToponym`; on skip → increment counter, `logNoToponymMatch({collection_no, country, state})`, continue (skip collection)
- [x] 6.5 Build the payload via `buildCollectionPayload`; when altitude was dropped, `logAltitudeDropped({collection_no})` (flag only, do not skip)
- [x] 6.6 Validate payload against the compiled migration schema; on failure log `{collection_no, errors, payload}` and `process.exit(1)` (no DB writes yet)
- [x] 6.7 Compute the geography SQL args `{ lng, lat, srid }` via `datumToSrid`; stage the collection insert record `{ permid, authorizer_person_id, enterer_person_id, collection, reference_id, geoArgs, collection_no }`

## 7. Bulk Insert — collections (transaction-wrapped)

- [ ] 7.1 Acquire one PG client; `BEGIN`
- [ ] 7.2 Batch-insert staged collections (1000/chunk); build `location` inline as `ST_Transform(ST_SetSRID(ST_MakePoint($lng,$lat),$srid),4326)::geography` (Transform is a no-op when srid=4326); `permid = randomUUID()`; leave `early_age_id`/`late_age_id` NULL
- [ ] 7.3 Capture each inserted collection's new `id` keyed by `collection_no` (RETURNING id) for the secondary-ref pass

## 8. Bulk Insert — additional_collection_refs

- [ ] 8.1 For each migrated collection, look up its `secondary_refs` `reference_no`s; resolve each via the refs map; on orphan → `logOrphanSecondaryRef`, skip that ref only (collection stays)
- [ ] 8.2 Insert `additional_collection_refs` rows `{ authorizer_person_id, enterer_person_id, collection_id, reference_id }` — audit inherited from the parent collection; no `order` column; batch inserts
- [ ] 8.3 `COMMIT`; on any error `ROLLBACK`, log with context, release client, `process.exit(1)`

## 9. Finalize + Report

- [ ] 9.1 Reset identity sequences for `collections` and `additional_collection_refs` (`setval(pg_get_serial_sequence(...), MAX(id))`)
- [ ] 9.2 Print counters: source rows read, collections inserted (with land/maritime toponym split), secondary refs inserted, skipped-orphan-ref, skipped-no-toponym-match, altitude-dropped, orphan-secondary-ref; assert `inserted + skipped == sourceRows`
- [ ] 9.3 Final `SELECT COUNT(*)` from `collections` and `additional_collection_refs`; log elapsed time

## 10. Unit Tests (play/)

- [x] 10.1 Add `play/` tests for the pure transforms (§5), especially: `coll_meth` split, `normalizeName` (diacritics/punctuation), `resolveToponym` cases — admin exact match, diacritic variant (Curaçao→CW), country alias hit (Russian Federation→RU), maritime exact match (Indian Ocean), maritime alias hit (North Pacific→North Pacific Ocean), and no-match skip — `datumToSrid`, feet→meter altitude + blank-unit drop, blank `geogscale`→`"unspecified"`, merged lithofacies adjectives, `buildAgesMeasurements` prefix→measurementType
- [x] 10.2 Add a validation smoke test: a representative built payload passes `collectionMigrationSchema`; a coordinate-less/reference-less payload also passes
