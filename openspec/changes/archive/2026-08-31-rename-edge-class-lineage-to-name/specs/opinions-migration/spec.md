## RENAMED Requirements

- FROM: `### Requirement: One universal crosswalk determines the lineage backfill reason for every disposition`
- TO: `### Requirement: One universal crosswalk determines the name backfill reason for every disposition`

- FROM: `### Requirement: The primary disposition and the lineage backfill are resolved and skipped independently`
- TO: `### Requirement: The primary disposition and the name backfill are resolved and skipped independently`

- FROM: `### Requirement: Mistagged original-spelling rows are a named exception to the no-lineage-edge default`
- TO: `### Requirement: Mistagged original-spelling rows are a named exception to the no-name-edge default`

## MODIFIED Requirements

### Requirement: One universal crosswalk determines the name backfill reason for every disposition
Independent of `status` and of which primary disposition applies, `spelling_reason` SHALL determine whether
a second, independent `name_opinions` name edge (`edge_class = 'name'`) is required, and which reason token
it carries, from exactly this table — the same table for every status:

| spelling_reason | name reason token |
|---|---|
| original spelling | (no name edge; see the mistagged-original-spelling exception below) |
| correction | correction |
| rank change | reranked |
| recombination | recombination |
| misspelling | misspelling |
| reassignment | assignment |

When required, the name edge SHALL have `subject_permid = permid(child_spelling_no)` and `target_permid
= permid(child_no)`.

#### Scenario: Recombination produces a name edge regardless of status
- **WHEN** a row has `spelling_reason = 'recombination'`, whether its `status` is `belongs to`,
  `subjective synonym of`, or `nomen dubium`
- **THEN** a `name_opinions` name edge is written with `reason = 'recombination'`, `subject_permid =
  permid(child_spelling_no)`, `target_permid = permid(child_no)`

#### Scenario: Original spelling produces no name edge by default
- **WHEN** a row has `spelling_reason = 'original spelling'`
- **THEN** no name edge is written for it, unless the row falls under the mistagged-original-spelling
  exception

#### Scenario: Every backfill edge carries the name edge class
- **WHEN** any row's crosswalk backfill edge is written to `name_opinions`
- **THEN** its `edge_class` is `'name'`, matching the `edge_class` of its reason token in
  `dictionaries.namechange_reasons`, and never the retired `'lineage'` token

### Requirement: The primary disposition and the name backfill are resolved and skipped independently
For any row requiring both a primary-disposition output and a name backfill edge, the two outputs SHALL
be resolved and, if necessary, skipped independently. A failure to resolve or write one output SHALL NOT
prevent the other from being written.

#### Scenario: Name edge still written when the primary disposition is skipped
- **WHEN** a row's primary-disposition output is skipped (for example, an unresolvable `parent_spelling_no`)
  but its name-edge fields all resolve
- **THEN** the name edge is still written

#### Scenario: Primary disposition still written when the name edge is skipped
- **WHEN** a row's name-edge output is skipped (for example, `child_no` is unresolvable) but its
  primary-disposition fields all resolve
- **THEN** the primary-disposition output is still written

### Requirement: misspelling of has no primary disposition and targets parent_spelling_no
`status = 'misspelling of'` SHALL NOT produce an `assignment_opinions`, concept-class `name_opinions`, or
`validity_opinions` row. It SHALL produce only a `name_opinions` name edge, with reason
`historical misspelling` (not the generic `misspelling` token from the universal crosswalk, since this
status's entire content is a formally published misspelling claim rather than one noticed incidentally
while entering some other opinion), and with `target_permid = permid(parent_spelling_no)` — the specific
correct spelling this opinion asserts `child_spelling_no` is a misspelling of, which differs from `child_no`
on 104 of the 875 rows (live-confirmed), not `permid(child_no)`.

#### Scenario: Misspelling of produces only a name edge, targeting parent_spelling_no
- **WHEN** a row has `status = 'misspelling of'`
- **THEN** the only output written is a `name_opinions` name edge with `reason = 'historical
  misspelling'`, `subject_permid = permid(child_spelling_no)`, `target_permid = permid(parent_spelling_no)`

#### Scenario: A misspelling-of row asserting no spelling deviation is skipped
- **WHEN** a `misspelling of` row has `child_spelling_no == parent_spelling_no`
- **THEN** no name edge is written for it, and the row is logged as a skip (it asserts no actual spelling
  deviation)

### Requirement: nomen oblitum's disposition is chosen per row, not per pair
`status = 'nomen oblitum'` SHALL branch its primary disposition per row on `parent_spelling_no`: when
`parent_spelling_no != 0` (targeted), the row SHALL produce a concept-class `name_opinions` edge (reason
`nomen oblitum`, `subject_permid = permid(child_spelling_no)`, `target_permid =
permid(parent_spelling_no)`); when `parent_spelling_no = 0` (untargeted), the row SHALL produce a
`validity_opinions` row (`nomenclatural_status_id` resolving to `nomen oblitum`). This branch SHALL be
independent of whether the row also requires a name backfill edge under the universal crosswalk.

#### Scenario: Targeted nomen oblitum folds into a concept edge
- **WHEN** a `nomen oblitum` row has `parent_spelling_no != 0`
- **THEN** a concept-class `name_opinions` edge is written with `reason = 'nomen oblitum'` and `target_permid
  = permid(parent_spelling_no)`

#### Scenario: Untargeted nomen oblitum produces validity testimony
- **WHEN** a `nomen oblitum` row has `parent_spelling_no = 0`
- **THEN** a `validity_opinions` row is written with `nomenclatural_status_id` resolving to `nomen oblitum`

#### Scenario: A targeted nomen oblitum row still receives its name backfill
- **WHEN** a `nomen oblitum` row has `parent_spelling_no != 0` and `spelling_reason = 'recombination'`
- **THEN** both the concept-class edge and a separate name edge (`reason = 'recombination'`) are written
  for the same row

### Requirement: Mistagged original-spelling rows are a named exception to the no-name-edge default
The migration SHALL still write a name backfill edge for a row in exactly three pairs — `belongs to`,
`replaced by`, and `subjective synonym of`, each paired with `spelling_reason = 'original spelling'` — whose
`child_spelling_no` differs from its `child_no`, as a named exception to the universal crosswalk's default
of "no name edge for original spelling." The name reason token for these rows SHALL be resolved per-row (from
the pre-computed `mistagged-original-spelling.csv` worklist for the `belongs to` pair, or from the specific
confirmed instances for the other two pairs), not from the universal crosswalk table, since `spelling_reason`
itself is known to be mistagged on these rows. A matching row absent from the worklist SHALL be
skipped-and-logged, never silently dropped.

#### Scenario: A mistagged original-spelling row still gets a name edge
- **WHEN** a row has `status` in (`belongs to`, `replaced by`, `subjective synonym of`), `spelling_reason =
  'original spelling'`, `child_spelling_no != child_no`, and is present in the worklist
- **THEN** a name edge is written for it despite `spelling_reason = 'original spelling'`, using its
  per-row-resolved reason token rather than the universal crosswalk

#### Scenario: The exception does not extend to other pairs
- **WHEN** a row has `spelling_reason = 'original spelling'` and `child_spelling_no != child_no`, but its
  `status` is not one of the three named pairs
- **THEN** this requirement does not apply to it (no name edge is required by this exception)

### Requirement: Self-referential edges are never written
The migration SHALL NOT write any output whose `subject_permid` would equal its `target_permid` (concept or
name edges) or its `containing_permid` (assignment edges). Such rows SHALL be skipped and logged,
independently for each output type, rather than raising a database constraint violation at write time.

#### Scenario: Self-referential assignment is skipped
- **WHEN** a `belongs to` row has `child_spelling_no == parent_spelling_no`
- **THEN** no `assignment_opinions` row is written for it, and it is logged as a skip

#### Scenario: Self-referential name edge is skipped independently of the primary disposition
- **WHEN** a row has `child_spelling_no == child_no` despite a `spelling_reason` other than
  `original spelling`
- **THEN** no name edge is written for it, regardless of whether its primary-disposition output is written

### Requirement: Every source row is accounted for and reconciliation is reported
The migration SHALL account for every source row: for each independent output type a pair can produce
(primary disposition, name backfill), rows written plus rows skipped-with-a-logged-reason SHALL equal
source rows read for that pair — no row silently dropped from either count. A row SHALL NOT be silently dropped from either count. The migration SHALL emit, on each run,
a run-summary output file reporting these per-output-type counts and whether the invariant held, and an
anomaly ledger in CSV form (columns `opinion_no,script,target_table,severity,issue,description`) recording
every skip and warning. The run summary's output-type label for the crosswalk backfill SHALL be `name`,
matching the `edge_class` the rows carry.

#### Scenario: Counts reconcile for a dual-output pair
- **WHEN** a pair producing both a primary-disposition output and a name backfill has finished processing
  its source rows
- **THEN** written-plus-skipped equals source-rows-read for the primary-disposition output, and separately,
  written-plus-skipped equals source-rows-read for the name backfill output

#### Scenario: Each run leaves an anomaly ledger and a run summary
- **WHEN** the migration finishes a run
- **THEN** it has written an anomaly CSV (with the `opinion_no,script,target_table,severity,issue,description`
  columns) and a run-summary file reporting per-output-type written/skipped counts and the reconciliation
  result, with the crosswalk backfill reported under the `name` output-type label
