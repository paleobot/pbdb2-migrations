 |1.0 `status` | 1.0 `spelling_reason` | 1.0 `parent_spelling_no` | 2.0 table | 2.0 `edge_class` | 2.0 `reason` | 2.0 `objective` | 2.0 `nomenclatural_status_id` | 2.0 `subject_permid` | 2.0 `target_permid` \ `containing_permid`|
|---|---|---|---|---|---|---|---|---|---|
|`subjective synonym of`  | (all get this record) | NA | name_opinions | concept | junior synonym | false | NA | permid of name_opinions record with oldpbdbid = child_spelling_no | parent_spelling_no = 0 ? NULL : permid of name_opinions record with oldpbdbid = parent_spelling_no|
|''| != `original spelling` ? add additional record | NA | name_opinions | linguistic | reason from namechange_reasons record that is closest match to spelling_reason (use "rank change" = "rerank", "reassignment" = "assignment") | false | NA | permid of name_opinions record with oldpbdbid = child_spelling_no | permid of name_opinions record with oldpbdbid = child_no|
|`objective synonym of`  | (all get this record) | NA | name_opinions | concept | junior synonym | true | NA |  permid of name_opinions record with oldpbdbid = child_spelling_no | parent_spelling_no = 0 ? NULL : permid of name_opinions record with oldpbdbid = parent_spelling_no|
|''| != `original spelling` ? add additional record | NA | name_opinions | linguistic | reason from namechange_reasons record that is closest match to spelling_reason (use "rank change" = "rerank", "reassignment" = "assignment") | false | NA | permid of name_opinions record with oldpbdbid = child_spelling_no | permid of name_opinions record with oldpbdbid = child_no|
|`replaced by`  | (all get this record) | NA | name_opinions | concept | replaced by | NA | NA |  permid of name_opinions record with oldpbdbid = child_spelling_no | parent_spelling_no = 0 ? NULL : permid of name_opinions record with oldpbdbid = parent_spelling_no|
|''| != `original spelling` ? add additional record | NA | name_opinions | linguistic | reason from namechange_reasons record that is closest match to spelling_reason (use "rank change" = "rerank", "reassignment" = "assignment") | NA | NA | permid of name_opinions record with oldpbdbid = child_spelling_no | permid of name_opinions record with oldpbdbid = child_no|
|`invalid subgroup of` | (all get this record) | NA | name_opinions | concept | invalid subgroup | NA | NA |  permid of name_opinions record with oldpbdbid = child_spelling_no | parent_spelling_no = 0 ? NULL : permid of name_opinions record with oldpbdbid = parent_spelling_no|
|''| != `original spelling` ? add additional record | NA | name_opinions | linguistic | reason from namechange_reasons record that is closest match to spelling_reason (use "rank change" = "rerank", "reassignment" = "assignment") | NA | NA | permid of name_opinions record with oldpbdbid = child_spelling_no | permid of name_opinions record with oldpbdbid = child_no|
|`nomen oblitum` | (all get this record) | != 0 | name_opinions | concept | nomen oblitum | NA | NA |  permid of name_opinions record with oldpbdbid = child_spelling_no | parent_spelling_no = 0 ? NULL : permid of name_opinions record with oldpbdbid = parent_spelling_no|
|''| != `original spelling` ? add additional record | NA | name_opinions | linguistic | reason from namechange_reasons record that is closest match to spelling_reason (use "rank change" = "rerank", "reassignment" = "assignment") | NA | NA | permid of name_opinions record with oldpbdbid = child_spelling_no | permid of name_opinions record with oldpbdbid = child_no|
|`nomen oblitum` | (all get this record) | = 0 | valdity_opinions | NA | NA | NA | fk to nomen oblitum id in dictionaries.nomenclatural_statuses |  permid of name_opinions record with oldpbdbid = child_spelling_no | parent_spelling_no = 0 ? NULL : permid of name_opinions record with oldpbdbid = parent_spelling_no|
|''| != `original spelling` ? add additional record | NA | name_opinions | linguistic | reason from namechange_reasons record that is closest match to spelling_reason (use "rank change" = "rerank", "reassignment" = "assignment") | NA | NA | permid of name_opinions record with oldpbdbid = child_spelling_no | permid of name_opinions record with oldpbdbid = child_no|
|`misspelling of` | (all get this record) | NA | name_opinions | linguistic | historical misspelling | NA | NA |  permid of name_opinions record with oldpbdbid = child_spelling_no | parent_spelling_no = 0 ? NULL : permid of name_opinions record with oldpbdbid = parent_spelling_no|
|`belongs to` | (all get this record) | NA | assignment_opinions | NA | NA | NA | NA | permid of name_opinions record with oldpbdbid = child_spelling_no | parent_spelling_no = 0 ? NULL : permid of name_opinions record with oldpbdbid = parent_spelling_no| 
|''| != `original spelling` ? add additional record | NA | name_opinions | linguistic | reason from namechange_reasons record that is closest match to spelling_reason (use "rank change" = "rerank", "reassignment" = "assignment") | NA | NA | permid of name_opinions record with oldpbdbid = child_spelling_no | permid of name_opinions record with oldpbdbid = child_no|
|`nomen nudum` | (all get this record) | NA | validity_opinions | NA | NA | NA | fk to nomen nudum id in dictionaries.nomenclatural_statuses | permid of name_opinions record with oldpbdbid = child_spelling_no | NA |
|''| != `original spelling` ? add additional record | NA | name_opinions | linguistic | reason from namechange_reasons record that is closest match to spelling_reason (use "rank change" = "rerank", "reassignment" = "assignment") | NA | NA | permid of name_opinions record with oldpbdbid = child_spelling_no | permid of name_opinions record with oldpbdbid = child_no|
|`nomen vanum` | (all get this record) | NA | validity_opinions | NA | NA | NA | fk to nomen vanum id in dictionaries.nomenclatural_statuses | permid of name_opinions record with oldpbdbid = child_spelling_no | NA |
|''| != `original spelling` ? add additional record | NA | name_opinions | linguistic | reason from namechange_reasons record that is closest match to spelling_reason (use "rank change" = "rerank", "reassignment" = "assignment") | NA | NA | permid of name_opinions record with oldpbdbid = child_spelling_no | permid of name_opinions record with oldpbdbid = child_no|
|`nomen dubium` | (all get this record) | NA | validity_opinions | NA | NA | NA | fk to nomen dubium id in dictionaries.nomenclatural_statuses | permid of name_opinions record with oldpbdbid = child_spelling_no | NA |
|''| != `original spelling` ? add additional record | NA | name_opinions | linguistic | reason from namechange_reasons record that is closest match to spelling_reason (use "rank change" = "rerank", "reassignment" = "assignment") | NA | NA | permid of name_opinions record with oldpbdbid = child_spelling_no | permid of name_opinions record with oldpbdbid = child_no|














