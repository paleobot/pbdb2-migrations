# synonymy-opinions-migration Specification

## Purpose
Migrate the synonymy (`subjective synonym of` / `objective synonym of`) + `original spelling` subset of the legacy MariaDB `opinions` table into the new PostgreSQL `name_opinions` table as `concept` edges (junior `subject_permid` → senior `target_permid`, `reason_id = 'junior synonym'`, `edge_class = 'concept'`, carrying no identity) — resolving both permids through the already-migrated `name_opinions` root rows, the subjective/objective split via the `objective` boolean, and reference/attribution/year provenance per the second-hand rule — with an explicit five-bucket skip-and-log policy and a counted reconciliation invariant (`inserted + skipped == in-scope`).

## Requirements

### Requirement: Read the in-scope synonymy subset from MariaDB
The script SHALL read from the MariaDB `opinions` table only the rows matching `(status = 'subjective synonym of' OR status = 'objective synonym of') AND spelling_reason = 'original spelling'` (48,839 rows). Required columns: `child_spelling_no`, `parent_spelling_no`, `status`, `basis`, `pubyr`, `ref_has_opinion`, `reference_no`, `authorizer_no`, `enterer_no`, and the author fields (`author1last`, `author2last`, `otherauthors`) used to build attribution. Opinions with any other `status` or `spelling_reason` SHALL NOT be read; they are out of scope for this slice.

#### Scenario: Scoped extraction
- **WHEN** the migration script executes the source query
- **THEN** exactly the 48,839 synonymy + `original spelling` rows are streamed and a starting in-scope count is logged

#### Scenario: Non-original-spelling synonymy is excluded
- **WHEN** a `subjective synonym of` opinion has `spelling_reason = 'recombination'`
- **THEN** the script does not read or migrate it (deferred to a later slice)

#### Scenario: Belongs-to is excluded
- **WHEN** an opinion has `status = 'belongs to'`
- **THEN** the script does not read it (that family is the assignment-opinions slice)

#### Scenario: Streaming, not buffering
- **WHEN** the source query executes against the in-scope rows
- **THEN** rows are processed in streaming fashion and the source result set is not held entirely in memory


### Requirement: Preload name identities from name_opinions
The script SHALL preload an in-memory Map from `name_opinions.oldpbdb_taxon_no` (current heads, `succeeded_by_id IS NULL`, `oldpbdb_taxon_no IS NOT NULL`) to that row's `permid`. This Map resolves both `subject_permid` and `target_permid`. It relies on the original-only invariant: `oldpbdb_taxon_no` is carried only by root/original rows, where `permid` and `subject_permid` are identically the same value, so a lookup by `oldpbdb_taxon_no` is unambiguous.

#### Scenario: Map resolves a spelling number to its name permid
- **WHEN** `name_opinions` has a row with `oldpbdb_taxon_no = 43695` and `permid = P`
- **THEN** the Map returns `P` for key `43695`

#### Scenario: Only current heads are loaded
- **WHEN** a `name_opinions` row has been re-versioned
- **THEN** only the row with `succeeded_by_id IS NULL` is loaded into the Map

#### Scenario: Concept rows written by this slice never enter the Map
- **WHEN** this migration inserts a concept row with `oldpbdb_taxon_no = NULL`
- **THEN** it is excluded from the Map (which requires `oldpbdb_taxon_no IS NOT NULL`), so it cannot be resolved as a subject/target

#### Scenario: Unknown spelling number is absent
- **WHEN** a `child_spelling_no` or `parent_spelling_no` has no `name_opinions` root row
- **THEN** the Map returns no value for that key (driving a skip, per the skip requirement)


### Requirement: Emit one concept name_opinion per resolvable in-scope row
For every in-scope `opinions` row that resolves cleanly, the script SHALL insert exactly one `name_opinions` row shaped as a `concept` edge. It SHALL set: `subject_permid` from the Map keyed by `child_spelling_no`; `target_permid` from the Map keyed by `parent_spelling_no`; `reason_id` = the id of `'junior synonym'`; `edge_class = 'concept'`; `new_name`, `rank_id`, `authority_id`, and `oldpbdb_taxon_no` all NULL; `removed = false`; and a fresh minted `permid`.

#### Scenario: One concept edge per resolvable row
- **WHEN** all resolvable in-scope rows are migrated
- **THEN** 48,822 `name_opinions` concept rows are inserted (48,839 in-scope minus 17 skips)

#### Scenario: Concept shape carries no identity
- **WHEN** an in-scope row is migrated
- **THEN** its `name_opinions` row has `new_name IS NULL`, `rank_id IS NULL`, and `authority_id IS NULL`, satisfying the `concept` branch of `name_opinion_shape`

#### Scenario: oldpbdb_taxon_no stays original-only
- **WHEN** a concept row is inserted
- **THEN** its `oldpbdb_taxon_no IS NULL`, preserving the invariant that only root/original rows carry it

#### Scenario: reason and edge_class satisfy the composite FK
- **WHEN** a concept row is inserted with `reason_id` = the `'junior synonym'` id and `edge_class = 'concept'`
- **THEN** the pair satisfies the `(reason_id, edge_class)` FK to `namechange_reasons`


### Requirement: Map status to the objective boolean
The script SHALL set `objective = true` when the source `status = 'objective synonym of'`, and `objective = false` when `status = 'subjective synonym of'`. The single reason token `'junior synonym'` is used for both; the objective/subjective distinction is carried solely by this boolean.

#### Scenario: Objective synonym
- **WHEN** an in-scope row has `status = 'objective synonym of'`
- **THEN** `objective = true` and `reason_id` = the `'junior synonym'` id

#### Scenario: Subjective synonym
- **WHEN** an in-scope row has `status = 'subjective synonym of'`
- **THEN** `objective = false` and `reason_id` = the `'junior synonym'` id


### Requirement: permid is a freshly minted uuidv7
The script SHALL generate a fresh uuidv7 for each `name_opinions` row using the project's `uuidv7()` helper. Each classic opinion is its own opinion identity; the script SHALL NOT collapse multiple in-scope opinions on the same taxon into one permid.

#### Scenario: v7 permid accepted
- **WHEN** a `name_opinions` row is inserted with a `uuidv7()` permid
- **THEN** it satisfies the version-7 CHECK on `permid`

#### Scenario: Multiple synonymies on one taxon are separate rows
- **WHEN** a taxon has two in-scope synonymy original-spelling opinions from different references
- **THEN** two `name_opinions` rows are inserted with distinct `permid` values


### Requirement: Resolve reference_id from the migrated refs
The script SHALL resolve `reference_id` from the migrated `refs` record whose `reference.legacyIDs.oldpbdbID` equals the source `reference_no` (current head). A row whose `reference_no` does not resolve SHALL be skipped and logged (per the skip requirement).

#### Scenario: Reference resolves
- **WHEN** an in-scope row has `reference_no = 3381` and a migrated ref carries `oldpbdbID = '3381'`
- **THEN** `reference_id` is that ref's `id`

#### Scenario: Unresolvable reference is skipped
- **WHEN** an in-scope row has `reference_no = 42348`, which exists in no migrated ref (e.g. opinion_no 422325)
- **THEN** no `name_opinions` row is inserted and the script logs the `opinion_no` and `reference_no`


### Requirement: Map basis to the evidence boolean
The script SHALL set `evidence = true` when the source `basis = 'stated with evidence'`, and `evidence = false` for every other value including NULL.

#### Scenario: Stated with evidence
- **WHEN** an in-scope row has `basis = 'stated with evidence'`
- **THEN** `evidence = true`

#### Scenario: Everything else is false
- **WHEN** an in-scope row has `basis = 'stated without evidence'`, `'implied'`, `'second hand'`, or NULL
- **THEN** `evidence = false`


### Requirement: Set publication_year and attribution as second-hand fields gated on ref_has_opinion
The script SHALL treat `publication_year` and `attribution` as second-hand overrides driven by the same switch. When `ref_has_opinion = 'YES'` (first-hand: the reference is the source), `publication_year` SHALL be NULL and `attribution` SHALL be omitted — `derive_taxa()` reads the year from the reference via `COALESCE(publication_year, ref.publicationYear)`. When `ref_has_opinion IS NULL` (second-hand: attributed to an earlier author), `publication_year` SHALL be `pubyr` parsed as an integer and `attribution` SHALL be a jsonb object built per `payloadSchemas/opinionAttribution.schema.js` from `author1last`/`author2last`/`otherauthors` using the `buildCitationFromFields`/`buildDescriptorsFromFields` helpers from `src/lib/authorities-builders.js` with `publishedInReference = false`.

Second-hand rows with no discernible authorship (`author1last` blank/NULL — 7 in-scope rows) SHALL use the established "authority unknown" sentinel attribution `{ citation: 'authority unknown', descriptors: [], publishedInReference: false }` (mirroring the authorities scenario ④ convention), rather than an empty-citation object.

The helper citation above previously named `migrate-authorities.js`. It is corrected to
`src/lib/authorities-builders.js`, which is where the implementation reads them from
(`src/lib/attribution.js`) and where they are now solely defined — the relocated
`src/authorities-migration/migrate-authorities.js` imports them rather than declaring them. This is a
source-of-guarantee citation, so `migration-script-layout`'s citation-form rule requires it to be
path-qualified to the file that actually holds the helpers.

#### Scenario: First-hand opinion defers year to the reference
- **WHEN** an in-scope row has `ref_has_opinion = 'YES'`
- **THEN** `publication_year IS NULL` and `attribution` is omitted

#### Scenario: Second-hand opinion overrides with the attributed year
- **WHEN** an in-scope row has `ref_has_opinion IS NULL` and `pubyr = '1868'`
- **THEN** `publication_year = 1868` and `attribution` carries the parsed author citation

#### Scenario: No in-scope row loses ranking to NULLS LAST
- **WHEN** the year rule is applied across the in-scope set
- **THEN** every retained row either has a `publication_year` or resolves a reference year, so no row's derive-time `yr` is NULL solely due to this rule (verified: 0 retained rows have `COALESCE(publication_year, ref.publicationYear)` NULL)

#### Scenario: Unknown-authorship second-hand row uses the sentinel
- **WHEN** a second-hand in-scope row has a blank/NULL `author1last`
- **THEN** `attribution = { citation: 'authority unknown', descriptors: [], publishedInReference: false }`

#### Scenario: Helpers resolve to the shared library
- **WHEN** a reader follows this requirement to the implementation of `buildCitationFromFields` and `buildDescriptorsFromFields`
- **THEN** they arrive at `src/lib/authorities-builders.js`, the single definition shared by the authorities and opinions migrations, rather than at a migration entry point


### Requirement: Resolve person FKs with zero-sentinel fallback
The script SHALL use `authorizer_no` and `enterer_no` directly as `persons.id` values (persons were inserted with `id = person_no`). When `authorizer_no = 0` or `enterer_no = 0`, the script SHALL substitute the other field's value; when both are 0, it SHALL fall back to `person_no = 1`. In scope no row exercises the fallback, but it SHALL be present.

#### Scenario: Both populated
- **WHEN** an in-scope row has `authorizer_no = 4`, `enterer_no = 4`
- **THEN** `authorizer_person_id = 4` and `enterer_person_id = 4`

#### Scenario: Zero-sentinel fallback available
- **WHEN** a row has `authorizer_no = 0`, `enterer_no = 7`
- **THEN** both person FKs resolve to 7


### Requirement: Skip and log rows that cannot satisfy the target constraints
The script SHALL skip and log any in-scope row that cannot produce a valid `name_opinions` concept row, in these disjoint buckets evaluated first-match-wins in order: (a) `child_spelling_no` does not resolve in the name Map — 6 rows; (b) `parent_spelling_no` is 0/NULL — 0 rows; (c) `parent_spelling_no` does not resolve in the name Map — 0 rows; (d) `child_spelling_no = parent_spelling_no`, which would violate `name_opinion_not_self` — 7 rows; (e) `reference_no` does not resolve — 4 rows. Total: 17 rows. Each skip SHALL log the `opinion_no` and the bucket, and the full set SHALL be enumerated in `failing-synonymy-opinions.csv`.

#### Scenario: Self-referential edge is skipped, not inserted
- **WHEN** an in-scope row has `child_spelling_no = parent_spelling_no` (e.g. opinion_no 525425)
- **THEN** the script skips it (logging `self_reference`) rather than attempting an insert that `name_opinion_not_self` would reject

#### Scenario: Unresolved child is skipped
- **WHEN** a `child_spelling_no` has no `name_opinions` root row (e.g. opinion_no 422323)
- **THEN** the row is skipped and logged with reason `child_spelling_unresolved`

#### Scenario: Orphan reference is skipped
- **WHEN** an in-scope row's `reference_no` resolves to no migrated ref (e.g. opinion_no 422325)
- **THEN** the row is skipped and logged with reason `orphan_reference`

#### Scenario: Empty buckets remain defined
- **WHEN** no in-scope row has a zero or orphan `parent_spelling_no`
- **THEN** the `parent_spelling_zero` and `parent_spelling_orphan` buckets report 0 but remain part of the reconciliation


### Requirement: Validate each attribution payload before any DB write
Every constructed `attribution` jsonb SHALL be validated against `payloadSchemas/opinionAttribution.schema.js` during the in-memory build phase, before any DB write. On validation failure the script SHALL log the offending `opinion_no` and failing payload and exit non-zero, needing no cleanup because no insert has happened.

#### Scenario: Valid attribution
- **WHEN** a second-hand attribution object is built from the author fields
- **THEN** ajv validation passes and the row is retained for insert

#### Scenario: Invalid attribution aborts before any insert
- **WHEN** a constructed attribution object fails schema validation
- **THEN** the script logs the offending `opinion_no` and payload, exits non-zero, and no rows have been inserted


### Requirement: Bulk insert is transaction-wrapped
The script SHALL wrap the bulk insert of all `name_opinions` concept rows in a single Postgres transaction (`BEGIN` … `COMMIT`). On any failure before `COMMIT`, Postgres SHALL roll back atomically, leaving the table in its pre-run state with no manual cleanup required.

#### Scenario: Successful bulk insert
- **WHEN** all 48,822 rows insert without error
- **THEN** the transaction commits and `name_opinions` reflects the inserted concept rows

#### Scenario: Mid-insert failure rolls back atomically
- **WHEN** an unexpected error occurs after some rows have been inserted but before `COMMIT`
- **THEN** the transaction rolls back and no migrated concept rows remain

#### Scenario: Re-run after abort needs no manual cleanup
- **WHEN** a prior run aborted before commit
- **THEN** re-running on the same source data produces the same result without a cleanup step


### Requirement: Log counts and enforce the reconciliation invariant
The script SHALL log in-scope rows read, `name_opinions` concept rows inserted, and skipped rows broken down by bucket, and SHALL assert the reconciliation invariant `inserted + skipped == in-scope`. If the invariant does not hold, the script SHALL abort without committing.

#### Scenario: Reconciliation holds
- **WHEN** the script completes over the current source data
- **THEN** it logs `inserted = 48,822`, `skipped = 17` (6 + 0 + 0 + 7 + 4), and confirms `48,822 + 17 == 48,839`

#### Scenario: Reconciliation failure aborts
- **WHEN** inserted plus skipped does not equal the in-scope count
- **THEN** the script reports the discrepancy and exits non-zero without committing


### Requirement: Reset the identity sequence after insert
After a successful commit the script SHALL reset the `name_opinions` id sequence to `MAX(id)` (as in `migrate-authority-opinions.js` and `migrate-assignment-opinions.js`), so subsequent inserts do not collide with the migrated rows' identity values.

The first of those two filenames was `migrate-authorities-opinions.js` until that script was renamed. This
mention is a comparative aside and would ordinarily stay untouched by a relocation — but a rename is not a
relocation: the old filename no longer names any file, so the citation is corrected regardless of its form.

#### Scenario: Sequence reset
- **WHEN** the bulk insert has committed
- **THEN** the script sets the `name_opinions` id sequence to the table's current `MAX(id)`
