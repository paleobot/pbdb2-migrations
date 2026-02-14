# PBDB Archive Database — ER Diagrams

All diagrams use Mermaid syntax. Paste into any Mermaid renderer (GitHub markdown, mermaid.live, VS Code preview) to visualize.

Legend:
- `PK` = Primary Key
- `FK` = Foreign Key (discovered, not enforced)
- `||--o{` = one-to-many
- `||--||` = one-to-one
- `}o--o{` = many-to-many

---

## 1. Core Entities

The central hub connecting taxonomy, collections, occurrences, references, and people.

```mermaid
erDiagram
    person {
        int person_no PK
        varchar name
        varchar reversed_name
        varchar first_name
        varchar last_name
        set role
        tinyint is_authorizer
        tinyint active
        int heir_no FK
    }

    refs {
        int reference_no PK
        varchar authorizer FK
        int authorizer_no FK
        int enterer_no FK
        int modifier_no FK
        varchar author1last
        varchar pubyr
        mediumtext reftitle
        mediumtext pubtitle
        enum publication_type
        varchar doi
        datetime created
    }

    authorities {
        int taxon_no PK
        int orig_no FK
        int reference_no FK
        int authorizer_no FK
        int enterer_no FK
        enum taxon_rank
        varchar taxon_name
        int type_taxon_no FK
        int type_locality FK
        enum extant
        varchar pubyr
    }

    collections {
        int collection_no PK
        int reference_no FK
        int authorizer_no FK
        int enterer_no FK
        varchar collection_name
        varchar country
        float lat
        float lng
        int max_interval_no FK
        int min_interval_no FK
        varchar formation
        enum environment
        datetime created
    }

    occurrences {
        int occurrence_no PK
        int collection_no FK
        int taxon_no FK
        int reference_no FK
        int authorizer_no FK
        varchar genus_name
        varchar species_name
        datetime created
    }

    opinions {
        int opinion_no PK
        int reference_no FK
        int child_no FK
        int child_spelling_no FK
        int parent_no FK
        int parent_spelling_no FK
        enum status
        enum spelling_reason
        int authorizer_no FK
    }

    person ||--o{ authorities : "authorizer_no"
    person ||--o{ collections : "authorizer_no"
    person ||--o{ occurrences : "authorizer_no"
    person ||--o{ refs : "authorizer_no"
    person ||--o{ opinions : "authorizer_no"
    refs ||--o{ authorities : "reference_no"
    refs ||--o{ collections : "reference_no"
    refs ||--o{ occurrences : "reference_no"
    refs ||--o{ opinions : "reference_no"
    authorities ||--o{ occurrences : "taxon_no"
    collections ||--o{ occurrences : "collection_no"
    authorities ||--o{ opinions : "child_no"
    authorities ||--o{ opinions : "parent_no"
    authorities ||--o{ authorities : "orig_no"
```

---

## 2. Taxonomy

The taxonomic hierarchy: names, trees, opinions, and derived data.

```mermaid
erDiagram
    authorities {
        int taxon_no PK
        int orig_no FK
        int reference_no FK
        enum taxon_rank
        varchar taxon_name
        int type_taxon_no FK
    }

    auth_orig {
        int taxon_no PK
        int orig_no FK
    }

    taxon_trees {
        int orig_no PK
        varchar name
        tinyint rank
        enum status
        int spelling_no FK
        int synonym_no FK
        int accepted_no FK
        int immpar_no FK
        int senpar_no FK
        int opinion_no FK
        int ints_no FK
        int lft
        int rgt
        int depth
    }

    taxon_names {
        int taxon_no PK
        int orig_no FK
        enum spelling_reason
        int opinion_no FK
        varchar pubyr
        varchar author
    }

    taxa_tree_cache {
        int taxon_no PK
        int lft
        int rgt
        int spelling_no FK
        int synonym_no FK
        int opinion_no FK
        int max_interval_no FK
        int min_interval_no FK
    }

    taxon_search {
        int taxon_no PK
        varchar genus
        varchar taxon_name
        varchar full_name
        enum taxon_rank
        int orig_no FK
        int accepted_no FK
    }

    taxon_ages {
        int orig_no PK
        decimal first_early_age
        decimal first_late_age
        decimal last_early_age
        decimal last_late_age
        int early_occ FK
        int late_occ FK
    }

    taxon_attrs {
        int orig_no PK
        tinyint is_valid
        tinyint is_extant
        int n_occs
        int n_colls
        decimal first_early_age
        float min_body_mass
        float max_body_mass
    }

    taxon_lower {
        int orig_no PK
        tinyint rank
        int genus_no FK
        int subgenus_no FK
        int species_no FK
    }

    taxon_counts {
        int orig_no PK
        int genus_count
        int species_count
        int family_count
    }

    taxon_colls {
        int orig_no PK
        int n_taxa
        int n_occs
        int n_colls
    }

    taxon_ints {
        int ints_no PK
        int kingdom_no FK
        int phylum_no FK
        int class_no FK
        int order_no FK
        int family_no FK
    }

    taxon_exceptions {
        int orig_no PK
        varchar name
        enum status
    }

    opinions {
        int opinion_no PK
        int child_no FK
        int parent_no FK
        enum status
    }

    authorities ||--o{ auth_orig : "taxon_no"
    authorities ||--o{ taxon_names : "taxon_no"
    authorities ||--|| taxa_tree_cache : "taxon_no"
    authorities ||--|| taxon_search : "taxon_no"
    authorities ||--|| taxon_trees : "orig_no via auth_orig"
    taxon_trees ||--|| taxon_ages : "orig_no"
    taxon_trees ||--|| taxon_attrs : "orig_no"
    taxon_trees ||--|| taxon_lower : "orig_no"
    taxon_trees ||--|| taxon_counts : "orig_no"
    taxon_trees ||--|| taxon_colls : "orig_no"
    taxon_trees ||--|| taxon_ints : "ints_no"
    taxon_trees ||--o{ taxon_trees : "immpar_no (parent)"
    opinions ||--o{ taxon_trees : "opinion_no"
    opinions ||--o{ taxon_names : "opinion_no"
    opinions ||--o{ taxa_tree_cache : "opinion_no"
```

---

## 3. Collections & Geography

Collection locations, stratigraphy, lithology, spatial bins, and paleocoordinates.

```mermaid
erDiagram
    collections {
        int collection_no PK
        int reference_no FK
        varchar country
        float lat
        float lng
        int max_interval_no FK
        int min_interval_no FK
        varchar formation
        enum environment
    }

    coll_matrix {
        int collection_no PK
        int bin_id_1 FK
        int bin_id_2 FK
        int bin_id_3 FK
        decimal lng
        decimal lat
        char cc FK
        decimal early_age
        decimal late_age
        int n_occs
        int reference_no FK
    }

    coll_loc {
        int collection_no PK
        decimal lng
        decimal lat
        char cc
        varchar protected
    }

    coll_strata {
        varchar grp
        varchar formation
        varchar member
        int collection_no FK
        int n_occs
    }

    coll_lith {
        int collection_no PK
        varchar lithology PK
        varchar macros_lith
        varchar lith_type
    }

    coll_bins {
        int bin_id PK
        int interval_no PK
        int n_colls
        int n_occs
        decimal lng
        decimal lat
    }

    coll_ints {
        int collection_no FK
        int interval_no FK
    }

    coll_units {
        int id PK
        int collection_no FK
        int col_id
        int unit_id
    }

    paleocoords {
        int collection_no PK
        varchar model PK
        enum selector PK
        smallint age
        smallint plate_no FK
        decimal paleo_lng
        decimal paleo_lat
    }

    paleostatic {
        int collection_no PK
        decimal present_lng
        decimal present_lat
        decimal early_age
        decimal late_age
    }

    bin_container {
        int bin_id PK
        int bin_id_1
        int bin_id_2
        int bin_id_3
    }

    bin_loc {
        int bin_id PK
        char cc PK
        char continent FK
    }

    country_map {
        char cc PK
        char continent FK
        varchar name
    }

    continent_data {
        char continent PK
        varchar name
    }

    plates {
        int plate PK
        varchar paleocontinent
        float age
    }

    geoplates {
        varchar model PK
        int plate_no PK
        varchar name
    }

    collections ||--|| coll_matrix : "collection_no"
    collections ||--|| coll_loc : "collection_no"
    collections ||--|| coll_strata : "collection_no"
    collections ||--o{ coll_lith : "collection_no"
    collections ||--o{ coll_ints : "collection_no"
    collections ||--o{ coll_units : "collection_no"
    collections ||--o{ paleocoords : "collection_no"
    collections ||--|| paleostatic : "collection_no"
    coll_matrix }o--|| bin_container : "bin_id_1"
    coll_bins }o--|| bin_container : "bin_id"
    bin_container ||--o{ bin_loc : "bin_id"
    bin_loc }o--|| country_map : "cc"
    country_map }o--|| continent_data : "continent"
    coll_matrix }o--|| country_map : "cc"
    paleocoords }o--o| geoplates : "plate_no + model"
```

---

## 4. Occurrences & Specimens

Occurrence records, reidentifications, specimens, and measurements.

```mermaid
erDiagram
    occurrences {
        int occurrence_no PK
        int collection_no FK
        int taxon_no FK
        int reference_no FK
        varchar genus_name
        varchar species_name
        int reid_no FK
        enum plant_organ
        datetime created
    }

    occ_matrix {
        int occurrence_no PK
        int reid_no PK
        int collection_no FK
        int taxon_no
        int orig_no FK
        tinyint latest_ident
        varchar genus_name
        varchar species_name
        decimal early_age
        decimal late_age
    }

    occ_taxon {
        int orig_no PK
        int n_occs
        int n_colls
        decimal first_early_age
        decimal last_late_age
    }

    occ_ref {
        int reference_no PK
        int n_occs
        int n_colls
        decimal early_age
        decimal late_age
    }

    reidentifications {
        int reid_no PK
        int occurrence_no FK
        int collection_no FK
        int taxon_no FK
        int reference_no FK
        varchar genus_name
        varchar species_name
        enum most_recent
    }

    specimens {
        int specimen_no PK
        int occurrence_no FK
        int taxon_no FK
        int reference_no FK
        int specelt_no FK
        varchar specimen_id
        enum specimen_side
        enum sex
        datetime created
    }

    spec_matrix {
        int specimen_no PK
        int reid_no PK
        int occurrence_no FK
        int taxon_no FK
        int orig_no FK
        tinyint latest_ident
    }

    measurements {
        int measurement_no PK
        int specimen_no FK
        enum position
        enum measurement_type
        varchar average
        float real_average
        float real_min
        float real_max
    }

    specelt_data {
        int specelt_no PK
        varchar element_name
        varchar taxon_name
    }

    occurrences ||--o{ occ_matrix : "occurrence_no"
    occurrences ||--o{ reidentifications : "occurrence_no"
    occurrences ||--o{ specimens : "occurrence_no"
    occurrences ||--|| occ_taxon : "orig_no via taxon"
    specimens ||--o{ measurements : "specimen_no"
    specimens ||--o{ spec_matrix : "specimen_no"
    reidentifications }o--|| occurrences : "occurrence_no"
    specimens }o--o| specelt_data : "specelt_no"
```

---

## 5. Time Intervals

Geological timescale definitions, hierarchies, and mappings.

```mermaid
erDiagram
    intervals {
        int interval_no PK
        varchar interval_name
        enum eml_interval
        int authorizer_no FK
        int reference_no FK
        datetime created
    }

    interval_data {
        int interval_no PK
        int scale_no FK
        varchar interval_name
        varchar abbrev
        decimal early_age
        decimal late_age
        enum b_type
        enum t_type
        int reference_no FK
    }

    interval_lookup {
        int interval_no PK
        varchar ten_my_bin
        int stage_no FK
        int subepoch_no FK
        int epoch_no FK
        int period_no FK
        decimal base_age
        decimal top_age
    }

    interval_map {
        decimal early_age PK
        decimal late_age PK
        smallint scale_no PK
        varchar range_key
        int cx_int_no
        int early_int_no FK
        int late_int_no FK
    }

    interval_bracket {
        decimal age PK
        int interval_no PK
        smallint scale_no
        decimal early_age
        decimal late_age
    }

    interval_buffer {
        int interval_no PK
        decimal early_bound
        decimal late_bound
    }

    int_summary {
        int interval_no PK
        int scale_no FK
        int colls_defined
        int occs_defined
        int colls_contained
        int occs_contained
    }

    int_major_map {
        decimal early_age PK
        decimal late_age PK
        int interval_no PK
        int scale_no
    }

    scale_data {
        smallint scale_no PK
        varchar scale_name
        tinyint levels
        decimal early_age
        decimal late_age
    }

    scale_map {
        smallint scale_no PK
        smallint scale_level PK
        int interval_no PK
        int parent_no FK
        varchar type
    }

    intervals ||--|| interval_data : "interval_no"
    intervals ||--|| interval_lookup : "interval_no"
    intervals ||--|| interval_buffer : "interval_no"
    intervals ||--|| int_summary : "interval_no"
    intervals ||--o{ interval_bracket : "interval_no"
    interval_lookup }o--o| intervals : "stage_no"
    interval_lookup }o--o| intervals : "epoch_no"
    interval_lookup }o--o| intervals : "period_no"
    scale_data ||--o{ interval_data : "scale_no"
    scale_data ||--o{ scale_map : "scale_no"
    scale_data ||--o{ int_summary : "scale_no"
    scale_map }o--|| intervals : "interval_no"
```

---

## 6. Opinions & Classification

Taxonomic opinion records and their ordering.

```mermaid
erDiagram
    opinions {
        int opinion_no PK
        int reference_no FK
        int authorizer_no FK
        int child_no FK
        int child_spelling_no FK
        enum status
        enum basis
        enum spelling_reason
        int parent_no FK
        int parent_spelling_no FK
        varchar pubyr
        datetime created
    }

    order_opinions {
        int opinion_no PK
        int orig_no FK
        enum child_rank
        int child_spelling_no FK
        int parent_no FK
        int parent_spelling_no FK
        int ri
        varchar pubyr
        enum status
        enum spelling_reason
        int reference_no FK
    }

    opview {
        int opinion_no
        int child_no
        int child_name
        int status
        int parent_no
    }

    authorities {
        int taxon_no PK
        varchar taxon_name
        enum taxon_rank
    }

    refs {
        int reference_no PK
        varchar author1last
        varchar pubyr
    }

    opinions ||--|| order_opinions : "opinion_no"
    opinions }o--|| refs : "reference_no"
    opinions }o--|| authorities : "child_no"
    opinions }o--o| authorities : "parent_no"
    opinions }o--|| authorities : "child_spelling_no"
    opinions }o--o| authorities : "parent_spelling_no"
```

---

## 7. Diversity & PVL Matrices

Pre-computed diversity and prevalence analysis tables.

```mermaid
erDiagram
    div_matrix {
        int bin_id PK
        int interval_no PK
        int ints_no PK
        int genus_no PK
        int n_occs
        tinyint not_trace
    }

    div_global {
        int interval_no PK
        int ints_no PK
        int genus_no PK
        int n_occs
        tinyint not_trace
    }

    pvl_matrix {
        int bin_id FK
        int interval_no
        int order_no FK
        int class_no FK
        int phylum_no FK
        int n_occs
    }

    pvl_collections {
        int collection_no FK
        int order_no FK
        int class_no FK
        int phylum_no FK
        int n_occs
    }

    pvl_global {
        int interval_no FK
        int order_no FK
        int class_no FK
        int phylum_no FK
        int n_occs
    }

    bin_container {
        int bin_id PK
    }

    taxon_ints {
        int ints_no PK
        int kingdom_no FK
        int phylum_no FK
        int class_no FK
        int order_no FK
        int family_no FK
    }

    intervals {
        int interval_no PK
        varchar interval_name
    }

    div_matrix }o--|| bin_container : "bin_id"
    div_matrix }o--|| intervals : "interval_no"
    div_matrix }o--|| taxon_ints : "ints_no"
    div_global }o--|| intervals : "interval_no"
    div_global }o--|| taxon_ints : "ints_no"
    pvl_matrix }o--|| bin_container : "bin_id"
    pvl_collections }o--|| collections : "collection_no"
```

---

## 8. Bibliographic & Media

References, authors, images, phylopics, and nexus file data.

```mermaid
erDiagram
    refs {
        int reference_no PK
        varchar author1last
        varchar pubyr
        mediumtext reftitle
        mediumtext pubtitle
        enum publication_type
        varchar doi
    }

    ref_authors {
        int reference_no FK
        tinyint place
        varchar lastname
        varchar firstname
        varchar orcid
    }

    ref_editors {
        int reference_no FK
        tinyint place
        varchar lastname
        varchar firstname
    }

    ref_summary {
        int reference_no PK
        int n_taxa
        int n_opinions
        int n_occs
        int n_colls
        decimal early_age
        decimal late_age
    }

    secondary_refs {
        int id PK
        int collection_no FK
        int reference_no FK
    }

    other_pubs {
        int other_pub_no PK
        varchar last_names
        int year
        text title
        varchar doi
    }

    pubs {
        int pub_no PK
        int first_author
        text title
        varchar doi
    }

    images {
        int image_no PK
        int taxon_no FK
        int authorizer_no FK
        int reference_no FK
        varchar path_to_image
    }

    phylopics {
        varchar uid PK
        int image_no
        varchar credit
        varchar license
    }

    phylopic_choice {
        int orig_no PK
        varchar uid PK
        tinyint priority
    }

    phylopic_names {
        varchar uid FK
        varchar taxon_name
        varchar taxon_attr
    }

    nexus_files {
        int nexusfile_no PK
        int taxon_no
        varchar filename
        int authorizer_no FK
    }

    nexus_data {
        int nexusfile_no PK
        varchar md5_digest
        text data
    }

    nexus_refs {
        int nexusfile_no PK
        int reference_no PK
    }

    nexus_taxa {
        int nexusfile_no FK
        int orig_no FK
        varchar taxon_name
    }

    refs ||--o{ ref_authors : "reference_no"
    refs ||--o{ ref_editors : "reference_no"
    refs ||--|| ref_summary : "reference_no"
    refs ||--o{ secondary_refs : "reference_no"
    refs ||--o{ nexus_refs : "reference_no"
    nexus_files ||--|| nexus_data : "nexusfile_no"
    nexus_files ||--o{ nexus_refs : "nexusfile_no"
    nexus_files ||--o{ nexus_taxa : "nexusfile_no"
    phylopics ||--o{ phylopic_choice : "uid"
    phylopics ||--o{ phylopic_names : "uid"
```

---

## 9. Misc / Admin

Administrative tables, permissions, sessions, logging, and educational resources.

```mermaid
erDiagram
    person {
        int person_no PK
        varchar name
        set role
        tinyint active
        int heir_no FK
    }

    permissions {
        int authorizer_no PK
        int modifier_no PK
    }

    table_permissions {
        int permission_no PK
        int person_no FK
        varchar table_name
        set permission
    }

    session_data {
        varchar session_id PK
        varchar user_id
        int authorizer_no FK
        int enterer_no FK
    }

    delete_log {
        int delete_id PK
        datetime delete_time
        int authorizer_no FK
        int enterer_no FK
        varchar comments
        text delete_sql
    }

    data_archives {
        int archive_no PK
        int authorizer_no FK
        int enterer_no FK
        varchar title
        varchar uri_path
        varchar doi
    }

    eduresources {
        int id PK
        varchar title
        varchar url
        int authorizer_no FK
    }

    eduresource_tags {
        int resource_id FK
        int tag_id FK
    }

    edutags {
        int id PK
        varchar name
    }

    equations {
        int eqn_no PK
        int reference_no FK
        varchar taxon_no
        varchar part
    }

    ecotaph {
        int ecotaph_no PK
        int taxon_no FK
        int reference_no FK
        enum diet1
        enum life_habit
        enum locomotion
    }

    person ||--o{ permissions : "authorizer_no"
    person ||--o{ table_permissions : "person_no"
    person ||--o{ delete_log : "authorizer_no"
    person ||--o{ session_data : "authorizer_no"
    eduresources ||--o{ eduresource_tags : "resource_id"
    edutags ||--o{ eduresource_tags : "tag_id"
```

---

*Generated from pbdb_archive schema on 2026-02-10*
