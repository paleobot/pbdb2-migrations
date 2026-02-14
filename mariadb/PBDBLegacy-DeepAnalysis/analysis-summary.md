# PBDB Archive Database — Analysis Summary

## Executive Summary

The `pbdb_archive` database is a legacy snapshot of the Paleobiology Database containing **99 tables** (98 base + 1 view) with approximately **22.4 million rows** of paleontological data spanning two decades of community data entry. This analysis examined the complete schema, discovered foreign key relationships, generated ER diagrams for 9 logical domains, and performed 17 categories of anomaly checks.

**Overall assessment:** The database has **strong referential integrity** (0.004% orphan rate across 58 validated FK relationships) and a **well-designed relational structure** despite having no formal foreign key constraints. However, several significant data quality issues were identified, particularly around timestamp consistency and coordinate representation.

---

## Database at a Glance

| Metric | Value |
|--------|-------|
| Total tables | 99 (98 base + 1 view) |
| Total estimated rows | ~22.4M |
| Tables with PKs | 78 (21 without) |
| Core data tables | 6 (authorities, collections, occurrences, refs, opinions, person) |
| Discovered FK relationships | 58 validated, 20+ additional implicit |
| Total orphan records | 799 (0.004% rate) |
| Empty tables | 3 (session_data, spelling_score, table_permissions) |

### Top 10 Tables by Size

| Table | Rows | Description |
|-------|------|-------------|
| div_matrix | 3,763,290 | Diversity analysis cache |
| paleocoords | 2,141,402 | Paleocoordinate reconstructions |
| occ_matrix | 2,019,202 | Occurrence summary cache |
| occurrences | 2,016,317 | **Core:** Fossil occurrence records |
| paleocoords_bins | 1,810,133 | Bin-level paleocoordinates |
| pvl_matrix | 1,689,665 | Prevalence analysis cache |
| coll_ints | 1,534,839 | Collection-interval mappings |
| opinions | 998,565 | **Core:** Taxonomic opinions |
| order_opinions | 997,048 | Ordered opinion rankings |
| div_global | 761,762 | Global diversity data |

---

## Key Findings

### 1. Schema Architecture

The database follows a **star-like schema** centered on six core entities:
- **`authorities`** (517K) — Taxonomic names (the taxon registry)
- **`collections`** (276K) — Fossil collection localities
- **`occurrences`** (2M) — Fossil occurrences linking taxa to collections
- **`refs`** (94K) — Bibliographic references
- **`opinions`** (999K) — Taxonomic classification opinions
- **`person`** (1.3K) — Database contributors

These are surrounded by:
- **Cache/matrix tables** (~15 tables) — Denormalized for query performance
- **Taxonomy tree tables** (~17 tables) — Hierarchical classification structure
- **Geography/paleocoord tables** (~12 tables) — Spatial data and plate reconstructions
- **Auxiliary tables** (~50 tables) — Intervals, specimens, media, admin

### 2. Relationship Map

**58 foreign key relationships** were validated by data-driven testing:
- **37 are perfectly clean** (zero orphan records)
- **21 have minor orphan issues** (1–271 orphans each)
- The database maintains **99.996% referential integrity** without formal FK constraints

**Universal patterns:**
- Every data-entry table has `authorizer_no`, `enterer_no`, `modifier_no` → `person.person_no`
- Every data-entry table has `reference_no` → `refs.reference_no`
- Text fields (`authorizer`, `enterer`, `modifier`) duplicate person names for denormalization
- The `orig_no` concept (original taxon concept number) links across the entire taxonomy subsystem

### 3. Top Anomalies by Severity

#### CRITICAL: Inverted Timestamps (1.13M records)
**53% of occurrences** (1,052,525 rows) have `modified` timestamps earlier than `created` dates. An additional 39,983 authorities (7.7%) and 35,568 collections (12.9%) show the same pattern. This is likely an artifact of bulk data migrations where `created` (a static datetime) was reset without updating `modified` (an auto-updating timestamp).

**Impact:** Any query using `modified > created` to detect edits will produce incorrect results. Audit trails based on these timestamps are unreliable for affected records.

#### HIGH: Coordinate DMS/Decimal Mismatch (90K records)
**32.8% of collections** (90,303 rows) have a discrepancy between DMS and decimal latitude representations exceeding 0.1 degrees (~11 km). Both representations are fully populated across all 275,555 collections.

**Impact:** Queries using DMS fields may return different spatial results than those using decimal fields. One representation should be designated as authoritative.

#### HIGH: Taxonomy Nested Set Anomalies (266K nodes)
**70.3% of taxon_trees** nodes (262,167) use a non-standard nested set encoding where `lft = rgt` for leaf nodes (standard practice requires `lft = rgt - 1`). Additionally, **105,347 taxa_tree_cache entries** (21.8%) reference taxa not present as current tree nodes. 4,372 nodes have NULL lft/rgt values.

**Impact:** Standard nested-set queries (counting descendants via `rgt - lft - 1`) will fail. The custom encoding must be understood before writing tree-traversal queries.

#### HIGH: Missing Indexes (93 columns)
**93 FK-like columns** lack indexes, including `updater_no` across all 7 major tables and `occ_matrix.taxon_no` (2M rows). This impacts query performance for any JOINs on these columns.

#### HIGH: Data Type Inconsistencies
The `session_data` table uses **signed integers** for `authorizer_no`, `enterer_no`, and `reference_no` where all other tables use unsigned. `collections.lat`/`lng` uses `float(9,6)` while derived tables use `decimal(9,6)`, creating precision mismatches. `created`/`modified` columns are split between `datetime` (timezone-naive) and `timestamp` (timezone-aware) across tables.

### 4. Areas of Strength

- **Referential integrity is excellent** — 0.004% orphan rate without formal FK constraints
- **Coordinate ranges are clean** — Zero out-of-range lat/lng values, no (0,0) sentinel coordinates
- **Paleocoordinates are fully valid** — All 2.1M records within proper ranges
- **Taxonomy parent chain is intact** — Zero cycles, zero orphaned subtrees, zero self-references
- **Person references are clean** — Zero orphans for authorizer_no across all major tables
- **Cache tables are mostly current** — spec_matrix is perfectly synchronized, coll_matrix has 1 missing record

---

## Recommendations

### Immediate (Data Quality)
1. **Investigate timestamp inversions** — Determine whether `created` or `modified` is more reliable for the 1.05M affected occurrence records. Consider adding a `data_import_date` column to distinguish bulk imports from user edits.
2. **Resolve DMS/decimal coordinate discrepancy** — Designate one representation as authoritative and regenerate the other. Consider removing DMS columns if decimal is the source of truth.
3. **Clean opinion_no orphans** — The ~143 deleted opinions that ripple through taxon_trees, taxa_tree_cache, and taxon_names should be set to 0 or to valid replacement opinions.

### Short-Term (Schema Improvement)
4. **Add missing indexes** — Priority: `occ_matrix.taxon_no`, `updater_no` (all tables), `opinions.max/min_interval_no`, `order_opinions.reference_no`, `taxa_tree_cache.max/min_interval_no`.
5. **Normalize data types** — Fix signed/unsigned mismatches in `session_data`. Standardize lat/lng as `decimal(9,6)` everywhere. Choose either `datetime` or `timestamp` for created/modified.
6. **Add primary keys** — Priority: `coll_ints` (1.5M rows), `pvl_matrix` (1.7M rows), `pvl_collections` (732K rows).

### Medium-Term (Maintenance)
7. **Verify legacy column migration** — Before dropping `*_old` columns, confirm `opinions.status_old` (125K values) and `authorities.extant_old` (108K values) have been fully migrated to their replacement columns.
8. **Standardize NULL handling** — Establish convention for "no value" (NULL vs empty string vs 0) in enum and FK columns.
9. **Rebuild nested set** — If nested-set queries are needed, rebuild taxon_trees to use standard encoding (`lft = rgt - 1` for leaves) and ensure all 4,372 NULL lft/rgt nodes are assigned valid values.
10. **Refresh occ_matrix cache** — Add the 629 missing occurrences and remove the 15 orphaned entries.

---

## Deliverables

| File | Description |
|------|-------------|
| [`schema-catalog.md`](schema-catalog.md) | Complete schema reference with all tables, columns, discovered FKs, and relationship map |
| [`er-diagrams.md`](er-diagrams.md) | 9 Mermaid ER diagrams organized by domain (paste into any Mermaid renderer) |
| [`anomaly-report.md`](anomaly-report.md) | Detailed analysis of 17 anomaly categories with counts and severity ratings |
| [`analysis-summary.md`](analysis-summary.md) | This executive summary |

---

*Analysis performed on 2026-02-10. All queries were read-only (SELECT only). ER diagrams can be verified at [mermaid.live](https://mermaid.live).*
