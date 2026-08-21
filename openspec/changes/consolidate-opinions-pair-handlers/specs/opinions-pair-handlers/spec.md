## Purpose

Defines the target rule set governing how every legacy `opinions` `(status, spelling_reason)` pair maps
to `assignment_opinions` / `name_opinions` / `validity_opinions` output — the three canonical
dispositions, the universal spelling-reason-to-lineage crosswalk, and the small, named set of exceptions
that fall outside them.

## ADDED Requirements

### Requirement: Every pair resolves to exactly one primary disposition or a named structural exception
A legacy `opinions` row's `status` SHALL determine its primary disposition from a closed set of three —
**assignment** (`assignment_opinions`), **concept** (a `name_opinions` edge with `edge_class = 'concept'`),
or **validity** (`validity_opinions`) — except for the two statuses named as structural exceptions
(`misspelling of`, which has no primary disposition, and `nomen oblitum`, whose disposition is chosen
per row). No other status SHALL be treated as ambiguous or left to fall through to a default.

#### Scenario: belongs to resolves to assignment
- **WHEN** a row has `status = 'belongs to'`
- **THEN** its primary disposition is assignment, written to `assignment_opinions`

#### Scenario: subjective synonym of resolves to concept
- **WHEN** a row has `status = 'subjective synonym of'`
- **THEN** its primary disposition is concept, written to `name_opinions` with `edge_class = 'concept'`

#### Scenario: nomen dubium resolves to validity
- **WHEN** a row has `status = 'nomen dubium'`
- **THEN** its primary disposition is validity, written to `validity_opinions`

#### Scenario: No status is left unmapped
- **WHEN** any `status` value present in the legacy `opinions` table is considered
- **THEN** it is accounted for by exactly one of: an assignment mapping, a concept mapping, a validity
  mapping, or one of the two named structural exceptions — never silently ignored

### Requirement: Assignment disposition parameters are fixed and status-independent within `belongs to`
For the assignment disposition, `subject_permid` SHALL resolve from `child_spelling_no` and
`containing_permid` SHALL resolve from `parent_spelling_no`. These parameters do not vary by
`spelling_reason` — every `belongs to` pair uses the same two fields for the same two roles.

#### Scenario: Standard assignment write
- **WHEN** a `belongs to` row has a resolvable `child_spelling_no` and a nonzero, resolvable
  `parent_spelling_no`
- **THEN** an `assignment_opinions` row is written with `subject_permid = permid(child_spelling_no)` and
  `containing_permid = permid(parent_spelling_no)`

### Requirement: A rootless assignment is an asserted claim, not a skip
`parent_spelling_no = 0` on a `belongs to` row SHALL be treated as Classic's own assertion that the
subject has no containing taxon, and written with `containing_permid = NULL` — not skipped. An
unresolvable, nonzero `parent_spelling_no` (no matching migrated name) SHALL instead be skipped and
logged; it SHALL NOT be written as `NULL`, so that `containing_permid IS NULL` in the output
unambiguously means "Classic asserted none."

#### Scenario: Asserted rootless row is written with a NULL containing_permid
- **WHEN** a `belongs to` row has `parent_spelling_no = 0`
- **THEN** an `assignment_opinions` row is written with `containing_permid = NULL`, logged as a warning,
  not a skip

#### Scenario: Unresolvable parent_spelling_no is skipped, not written as NULL
- **WHEN** a `belongs to` row has a nonzero `parent_spelling_no` with no corresponding migrated name
- **THEN** no `assignment_opinions` row is written for it, and the row is logged as a skip

### Requirement: Concept disposition parameters are determined solely by status
For the concept disposition, `subject_permid` SHALL resolve from `child_spelling_no` and `target_permid`
SHALL resolve from `parent_spelling_no`, for every status in this disposition. The edge's reason token
and `objective` value SHALL be determined solely by `status`, from exactly these four mappings, with no
other source of variation:

| status | reason token | objective |
|---|---|---|
| subjective synonym of | junior synonym | false |
| objective synonym of | junior synonym | true |
| invalid subgroup of | invalid subgroup | NULL |
| replaced by | replaced by | NULL |

#### Scenario: Subjective synonym maps to junior synonym, objective=false
- **WHEN** a row has `status = 'subjective synonym of'`
- **THEN** its concept edge has `reason = 'junior synonym'` and `objective = false`

#### Scenario: Objective synonym maps to junior synonym, objective=true
- **WHEN** a row has `status = 'objective synonym of'`
- **THEN** its concept edge has `reason = 'junior synonym'` and `objective = true`

#### Scenario: Invalid subgroup of maps to its own reason, objective=NULL
- **WHEN** a row has `status = 'invalid subgroup of'`
- **THEN** its concept edge has `reason = 'invalid subgroup'` and `objective = NULL`

#### Scenario: Replaced by maps to its own reason, objective=NULL
- **WHEN** a row has `status = 'replaced by'`
- **THEN** its concept edge has `reason = 'replaced by'` and `objective = NULL`

### Requirement: Validity disposition parameters are determined solely by status
For the validity disposition, `subject_permid` SHALL resolve from `child_spelling_no`; a validity row
carries no target field. The `nomenclatural_status_id` SHALL be determined solely by `status`, from
exactly these three mappings, with no other source of variation:

| status | nomenclatural_status |
|---|---|
| nomen dubium | nomen dubium |
| nomen nudum | nomen nudum |
| nomen vanum | nomen vanum |

#### Scenario: Nomen nudum maps to its own status
- **WHEN** a row has `status = 'nomen nudum'`
- **THEN** a `validity_opinions` row is written with `nomenclatural_status_id` resolving to `nomen nudum`

#### Scenario: Validity rows carry no target
- **WHEN** a row resolves to the validity disposition
- **THEN** the written row has no target-bearing field, regardless of any `parent_no`/`parent_spelling_no`
  present on the source row

### Requirement: One universal crosswalk determines the lineage backfill reason for every disposition
Independent of `status` and of which primary disposition applies, `spelling_reason` SHALL determine
whether a second, independent `name_opinions` lineage edge is required, and which reason token it
carries, from exactly this table — the same table for every status:

| spelling_reason | lineage reason token |
|---|---|
| original spelling | (no lineage edge; see the mistagged-original-spelling exception below) |
| correction | correction |
| rank change | reranked |
| recombination | recombination |
| misspelling | misspelling |
| reassignment | assignment |

When required, the lineage edge SHALL have `subject_permid = permid(child_spelling_no)` and
`target_permid = permid(child_no)`.

#### Scenario: Recombination produces a lineage edge regardless of status
- **WHEN** a row has `spelling_reason = 'recombination'`, whether its `status` is `belongs to`,
  `subjective synonym of`, or `nomen dubium`
- **THEN** a `name_opinions` lineage edge is written with `reason = 'recombination'`,
  `subject_permid = permid(child_spelling_no)`, `target_permid = permid(child_no)`

#### Scenario: Original spelling produces no lineage edge by default
- **WHEN** a row has `spelling_reason = 'original spelling'`
- **THEN** no lineage edge is written for it, unless the row falls under the mistagged-original-spelling
  exception

### Requirement: The primary disposition and the lineage backfill are resolved and skipped independently
For any row requiring both a primary-disposition output and a lineage backfill edge, the two outputs
SHALL be resolved and, if necessary, skipped independently. A failure to resolve or write one output
SHALL NOT prevent the other from being written.

#### Scenario: Lineage edge still written when the primary disposition is skipped
- **WHEN** a row's primary-disposition output is skipped (for example, an unresolvable
  `parent_spelling_no`) but its lineage-edge fields all resolve
- **THEN** the lineage edge is still written

#### Scenario: Primary disposition still written when the lineage edge is skipped
- **WHEN** a row's lineage-edge output is skipped (for example, `child_no` is unresolvable) but its
  primary-disposition fields all resolve
- **THEN** the primary-disposition output is still written

### Requirement: misspelling of has no primary disposition
`status = 'misspelling of'` SHALL NOT produce an `assignment_opinions`, concept-class `name_opinions`, or
`validity_opinions` row. It SHALL produce only a `name_opinions` lineage edge, with reason
`historical misspelling` — not the generic `misspelling` token from the universal crosswalk, since this
status's entire content is a formally published misspelling claim, as opposed to an incidental one
noticed while entering some other opinion.

#### Scenario: Misspelling of produces only a lineage edge
- **WHEN** a row has `status = 'misspelling of'`
- **THEN** the only output written is a `name_opinions` lineage edge with `reason = 'historical
  misspelling'`, `subject_permid = permid(child_spelling_no)`, `target_permid = permid(child_no)`

### Requirement: nomen oblitum's disposition is chosen per row, not per pair
`status = 'nomen oblitum'` SHALL branch its primary disposition per row on `parent_no`: when
`parent_no != 0` (targeted), the row SHALL produce a concept-class `name_opinions` edge (reason
`nomen oblitum`, `subject_permid = permid(child_spelling_no)`, `target_permid =
permid(parent_spelling_no)`); when `parent_no = 0` (untargeted), the row SHALL produce a
`validity_opinions` row (`nomenclatural_status_id` resolving to `nomen oblitum`). This branch SHALL be
independent of whether the row also requires a lineage backfill edge under the universal crosswalk.

#### Scenario: Targeted nomen oblitum folds into a concept edge
- **WHEN** a `nomen oblitum` row has `parent_no != 0`
- **THEN** a concept-class `name_opinions` edge is written with `reason = 'nomen oblitum'`

#### Scenario: Untargeted nomen oblitum produces validity testimony
- **WHEN** a `nomen oblitum` row has `parent_no = 0`
- **THEN** a `validity_opinions` row is written with `nomenclatural_status_id` resolving to
  `nomen oblitum`

#### Scenario: A targeted nomen oblitum row still receives its lineage backfill
- **WHEN** a `nomen oblitum` row has `parent_no != 0` and `spelling_reason = 'recombination'`
- **THEN** both the concept-class edge and a separate lineage edge (`reason = 'recombination'`) are
  written for the same row

### Requirement: Mistagged original-spelling rows are a named exception to the no-lineage-edge default
For exactly three pairs — `belongs to`, `replaced by`, and `subjective synonym of`, each paired with
`spelling_reason = 'original spelling'` — a row whose `child_spelling_no` differs from its `child_no`
SHALL still receive a lineage backfill edge, as a named exception to the universal crosswalk's default of
"no lineage edge for original spelling." The lineage reason token for these rows SHALL be resolved
per-row (from the pre-computed worklist for the `belongs to` pair, or from the specific confirmed instance
for the other two pairs), not from the universal crosswalk table, since `spelling_reason` itself is known
to be mistagged on these rows.

#### Scenario: A mistagged original-spelling row still gets a lineage edge
- **WHEN** a row has `status` in (`belongs to`, `replaced by`, `subjective synonym of`),
  `spelling_reason = 'original spelling'`, and `child_spelling_no != child_no`
- **THEN** a lineage edge is written for it despite `spelling_reason = 'original spelling'`, using a
  per-row-resolved reason token rather than the universal crosswalk

#### Scenario: The exception does not extend to other pairs
- **WHEN** a row has `spelling_reason = 'original spelling'` and `child_spelling_no != child_no`, but its
  `status` is not one of the three named pairs
- **THEN** this requirement does not apply to it (no lineage edge is required by this exception)

### Requirement: Self-referential edges are never written
Any output whose `subject_permid` would equal its `target_permid` (concept or lineage edges) or its
`containing_permid` (assignment edges) SHALL NOT be written. Such rows SHALL be skipped and logged,
independently for each output type, rather than raising a database constraint violation at write time.

#### Scenario: Self-referential assignment is skipped
- **WHEN** a `belongs to` row has `child_spelling_no == parent_spelling_no`
- **THEN** no `assignment_opinions` row is written for it, and it is logged as a skip

#### Scenario: Self-referential lineage edge is skipped independently of the primary disposition
- **WHEN** a row has `child_spelling_no == child_no` despite a `spelling_reason` other than
  `original spelling`
- **THEN** no lineage edge is written for it, regardless of whether its primary-disposition output is
  written

### Requirement: Every source row is accounted for
For each independent output type a pair can produce (primary disposition, lineage backfill), the number
of rows written plus the number of rows skipped-with-a-logged-reason SHALL equal the number of source
rows read for that pair. A row SHALL NOT be silently dropped from either count.

#### Scenario: Counts reconcile for a dual-output pair
- **WHEN** a pair producing both a primary-disposition output and a lineage backfill has finished
  processing its source rows
- **THEN** written-plus-skipped equals source-rows-read for the primary-disposition output, and
  separately, written-plus-skipped equals source-rows-read for the lineage backfill output
