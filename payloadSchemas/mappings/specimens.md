# Classic specimens → 2.0 mapping [‡]

### Every row from the classic specimens table should be imported according to the following mappings.
| PBDB 2.0 specimen (columns and payload fields) | Classic Source 	| Notes |   
| --- | --- | --- |
| id	| N/A | pk |
| permid | N/A | generated |
| authorizer_person_id | authorizer_no | This is a foreign key to the new persons table record whose person.legacyIDs.oldpbdbID = authorizer_no. If 0, apply the 0-sentinel fallback (resolvePersons in src/lib/identity.js): the non-zero of the pair substitutes for the zero one; if both are 0, use person 1. |
| enterer_person_id | enterer_no | This is a foreign key to the new persons table record whose person.legacyIDs.oldpbdbID = enterer_no. If 0, apply the 0-sentinel fallback (resolvePersons in src/lib/identity.js): the non-zero of the pair substitutes for the zero one; if both are 0, use person 1. |
| oldpbdb_occurrence_no | occurrence_no | This is a temporary column for use during migrations and will likely be dropped later. |
| name_opinions_permid | taxon_no | use SELECT permid FROM name_opinions WHERE edge_class = ‘root’ AND succeeded_by_id IS NULL AND oldpbdb_taxon_no = <taxon_no> |
| collection_id | occurrences[occurence_no].collection_no | This is a foreign key to the new collections table record whose collection.legacyIDs.oldpbdbID = collection_no. |
| reference_id | reference_no | This is a foreign key to the new refs table record whose reference.legacyIDs.oldpbdbID = reference_no. If reference_no is 0 or null, get the reference_no from occurrences[occurrence_no]. |
| specimen.name | specimen_no | Use string `pbdb_classic:${specimen_no}` This concept doesn't exist in classic. Pbot has it, and it will be required going forward. Consequently, this is really just a placeholder. |
| specimen.legacyIDs.oldpbdbID | specimen_no | |
| specimen.type | is_type | If blank or null, omit key.  |
| specimen.identifiers.institutionCode | collections[occurrences[occurrence_no].collection_no].museum | Take first value from the set if multiple. If there is no museum value, use 'none specified'. Specimen-level institution and catalog data do not exist in classic. They do in pbot and will going forward. So this and catalogNumber are mostly placeholders. |
| specimen.identifiers.catalogNumber | specimen_id | |
| specimen.identifiers.GBIF | N/A | This is pbot only |
| specimen.paleontology.preservationModes | collections[occurrences[occurrence_no].collection_no].pres_mode |  |
| specimen.notes | comments | |
| specimen.paleontology.numberMeasured | specimens_measured | |
| specimen.paleontology.coverage | specimen_coverage | |
| specimen.paleontology.side | specimen_side | |
| specimen.paleontology.sex | sex | |
| specimen.paleontology.part | specimen_part | |
| specimen.paleontology.measurementSource | measurement_source | |
| specimen.paleontology.magnification | magnification | |

