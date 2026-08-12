# collection-migration Specification

## Purpose
Migrate legacy MariaDB `collections` rows into the new PostgreSQL `collections` table (identity, geography, stratigraphy, lithology, age) together with `additional_collection_refs`.

## Requirements

### Requirement: Read all source data from MariaDB
The script SHALL stream all rows from the MariaDB `collections` table, ordered by `collection_no ASC`. Required columns cover identity/audit (`collection_no`, `reference_no`, `authorizer_no`, `enterer_no`), name (`collection_name`, `collection_aka`), context (`collectors`, `coll_meth`, `collection_dates`, `collection_comments`), geography (`country`, `state`, `county`, `lat`, `lng`, `gps_datum`, `latlng_basis`, `altitude_value`, `altitude_unit`, `geogscale`, `geogcomments`, `museum`), stratigraphy (`supergroup`, `geological_group`, `subgroup`, `formation`, `member`, `bed`, `stratscale`, `stratcomments`, `local_section`, `local_bed`, `local_bed_unit`, `local_order`), lithology (`lithology1`, `lithology2`, `lithadj`, `lithadj2`, `minor_lithology`, `minor_lithology2`, `fossilsfrom1`, `fossilsfrom2`, `lithification`, `lithification2`), and age (`direct_ma*`, `max_ma*`, `min_ma*`). Deferred columns (`max_interval_no`, `min_interval_no`, `paleolat`, `paleolng`, `plate`, `latlng_precision`) SHALL NOT be used.

#### Scenario: Full streaming extraction
- **WHEN** the migration script executes the source query
- **THEN** all 275,555 rows are streamed from MariaDB ordered by `collection_no ASC`, without buffering the full result set, and a starting row count is logged

### Requirement: Hydrate DB-driven enums before compiling the migration schema
The script SHALL populate the schema's four DB-driven enums — `toponym.administrativeArea.admin0`, `toponym.administrativeArea.admin1`, the `if`-condition country list, and `toponym.maritimeArea` — from `dictionaries.admin0`/`admin1` ISO values and `dictionaries.maritime.iho_name` at startup, before compiling the validation schema. An empty `enum: []` SHALL NOT be passed to the validator.

#### Scenario: Enums hydrated at startup
- **WHEN** the script starts and loads `collectionMigrationSchema`
- **THEN** the four DB-driven enums are filled from `dictionaries` and `ajv.compile` succeeds

#### Scenario: Compile fails fast on empty enum
- **WHEN** any DB-driven enum is still empty at compile time
- **THEN** compilation fails and the migration aborts before reading source rows

### Requirement: Validate the stored jsonb against the lenient migration schema
The script SHALL validate each built `collection` payload against `collectionMigrationSchema` (not the strict `collectionSchema`) before any DB write. The migration schema SHALL NOT require `latitude`/`longitude` or `references`, which are stored in columns rather than the jsonb.

#### Scenario: Coordinate-less, reference-less jsonb validates
- **WHEN** a payload contains `name` and valid sub-objects but no `latitude`/`longitude` or `references` keys
- **THEN** validation passes

#### Scenario: Validation failure aborts the run
- **WHEN** a built payload fails migration-schema validation
- **THEN** the offending `collection_no`, errors, and payload are logged and the migration aborts

### Requirement: Build identity and name fields
The script SHALL set `collection.name` from `collection_name`, `collection.akaName` from `collection_aka` (when present), and `collection.legacyIDs.oldpbdbID` from `collection_no`.

#### Scenario: Name and legacy id populated
- **WHEN** a source row has `collection_no = 123` and `collection_name = 'Foo Quarry'`
- **THEN** the payload has `name = 'Foo Quarry'` and `legacyIDs.oldpbdbID = '123'`

### Requirement: Build the context object
The script SHALL build `collection.context` from `collectors`, `coll_meth` (→ `collectionMethods`, splitting the CSV/SET into an array of strings), `collection_dates` (→ `dates`), and `collection_comments` (→ `comments`). Empty/null source fields SHALL be omitted. The legacy `collection_type` column SHALL NOT be read or migrated (removed from the schema).

#### Scenario: Collection methods CSV split into array
- **WHEN** `coll_meth = 'sieve,surface (float)'`
- **THEN** `context.collectionMethods = ['sieve', 'surface (float)']`

#### Scenario: collection_type is not migrated
- **WHEN** a source row has any `collection_type` value
- **THEN** the built `context` has no `collectionType` key and `collection_type` is not read

### Requirement: Resolve the toponym (admin area or maritime area) from free-text country/state
The script SHALL resolve `country`/`state` into `location.toponym`, which holds an `administrativeArea` (land), a `maritimeArea` (open water), or both, with at least one required. For land, it SHALL resolve `country` → `toponym.administrativeArea.admin0` and `state` → `admin1` to ISO codes using a normalize-then-alias pipeline against `dictionaries.admin0`/`admin1`, because legacy values do not equal dictionary names verbatim. Resolution SHALL: (1) normalize both the legacy value and dictionary entries by casefolding, trimming, stripping diacritics (Unicode NFD + combining-mark removal), and collapsing whitespace/punctuation; (2) match `country` against admin0 `name`/`iso`/`iso3`, and `state` against admin1 `name`/`alternate_name` scoped by the resolved `admin0_id`; (3) fall back to a curated alias map (normalized legacy string → ISO code) for known variants. County SHALL pass through to `admin2` as free text. `admin1` is NOT required: when `country` resolves but `state` does not resolve to an `admin1` ISO code, the row SHALL migrate country-only (no `admin1`), be counted/flagged in output, and preserve the raw `state` string via a `location.comments` marker (see the location-comments requirement) — it SHALL NOT be dropped. When `country` resolves to no admin0, the script SHALL attempt maritime resolution (see the maritime requirement) before flagging. On no resolution as either an admin area or a maritime area, the row SHALL be flagged and not migrated.

#### Scenario: Country resolves by normalized name
- **WHEN** `country = 'United States'` normalizes to a dictionary admin0 `name`
- **THEN** `admin0` is set to the matched ISO code (`US`)

#### Scenario: Diacritic variant resolves via normalization
- **WHEN** `country = 'Curaçao'` (no verbatim dictionary match) normalizes to a dictionary/alias entry
- **THEN** `admin0` is set to its ISO code (`CW`)

#### Scenario: Name variant resolves via alias map
- **WHEN** `country = 'Russian Federation'` matches no dictionary name but is present in the country alias map
- **THEN** `admin0` is set to `RU`

#### Scenario: No admin or maritime resolution skips the row
- **WHEN** `country` resolves via neither normalized admin0 dictionary match, the country alias map, nor maritime resolution
- **THEN** the collection is flagged in output with its `collection_no` and is not migrated

#### Scenario: Unresolved admin1 migrates country-only and preserves the raw string
- **WHEN** `country` resolves to an `admin0` but `state` resolves to no `admin1` ISO code
- **THEN** the collection migrates with `administrativeArea = { admin0 }` (no `admin1`), is counted/flagged in output, and the raw `state` string is appended to `location.comments` as `[migration] Unrecognized admin1 name: <state>`

### Requirement: Resolve ocean/marine country values to a maritime area
The script SHALL resolve legacy `country` values that name a body of water rather than an administrative area (e.g. "North Pacific", "Indian Ocean") — approximately 32,117 rows — into `location.toponym.maritimeArea`, set to the matching `iho_name` from `dictionaries.maritime`. These SHALL NOT be forced into `admin0`. Resolution SHALL: (1) `normalizeName`-match the legacy `country` against `dictionaries.maritime.iho_name`; (2) fall back to a curated `MARITIME_ALIASES` map (normalized legacy string → `iho_name`) for values whose legacy form is shorter than the IHO name (e.g. "North Pacific" → "North Pacific Ocean"). Maritime resolution is attempted only after admin0 resolution fails.

#### Scenario: Ocean value resolves to a maritime area
- **WHEN** `country = 'Indian Ocean'` matches a `dictionaries.maritime.iho_name`
- **THEN** `toponym.maritimeArea = 'Indian Ocean'` and no `admin0` is set

#### Scenario: Short ocean name resolves via the maritime alias map
- **WHEN** `country = 'North Pacific'` (no verbatim `iho_name` match) is present in `MARITIME_ALIASES`
- **THEN** `toponym.maritimeArea = 'North Pacific Ocean'`

### Requirement: Build the PostGIS geography from decimal coordinates
The script SHALL build the `location` geography column from decimal `lat`/`lng` (WGS84 DD, already signed). The legacy `coordinate` POINT and DMS fields SHALL NOT be used. Latitude and longitude SHALL NOT be written to the jsonb.

#### Scenario: Geography built from lat/lng
- **WHEN** a row has `lat = 45.1` and `lng = -110.2` with null or WGS84 `gps_datum`
- **THEN** `location` is set to `ST_SetSRID(ST_MakePoint(-110.2, 45.1), 4326)::geography` and no latitude/longitude appears in the jsonb

#### Scenario: Non-WGS84 datum is transformed
- **WHEN** a row has `gps_datum = 'NAD27 CONUS'`
- **THEN** the point is built in SRID 4267 and `ST_Transform`ed to 4326 before casting to geography

### Requirement: Build coordinate basis and altitude
The script SHALL set `location.coordinates.basis` from `latlng_basis`, and `location.coordinates.altitude` from `altitude_value` converted to meters. When `altitude_unit` is blank or null, the altitude SHALL NOT be migrated and the row SHALL be flagged in output.

#### Scenario: Feet converted to meters
- **WHEN** `altitude_value = 100` and `altitude_unit = 'feet'`
- **THEN** `altitude.value` is the meter-converted value and `altitude.unit = 'meters'`

#### Scenario: Blank altitude unit drops altitude and flags
- **WHEN** `altitude_value = 100` and `altitude_unit` is blank or null
- **THEN** no `altitude` is written and the `collection_no` is flagged in output

### Requirement: Build location scale, comments, and repository
The script SHALL set `location.scale` from `geogscale`, `location.comments` from `geogcomments`, and `location.repository.institution` from `museum`, omitting empty/null values — **except** `scale`, which is required: a blank/null `geogscale` SHALL coerce to the explicit enum value `"unspecified"` rather than being omitted. When the legacy `state` was present but did not resolve to an `admin1` ISO code (see the toponym-resolution requirement), the script SHALL append a marker line `[migration] Unrecognized admin1 name: <raw state>` to `location.comments`, joined to any existing `geogcomments` text with a newline (marker last). This preserves the raw legacy state string in the migrated record rather than discarding it.

#### Scenario: Scale and repository populated
- **WHEN** `geogscale = 'outcrop'` and `museum = 'AMNH'`
- **THEN** `location.scale = 'outcrop'` and `location.repository.institution = 'AMNH'`

#### Scenario: Blank scale coerces to "unspecified"
- **WHEN** `geogscale` is blank or null
- **THEN** `location.scale = 'unspecified'` (the field is present, satisfying the required `scale`)

#### Scenario: Unresolved admin1 appended to comments with no prior comment
- **WHEN** `state = 'Bayern'` does not resolve to an `admin1` ISO code and `geogcomments` is blank/null
- **THEN** `location.comments = '[migration] Unrecognized admin1 name: Bayern'`

#### Scenario: Unresolved admin1 appended after an existing geog comment
- **WHEN** `state = 'Bayern'` does not resolve and `geogcomments = 'Outcrop near river.'`
- **THEN** `location.comments = 'Outcrop near river.\n[migration] Unrecognized admin1 name: Bayern'`

### Requirement: Build the stratigraphy object
The script SHALL build `collection.stratigraphy` with `stratonyms` (`supergroup`, `geological_group` → `group`, `subgroup`, `formation`, `member`, `bed`), `scale` (from `stratscale`), `comments` (from `stratcomments`), and `measuredSections` (`local_section` → `section`, `local_bed` → `bed`, `local_bed_unit` → `unit`, `local_order` → `order`). Empty/null values SHALL be omitted.

#### Scenario: Stratonyms and measured section mapped
- **WHEN** `formation = 'Hell Creek'` and `local_section = 'A'`
- **THEN** `stratigraphy.stratonyms.formation = 'Hell Creek'` and `stratigraphy.measuredSections.section = 'A'`

### Requirement: Build the lithofacies array
The script SHALL build up to two `lithofacies[]` objects. Object 1: `lithology1`, `adjectives` = `lithadj` merged with `minor_lithology`, `fossils` = (`fossilsfrom1 === 'Y'`), `lithification`. Object 2: the `*2` equivalents. An object with no lithology SHALL be omitted; the array MAY be empty.

#### Scenario: Two lithofacies objects built with merged adjectives
- **WHEN** `lithology1 = 'sandstone'`, `lithadj = 'red'`, `minor_lithology = 'silty'`, `fossilsfrom1 = 'Y'`
- **THEN** `lithofacies[0]` has `lithology = 'sandstone'`, `adjectives` includes `'red'` and `'silty'`, and `fossils = true`

#### Scenario: Empty lithology yields empty array
- **WHEN** both `lithology1` and `lithology2` are null/empty
- **THEN** `lithofacies` is omitted or an empty array and the row still validates

### Requirement: Build the ages.measurements array
The script SHALL build `ages.measurements[]` from the `direct_ma*`, `max_ma*`, and `min_ma*` column groups (`_ma` → `age`, `_ma_error` → `error`, `_ma_unit` → `unit`, `_ma_method` → `method`), with the prefix mapping to `measurementType` (`direct`/`max`/`min`). A group with no `_ma` value SHALL be omitted. This SHALL be independent of the deferred age interval FKs.

#### Scenario: Measurement built from max_ma group
- **WHEN** `max_ma = '66'`, `max_ma_error = '0.1'`, `max_ma_unit = 'Ma'`, `max_ma_method = 'U/Pb'`
- **THEN** `ages.measurements` contains `{ age:'66', error:'0.1', unit:'Ma', method:'U/Pb', measurementType:'max' }`

### Requirement: Map the primary reference and skip orphans
The script SHALL resolve `reference_no` → `reference_id` via the `refs.reference.legacyIDs.oldpbdbID` → `refs.id` head-version lookup (`succeeded_by_id IS NULL`). When no surviving ref exists, the collection SHALL be skipped and logged.

#### Scenario: Primary reference resolved
- **WHEN** `reference_no = 500` maps to a current-head `refs` row with id 42
- **THEN** the collection's `reference_id` is 42

#### Scenario: Orphan primary reference skips the collection
- **WHEN** `reference_no` has no surviving `refs` row
- **THEN** the collection is skipped and logged with its `collection_no` and `reference_no`

### Requirement: Migrate secondary references into additional_collection_refs
The script SHALL read `secondary_refs` (`collection_no`, `reference_no`) and insert one `additional_collection_refs` row per surviving secondary reference, with `collection_id` set to the migrated collection and `authorizer_person_id`/`enterer_person_id` inherited from the parent collection. Secondary refs whose `reference_no` is orphaned SHALL be skipped and logged individually, without dropping the collection. No `order` value is stored.

#### Scenario: Secondary ref inherits collection audit
- **WHEN** a `secondary_refs` row links `collection_no = 123` to a surviving `reference_no`
- **THEN** an `additional_collection_refs` row is created with the collection's `collection_id` and the collection's authorizer/enterer person ids

#### Scenario: Orphan secondary ref skipped without dropping collection
- **WHEN** a `secondary_refs.reference_no` has no surviving `refs` row
- **THEN** that secondary ref is skipped and logged, and the parent collection is still migrated

### Requirement: Resolve person FKs with zero-sentinel fallback
The script SHALL set `authorizer_person_id`/`enterer_person_id` from `authorizer_no`/`enterer_no`, applying the same zero-sentinel fallback used by the refs/authorities migrations (0 → the other value, or a person fallback when both are 0).

#### Scenario: Zero authorizer falls back to enterer
- **WHEN** `authorizer_no = 0` and `enterer_no = 7`
- **THEN** both `authorizer_person_id` and `enterer_person_id` resolve to 7

### Requirement: Leave age FK columns NULL and omit deferred jsonb objects
The script SHALL leave `early_age_id` and `late_age_id` NULL, and SHALL NOT populate `ages.intervals`, `environment`, or `paleontology` in the jsonb.

#### Scenario: Age FKs and deferred objects absent
- **WHEN** any collection is inserted
- **THEN** `early_age_id` and `late_age_id` are NULL and the jsonb has no `ages.intervals`, `environment`, or `paleontology` keys

### Requirement: Generate a fresh permid per collection
The script SHALL generate a fresh `randomUUID()` `permid` for each inserted collection, inserting rows as single versions (`succeeded_by_id IS NULL`).

#### Scenario: Unique permid assigned
- **WHEN** a collection is inserted
- **THEN** it receives a fresh UUID `permid` and no `preceded_by_id`/`succeeded_by_id`

### Requirement: Insert within a transaction and report outcomes
The migration SHALL insert `collections` and `additional_collection_refs` within a transaction (rolling back on failure), reset the identity sequences afterward, and report counters for inserted collections, inserted secondary refs, and each skip/flag category (orphan primary ref, no toponym match, dropped altitude, orphan secondary ref).

#### Scenario: Transactional insert with counters
- **WHEN** the migration completes successfully
- **THEN** all rows are committed in one transaction, identity sequences are reset, and a summary of inserted and skipped/flagged counts is printed

#### Scenario: Rollback on failure
- **WHEN** an insert fails mid-run
- **THEN** the transaction rolls back and no partial data remains
