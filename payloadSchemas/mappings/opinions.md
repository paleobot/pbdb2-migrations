# Classic opinions → 2.0 mapping [‡]

 |1.0 `status` | 1.0 `spelling_reason` [†] | 1.0 `parent_spelling_no` | 2.0 table | 2.0 `edge_class` | 2.0 `reason` | 2.0 `objective` | 2.0 `nomenclatural_status_id` | 2.0 `subject_permid` | 2.0 `target_permid` \ `containing_permid`|
|---|---|---|---|---|---|---|---|---|---|
|`subjective synonym of`  | (all get this record) | NA | name_opinions | concept | junior synonym | false | NA | permid of name_opinions record with oldpbdbid = child_spelling_no | parent_spelling_no = 0 ? NULL : permid of name_opinions record with oldpbdbid = parent_spelling_no|
|''| != `original spelling` ? add additional record | NA | name_opinions | linguistic | reason from namechange_reasons record that is closest match to spelling_reason (use "rank change" = "reranked", "reassignment" = "assignment") | false | NA | permid of name_opinions record with oldpbdbid = child_spelling_no | permid of name_opinions record with oldpbdbid = child_no|
|`objective synonym of`  | (all get this record) | NA | name_opinions | concept | junior synonym | true | NA |  permid of name_opinions record with oldpbdbid = child_spelling_no | parent_spelling_no = 0 ? NULL : permid of name_opinions record with oldpbdbid = parent_spelling_no|
|''| != `original spelling` ? add additional record | NA | name_opinions | linguistic | reason from namechange_reasons record that is closest match to spelling_reason (use "rank change" = "reranked", "reassignment" = "assignment") | false | NA | permid of name_opinions record with oldpbdbid = child_spelling_no | permid of name_opinions record with oldpbdbid = child_no|
|`replaced by`  | (all get this record) | NA | name_opinions | concept | replaced by | NA | NA |  permid of name_opinions record with oldpbdbid = child_spelling_no | parent_spelling_no = 0 ? NULL : permid of name_opinions record with oldpbdbid = parent_spelling_no|
|''| != `original spelling` ? add additional record | NA | name_opinions | linguistic | reason from namechange_reasons record that is closest match to spelling_reason (use "rank change" = "reranked", "reassignment" = "assignment") | NA | NA | permid of name_opinions record with oldpbdbid = child_spelling_no | permid of name_opinions record with oldpbdbid = child_no|
|`invalid subgroup of` | (all get this record) | NA | name_opinions | concept | invalid subgroup | NA | NA |  permid of name_opinions record with oldpbdbid = child_spelling_no | parent_spelling_no = 0 ? NULL : permid of name_opinions record with oldpbdbid = parent_spelling_no|
|''| != `original spelling` ? add additional record | NA | name_opinions | linguistic | reason from namechange_reasons record that is closest match to spelling_reason (use "rank change" = "reranked", "reassignment" = "assignment") | NA | NA | permid of name_opinions record with oldpbdbid = child_spelling_no | permid of name_opinions record with oldpbdbid = child_no|
|`nomen oblitum` | (all get this record) | != 0 | name_opinions | concept | nomen oblitum | NA | NA |  permid of name_opinions record with oldpbdbid = child_spelling_no | parent_spelling_no = 0 ? NULL : permid of name_opinions record with oldpbdbid = parent_spelling_no|
|''| != `original spelling` ? add additional record | NA | name_opinions | linguistic | reason from namechange_reasons record that is closest match to spelling_reason (use "rank change" = "reranked", "reassignment" = "assignment") | NA | NA | permid of name_opinions record with oldpbdbid = child_spelling_no | permid of name_opinions record with oldpbdbid = child_no|
|`nomen oblitum` | (all get this record) | = 0 | valdity_opinions | NA | NA | NA | fk to nomen oblitum id in dictionaries.nomenclatural_statuses |  permid of name_opinions record with oldpbdbid = child_spelling_no | parent_spelling_no = 0 ? NULL : permid of name_opinions record with oldpbdbid = parent_spelling_no|
|''| != `original spelling` ? add additional record | NA | name_opinions | linguistic | reason from namechange_reasons record that is closest match to spelling_reason (use "rank change" = "reranked", "reassignment" = "assignment") | NA | NA | permid of name_opinions record with oldpbdbid = child_spelling_no | permid of name_opinions record with oldpbdbid = child_no|
|`misspelling of` | (all get this record) | NA | name_opinions | linguistic | historical misspelling | NA | NA |  permid of name_opinions record with oldpbdbid = child_spelling_no | parent_spelling_no = 0 ? NULL : permid of name_opinions record with oldpbdbid = parent_spelling_no|
|`belongs to` | (all get this record) | NA | assignment_opinions | NA | NA | NA | NA | permid of name_opinions record with oldpbdbid = child_spelling_no | parent_spelling_no = 0 ? NULL : permid of name_opinions record with oldpbdbid = parent_spelling_no| 
|''| != `original spelling` ? add additional record | NA | name_opinions | linguistic | reason from namechange_reasons record that is closest match to spelling_reason (use "rank change" = "reranked", "reassignment" = "assignment") | NA | NA | permid of name_opinions record with oldpbdbid = child_spelling_no | permid of name_opinions record with oldpbdbid = child_no|
|`nomen nudum` | (all get this record) | NA | validity_opinions | NA | NA | NA | fk to nomen nudum id in dictionaries.nomenclatural_statuses | permid of name_opinions record with oldpbdbid = child_spelling_no | NA |
|''| != `original spelling` ? add additional record | NA | name_opinions | linguistic | reason from namechange_reasons record that is closest match to spelling_reason (use "rank change" = "reranked", "reassignment" = "assignment") | NA | NA | permid of name_opinions record with oldpbdbid = child_spelling_no | permid of name_opinions record with oldpbdbid = child_no|
|`nomen vanum` | (all get this record) | NA | validity_opinions | NA | NA | NA | fk to nomen vanum id in dictionaries.nomenclatural_statuses | permid of name_opinions record with oldpbdbid = child_spelling_no | NA |
|''| != `original spelling` ? add additional record | NA | name_opinions | linguistic | reason from namechange_reasons record that is closest match to spelling_reason (use "rank change" = "reranked", "reassignment" = "assignment") | NA | NA | permid of name_opinions record with oldpbdbid = child_spelling_no | permid of name_opinions record with oldpbdbid = child_no|
|`nomen dubium` | (all get this record) | NA | validity_opinions | NA | NA | NA | fk to nomen dubium id in dictionaries.nomenclatural_statuses | permid of name_opinions record with oldpbdbid = child_spelling_no | NA |
|''| != `original spelling` ? add additional record | NA | name_opinions | linguistic | reason from namechange_reasons record that is closest match to spelling_reason (use "rank change" = "reranked", "reassignment" = "assignment") | NA | NA | permid of name_opinions record with oldpbdbid = child_spelling_no | permid of name_opinions record with oldpbdbid = child_no|

## Notes

**[†] Mistagged `original spelling` — a per-`opinion_no` exception, not a rule.**
53 rows are labeled `spelling_reason = 'original spelling'` but nonetheless have
`child_spelling_no ≠ child_no`, so — against the rule above — they *do* carry a lineage
claim. Each is backfilled as one extra `name_opinions` lineage row (`edge_class =
linguistic`, `subject = permid(child_spelling_no)`, `target = permid(child_no)`), with the
reason chosen per row from a curated worklist, since it cannot be derived from `(status,
spelling_reason)`:

| pair | rows | source of the override |
|---|---:|---|
| `belongs to` / `original spelling` | 50 | `mistagged-original-spelling.csv` (repo root, git-tracked) |
| `replaced by` / `original spelling` | 1 | hard-coded (`opinion_no` 955925 → `assignment`) |
| `subjective synonym of` / `original spelling` | 2 | hard-coded (71324 → `reranked`, 912640 → `assignment`) |

The CSV's `inferred_reason` is a human label, translated to a `namechange_reasons` token
before emission: `duplicate-or-homonym → assignment`, `reranked → reranked`,
`recombination → recombination`, `correction → correction`. A row matching the
`child_spelling_no ≠ child_no` condition but absent from the worklist is skipped and logged
as `mislabeled_original_spelling`, never silently dropped. See `migration_exploration/DESIGN.md`
§3 ("The mistagged `original spelling` anomaly").

**[‡] Scope: this table maps *qualifying* opinions only.** It is the rule-based happy
path — every row here becomes a ledger row. It deliberately does **not** enumerate the
"do-not-migrate" cases, which are handled as skip-and-log inside the pair handlers, not as
mappings:

- **Same-taxon self-reference** (`child_no == parent_no`): a taxon asserted as a
  synonym/replacement/subgroup/assignment of itself — meaningless; skipped.
- **`parent_spelling_orphan` / `child_spelling_unresolved`**: the referenced `taxon_no` is
  absent from Classic's own `authorities` table (deleted authority rows) — genuine bad
  data; skipped and flagged for Classic maintainers.
- **Lineage self-reference** (`child_spelling_no == child_no` despite a non-`original
  spelling` `spelling_reason`): no real deviation to record, so no lineage edge is emitted.

Note that **rootless `belongs to`** (`parent_spelling_no = 0` → `containing_permid = NULL`,
row 16) is *not* a skip — it is a real mapping, and Classic's own assertion that the subject
has no container. It is distinct from an unresolvable orphan, which is skipped. See
DESIGN.md §3 for the full skip/anomaly register.
