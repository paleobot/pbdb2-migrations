# PBDB Archive Database — Schema Catalog

## Database Overview

| Metric | Value |
|--------|-------|
| **Database** | `pbdb_archive` |
| **Engine** | MySQL/MariaDB (InnoDB) |
| **Total Tables** | 99 (98 base tables + 1 view) |
| **Total Rows** | ~22.4M (estimated from information_schema) |
| **Largest Table** | `div_matrix` (~3.76M rows) |
| **Core Data Tables** | `occurrences` (~2.02M), `opinions` (~999K), `authorities` (~517K), `collections` (~239K), `refs` (~94K), `person` (1,304) |

---

## Table Inventory by Domain

### 1. Core Entity Tables

#### `authorities` — Taxonomic Names (517,287 rows)
Primary key: `taxon_no` (auto_increment)

| Column | Type | Null | Key | Default | Notes |
|--------|------|------|-----|---------|-------|
| authorizer_no | int(10) unsigned | NO | MUL | 0 | → person.person_no |
| enterer_no | int(10) unsigned | NO | MUL | 0 | → person.person_no |
| modifier_no | int(10) unsigned | NO | MUL | 0 | → person.person_no |
| updater_no | int(10) unsigned | NO | | 0 | → person.person_no (no index) |
| taxon_no | int(10) unsigned | NO | PRI | auto | Primary key |
| orig_no | int(10) unsigned | NO | MUL | 0 | → authorities.taxon_no (original concept) |
| reference_no | int(10) unsigned | NO | MUL | 0 | → refs.reference_no |
| taxon_rank | enum(26 values) | YES | MUL | NULL | subspecies..superkingdom,unranked clade,informal |
| taxon_name | varchar(80) | NO | MUL | '' | |
| subgenus_index | varchar(80) | YES | MUL | NULL | |
| common_name | varchar(80) | YES | | NULL | |
| type_taxon_no | int(10) unsigned | NO | MUL | 0 | → authorities.taxon_no (self-ref) |
| type_specimen | varchar(255) | NO | | '' | |
| museum | varchar(12) | YES | | NULL | |
| catalog_number | varchar(80) | YES | | NULL | |
| type_body_part | enum(57 values) | YES | | NULL | |
| form_taxon | enum('','no','yes') | YES | | NULL | |
| part_details | varchar(160) | YES | | NULL | |
| type_locality | int(10) unsigned | YES | | NULL | → collections.collection_no (no index, nullable) |
| extant_old | varchar(4) | YES | | NULL | **DEPRECATED** |
| extant | enum('','no','yes') | YES | | NULL | |
| first_occurrence | varchar(255) | YES | | NULL | |
| last_occurrence | varchar(255) | YES | | NULL | |
| preservation_old | enum(4 values) | YES | | NULL | **DEPRECATED** |
| preservation_less_old | enum(4 values) | YES | | NULL | **DEPRECATED** |
| preservation | enum(11 values) | YES | | NULL | |
| ref_is_authority | varchar(4) | NO | | '' | |
| refauth | tinyint(1) | YES | | NULL | |
| author1init | varchar(10) | NO | | '' | |
| author1last | varchar(80) | NO | | '' | |
| author2init | varchar(10) | NO | | '' | |
| author2last | varchar(80) | NO | | '' | |
| otherauthors | varchar(255) | NO | | '' | |
| pubyr | varchar(4) | YES | | '' | |
| pages | varchar(40) | YES | | NULL | |
| figures | varchar(100) | YES | | NULL | |
| comments | mediumtext | NO | | '' | |
| discussion | mediumtext | YES | | NULL | |
| discussed_by | int(10) unsigned | YES | | NULL | → refs.reference_no (no index) |
| upload | varchar(255) | NO | | '' | |
| created | datetime | NO | MUL | current_timestamp() | |
| modified | timestamp | NO | MUL | current_timestamp() | on update |
| updated | timestamp | YES | | NULL | |
| upload_id | varchar(255) | YES | | NULL | |

#### `collections` — Fossil Collection Sites (238,642 rows)
Primary key: `collection_no` (auto_increment)

| Column | Type | Null | Key | Default | Notes |
|--------|------|------|-----|---------|-------|
| authorizer | varchar(64) | NO | | '' | Denormalized from person |
| enterer | varchar(64) | NO | | '' | Denormalized from person |
| modifier | varchar(64) | YES | | NULL | Denormalized from person |
| authorizer_no | int(10) unsigned | NO | MUL | 0 | → person.person_no |
| enterer_no | int(10) unsigned | NO | MUL | 0 | → person.person_no |
| modifier_no | int(10) unsigned | NO | MUL | 0 | → person.person_no |
| updater_no | int(10) unsigned | NO | | 0 | → person.person_no (no index) |
| source_database | enum(4 values) | YES | | NULL | ETE, Fossilworks, PaleoDB, PGAP |
| research_group | set(12 values) | YES | MUL | NULL | |
| license | enum('CC BY','CC0') | YES | | NULL | |
| collection_no | int(10) unsigned | NO | PRI | auto | Primary key |
| collection_subset | int(10) unsigned | YES | MUL | NULL | → collections.collection_no (self-ref) |
| reference_no | int(10) unsigned | NO | MUL | 0 | → refs.reference_no |
| collection_name | varchar(255) | NO | MUL | '' | |
| collection_aka | mediumtext | YES | | NULL | |
| country | varchar(255) | NO | MUL | '' | |
| state | varchar(255) | YES | MUL | NULL | |
| county | varchar(255) | YES | MUL | NULL | |
| latdeg | smallint(5) unsigned | YES | | NULL | DMS latitude degrees |
| latmin | smallint(5) unsigned | YES | | NULL | DMS latitude minutes |
| latsec | smallint(5) unsigned | YES | | NULL | DMS latitude seconds |
| latdec | varchar(10) | YES | | NULL | Decimal portion |
| latdir | enum('North','South') | NO | | 'North' | |
| lat | float(9,6) | YES | | NULL | Decimal latitude |
| lngdeg | smallint(5) unsigned | YES | | NULL | DMS longitude degrees |
| lngmin | smallint(5) unsigned | YES | | NULL | DMS longitude minutes |
| lngsec | smallint(5) unsigned | YES | | NULL | DMS longitude seconds |
| lngdec | varchar(10) | YES | | NULL | Decimal portion |
| lngdir | enum('East','West') | NO | | 'East' | |
| lng | float(9,6) | YES | | NULL | Decimal longitude |
| coordinate | point | YES | | NULL | Spatial column |
| latlng_precision | enum(12 values) | YES | | NULL | |
| latlng_basis | enum(6 values) | YES | | NULL | |
| paleolng | float(5,2) | YES | | NULL | Paleocoordinate longitude |
| paleolat | float(5,2) | YES | | NULL | Paleocoordinate latitude |
| plate | int(3) unsigned | YES | | NULL | → plates.plate |
| max_interval_no | int(10) unsigned | NO | MUL | 0 | → intervals.interval_no |
| min_interval_no | int(10) unsigned | NO | MUL | 0 | → intervals.interval_no |
| formation | varchar(255) | YES | MUL | NULL | |
| geological_group | varchar(255) | YES | MUL | NULL | |
| member | varchar(255) | YES | MUL | NULL | |
| environment | enum(95 values) | YES | MUL | NULL | Detailed depositional environment |
| lithology1 | enum(53 values) | YES | MUL | NULL | |
| lithology2 | enum(52 values) | YES | MUL | NULL | |
| pres_mode | set(36 values) | YES | MUL | NULL | |
| created | datetime | NO | MUL | current_timestamp() | |
| modified | timestamp | NO | MUL | current_timestamp() | on update |
| access_level | enum(4 values) | NO | MUL | 'the public' | |
| *(+100 more columns)* | | | | | See full dump for stratigraphy, lithology, preservation, component, collection method details |

#### `occurrences` — Fossil Occurrence Records (2,016,317 rows)
Primary key: `occurrence_no` (auto_increment)

| Column | Type | Null | Key | Default | Notes |
|--------|------|------|-----|---------|-------|
| authorizer | varchar(64) | NO | MUL | '' | Denormalized from person |
| enterer | varchar(64) | NO | MUL | '' | Denormalized from person |
| modifier | varchar(64) | YES | MUL | NULL | Denormalized from person |
| authorizer_no | int(10) unsigned | NO | MUL | 0 | → person.person_no |
| enterer_no | int(10) unsigned | NO | MUL | 0 | → person.person_no |
| modifier_no | int(10) unsigned | NO | MUL | 0 | → person.person_no |
| updater_no | int(10) unsigned | NO | | 0 | → person.person_no (no index) |
| occurrence_no | int(10) unsigned | NO | PRI | auto | Primary key |
| reid_no | int(10) unsigned | YES | | NULL | → reidentifications.reid_no |
| collection_no | int(10) unsigned | NO | MUL | 0 | → collections.collection_no |
| taxon_no | int(10) unsigned | YES | MUL | 0 | → authorities.taxon_no |
| genus_reso | enum(10 values) | YES | MUL | NULL | |
| genus_name | varchar(255) | NO | MUL | '' | |
| species_reso | enum(10 values) | YES | MUL | NULL | |
| species_name | varchar(255) | NO | MUL | '' | |
| subgenus_reso | enum(10 values) | YES | | NULL | |
| subgenus_name | varchar(255) | YES | MUL | NULL | |
| subspecies_reso | enum(14 values) | YES | | NULL | |
| subspecies_name | varchar(255) | YES | | NULL | |
| abund_value | varchar(255) | YES | | NULL | |
| abund_unit | varchar(20) | YES | | NULL | |
| reference_no | int(10) unsigned | NO | MUL | 0 | → refs.reference_no |
| plant_organ | enum(18 values) | YES | | NULL | |
| plant_organ2 | enum(17 values) | YES | | NULL | |
| comments | mediumtext | YES | | NULL | |
| created | datetime | NO | | current_timestamp() | |
| modified | timestamp | NO | MUL | current_timestamp() | on update |

#### `refs` — Bibliographic References (93,863 rows)
Primary key: `reference_no` (auto_increment)

| Column | Type | Null | Key | Default | Notes |
|--------|------|------|-----|---------|-------|
| authorizer | varchar(64) | NO | | '' | Denormalized from person |
| enterer | varchar(64) | NO | | '' | Denormalized from person |
| modifier | varchar(64) | YES | | NULL | Denormalized from person |
| authorizer_no | int(10) unsigned | NO | MUL | 0 | → person.person_no |
| enterer_no | int(10) unsigned | NO | MUL | 0 | → person.person_no |
| modifier_no | int(10) unsigned | NO | MUL | 0 | → person.person_no |
| updater_no | int(10) unsigned | NO | | 0 | → person.person_no (no index) |
| reference_no | int(10) unsigned | NO | PRI | auto | Primary key |
| author1init | varchar(10) | YES | | NULL | |
| author1last | varchar(255) | NO | MUL | '' | |
| author2init | varchar(10) | YES | | NULL | |
| author2last | varchar(255) | YES | | NULL | |
| otherauthors | varchar(255) | YES | | NULL | |
| pubyr | varchar(4) | NO | MUL | '' | |
| reftitle | mediumtext | YES | MUL | NULL | |
| pubtitle | mediumtext | YES | MUL | NULL | |
| editors | varchar(255) | YES | | NULL | |
| publisher | varchar(255) | YES | | NULL | |
| pubcity | varchar(80) | YES | | NULL | |
| pubvol | varchar(10) | YES | | NULL | |
| pubno | varchar(10) | YES | | NULL | |
| firstpage | varchar(10) | YES | | NULL | |
| lastpage | varchar(10) | YES | | NULL | |
| publication_type | enum(13 values) | YES | | NULL | |
| language | enum(14 values) | YES | | NULL | |
| doi | varchar(80) | YES | | NULL | |
| created | datetime | NO | | current_timestamp() | |
| modified | timestamp | NO | MUL | current_timestamp() | on update |

#### `opinions` — Taxonomic Opinions (998,565 rows)
Primary key: `opinion_no` (auto_increment)

| Column | Type | Null | Key | Default | Notes |
|--------|------|------|-----|---------|-------|
| authorizer_no | int(10) unsigned | NO | MUL | 0 | → person.person_no |
| enterer_no | int(10) unsigned | NO | MUL | 0 | → person.person_no |
| modifier_no | int(10) unsigned | NO | MUL | 0 | → person.person_no |
| updater_no | int(10) unsigned | NO | | 0 | → person.person_no (no index) |
| opinion_no | int(10) unsigned | NO | PRI | auto | Primary key |
| reference_no | int(10) unsigned | NO | MUL | 0 | → refs.reference_no |
| child_no | int(10) unsigned | NO | MUL | 0 | → authorities.taxon_no (child taxon concept) |
| child_spelling_no | int(10) unsigned | NO | MUL | 0 | → authorities.taxon_no (child spelling) |
| status_old | enum(13 values) | YES | | NULL | **DEPRECATED** |
| status | enum(10 values) | YES | | NULL | belongs to, synonym of, etc. |
| basis | enum(5 values) | YES | | NULL | |
| phylogenetic_status | enum(5 values) | NO | | '' | |
| spelling_reason | enum(6 values) | NO | | 'original spelling' | |
| parent_no | int(10) unsigned | YES | MUL | NULL | → authorities.taxon_no (parent concept) |
| parent_spelling_no | int(10) unsigned | NO | MUL | 0 | → authorities.taxon_no (parent spelling) |
| author1init..otherauthors | varchar | NO | | '' | Author fields |
| pubyr | varchar(4) | NO | | '' | |
| created | datetime | NO | MUL | current_timestamp() | |
| modified | timestamp | NO | MUL | current_timestamp() | on update |

#### `person` — Database Users (1,304 rows)
Primary key: `person_no` (auto_increment)

| Column | Type | Null | Key | Default | Notes |
|--------|------|------|-----|---------|-------|
| person_no | int(10) unsigned | NO | PRI | auto | Primary key |
| name | varchar(64) | NO | MUL | '' | Display name (e.g., "J. Alroy") |
| reversed_name | varchar(64) | NO | MUL | '' | |
| first_name | varchar(30) | NO | | '' | |
| last_name | varchar(30) | NO | | '' | |
| role | set(5 values) | YES | MUL | NULL | authorizer, limited, officer, student, technician |
| is_authorizer | tinyint(1) | NO | | 0 | |
| active | tinyint(1) | NO | | 1 | |
| heir_no | int(10) unsigned | NO | | 0 | → person.person_no (self-ref) |
| superuser | tinyint(1) | YES | | 0 | |

---

### 2. Taxonomy Domain

#### `auth_orig` — Taxon-to-Original-Concept Map (464,048 rows)
Primary key: `taxon_no`

| Column | Type | Null | Key | Default | Notes |
|--------|------|------|-----|---------|-------|
| taxon_no | int(10) unsigned | NO | PRI | | → authorities.taxon_no |
| orig_no | int(10) unsigned | NO | MUL | | → authorities.taxon_no (original concept) |

#### `taxon_trees` — Taxonomic Tree Structure (376,863 rows)
Primary key: `orig_no`

| Column | Type | Null | Key | Default | Notes |
|--------|------|------|-----|---------|-------|
| orig_no | int(10) unsigned | NO | PRI | | Original taxon concept number |
| name | varchar(80) | NO | MUL | | |
| imp | tinyint(1) | NO | | | |
| rank | tinyint(4) | NO | | | Numeric rank |
| trad_rank | tinyint(4) | NO | | | Traditional rank |
| min_rank | decimal(3,1) | NO | | | |
| max_rank | decimal(3,1) | NO | | | |
| status | enum(11 values) | YES | MUL | | belongs to, synonym of, etc. |
| spelling_no | int(10) unsigned | NO | MUL | | → authorities.taxon_no |
| trad_no | int(10) unsigned | NO | MUL | | |
| synonym_no | int(10) unsigned | NO | MUL | | → taxon_trees.orig_no (senior synonym) |
| immsyn_no | int(10) unsigned | NO | | | |
| accepted_no | int(10) unsigned | NO | MUL | | → taxon_trees.orig_no |
| immpar_no | int(10) unsigned | NO | MUL | | → taxon_trees.orig_no (immediate parent) |
| senpar_no | int(10) unsigned | NO | MUL | | → taxon_trees.orig_no (senior parent) |
| opinion_no | int(10) unsigned | NO | MUL | | → opinions.opinion_no |
| ints_no | int(10) unsigned | NO | | | → taxon_ints.ints_no |
| lft | int(11) | YES | MUL | | Nested set left |
| rgt | int(11) | YES | MUL | | Nested set right |
| bound | int(11) | YES | | | |
| depth | int(11) | YES | MUL | | Tree depth |

#### `taxon_names` — Taxon Name Spellings (482,022 rows)
Primary key: `taxon_no`

| Column | Type | Null | Key | Default | Notes |
|--------|------|------|-----|---------|-------|
| taxon_no | int(10) unsigned | NO | PRI | | → authorities.taxon_no |
| orig_no | int(10) unsigned | NO | MUL | | → authorities.taxon_no (original concept) |
| spelling_reason | enum(6 values) | YES | | | |
| opinion_no | int(10) unsigned | NO | MUL | | → opinions.opinion_no |
| pubyr | varchar(4) | YES | | | |
| author | varchar(80) | YES | | | |

#### `taxa_tree_cache` — Cached Tree Data (482,023 rows)
Primary key: `taxon_no`

| Column | Type | Null | Key | Default | Notes |
|--------|------|------|-----|---------|-------|
| taxon_no | int(10) unsigned | NO | PRI | | → authorities.taxon_no |
| lft | int(10) unsigned | NO | MUL | | Nested set left |
| rgt | int(10) unsigned | NO | MUL | | Nested set right |
| spelling_no | int(10) unsigned | NO | MUL | | → authorities.taxon_no |
| synonym_no | int(10) unsigned | NO | MUL | | → authorities.taxon_no |
| opinion_no | int(10) unsigned | NO | MUL | | → opinions.opinion_no |
| max_interval_no | int(10) unsigned | NO | | | → intervals.interval_no |
| min_interval_no | int(10) unsigned | NO | | | → intervals.interval_no |
| mass | float | YES | | | |

#### `taxon_search` — Taxon Name Search Index (506,888 rows)
Primary key: (`taxon_no`, `genus`, `common`)

| Column | Type | Null | Key | Default | Notes |
|--------|------|------|-----|---------|-------|
| genus | varchar(80) | NO | PRI | | |
| taxon_name | varchar(80) | NO | MUL | | |
| full_name | varchar(80) | NO | MUL | | |
| taxon_rank | enum(26 values) | YES | | | |
| taxon_no | int(10) unsigned | NO | PRI | | → authorities.taxon_no |
| orig_no | int(10) unsigned | NO | | | → authorities.taxon_no |
| accepted_no | int(10) unsigned | NO | | | |
| is_current | tinyint(1) | NO | | | |
| is_exact | tinyint(1) | NO | | | |
| common | char(2) | NO | PRI | | |

#### `taxon_ages` — Taxon Age Ranges (376,863 rows)
Primary key: `orig_no`

| Column | Type | Null | Key | Default | Notes |
|--------|------|------|-----|---------|-------|
| orig_no | int(10) unsigned | NO | PRI | | → taxon_trees.orig_no |
| precise_age | tinyint(1) | YES | | | |
| first_early_age | decimal(9,5) | YES | | | Ma |
| first_late_age | decimal(9,5) | YES | | | Ma |
| last_early_age | decimal(9,5) | YES | | | Ma |
| last_late_age | decimal(9,5) | YES | | | Ma |
| early_occ | int(10) unsigned | YES | | | → occurrences.occurrence_no |
| late_occ | int(10) unsigned | YES | | | → occurrences.occurrence_no |

#### `taxon_attrs` — Taxon Attributes (376,863 rows)
Primary key: `orig_no` — Extensive attribute cache including validity, extancy, size, ages, body mass, occurrence counts.

#### `taxon_lower` — Lower Taxonomy Mappings (339,190 rows)
Primary key: `orig_no` — Maps taxa to genus/subgenus/species level with `genus_no`, `subgenus_no`, `species_no` → authorities.taxon_no.

#### `taxon_counts` — Hierarchical Taxon Counts (344,685 rows)
Primary key: `orig_no` — Counts of immediate children, juniors, kingdoms, phyla, classes, orders, families, genera, species.

#### `taxon_colls` — Taxon Collection Statistics (76,921 rows)
Primary key: `orig_no` — Occurrence and collection counts (marine/terrestrial split).

#### `taxon_ecotaph` — Taxon Ecology/Taphonomy (376,863 rows)
Primary key: `orig_no` — Ecological and taphonomic attributes with `*_basis_no` columns → ecotaph.ecotaph_no.

#### `taxon_etbasis` — Ecotaph Basis Records (376,863 rows)
Primary key: `orig_no` — `*_basis_no` + `*_basis` text pairs referencing basis for ecological attributes.

#### `taxon_ints` — Taxon Interval Classifications (32,241 rows)
Primary key: `ints_no` — Higher taxonomy assignments (kingdom_no, phylum_no, class_no, order_no, family_no → taxon_trees.orig_no).

#### `taxon_pics` — Taxon Picture Assignments (4,169 rows)
Primary key: `orig_no` — Maps taxa to `image_no` → images.image_no.

#### `taxon_images` — Taxon Phylopic Images (480 rows)
Primary key: `uid` — Phylopic image associations.

#### `taxon_exceptions` — Taxonomy Exceptions (4 rows)
Primary key: `orig_no` — Special-case overrides.

#### `taxon_search` — Search Index (506,888 rows)
Composite PK (`taxon_no`, `genus`, `common`) — Full-text search support table.

---

### 3. Collections & Geography Domain

#### `coll_matrix` — Collection Summary Cache (275,554 rows)
Primary key: `collection_no`

| Column | Type | Null | Key | Default | Notes |
|--------|------|------|-----|---------|-------|
| collection_no | int(10) unsigned | NO | PRI | | → collections.collection_no |
| bin_id_1..3 | int(10) unsigned | NO | MUL | 0 | → bin_container.bin_id |
| clust_id | int(10) unsigned | NO | | 0 | |
| lng, lat | decimal(9,6) | YES | | | |
| g_plate_no | smallint(5) unsigned | YES | | | → geoplates.plate_no |
| s_plate_no | smallint(5) unsigned | YES | | | |
| loc | geometry | NO | MUL | | Spatial index |
| cc | char(2) | YES | MUL | | → country_map.cc |
| continent | char(3) | YES | | | → continent_data.continent |
| early_age, late_age | decimal(9,5) | YES | MUL | | Ma |
| early_int_no, late_int_no | int(10) unsigned | NO | | | → intervals.interval_no |
| n_occs | int(10) unsigned | NO | | 0 | |
| reference_no | int(10) unsigned | NO | MUL | | → refs.reference_no |
| access_level | tinyint(3) unsigned | NO | | | |

#### `coll_loc` — Collection Locations (275,672 rows)
Primary key: `collection_no` — Coordinates (lng, lat), country code (cc), protected land status.

#### `coll_strata` — Collection Stratigraphy Cache (275,552 rows)
No PK (indexed on `collection_no`) — group, formation, member, lithology, coordinates, ages.

#### `coll_lith` — Collection Lithology (248,513 rows)
Composite PK: (`collection_no`, `lithology`) — Normalized lithology entries.

#### `coll_bins` — Collection Spatial Bins (335,250 rows)
Composite PK: (`bin_id`, `interval_no`) — Spatiotemporal binning with occurrence/collection counts.

#### `coll_ints` — Collection-Interval Assignments (1,534,839 rows)
No PK — (`collection_no`, `interval_no`) mapping, both indexed.

#### `coll_units` — Collection Stratigraphic Units (31,680 rows)
Primary key: `id` (auto_increment) — Links collections to column/unit IDs.

#### `paleocoords` — Paleocoordinates (2,141,402 rows)
Composite PK: (`collection_no`, `model`, `selector`) — Plate rotation results per collection.

#### `paleostatic` — Static Paleocoord Data (275,675 rows)
Primary key: `collection_no` — Present-day coords + ages for paleocoord computation.

#### `paleocoords_bins` / `paleostatic_bins` — Bin-level equivalents (~1.8M / ~239K rows)

#### `bin_container` — Spatial Bin Hierarchy (23,167 rows)
Primary key: `bin_id` — Contains `bin_id_1`, `bin_id_2`, `bin_id_3` nesting levels.

#### `bin_loc` — Bin Locations (25,400 rows)
Composite PK: (`bin_id`, `cc`) — Country code assignments per bin.

#### `country_map` — Country Code Lookup (256 rows)
Primary key: `cc` — Maps 2-letter codes to continent + name.

#### `continent_data` — Continent Lookup (9 rows)
Primary key: `continent` — 3-letter continent codes to names.

#### `plates` — Tectonic Plates (227 rows)
Primary key: `plate` — Plate number to paleocontinent + age.

#### `geoplates` — Geoplate Model Data (547 rows)
Composite PK: (`model`, `plate_no`) — Plate data per rotation model.

#### `paleomodels` — Paleocoord Models (3 rows)
Primary key: `name` — Active rotation model configuration.

#### `protected_land` — Protected Areas (49,778 rows)
No PK — Geometry shapes with country codes and categories.

---

### 4. Occurrences & Specimens Domain

#### `occ_matrix` — Occurrence Summary Cache (2,019,202 rows)
Composite PK: (`occurrence_no`, `reid_no`) — Denormalized occurrence data with taxonomy, ages, person references.

#### `occ_taxon` — Occurrence Taxon Summary (233,787 rows)
Primary key: `orig_no` — Per-taxon occurrence/collection counts and age ranges.

#### `occ_ref` — Occurrence Reference Summary (36,238 rows)
Primary key: `reference_no` — Per-reference occurrence/collection counts and age ranges.

#### `reidentifications` — Taxonomic Reidentifications (34,558 rows)
Primary key: `reid_no` (auto_increment) — Re-identifications of occurrences with full taxonomy fields.

#### `specimens` — Specimen Records (167,150 rows)
Primary key: `specimen_no` (auto_increment) — Links to occurrence_no, taxon_no, reference_no.

#### `spec_matrix` — Specimen Summary Cache (172,914 rows)
Composite PK: (`specimen_no`, `reid_no`) — Denormalized specimen data.

#### `measurements` — Specimen Measurements (365,099 rows)
Primary key: `measurement_no` (auto_increment) — Position, type, average/median/min/max values.

#### `specelt_data` / `specelt_map` / `specelt_exc` — Specimen Element Hierarchy
Lookup tables for specimen element types with nested-set structure.

---

### 5. Time Intervals Domain

#### `intervals` — Time Intervals (1,769 rows)
Primary key: `interval_no` (auto_increment) — Named geological time intervals.

#### `interval_data` — Interval Age Boundaries (1,769 rows)
Primary key: `interval_no` — Scale assignment, early/late ages, boundary types.

#### `interval_lookup` — Interval Hierarchy Cache (1,769 rows)
Primary key: `interval_no` — Maps intervals to period/epoch/subepoch/stage.

#### `interval_map` — Age-to-Interval Mapping (460,320 rows)
Composite PK: (`early_age`, `late_age`, `scale_no`) — Maps age ranges to intervals per scale.

#### `interval_bracket` — Age Bracket Lookup (2,404 rows)
Composite PK: (`age`, `interval_no`) — Maps specific ages to intervals.

#### `interval_buffer` — Interval Boundaries (171 rows)
Primary key: `interval_no` — Early/late boundary values.

#### `int_summary` — Interval Collection/Occurrence Counts (1,769 rows)
Primary key: `interval_no` — Aggregated counts per interval.

#### `int_major_map` — Major Interval Mapping (8,656 rows)
Composite PK: (`early_age`, `late_age`, `interval_no`)

#### `scale_data` — Timescale Definitions (65 rows)
Primary key: `scale_no` — Named timescales with age ranges.

#### `scale_map` — Timescale Interval Mapping (1,909 rows)
Composite PK: (`scale_no`, `scale_level`, `interval_no`) — Hierarchical interval-scale assignments.

---

### 6. Opinions & Classification Domain

#### `order_opinions` — Ordered Opinion Rankings (997,048 rows)
Primary key: `opinion_no` — Pre-computed opinion ordering with rankings.

#### `opview` — Opinion View (VIEW, stub)
Stub view returning constants — appears non-functional in this archive.

---

### 7. Diversity & PVL Matrices

#### `div_matrix` — Diversity Matrix (3,763,290 rows)
Composite PK: (`bin_id`, `interval_no`, `ints_no`, `genus_no`) — Per-bin diversity data.

#### `div_global` — Global Diversity (761,762 rows)
Composite PK: (`interval_no`, `ints_no`, `genus_no`) — Global diversity data.

#### `pvl_matrix` — PVL Matrix (1,689,665 rows)
No PK — Bin-level prevalence data with order/class/phylum_no.

#### `pvl_collections` — PVL Collection Data (731,946 rows)
No PK — Per-collection prevalence at order/class/phylum level.

#### `pvl_global` — PVL Global (62,156 rows)
No PK — Global prevalence data.

---

### 8. Bibliographic & Media Domain

#### `ref_authors` — Reference Authors (14,144 rows)
No PK — (`reference_no`, `place`) indexed. Normalized author list.

#### `ref_editors` — Reference Editors (414 rows)
No PK — Same structure as ref_authors for editors.

#### `ref_summary` — Reference Summary Cache (93,715 rows)
Primary key: `reference_no` — Counts of taxa, opinions, occurrences, collections per reference.

#### `secondary_refs` — Additional Collection References (375,845 rows)
Primary key: `id` (auto_increment) — Links collections to additional references beyond the primary.

#### `other_pubs` / `pubs` — Publication Records (240 / 542 rows)
Standalone publication tables with author, year, title, journal, DOI.

#### `nexus_files` / `nexus_data` / `nexus_refs` / `nexus_taxa` — Nexus File Data
Phylogenetic data file management (337 files, 727 ref links, 9,893 taxa).

#### `images` — Uploaded Images (2,771 rows)
Primary key: `image_no` (auto_increment)

#### `phylopics` / `phylopic_choice` / `phylopic_names` — PhyloPic Integration
PhyloPic silhouette image management (2,226 images, 5,689 taxon choices).

---

### 9. Miscellaneous / Admin Domain

#### `permissions` — Authorizer-Modifier Permissions (181,953 rows)
Composite PK: (`authorizer_no`, `modifier_no`)

#### `table_permissions` — Table-Level Permissions (0 rows)
Primary key: `permission_no` (auto_increment) — Empty in this archive.

#### `session_data` — Web Sessions (0 rows)
Primary key: `session_id` — Empty in this archive.

#### `delete_log` — Deletion Log (46,948 rows)
Primary key: `delete_id` (auto_increment) — SQL statements of deleted records.

#### `data_archives` — Data Archive Records (48 rows)
Primary key: `archive_no` (auto_increment)

#### `eduresources` / `eduresource_*` / `edutags` — Educational Resources
Small tables for educational content management.

#### `equations` — Body Mass Equations (95 rows)
Primary key: `eqn_no` (auto_increment)

#### `navigator_states` — UI Navigator State (11,572 rows)
Application state persistence.

#### `ecotaph` — Ecology/Taphonomy Records (5,245 rows)
Primary key: `ecotaph_no` (auto_increment) — Per-record ecological data entry (vs taxon_ecotaph which is per-taxon aggregated).

#### `strata_names` / `stratigraphy` — Stratigraphic Name Lookups
Lookup tables for formation/group/member names.

#### `rank_map` — Taxonomic Rank Mapping (24 rows)
Primary key: `rank_no` — Maps numeric ranks to enum labels.

#### `spelling_score` — Spelling Scores (0 rows, empty)
#### `tc_mutex` / `tc_sync` — Tree Cache Synchronization (1 row each)
#### `last_build` — Build Timestamps (3 rows)

---

## Discovered Foreign Key Relationships

### Confirmed High-Confidence FKs

These relationships are confirmed by naming convention, data type match, and (where tested) data validation.

#### Universal Person References
Nearly every data-entry table has these four columns:

| Child Column | Parent | Indexed | Notes |
|-------------|--------|---------|-------|
| `authorizer_no` | person.person_no | Usually MUL | Required (default 0) |
| `enterer_no` | person.person_no | Usually MUL | Required (default 0) |
| `modifier_no` | person.person_no | Usually MUL | Required (default 0) |
| `updater_no` | person.person_no | **No index** | Required (default 0) |

Tables with these: `authorities`, `collections`, `occurrences`, `refs`, `opinions`, `specimens`, `reidentifications`, `ecotaph`, `images`, `intervals`, `nexus_files`, `data_archives`, `equations`, `scale_data`, `interval_data`, `delete_log`, `eduresource_queue`, `taxon_ecotaph`

Also denormalized text versions (`authorizer`, `enterer`, `modifier` varchar columns) in: `collections`, `occurrences`, `refs`, `reidentifications`

#### Reference Links
| Child Table | Child Column | Parent | Notes |
|------------|-------------|--------|-------|
| authorities | reference_no | refs.reference_no | |
| collections | reference_no | refs.reference_no | |
| occurrences | reference_no | refs.reference_no | |
| opinions | reference_no | refs.reference_no | |
| reidentifications | reference_no | refs.reference_no | |
| specimens | reference_no | refs.reference_no | |
| ecotaph | reference_no | refs.reference_no | |
| images | reference_no | refs.reference_no | Nullable |
| equations | reference_no | refs.reference_no | |
| nexus_refs | reference_no | refs.reference_no | |
| secondary_refs | reference_no | refs.reference_no | |
| coll_matrix | reference_no | refs.reference_no | |
| occ_matrix | reference_no | refs.reference_no | |
| spec_matrix | reference_no | refs.reference_no | |
| order_opinions | reference_no | refs.reference_no | |
| scale_data | reference_no | refs.reference_no | |
| scale_map | reference_no | refs.reference_no | Nullable |
| interval_data | reference_no | refs.reference_no | |
| taxon_ecotaph | reference_no | refs.reference_no | |

#### Collection Links
| Child Table | Child Column | Parent |
|------------|-------------|--------|
| occurrences | collection_no | collections.collection_no |
| reidentifications | collection_no | collections.collection_no |
| secondary_refs | collection_no | collections.collection_no |
| coll_matrix | collection_no | collections.collection_no |
| coll_loc | collection_no | collections.collection_no |
| coll_strata | collection_no | collections.collection_no |
| coll_lith | collection_no | collections.collection_no |
| coll_ints | collection_no | collections.collection_no |
| coll_units | collection_no | collections.collection_no |
| paleocoords | collection_no | collections.collection_no |
| paleostatic | collection_no | collections.collection_no |
| pvl_collections | collection_no | collections.collection_no |
| occ_matrix | collection_no | collections.collection_no |

#### Taxon Links
| Child Table | Child Column | Parent |
|------------|-------------|--------|
| occurrences | taxon_no | authorities.taxon_no |
| reidentifications | taxon_no | authorities.taxon_no |
| specimens | taxon_no | authorities.taxon_no |
| ecotaph | taxon_no | authorities.taxon_no |
| images | taxon_no | authorities.taxon_no |
| authorities | orig_no | authorities.taxon_no (self) |
| authorities | type_taxon_no | authorities.taxon_no (self) |
| auth_orig | taxon_no | authorities.taxon_no |
| auth_orig | orig_no | authorities.taxon_no |
| taxon_names | taxon_no | authorities.taxon_no |
| taxon_names | orig_no | authorities.taxon_no |
| taxa_tree_cache | taxon_no | authorities.taxon_no |
| taxa_tree_cache | spelling_no | authorities.taxon_no |
| taxa_tree_cache | synonym_no | authorities.taxon_no |
| taxon_trees | spelling_no | authorities.taxon_no |
| opinions | child_no | authorities.taxon_no |
| opinions | child_spelling_no | authorities.taxon_no |
| opinions | parent_no | authorities.taxon_no |
| opinions | parent_spelling_no | authorities.taxon_no |
| nexus_taxa | orig_no | authorities.taxon_no |

#### Occurrence Links
| Child Table | Child Column | Parent |
|------------|-------------|--------|
| specimens | occurrence_no | occurrences.occurrence_no |
| occ_matrix | occurrence_no | occurrences.occurrence_no |
| spec_matrix | occurrence_no | occurrences.occurrence_no |
| reidentifications | occurrence_no | occurrences.occurrence_no |

#### Opinion Links
| Child Table | Child Column | Parent |
|------------|-------------|--------|
| taxon_trees | opinion_no | opinions.opinion_no |
| taxa_tree_cache | opinion_no | opinions.opinion_no |
| taxon_names | opinion_no | opinions.opinion_no |
| order_opinions | opinion_no | opinions.opinion_no |

#### Interval Links
| Child Table | Child Column | Parent |
|------------|-------------|--------|
| collections | max_interval_no | intervals.interval_no |
| collections | min_interval_no | intervals.interval_no |
| taxa_tree_cache | max_interval_no | intervals.interval_no |
| taxa_tree_cache | min_interval_no | intervals.interval_no |
| coll_ints | interval_no | intervals.interval_no |
| coll_bins | interval_no | intervals.interval_no |
| interval_data | interval_no | intervals.interval_no |
| interval_lookup | interval_no | intervals.interval_no |
| interval_buffer | interval_no | intervals.interval_no |
| int_summary | interval_no | intervals.interval_no |
| scale_map | interval_no | intervals.interval_no |
| interval_lookup | stage_no | intervals.interval_no |
| interval_lookup | subepoch_no | intervals.interval_no |
| interval_lookup | epoch_no | intervals.interval_no |
| interval_lookup | period_no | intervals.interval_no |

#### Specimen Links
| Child Table | Child Column | Parent |
|------------|-------------|--------|
| measurements | specimen_no | specimens.specimen_no |
| spec_matrix | specimen_no | specimens.specimen_no |

#### Self-Referential (Taxonomy Tree)
| Table | Column | References |
|-------|--------|-----------|
| taxon_trees | immpar_no | taxon_trees.orig_no (immediate parent) |
| taxon_trees | senpar_no | taxon_trees.orig_no (senior parent) |
| taxon_trees | synonym_no | taxon_trees.orig_no (senior synonym) |
| taxon_trees | accepted_no | taxon_trees.orig_no (accepted name) |
| taxon_trees | trad_no | taxon_trees.orig_no |
| taxon_trees | ints_no | taxon_ints.ints_no |

### Non-Obvious Relationships

| Relationship | Type | Notes |
|-------------|------|-------|
| collections.authorizer ↔ person.name | Text match | Denormalized; 250 distinct values vs 1,249 distinct person names |
| collections.enterer ↔ person.name | Text match | 678 distinct values |
| occurrences.authorizer ↔ person.name | Text match | 246 distinct values |
| authorities.type_locality → collections.collection_no | Implicit FK | No index, nullable |
| authorities.discussed_by → refs.reference_no | Implicit FK | No index, nullable |
| taxon_ecotaph.*_basis_no → ecotaph.ecotaph_no | Implicit FK | 8 basis columns |
| taxon_etbasis.*_basis_no → ecotaph.ecotaph_no | Implicit FK | 8 basis columns |
| taxon_ages.early_occ / late_occ → occurrences.occurrence_no | Implicit FK | |
| taxon_attrs.early_occ / late_occ → occurrences.occurrence_no | Implicit FK | |
| taxon_attrs.image_no → images.image_no | Implicit FK | |
| taxon_pics.image_no → images.image_no | Implicit FK | |
| pubs.first_author / second_author | int → ??? | Possibly person indices within pubs |
| collections.collection_subset → collections.collection_no | Self-ref | Subset relationship |
| person.heir_no → person.person_no | Self-ref | Data inheritance |
| eduresource_tags.resource_id → eduresources.id | FK | |
| eduresource_tags.tag_id → edutags.id | FK | |
| eduresource_images.eduresource_no → eduresources.id | FK | |
| phylopic_choice.uid → phylopics.uid | FK | |
| phylopic_names.uid → phylopics.uid | FK | |
| table_permissions.person_no → person.person_no | FK | |

---

## Tables Without Primary Keys

The following 15 base tables lack a PRIMARY KEY constraint:

| Table | Rows | Natural Key Candidate | Notes |
|-------|------|----------------------|-------|
| coll_ints | 1,534,839 | (collection_no, interval_no) | Many-to-many mapping |
| coll_strata | 275,552 | collection_no | One-to-one with collections |
| protected_land | 49,778 | (shape, cc) | Spatial data |
| pvl_collections | 731,946 | (collection_no, order_no, class_no, phylum_no) | Aggregation table |
| pvl_global | 62,156 | (interval_no, order_no, class_no, phylum_no) | Aggregation table |
| pvl_matrix | 1,689,665 | (bin_id, interval_no, order_no, class_no, phylum_no) | Aggregation table |
| ref_authors | 14,144 | (reference_no, place) | Author list |
| ref_editors | 414 | (reference_no, place) | Editor list |
| strata_names | 19,689 | (name, type) | Lookup |
| stratigraphy | 20,018 | name | Lookup |
| specelt_map | 523 | (specelt_no, base_no) | Nested set map |
| specelt_exc | 13 | specelt_no | Exclusion list |

---

*Generated from pbdb_archive schema on 2026-02-10*
