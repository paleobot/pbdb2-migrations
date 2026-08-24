 1.0 `status` | 1.0 `spelling_reason` | 2.0 table | 2.0 `edge_class` | 2.0 `reason` | 2.0 `objective` | 2.0 `subject_permid` | 2.0 `target_permid` \ `containing_permid`
---|---|---|---|---|---|---|---
`subjective synonym of`  | (all get this record) | name_opinions | concept | junior synonym | false | permid of name_opinions record with oldpbdbid = child_spelling_no | parent_spelling_no = 0 ? NULL : permid of name_opinions record with oldpbdbid = parent_spelling_no
|''| != `original spelling` ? add additional record | name_opinions | concept | junior synonym | false | permid of name_opinions record with oldpbdbid = child_spelling_no | permid of name_opinions record with oldpbdbid = child_no
`objective synonym of`  | (all get this record) | name_opinions | concept | junior synonym | true |  permid of name_opinions record with oldpbdbid = child_spelling_no | parent_spelling_no = 0 ? NULL : permid of name_opinions record with oldpbdbid = parent_spelling_no
|''| != `original spelling` ? add additional record | name_opinions | concept | junior synonym | false | permid of name_opinions record with oldpbdbid = child_spelling_no | permid of name_opinions record with oldpbdbid = child_no
`replaced by`  | (all get this record) | name_opinions | concept | replaced by | NA |  permid of name_opinions record with oldpbdbid = child_spelling_no | parent_spelling_no = 0 ? NULL : permid of name_opinions record with oldpbdbid = parent_spelling_no
|''| != `original spelling` ? add additional record | name_opinions | concept | junior synonym | false | permid of name_opinions record with oldpbdbid = child_spelling_no | permid of name_opinions record with oldpbdbid = child_no
`invalid subgroup of` | (all get this record) | name_opinions | concept | invalid subgroup | NA |  permid of name_opinions record with oldpbdbid = child_spelling_no | parent_spelling_no = 0 ? NULL : permid of name_opinions record with oldpbdbid = parent_spelling_no
|''| != `original spelling` ? add additional record | name_opinions | concept | junior synonym | false | permid of name_opinions record with oldpbdbid = child_spelling_no | permid of name_opinions record with oldpbdbid = child_no
`nomen oblitum` | (all get this record) | name_opinions | concept | nomen oblitum | NA |  permid of name_opinions record with oldpbdbid = child_spelling_no | parent_spelling_no = 0 ? NULL : permid of name_opinions record with oldpbdbid = parent_spelling_no
|''| != `original spelling` ? add additional record | name_opinions | concept | junior synonym | false | permid of name_opinions record with oldpbdbid = child_spelling_no | permid of name_opinions record with oldpbdbid = child_no
`misspelling of` | (all get this record) | name_opinions | linguistic | historical misspelling | NA |  permid of name_opinions record with oldpbdbid = child_spelling_no | parent_spelling_no = 0 ? NULL : permid of name_opinions record with oldpbdbid = parent_spelling_no
`belongs to` | (all get this record) | assignment_opinions | NA | NA | NA | permid of name_opinions record with oldpbdbid = child_spelling_no | parent_spelling_no = 0 ? NULL : permid of name_opinions record with oldpbdbid = parent_spelling_no 
|''| != `original spelling` ? add additional record | name_opinions | concept | junior synonym | false | permid of name_opinions record with oldpbdbid = child_spelling_no | permid of name_opinions record with oldpbdbid = child_no
`nomen nudum` | (all get this record) | validity_opinions | NA | NA | NA | permid of name_opinions record with oldpbdbid = child_spelling_no | NA |
|''| != `original spelling` ? add additional record | name_opinions | concept | junior synonym | false | permid of name_opinions record with oldpbdbid = child_spelling_no | permid of name_opinions record with oldpbdbid = child_no
`nomen vanum` | (all get this record) | validity_opinions | NA | NA | NA | permid of name_opinions record with oldpbdbid = child_spelling_no | NA |
|''| != `original spelling` ? add additional record | name_opinions | concept | junior synonym | false | permid of name_opinions record with oldpbdbid = child_spelling_no | permid of name_opinions record with oldpbdbid = child_no
`nomen dubium` | (all get this record) | validity_opinions | NA | NA | NA | permid of name_opinions record with oldpbdbid = child_spelling_no | NA |
|''| != `original spelling` ? add additional record | name_opinions | concept | junior synonym | false | permid of name_opinions record with oldpbdbid = child_spelling_no | permid of name_opinions record with oldpbdbid = child_no














