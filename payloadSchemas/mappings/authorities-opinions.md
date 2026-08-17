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
N/A | targeted | FALSE
N/A | publication_year | authorities.authority.year in the record fk'ed by authority_id
N/A | attribution | Using opinionAttribution.schema.js, this gets the relevant data from authorities.authority in the record fk'ed by authority_id
N/A | removed | false

# Classic opinions to assignment_opinions migration

### This mapping applies only to records in the old opinions table that are returned by the following sql:
   >SELECT * FROM opinions WHERE status = 'belongs to' AND spelling_reason = 'original spelling';
   
Classic opinions | assignment_opinions | Notes
-- | -- | --
N/A	| id	| pk
N/A | permid | generated
authorizer_no	| authorizer_person_id	| This is a foreign key to the new persons table record whose person.legacyIDs.oldpbdbid = authorizer_no.
enterer_no	| enterer_person_id	| This is a foreign key to the new persons table record whose person.legacyIDs.oldpbdbid = enterer_no.
child_spelling_no | subject_permid | The permid from the name_opinions record with oldpbdb_taxon_no = child_spelling_no.
parent_spelling_no | containing_permid | The permid from the name_opinions record with oldpbdb_taxon_no = parent_spelling_no.
reference_no | reference_id | fk to the refs record with reference.legacyIDs.oldpbdbid = reference_no.
basis | evidence | 'stated with evidence' = TRUE, everything else = FALSE
pubyr | publication_year | Second-hand override only, gated on ref_has_opinion (the same switch that drives attribution). When ref_has_opinion = 'YES' (first-hand: the reference is itself the source), leave publication_year NULL — derive_taxa() reads the year off the reference via COALESCE(publication_year, ref.publicationYear), so copying pubyr would just store the reference's own year twice. When ref_has_opinion IS NULL (second-hand: the opinion is attributed to an earlier author), set publication_year = pubyr, so the attributed year overrides the (later) reporting reference's year for recency ranking. Verified safe in scope: 0 rows have a pubyr with no resolvable reference year, so the NULL/COALESCE path never sinks a row to NULLS LAST.
author1last, author2last, otherauthors, ref_has_opinion | attribution | Using opinionAttribution.schema.js, format attribution fields from the old data as described in the Decisions section of https://github.com/paleobot/pbdb2-migrations/blob/main/openspec/changes/archive/2026-06-02-migrate-authorities/design.md. 

Original-only resolution assumption: subject_permid and containing_permid are resolved by looking up name_opinions.oldpbdb_taxon_no. This lookup returns name_opinions.permid, which is safe because oldpbdb_taxon_no is carried ONLY by root/original rows (edge_class='root', reason='original'), where permid and subject_permid are identically the same value by construction (the root minting shape assigns subject_permid := permid). On those rows permid is the structurally-minted name identity, so pointing to it is equivalent to — and no less safe than — pointing to subject_permid. This is currently a data property, not an enforced constraint: there is no unique index on oldpbdb_taxon_no, and nothing stops a future migration slice from stamping oldpbdb_taxon_no onto a non-original (lineage/concept) row. If that ever happens the lookup would become ambiguous, permid would diverge from subject_permid, and the resolution would need to explicitly filter edge_class='root'. Future slices MUST keep oldpbdb_taxon_no original-only to preserve this guarantee.

Known missing reference: opinion_no 422326 cites reference_no 42348, which does not exist in the classic refs table (dangling FK in the source) and was therefore never migrated. Since reference_id is NOT NULL, this one in-scope opinion is skipped and logged. It is the only in-scope reference_no that fails to resolve against the migrated refs.

### Skip-and-log and reconciliation invariant

The assignment_opinions columns subject_permid, containing_permid, and reference_id are all NOT NULL, and a same-row CHECK (assignment_not_self) forbids subject_permid = containing_permid. An in-scope opinion that cannot satisfy all of these is skipped and logged rather than inserted (mirroring the orphan-authority handling in migrate-name-opinions.js). Persons need no skipping: persons.id is pinned to the legacy person_no, and in scope every authorizer_no/enterer_no is non-zero and present in persons, so the D10 0-sentinel fallback is carried for safety but never fires.

Measured against the source and the migrated name_opinions/refs (2026-08-14), the in-scope set is 743,712 rows, of which 331 are skipped in five disjoint buckets:

| Skip bucket | Rows | Cause |
| -- | -- | -- |
| parent_spelling_zero | 322 | parent_spelling_no = 0/NULL — a degenerate `belongs to` that states no container (321 genera + 1 species); containing_permid is NOT NULL, so it carries no assignment and cannot become a row. These names are simply left unparented by this slice (many are placed later by a deferred recombination opinion). |
| parent_spelling_orphan | 6 | parent_spelling_no points at a taxon_no absent from authorities/name_opinions — dangling FK in the source (4 share reference_no 55050). |
| orphan_reference | 1 | reference_no not resolvable (opinion_no 422326 → reference_no 42348; see above). |
| child_spelling_unresolved | 1 | child_spelling_no has no name_opinions row. |
| self_reference | 1 | child_spelling_no = parent_spelling_no; would violate assignment_not_self. |

The buckets are disjoint, so the migration MUST hold the reconciliation invariant:

>inserted (743,381) + skipped (331) == in-scope (743,712)

The run aborts if this does not hold. The 331 skipped rows are enumerated (with opinion_no, failure_reason, and source columns) in failing-assignment-opinions.csv. Note the 322 parent_spelling_zero rows are an expected, non-error outcome: they represent classifications that assert no containment, so "743,712 in, 743,381 out" is not data loss.

# Classic opinions original spellings migration

### This mapping applies only to records in the old opinions table that are returned by the following sql:
```
SELECT * FROM opinions 
    WHERE (status = 'subjective synonym of' OR status = 'objective synonym of') 
    AND spelling_reason = 'original spelling';
```
   
Classic opinions | assignment_opinions | Notes
-- | -- | --
N/A	| id	| pk
N/A | permid | generated
authorizer_no	| authorizer_person_id	|
enterer_no	| enterer_person_id	| 
N/A | oldpbdb_taxon_no |  NA
N/A	| reason_id	| 'junior synonym'
child_spelling_no	| subject_permid | permid of the name_opinions record whose oldpbdb_taxon_no = child_spelling_no 
parent_spelling_no | target_permid |  permid of the name_opinions record whose oldpbdb_taxon_no = parent_spelling_no
N/A	| edge_class | 'concept'
status | objective | if status = 'objective synonym of' this gets TRUE, if satus = 'subjective synonym of' this gets FALSE
basis | evidence | if basis = 'stated with evidence' this gets TRUE, everything else = FALSE
N/A | new_name | new_name of name_opinions record whose permid = target_permid
N/A | rank_id | rank_id of name_opinions record whose permid = target_permid
N/A | authority_id | NA
reference_no | reference_id | fk to the refs record with reference.legacyIDs.oldpbdbid = reference_no.
pubyr | publication_year | Second-hand override only, gated on ref_has_opinion (the same switch that drives attribution). When ref_has_opinion = 'YES' (first-hand: the reference is itself the source), leave publication_year NULL — derive_taxa() reads the year off the reference via COALESCE(publication_year, ref.publicationYear), so copying pubyr would just store the reference's own year twice. When ref_has_opinion IS NULL (second-hand: the opinion is attributed to an earlier author), set publication_year = pubyr, so the attributed year overrides the (later) reporting reference's year for recency ranking. Verified safe in scope: 0 rows have a pubyr with no resolvable reference year, so the NULL/COALESCE path never sinks a row to NULLS LAST.
author1last, author2last, otherauthors, ref_has_opinion | attribution | Using opinionAttribution.schema.js, format attribution fields from the old data as described in the Decisions section of https://github.com/paleobot/pbdb2-migrations/blob/main/openspec/changes/archive/2026-06-02-migrate-authorities/design.md. 
N/A | removed | false
