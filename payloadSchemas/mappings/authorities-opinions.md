# Classic authorities to name_opinions migration
### Every row from the classic authorities table should be imported according to the following mappings.
Classic authorities	| name_opinions	| Notes   
--- | --- | --- 
N/A	| id	| pk
N/A | permid | generated
authorizer_no	| authorizer_person_id	| This is a foreign key to the new persons table record whose person.legacyIDs.oldpbdbid = authorizer_no.
enterer_no	| enterer_person_id	| This is a foreign key to the new persons table record whose person.legacyIDs.oldpbdbid = enterer_no.
taxon_no	| oldpbdb_taxon_no	| 
N/A	| reason_id	| 'original', this will be hard-coded to always be original for migration from the authorities table
N/A	| subject_permid | This is a soft reference (not an fk) to name_opinions.permid. For root records, this contains the record's permid.
N/A	| target_permid | This is a soft reference (not an fk) to name_opinions.permid. For root records, this will be null.
N/A	| edge_class | 'root'
N/A | objective | NA
N/A | evidence | Always FALSE for root
taxon_name	| new_name |
taxon_rank	| rank_id | Find the id in dictionaries.taxonomy_ranks that corresponds to the taxon_rank.
N/A | authority_id | This is a fk to the new authorities table record whose authority.legacyIDs.oldpbdbids includes the oldpbdb_taxon_no.
reference_no | reference_id | The reference_id from the record in the new authorities table fk'ed by authority_id
N/A | attribution | Using opinionAttribution.schema.js, this gets the relevant data from authorities.authority in the record fk'ed by authority_id
N/A | publication_year | authorities.authority.year in the record fk'ed by authority_id
N/A | removed | false

### There will be 18 rows from classic authorities that have a taxon rank of "informal". These should be mapped to the rank_id for "unranked" in the name_opinions record and a record should be added to validity_opinions that follows this mapping:

Classic authorities | validity_opinions | Notes
-- | -- | --
N/A	| id	| pk
N/A | permid | generated
authorizer_no	| authorizer_person_id	| This is a foreign key to the new persons table record whose person.legacyIDs.oldpbdbid = authorizer_no.
enterer_no	| enterer_person_id	| This is a foreign key to the new persons table record whose person.legacyIDs.oldpbdbid = enterer_no.
taxon_no | subject_permid | The permid from the name_opinions record with oldpbdb_taxon_no = taxon_no.
taxon_rank | nomenclatural_status_id | fk to the dictionaries.nomenclatural_statuses = 'informal'
reference_no | reference_id | The reference_id from the record in the new authorities table fk'ed by authority_id
N/A | evidence |  FALSE
N/A | publication_year | authorities.authority.year in the record fk'ed by authority_id
N/A | attribution | Using opinionAttribution.schema.js, this gets the relevant data from authorities.authority in the record fk'ed by authority_id

# Classic opinions to assignment_opinions migration

### This mapping applies only to records in the old opinions table that are returned by the following sql:
   >SELECT * FROM opinions WHERE status = 'belongs to' AND 'spelling_reason = 'original_spelling';
   
Classic opinions | assignment_opinions | Notes
-- | -- | --
child_spelling_no | subject_permid | The permid from the name_opinions record with oldpbdb_taxon_no = child_spelling_no.
parent_spelling_no | containing_permid | The permid from the name_opinions record with oldpbdb_taxon_no = parent_spelling_no.
reference_no | reference_id | fk to the refs record with reference.legacyIDs.oldpbdbid = reference_no.
basis | evidence | 'stated with evidence' = TRUE, everything else = FALSE
pubyr | publication_year | 
author1last, author2last, otherauthors, ref_has_opinion | attribution | Using opinionAttribution.schema.js, format attribution fields from the old data as described in the Decisions section of https://github.com/paleobot/pbdb2-migrations/blob/main/openspec/changes/archive/2026-06-02-migrate-authorities/design.md. 
