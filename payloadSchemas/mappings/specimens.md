# Classic specimens → 2.0 mapping [‡]

### Every row from the classic authorities table should be imported according to the following mappings.
| PBDB 2.0 specimen (columns and payload fields) | Classic Source 	| Notes |   
| --- | --- | --- |
| id	| N/A | pk |
| permid | N/A | generated |
| authorizer_person_id | authorizer_no | This is a foreign key to the new persons table record whose person.legacyIDs.oldpbdbid = authorizer_no. |
| enterer_person_id | enterer_no | This is a foreign key to the new persons table record whose person.legacyIDs.oldpbdbid = enterer_no. |
| collection_id | occurrences[occurence_no].collection_no | This is a foreign key to the new collections table record whose collection.legacyIDs.oldpbdbid = collection_no. |
| reference_id | reference_no | This is a foreign key to the new refs table record whose reference.legacyIDs.oldpbdbid = reference_no. |
| specimen.name | specimen_id | <what if null?> |
| specimen.legacyIDs.oldpbdbid | specimen_no | |
| specimen.identifiers.institutionCode | collections[occurrences[occurence_no].collection_no].museum | null if blank |
| specimen.identifiers.catalogNumber | specimen_id | null if blank |
| specimen.identifiers.GBIF | N/A | This is pbot only |
| specimen.paleontology.preservationModes | collections[occurrences[occurence_no].collection_no].pres_mode | <make an enum or dictionaries table> |
| specimen.notes | comments | |
| specimen.paleontology.numberMeasured | specimens_measured | |
| specimen.paleontology.coverage | specimen_coverage | |
| specimen.paleontology.side | specimen_side | |
| specimen.paleontology.sex | sex | |
| specimen.paleontology.part | specimen_part | |
| specimen.paleontology.measurementSource | measurement_source | |
| specimen.paleontology.magnification | magnification | |



