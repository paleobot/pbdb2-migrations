## ADDED Requirements

### Requirement: Read the in-scope opinions subset from MariaDB
The script SHALL read from the MariaDB `opinions` table only the rows matching `status = 'belongs to' AND spelling_reason = 'original spelling'` (743,712 rows). Required columns: `child_spelling_no`, `parent_spelling_no`, `basis`, `pubyr`, `ref_has_opinion`, `reference_no`, `authorizer_no`, `enterer_no`, and the author fields (`author1last`, `author2last`, `otherauthors`) used to build attribution. Opinions with any other `status` or `spelling_reason` SHALL NOT be read; they are out of scope for this slice.

#### Scenario: Scoped extraction
- **WHEN** the migration script executes the source query
- **THEN** exactly the 743,712 `belongs to` + `original spelling` rows are streamed and a starting in-scope count is logged

#### Scenario: Non-original-spelling belongs-to is excluded
- **WHEN** a `belongs to` opinion has `spelling_reason = 'recombination'`
- **THEN** the script does not read or migrate it (deferred to a later slice)

#### Scenario: Streaming, not buffering
- **WHEN** the source query executes against the in-scope rows
- **THEN** rows are processed in streaming fashion and the source result set is not held entirely in memory


### Requirement: Preload name identities from name_opinions
The script SHALL preload an in-memory Map from `name_opinions.oldpbdb_taxon_no` (current heads, `succeeded_by_id IS NULL`) to that row's `permid`. This Map resolves both `subject_permid` and `containing_permid`. It relies on the original-only invariant: `oldpbdb_taxon_no` is carried only by root/original rows, where `permid` and `subject_permid` are identically the same value, so a lookup by `oldpbdb_taxon_no` is unambiguous.

#### Scenario: Map resolves a spelling number to its name permid
- **WHEN** `name_opinions` has a row with `oldpbdb_taxon_no = 43695` and `permid = P`
- **THEN** the Map returns `P` for key `43695`

#### Scenario: Only current heads are loaded
- **WHEN** a `name_opinions` row has been re-versioned
- **THEN** only the row with `succeeded_by_id IS NULL` is loaded into the Map

#### Scenario: Unknown spelling number is absent
- **WHEN** a `child_spelling_no` or `parent_spelling_no` has no `name_opinions` row
- **THEN** the Map returns no value for that key (driving a skip, per the skip requirement)


### Requirement: Emit one assignment_opinion per resolvable in-scope row
For every in-scope `opinions` row that resolves cleanly, the script SHALL insert exactly one `assignment_opinions` row. It SHALL set: `subject_permid` from the Map keyed by `child_spelling_no`; `containing_permid` from the Map keyed by `parent_spelling_no`; `questioned = false`; `removed = false`; and a fresh minted `permid`.

#### Scenario: One assignment per resolvable row
- **WHEN** all resolvable in-scope rows are migrated
- **THEN** 743,381 `assignment_opinions` rows are inserted (743,712 in-scope minus 331 skips)

#### Scenario: questioned defaults to false
- **WHEN** an in-scope row is migrated
- **THEN** its `assignment_opinions` row has `questioned = false` (classic has no source for it)

#### Scenario: Distinct permid per row
- **WHEN** two in-scope rows are migrated
- **THEN** they receive distinct `permid` values (each is a distinct published statement, not a version of the other)


### Requirement: permid is a freshly minted uuidv7
The script SHALL generate a fresh uuidv7 for each `assignment_opinions` row using the project's `uuidv7()` helper. Each classic opinion is its own opinion identity; the script SHALL NOT collapse multiple in-scope opinions on the same taxon into one permid.

#### Scenario: v7 permid accepted
- **WHEN** an `assignment_opinions` row is inserted with a `uuidv7()` permid
- **THEN** it satisfies the version-7 CHECK on `permid`

#### Scenario: Multiple placements on one taxon are separate rows
- **WHEN** a taxon has two in-scope `belongs to` original-spelling opinions from different references
- **THEN** two `assignment_opinions` rows are inserted with distinct `permid` values


### Requirement: Resolve reference_id from the migrated refs
The script SHALL resolve `reference_id` from the migrated `refs` record whose `reference.legacyIDs.oldpbdbID` equals the source `reference_no` (current head). A row whose `reference_no` does not resolve SHALL be skipped and logged (per the skip requirement).

#### Scenario: Reference resolves
- **WHEN** an in-scope row has `reference_no = 3381` and a migrated ref carries `oldpbdbID = '3381'`
- **THEN** `reference_id` is that ref's `id`

#### Scenario: Unresolvable reference is skipped
- **WHEN** an in-scope row has `reference_no = 42348`, which exists in no migrated ref (opinion_no 422326)
- **THEN** no `assignment_opinions` row is inserted and the script logs the `opinion_no` and `reference_no`


### Requirement: Map basis to the evidence boolean
The script SHALL set `evidence = true` when the source `basis = 'stated with evidence'`, and `evidence = false` for every other value including NULL.

#### Scenario: Stated with evidence
- **WHEN** an in-scope row has `basis = 'stated with evidence'`
- **THEN** `evidence = true`

#### Scenario: Everything else is false
- **WHEN** an in-scope row has `basis = 'stated without evidence'`, `'implied'`, `'second hand'`, or NULL
- **THEN** `evidence = false`


### Requirement: Set publication_year and attribution as second-hand fields gated on ref_has_opinion
The script SHALL treat `publication_year` and `attribution` as second-hand overrides driven by the same switch. When `ref_has_opinion = 'YES'` (first-hand: the reference is the source), `publication_year` SHALL be NULL and `attribution` SHALL be omitted — `derive_taxa()` reads the year from the reference via `COALESCE(publication_year, ref.publicationYear)`. When `ref_has_opinion IS NULL` (second-hand: attributed to an earlier author), `publication_year` SHALL be `pubyr` parsed as an integer and `attribution` SHALL be a jsonb object built per `payloadSchemas/opinionAttribution.schema.js` from `author1last`/`author2last`/`otherauthors` using the `buildCitationFromFields`/`buildDescriptorsFromFields` helpers from `migrate-authorities.js` with `publishedInReference = false`.

Second-hand rows with no discernible authorship (`author1last` blank/NULL — 215 in-scope rows, all with blank author2last/otherauthors/pubyr) SHALL use the established "authority unknown" sentinel attribution `{ citation: 'authority unknown', descriptors: [], publishedInReference: false }` (mirroring the authorities scenario ④ convention), rather than an empty-citation object. These records SHALL be exported to `unknown-authority-assignment-opinions.csv` for later domain-expert review. (Of the 215, one falls in the skip set and is not inserted, leaving 214 sentinel rows.)

#### Scenario: First-hand opinion defers year to the reference
- **WHEN** an in-scope row has `ref_has_opinion = 'YES'`
- **THEN** `publication_year IS NULL` and `attribution` is omitted

#### Scenario: Second-hand opinion overrides with the attributed year
- **WHEN** an in-scope row has `ref_has_opinion IS NULL` and `pubyr = '1868'`
- **THEN** `publication_year = 1868` and `attribution` carries the parsed author citation

#### Scenario: No in-scope row loses ranking to NULLS LAST
- **WHEN** the year rule is applied across the in-scope set
- **THEN** every row either has a `publication_year` or resolves a reference year, so no row's derive-time `yr` is NULL solely due to this rule (verified: 0 in-scope rows have a `pubyr` with no resolvable reference year)

#### Scenario: Unknown-authorship second-hand row uses the sentinel
- **WHEN** a second-hand in-scope row has a blank/NULL `author1last` (e.g. opinion_no 78348)
- **THEN** `attribution = { citation: 'authority unknown', descriptors: [], publishedInReference: false }` and the row is written to `unknown-authority-assignment-opinions.csv`


### Requirement: Resolve person FKs with zero-sentinel fallback
The script SHALL use `authorizer_no` and `enterer_no` directly as `persons.id` values (persons were inserted with `id = person_no`). When `authorizer_no = 0` or `enterer_no = 0`, the script SHALL substitute the other field's value; when both are 0, it SHALL fall back to `person_no = 1`. In scope no row exercises the fallback, but it SHALL be present.

#### Scenario: Both populated
- **WHEN** an in-scope row has `authorizer_no = 4`, `enterer_no = 4`
- **THEN** `authorizer_person_id = 4` and `enterer_person_id = 4`

#### Scenario: Zero-sentinel fallback available
- **WHEN** a row has `authorizer_no = 0`, `enterer_no = 7`
- **THEN** both person FKs resolve to 7


### Requirement: Skip and log rows that cannot satisfy the target constraints
The script SHALL skip and log any in-scope row that cannot produce a valid `assignment_opinions` row, in these disjoint buckets: (a) `parent_spelling_no` is 0/NULL — 322 rows; (b) `parent_spelling_no` does not resolve in the name Map — 6 rows; (c) `reference_no` does not resolve — 1 row; (d) `child_spelling_no` does not resolve — 1 row; (e) `child_spelling_no = parent_spelling_no`, which would violate `assignment_not_self` — 1 row. Total: 331 rows. Each skip SHALL log the `opinion_no` and the bucket.

#### Scenario: Zero-parent belongs-to is skipped
- **WHEN** an in-scope row has `parent_spelling_no = 0`
- **THEN** no `assignment_opinions` row is inserted and the script logs the `opinion_no` with reason `parent_spelling_zero`

#### Scenario: Self-referential edge is skipped, not inserted
- **WHEN** an in-scope row has `child_spelling_no = parent_spelling_no`
- **THEN** the script skips it (logging `self_reference`) rather than attempting an insert that `assignment_not_self` would reject

#### Scenario: Orphan parent and unresolved child are skipped
- **WHEN** a `parent_spelling_no` or `child_spelling_no` has no `name_opinions` row
- **THEN** the row is skipped and logged with the corresponding bucket


### Requirement: Validate each attribution payload before any DB write
Every constructed `attribution` jsonb SHALL be validated against `payloadSchemas/opinionAttribution.schema.js` during the in-memory build phase, before any DB write. On validation failure the script SHALL log the offending `opinion_no` and failing payload and exit non-zero, needing no cleanup because no insert has happened.

#### Scenario: Valid attribution
- **WHEN** a second-hand attribution object is built from the author fields
- **THEN** ajv validation passes and the row is retained for insert

#### Scenario: Invalid attribution aborts before any insert
- **WHEN** a constructed attribution object fails schema validation
- **THEN** the script logs the offending `opinion_no` and payload, exits non-zero, and no rows have been inserted


### Requirement: Bulk insert is transaction-wrapped
The script SHALL wrap the bulk insert of all `assignment_opinions` rows in a single Postgres transaction (`BEGIN` … `COMMIT`). On any failure before `COMMIT`, Postgres SHALL roll back atomically, leaving the table in its pre-run state with no manual cleanup required.

#### Scenario: Successful bulk insert
- **WHEN** all 743,381 rows insert without error
- **THEN** the transaction commits and `assignment_opinions` reflects the inserts

#### Scenario: Mid-insert failure rolls back atomically
- **WHEN** an unexpected error occurs after some rows have been inserted but before `COMMIT`
- **THEN** the transaction rolls back and no migrated rows remain

#### Scenario: Re-run after abort needs no manual cleanup
- **WHEN** a prior run aborted before commit
- **THEN** re-running on the same source data produces the same result without a `TRUNCATE` step


### Requirement: Log counts and enforce the reconciliation invariant
The script SHALL log in-scope rows read, `assignment_opinions` inserted, and skipped rows broken down by bucket, and SHALL assert the reconciliation invariant `inserted + skipped == in-scope`. If the invariant does not hold, the script SHALL abort without committing.

#### Scenario: Reconciliation holds
- **WHEN** the script completes over the current source data
- **THEN** it logs `inserted = 743,381`, `skipped = 331` (322 + 6 + 1 + 1 + 1), and confirms `743,381 + 331 == 743,712`

#### Scenario: Reconciliation failure aborts
- **WHEN** inserted plus skipped does not equal the in-scope count
- **THEN** the script reports the discrepancy and exits non-zero without committing
