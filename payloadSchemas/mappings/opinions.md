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

## Behavioral rules

The table above states *what maps to what*; these rules state *how the mapper must behave* — the
constraints a mapping table cannot express. They are the migration's behavioral contract; see
`openspec/changes/create-opinions-migration/specs/opinions-migration/spec.md` for the same rules as
testable scenarios.

1. **Status closure / no fall-through.** Every `status` value present in the source `opinions` table
   resolves to exactly one of: an assignment mapping (`assignment_opinions`), a concept mapping
   (`name_opinions`, `edge_class = concept`), a validity mapping (`validity_opinions`), or one of the two
   named structural exceptions (`misspelling of`, `nomen oblitum`). No status is treated as ambiguous or
   left to a default. `nomen oblitum` is the one status whose primary disposition is chosen **per row**
   (on `parent_spelling_no`), not per pair.

2. **Primary vs. lineage are resolved and skipped independently.** The primary disposition (assignment /
   concept / validity) and the universal lineage backfill (the "additional record" rows, `edge_class =
   linguistic`) are two independent outputs. Each is resolved, and if necessary skipped-and-logged, on its
   own; a failure to resolve or write one SHALL NOT prevent the other from being written.

3. **Self-referential edges are never written.** No output whose `subject_permid` would equal its
   `target_permid` (concept/lineage edges) or its `containing_permid` (assignment edges) is written. Such
   rows are skipped-and-logged (per output type), never allowed to reach the DB constraint. This covers
   both same-taxon assignment (`child_spelling_no == parent_spelling_no`) and lineage self-reference
   (`child_spelling_no == child_no` despite a non-`original spelling` `spelling_reason`).

4. **Rootless is a mapping, not a skip.** `parent_spelling_no = 0` on a `belongs to` row is Classic's own
   assertion that the subject has no container: write the `assignment_opinions` row with `containing_permid
   = NULL` (logged as a warning). A **nonzero** `parent_spelling_no` that resolves to no migrated name is a
   genuine orphan: skip-and-log, never written as `NULL`, so `containing_permid IS NULL` in the output
   unambiguously means "Classic asserted none."

5. **Per-output reconciliation.** For each independent output type a pair can produce (primary disposition,
   lineage backfill), `written + skipped-with-a-logged-reason == source rows read` for that pair. No row is
   silently dropped from either count. Each run emits a run-summary file (per-output written/skipped counts
   and whether the invariant held) and an anomaly ledger CSV
   (`opinion_no,script,target_table,severity,issue,description`) recording every skip and warning.

6. **Why `historical misspelling` for `misspelling of`.** The `misspelling of` lineage edge uses the
   `historical misspelling` reason token, not the generic `misspelling` token from the universal crosswalk:
   this status's *entire content* is a formally published misspelling claim, whereas the crosswalk
   `misspelling` records one noticed incidentally while entering some other opinion. Its lineage target is
   `parent_spelling_no` (the specific correct spelling this opinion asserts) — **not** `child_no` — which
   differs from `child_no` on 104 of the 875 rows (live-confirmed).

7. **Why `nomen oblitum` branches per row.** `nomen oblitum` carries a real target on some rows and none on
   others. When `parent_spelling_no != 0` it is a concept edge (reason `nomen oblitum`, target
   `parent_spelling_no`); when `parent_spelling_no = 0` it is untargeted validity testimony
   (`nomenclatural_status_id → nomen oblitum`). This per-row branch is independent of the lineage backfill.

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
