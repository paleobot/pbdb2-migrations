# PBDB Archive Database — Anomaly Report

## Overview

This report documents anomalies found across 17 categories of analysis on the `pbdb_archive` database (99 tables, ~22.4M total rows). Each anomaly is rated by severity:

- **CRITICAL** — Data integrity risk, may cause incorrect query results
- **HIGH** — Significant data quality issue affecting substantial records
- **MEDIUM** — Notable inconsistency worth investigating
- **LOW** — Minor issue or cosmetic concern

---

## 1. Missing Primary Keys

**Severity: MEDIUM**

**21 tables** lack a PRIMARY KEY constraint:

| Table | Rows | Natural Key Candidate | Impact |
|-------|------|----------------------|--------|
| coll_ints | 1,534,839 | (collection_no, interval_no) | Large table, risk of duplicates |
| order_opinions | 997,048 | opinion_no | Has unique index, effectively a PK |
| pvl_collections | 731,946 | (collection_no, order/class/phylum_no) | Aggregation table |
| pvl_matrix | 1,689,665 | (bin_id, interval_no, order/class/phylum_no) | Aggregation table |
| auth_orig | 464,048 | taxon_no | Has unique index on taxon_no |
| secondary_refs* | 375,845 | (collection_no, reference_no) | *Has auto_increment PK `id` but also unique composite |
| coll_strata | 275,552 | collection_no | One-to-one with collections |
| coll_lith | 248,513 | (collection_no, lithology) | Has composite unique index |
| taxon_search | 506,888 | (taxon_no, genus, common) | Has composite unique index |
| pvl_global | 62,156 | (interval_no, order/class/phylum_no) | Aggregation table |
| protected_land | 49,778 | — | Spatial data, no natural key |
| strata_names | 19,689 | (name, type) | Has composite unique index |
| stratigraphy | 20,018 | name | No indexes |
| ref_authors | 14,144 | (reference_no, place) | Has composite index |
| nexus_taxa | 9,893 | — | No unique constraint |
| phylopic_names | 7,373 | (uid, taxon_name, taxon_attr) | Has composite unique |
| phylopic_choice | 5,689 | (orig_no, uid) | Has composite unique |
| nexus_refs | 727 | (nexusfile_no, reference_no) | Has composite unique |
| ref_editors | 414 | (reference_no, place) | Has composite index |
| specelt_map | 523 | (specelt_no, base_no) | Small table |
| specelt_exc | 13 | specelt_no | Small table |
| eduresource_tags | 160 | (resource_id, tag_id) | Small table |

**Notes:** Many of these have composite unique indexes that serve as de facto primary keys. The most concerning are `coll_ints` (1.5M rows), `pvl_matrix` (1.7M rows), and `pvl_collections` (732K rows), which are large tables without any uniqueness guarantee.

---

## 2. Orphaned Foreign Keys

**Severity: HIGH**

58 FK relationships were validated. 21 have orphan records (child values pointing to non-existent parents). Total orphans: **799 records**.

### Orphan Summary (sorted by count)

| Child Table | Child Column | Parent Table | Parent Column | Total Rows | Orphans | Rate |
|------------|-------------|-------------|--------------|------------|---------|------|
| authorities | modifier_no | person | person_no | 171,684 | **271** | 0.16% |
| taxon_names | opinion_no | opinions | opinion_no | 472,617 | **143** | 0.03% |
| taxa_tree_cache | opinion_no | opinions | opinion_no | 476,512 | **130** | 0.03% |
| taxon_trees | opinion_no | opinions | opinion_no | 371,333 | **115** | 0.03% |
| secondary_refs | reference_no | refs | reference_no | 371,829 | **42** | 0.01% |
| reidentifications | occurrence_no | occurrences | occurrence_no | 35,098 | **15** | 0.04% |
| occ_matrix | occurrence_no | occurrences | occurrence_no | 2,019,202 | **15** | <0.01% |
| secondary_refs | collection_no | collections | collection_no | 371,831 | **11** | <0.01% |
| occurrences | reference_no | refs | reference_no | 1,984,136 | **11** | <0.01% |
| occurrences | taxon_no | authorities | taxon_no | 1,931,939 | **10** | <0.01% |
| opinions | reference_no | refs | reference_no | 998,565 | **10** | <0.01% |
| opinions | parent_spelling_no | authorities | taxon_no | 997,050 | **8** | <0.01% |
| opinions | parent_no | authorities | taxon_no | 997,050 | **5** | <0.01% |
| occurrences | collection_no | collections | collection_no | 1,984,112 | **5** | <0.01% |
| authorities | reference_no | refs | reference_no | 517,287 | **3** | <0.01% |
| auth_orig | taxon_no | authorities | taxon_no | 467,494 | **3** | <0.01% |
| opinions | child_spelling_no | authorities | taxon_no | 998,565 | **2** | <0.01% |
| auth_orig | orig_no | authorities | taxon_no | 467,494 | **2** | <0.01% |
| collections | modifier_no | person | person_no | 148,997 | **2** | <0.01% |
| measurements | specimen_no | specimens | specimen_no | 365,099 | **2** | <0.01% |
| ref_authors | reference_no | refs | reference_no | 14,045 | **2** | 0.01% |
| opinions | child_no | authorities | taxon_no | 998,565 | **1** | <0.01% |
| reidentifications | reference_no | refs | reference_no | 35,098 | **1** | <0.01% |
| ecotaph | taxon_no | authorities | taxon_no | 5,245 | **1** | 0.02% |

### Clean Relationships (37 of 58)
The following FK relationships have **zero orphans**: authorities.orig_no, authorities.type_taxon_no, authorities.authorizer_no, authorities.enterer_no, collections.reference_no, collections.authorizer_no, collections.enterer_no, collections.max_interval_no, collections.min_interval_no, occurrences.authorizer_no, reidentifications.collection_no, reidentifications.taxon_no, specimens (all 3 FKs), taxon_trees.spelling_no, taxon_trees.synonym_no, taxon_trees.immpar_no, taxon_trees.senpar_no, taxa_tree_cache.spelling_no, taxa_tree_cache.synonym_no, taxon_names.orig_no, images.taxon_no, nexus_refs (both FKs), nexus_taxa (both FKs), coll_matrix (both FKs), occ_matrix.collection_no, spec_matrix (both FKs), ref_editors.reference_no.

### Key Patterns
- **opinion_no orphans** (115+130+143 = 388): The same ~143 deleted opinions ripple through three taxonomy tables. These should be cleaned up together.
- **modifier_no orphans** (271 + 2 = 273): Deleted person records whose person_no still lingers in modifier_no columns.
- **Overall integrity is strong**: 799 orphans across ~22M rows = 0.004% orphan rate.

---

## 3. Duplicate Detection

**Severity: LOW**

### References (refs)
- **1,117 groups** of duplicate titles covering 2,740 rows
- **162 groups** of author+year combinations with >10 entries (2,633 rows)

Top duplicate titles are legitimate: generic titles like "Taxonomic names" (42 occurrences), "Description of fossils" (14), and section/chapter titles from multi-volume works. Chinese surnames (Li, Wang, Chen, Zhang) dominate the author+year duplicates due to surname frequency, not actual duplication.

**Assessment:** No systematic duplication problem detected. The duplicates represent legitimate bibliographic realities (generic chapter titles, common surnames).

---

## 4. NULL Analysis

**Severity: MEDIUM**

### Zeros-as-NULLs Pattern
Many columns use `0` as the default instead of NULL, masking missing data:

| Table.Column | Zero/Empty Count | Percentage | Concern |
|-------------|-----------------|------------|---------|
| authorities.modifier_no | 345,603 | **66.8%** | Two-thirds never edited |
| authorities.pubyr (NULL or '') | 276,763 | **53.5%** | Over half missing publication year |
| authorities.authorizer_no = 0 | 1 | <0.01% | Single bad record |
| authorities.enterer_no = 0 | 1 | <0.01% | Single bad record |

### Collections
- `min_interval_no = 0`: 244,220 rows (88.6%) — Most collections have only a max interval, meaning min is not specified
- `modifier_no = 0`: 126,558 rows (45.9%) — Nearly half never edited

### Occurrences
- `taxon_no = 0`: ~52,794 rows (2.7%) — Occurrences without resolved taxonomy
- `modifier_no = 0`: ~significant portion never edited

---

## 5. Data Type Inconsistencies

**Severity: HIGH**

59 column names are used with inconsistent types across tables. The most operationally significant:

### Signed vs Unsigned Integer Mismatch
| Column | Normal Type | Exception | Table |
|--------|------------|-----------|-------|
| authorizer_no | int(10) unsigned | **int(10) signed** | session_data |
| enterer_no | int(10) unsigned | **int(10) signed** | session_data |
| reference_no | int(10) unsigned | **int(11) signed** | session_data |

**Risk:** JOINs between signed and unsigned columns can produce incorrect results or performance degradation due to implicit type conversion.

### Precision Mismatches
| Column | Type A | Type B | Tables |
|--------|--------|--------|--------|
| lat/lng | float(9,6) | decimal(9,6) | collections vs coll_loc/coll_matrix/coll_strata |
| early_age/late_age | decimal(9,5) | decimal(9,6) | most tables vs coll_strata |
| scale_no | smallint(5) unsigned | int(10) unsigned | scale tables vs interval_data/int_summary |
| plate | int(3) unsigned | int(4) unsigned | collections vs plates |

**Risk:** float vs decimal precision difference means `collections.lat` may not exactly match `coll_loc.lat` for the same collection.

### Timestamp vs Datetime
| Column | Timestamp Tables | Datetime Tables |
|--------|-----------------|-----------------|
| created | data_archives, equations, interval_data, navigator_states, nexus_files, occ_matrix, pubs, scale_data, spec_matrix | authorities, collections, ecotaph, images, intervals, occurrences, opinions, other_pubs, person, refs, reidentifications, specimens, taxon_ecotaph, tc_mutex |
| modified | (most tables) | person, phylopics, taxon_ecotaph, taxon_images |

**Risk:** `timestamp` is timezone-aware; `datetime` is not. Mixing the two can cause confusion when comparing dates across tables.

### Semantic Type Mismatches
| Column | Notable Conflict |
|--------|-----------------|
| taxon_no | int(10) unsigned everywhere **except** equations where it's varchar(255) |
| opinion_no | int(10) unsigned everywhere **except** opview where it's int(1) |
| museum | varchar(12) in authorities vs SET(59 values) in collections |

---

## 6. Referential Integrity Summary

**Severity: LOW** (overall integrity is excellent)

| Metric | Value |
|--------|-------|
| Total FK relationships checked | 58 |
| Clean (zero orphans) | 37 (63.8%) |
| With orphans | 21 (36.2%) |
| Total orphan records | 799 |
| Overall orphan rate | 0.004% |
| Largest single orphan set | authorities.modifier_no: 271 |

The database has remarkably clean referential integrity for a system without formal FK constraints. The low orphan rate suggests disciplined application-level enforcement.

---

## 7. Stale/Legacy Columns

**Severity: MEDIUM**

8 columns with `_old` / `old_` suffixes contain significant data:

| Column | Non-empty Rows | Total Table Rows | % Populated | Has Replacement |
|--------|---------------|-----------------|-------------|-----------------|
| opinions.status_old | **125,487** | 998,565 | 12.6% | opinions.status |
| authorities.extant_old | **108,196** | 517,287 | 20.9% | authorities.extant |
| authorities.preservation_less_old | **53,778** | 517,287 | 10.4% | authorities.preservation |
| taxon_ecotaph.life_habit_old | **2,744** | 376,863 | 0.7% | taxon_ecotaph.life_habit |
| ecotaph.old_minimum_body_mass | **273** | 5,245 | 5.2% | ecotaph.minimum_body_mass |
| ecotaph.old_maximum_body_mass | **234** | 5,245 | 4.5% | ecotaph.maximum_body_mass |
| authorities.preservation_old | **181** | 517,287 | 0.03% | authorities.preservation |
| taxon_ecotaph.repro_old | **123** | 376,863 | 0.03% | taxon_ecotaph.reproduction |

**Warning:** `opinions.status_old` (125K rows) and `authorities.extant_old` (108K rows) contain substantial data. Any schema cleanup must verify these values have been migrated to their replacement columns.

---

## 8. Value Distribution Anomalies

**Severity: LOW**

### Enum Columns
- `authorities.taxon_rank`: "superkingdom" has only 1 record
- `collections.environment`: "lacustrine interdistributary bay" is a singleton (1 record)
- `refs.publication_type`: 1,201 refs (1.3%) have NULL publication type

### NULL vs Empty String Inconsistency
`occurrences.genus_reso` uses both NULL (11,326 rows) and empty string (1,870,993 rows) to represent "no value." Same pattern in species_reso, subgenus_reso. The `"` (double-quote) value appearing in 11,040 rows is a ditto-mark convention from the data entry system.

---

## 9. Temporal Anomalies

**Severity: CRITICAL**

### Impossible Dates (before 1998 or future)

| Table | Records | Notes |
|-------|---------|-------|
| occurrences | **6,422** | Created dates before PBDB existed |
| collections | **4,647** | Created dates before PBDB existed |
| authorities | **140** | |
| refs | **4** | |

These likely represent data imported from predecessor systems with original creation dates preserved.

### Modified Before Created (Inverted Timestamps)

| Table | Inverted Count | Total Rows | Percentage |
|-------|---------------|------------|------------|
| occurrences | **1,052,525** | 1,984,733 | **53.0%** |
| authorities | **39,983** | 517,287 | **7.7%** |
| collections | **35,568** | 275,555 | **12.9%** |

**This is the single largest anomaly in the database.** Over half of all occurrence records have `modified < created`. This almost certainly results from bulk data migrations or system operations that updated the `created` field (a datetime, not auto-updating) without also updating `modified` (a timestamp with `ON UPDATE CURRENT_TIMESTAMP`), or vice versa. The `modified` timestamp auto-updates on any row change, while `created` is a static datetime set at insert time — but bulk imports may have set `created` to a later date than the auto-set `modified`.

---

## 10. Cross-Table Consistency

**Severity: LOW**

### Occurrence-Collection Consistency
- 5 occurrences reference non-existent collection_no values
- 0 occurrences reference collection_no = 0

### Occurrence-Taxon Consistency
- 10 occurrences reference non-existent taxon_no values
- ~52,794 occurrences have taxon_no = 0 (unresolved taxonomy)

### Opinion-Taxon Consistency
- 1 opinion references non-existent child_no
- 5 opinions reference non-existent parent_no

All cross-table consistency issues are minimal.

---

## 11. Denormalized Field Sync

**Severity: MEDIUM**

Three tables store denormalized text versions of person names alongside numeric person_no FK columns. Mismatches indicate the text fields were not updated when person names changed.

### Full Sync Check Results

| Table | Mismatched Authorizer | Mismatched Enterer | Mismatched Modifier | Total Rows |
|-------|----------------------|-------------------|---------------------|------------|
| collections | 21 (0.008%) | 610 (0.22%) | 1,305 (0.47%) | 275,555 |
| occurrences | 142 (0.007%) | 4,471 (0.23%) | — | 1,984,733 |
| refs (sampled 10K) | 206 (2.06%) | 225 (2.25%) | — | ~93,863 |

**Key finding:** The `refs` table has the highest mismatch rate (~2%), suggesting person name changes were not propagated back to refs. The `modifier` field in collections has 1,305 mismatches (0.47%). Overall, the denormalization is well-maintained but not perfectly synchronized.

---

## 12. Coordinate Integrity

**Severity: HIGH**

### Decimal Coordinate Quality
| Metric | Count | Notes |
|--------|-------|-------|
| Total collections | 275,555 | |
| Has decimal coords (lat + lng) | 275,555 (100%) | All collections have coordinates |
| Latitude out of range | 0 | |
| Longitude out of range | 0 | |
| Zero coordinates (0,0) | 0 | |
| Has both DMS and decimal | 275,555 (100%) | |

### DMS vs Decimal Consistency
| Metric | Count | Percentage |
|--------|-------|------------|
| DMS-decimal mismatch > 0.1 degrees | **90,303** | **32.8%** |

One-third of collections have a discrepancy between their DMS (degrees/minutes/seconds) and decimal latitude representations exceeding 0.1 degrees (~11 km). This could indicate:
- DMS fields represent the original entry and decimal was computed with rounding
- One representation was updated without updating the other
- Unit conversion errors

### Paleocoordinate Quality
- All 2,141,402 paleocoordinate records have valid lat/lng ranges
- No out-of-range values detected

---

## 13. Taxonomy Tree Integrity

**Severity: HIGH**

### Hierarchy Checks
| Check | Result | Status |
|-------|--------|--------|
| Self-referencing (orig_no = immpar_no) | 0 | Clean |
| Self-referencing senpar | 0 | Clean |
| Orphaned parent references | 0 | Clean |
| Root nodes (immpar_no = 0) | 5,630 | Expected |

### Nested Set Integrity
| Check | Count | Notes |
|-------|-------|-------|
| lft = rgt (collapsed leaves) | **262,167** | 70.3% of nodes |
| lft = rgt - 1 (standard leaves) | 1,279 | 0.3% of nodes |
| lft > rgt | 0 | No reversed pairs |
| NULL lft or rgt | 4,372 | 1.2% of nodes |

**262,167 nodes** (70.3%) have `lft = rgt`, meaning they're "collapsed" leaf nodes with no subtree space allocated. While this doesn't indicate corruption (there are zero cases of `lft > rgt`), it's a non-standard nested set implementation where leaf nodes have zero width instead of the standard width of 1 (`lft = rgt - 1`). This affects any queries that use `rgt - lft - 1` to count descendants.

### Cache Consistency
| Check | Count |
|-------|-------|
| taxa_tree_cache entries not matching any taxon_trees spelling_no | **105,347** |
| taxon_names entries missing from authorities | 0 |

**105,347 entries** in `taxa_tree_cache` (21.8%) reference taxon_no values that exist in `authorities` but have no matching `spelling_no` in `taxon_trees`. These likely represent synonyms or alternate spellings that are tracked in the cache but don't appear as current tree nodes.

---

## 14. Cached Table Staleness

**Severity: MEDIUM**

| Source Table | Cache Table | Source Rows | Cache Rows | Missing from Cache | Orphan Cache Entries |
|-------------|------------|------------|------------|-------------------|---------------------|
| collections | coll_matrix | 275,555 | 275,554 | 1 | 0 |
| occurrences | occ_matrix | 1,984,733 | 1,984,119 | **629** | **15** |
| specimens | spec_matrix | 167,150 | 167,150 | 0 | 0 |

- `coll_matrix` is nearly perfect (1 collection missing)
- `occ_matrix` has 629 occurrences not reflected in the cache and 15 stale entries for deleted occurrences
- `spec_matrix` is perfectly synchronized

---

## 15. Index Coverage

**Severity: HIGH**

**93 FK-like integer columns** (ending in `_no` or `_id`) across the database lack indexes. Key gaps:

### Universal Audit Columns (no index anywhere)
| Column | Tables Missing Index |
|--------|-------------------|
| updater_no | authorities, collections, occurrences, opinions, refs, reidentifications, specimens (7 tables, all large) |

### Large Table FK Columns Missing Indexes
| Table | Column | Table Rows | Impact |
|-------|--------|-----------|--------|
| occ_matrix | taxon_no | 2,019,202 | Full scan for taxon lookups |
| occurrences | reid_no | 1,984,733 | Full scan for reidentification joins |
| opinions | max_interval_no | 998,565 | Full scan for interval queries |
| opinions | min_interval_no | 998,565 | Full scan for interval queries |
| order_opinions | reference_no | 997,048 | Full scan for reference joins |
| taxa_tree_cache | max_interval_no | 482,023 | Full scan for interval queries |
| taxa_tree_cache | min_interval_no | 482,023 | Full scan for interval queries |

### Ecotaph Basis Columns (16 unindexed FKs)
Both `taxon_ecotaph` and `taxon_etbasis` have 8 `*_basis_no` columns each referencing `ecotaph.ecotaph_no`, none indexed.

### PVL Tables (10 unindexed columns)
`pvl_collections`, `pvl_global`, and `pvl_matrix` have `order_no`, `class_no`, `phylum_no` unindexed across ~2.5M rows.

---

## 16. Delete Log Patterns

**Severity: LOW**

The `delete_log` contains **46,948 records** spanning 2006–2026, storing INSERT statements (reverse of the deletion) for recovery purposes.

### Deletion Volume by Type
| Record Type | Deletions | Percentage |
|------------|-----------|------------|
| occurrences | 38,902 | 82.9% |
| reidentifications | 4,279 | 9.1% |
| opinions | 3,765 | 8.0% |
| cladogram_nodes | 2 | <0.01% |

### Annual Trends
Activity peaked in 2011–2013 (~4K/year), declined to ~1K/year by 2024–2025. Largest single-day events:
- 2022-06-23: 767 deletions
- 2006-08-06: 740 deletions
- 2011-09-02: 630 deletions
- 2017-01-15: 520 deletions

These bulk events suggest systematic cleanup operations rather than accidental deletions.

---

## 17. Enum/Vocabulary Drift

**Severity: LOW**

### NULL vs Empty String Inconsistency
Multiple enum columns use both NULL and empty string ('') as "no value":
- `occurrences.genus_reso`: NULL (11,326) vs '' (1,870,993)
- `collections.environment`: NULL (31,853 est.) vs '' used differently

### Double-Quote Convention
`occurrences.genus_reso = '"'` appears in 11,040 rows. This is a ditto-mark convention from the original data entry system, not a data error.

### Singleton Environment Values
`collections.environment` has values used only 1–7 times:
- "lacustrine interdistributary bay" (1)
- "lacustrine prodelta" (4)
- "lacustrine delta front" (7)

These may be over-specific categories that could be consolidated.

### refs.publication_type
1,201 refs (1.3%) have NULL publication_type, representing unclassified references.

---

## Anomaly Summary Table

| # | Category | Severity | Affected Records | Key Finding |
|---|----------|----------|-----------------|-------------|
| 9 | Temporal: modified < created | **CRITICAL** | 1,128,076 | 53% of occurrences |
| 12 | DMS/decimal coord mismatch | **HIGH** | 90,303 | 32.8% of collections |
| 13 | Nested set lft=rgt | **HIGH** | 262,167 | 70% of taxon_trees |
| 5 | Data type mismatches | **HIGH** | — | signed/unsigned, float/decimal |
| 15 | Missing indexes | **HIGH** | — | 93 unindexed FK columns |
| 2 | Orphaned FKs | **HIGH** | 799 | 21 of 58 relationships |
| 13 | Cache-tree inconsistency | **HIGH** | 105,347 | taxa_tree_cache vs taxon_trees |
| 11 | Denormalized name mismatches | **MEDIUM** | ~7K+ | refs worst at ~2% |
| 7 | Legacy columns with data | **MEDIUM** | 290,762 | Cannot drop without migration |
| 4 | NULL/zero masking | **MEDIUM** | ~622K | modifier_no=0, pubyr empty |
| 1 | Missing PKs | **MEDIUM** | — | 21 tables |
| 14 | Cache staleness | **MEDIUM** | 644 | occ_matrix 629 missing |
| 9 | Pre-1998 dates | **MEDIUM** | 11,213 | Imported legacy records |
| 3 | Duplicate refs | **LOW** | 2,740 | Legitimate, not true dupes |
| 8 | Enum singletons | **LOW** | ~12 | environment outliers |
| 16 | Delete log | **LOW** | 46,948 | Normal operations |
| 17 | Vocabulary drift | **LOW** | ~22K | NULL vs '' inconsistency |

---

*Generated from pbdb_archive analysis on 2026-02-10. All queries were read-only (SELECT only).*
