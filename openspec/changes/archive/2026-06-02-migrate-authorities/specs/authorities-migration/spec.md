## ADDED Requirements

### Requirement: Read all source data from MariaDB
The script SHALL read all rows from the MariaDB `authorities` table, ordered by `taxon_no ASC`. Required columns: `taxon_no`, `ref_is_authority`, `author1last`, `author2last`, `otherauthors`, `pubyr`, `reference_no`, `authorizer_no`, `enterer_no`. Taxon-related columns (`taxon_name`, `taxon_rank`, `orig_no`, `extant_old`, classification fields) SHALL NOT be read.

#### Scenario: Full extraction
- **WHEN** the migration script executes the source query
- **THEN** all 517,287 rows are streamed from MariaDB ordered by `taxon_no ASC` and a starting row count is logged

#### Scenario: Streaming, not buffering
- **WHEN** the source query executes against 517K rows
- **THEN** rows are processed in streaming fashion and the source result set is not held entirely in memory


### Requirement: Classify each source row by scenario
The script SHALL classify each source row into one of four scenarios based on `(ref_is_authority, author1last)`. The classification SHALL drive citation construction, descriptor construction, and the migrate-vs-skip decision.

| Scenario | `ref_is_authority` | `author1last` | Action |
|---|---|---|---|
| ① | `'YES'` | `''` | Migrate; citation+descriptors from reference |
| ② | `'YES'` | non-empty | Migrate; citation+descriptors from `*last` fields |
| ③ | not `'YES'` | non-empty | Migrate; citation+descriptors from `*last` fields |
| ④ | not `'YES'` | `''` | Skip and log |

#### Scenario: Classification ①
- **WHEN** a row has `ref_is_authority = 'YES'` and `author1last = ''`
- **THEN** the row is classified as scenario ① and citation/descriptors are built from the linked reference

#### Scenario: Classification ②
- **WHEN** a row has `ref_is_authority = 'YES'` and `author1last = 'Smith'`
- **THEN** the row is classified as scenario ② and citation/descriptors are built from the legacy `*last`/`otherauthors`/`pubyr` fields

#### Scenario: Classification ③
- **WHEN** a row has `ref_is_authority = ''` and `author1last = 'Smith'`
- **THEN** the row is classified as scenario ③ and citation/descriptors are built from the legacy `*last`/`otherauthors`/`pubyr` fields

#### Scenario: Classification ④
- **WHEN** a row has `ref_is_authority = ''` and `author1last = ''`
- **THEN** the row is classified as scenario ④ and is logged with its `taxon_no` but not inserted

#### Scenario: Empty author1last test is exact
- **WHEN** `author1last` is the empty string `''`
- **THEN** classification treats it as empty; whitespace-only values (if encountered) are also treated as empty


### Requirement: Build citation for scenario ① from the linked reference
The script SHALL set `authority.citation` for scenario ① rows from the linked reference's authors and `publicationYear`, joined per author count:

| Author count | Joined authors |
|---|---|
| 1 | `authors[0].familyName` |
| 2 | `authors[0].familyName + ' and ' + authors[1].familyName` |
| 3+ | `authors[0].familyName + ' et al.'` |
| 0 | empty string |

The citation is then `(joined authors + ' ' + ref.publicationYear).trim()`.

#### Scenario: One-author reference
- **WHEN** a scenario ① row links to a ref with `authors=[{familyName:'Smith'}]` and `publicationYear='1969'`
- **THEN** `authority.citation = 'Smith 1969'`

#### Scenario: Two-author reference
- **WHEN** a scenario ① row links to a ref with `authors=[{familyName:'Smith'},{familyName:'Jones'}]` and `publicationYear='1969'`
- **THEN** `authority.citation = 'Smith and Jones 1969'`

#### Scenario: Three-author reference
- **WHEN** a scenario ① row links to a ref with three or more authors and `publicationYear='1969'`
- **THEN** `authority.citation = 'Smith et al. 1969'`, where `Smith` is the first author's `familyName`

#### Scenario: Empty publicationYear
- **WHEN** a scenario ① row links to a ref with `publicationYear=''`
- **THEN** `authority.citation = 'Smith'` (no trailing space)

#### Scenario: Zero-author reference
- **WHEN** a scenario ① row links to a ref with `authors=[]` and `publicationYear='1969'`
- **THEN** `authority.citation = '1969'` (year only, trimmed)


### Requirement: Build citation for scenarios ②/③ from legacy fields
The script SHALL set `authority.citation` for scenarios ② and ③ from `author1last`, `author2last`, `otherauthors`, and `pubyr`:

```
citation = (author1last
         + (otherauthors != ''     ? ' et al.'
            : author2last != ''    ? ' and ' + author2last
            : '')
         + ' ' + pubyr).trim()
```

No further interpretation, splitting, or cleanup of the assembled string is performed; raw author content is preserved verbatim.

#### Scenario: One author only
- **WHEN** a scenario ②/③ row has `author1last='Smith'`, `author2last=''`, `otherauthors=''`, `pubyr='1969'`
- **THEN** `authority.citation = 'Smith 1969'`

#### Scenario: Two authors via author2last
- **WHEN** a scenario ②/③ row has `author1last='Smith'`, `author2last='Jones'`, `otherauthors=''`, `pubyr='1969'`
- **THEN** `authority.citation = 'Smith and Jones 1969'`

#### Scenario: Three or more authors via otherauthors
- **WHEN** a scenario ②/③ row has `author1last='Smith'`, `author2last='Jones'`, `otherauthors='Brown'`, `pubyr='1969'`
- **THEN** `authority.citation = 'Smith et al. 1969'` (otherauthors triggers et al. regardless of author2last)

#### Scenario: Empty pubyr
- **WHEN** a scenario ②/③ row has `author1last='Smith'`, `author2last=''`, `otherauthors=''`, `pubyr=''`
- **THEN** `authority.citation = 'Smith'` (no trailing space)

#### Scenario: Raw content preserved
- **WHEN** a scenario ②/③ row has `author1last='Kamptner 1948 ex Piviteau  1952'`, `pubyr='1952'`
- **THEN** `authority.citation = 'Kamptner 1948 ex Piviteau  1952 1952'` (preserved verbatim including the embedded year and double space)


### Requirement: Build descriptors for scenario ① from the reference
The script SHALL set `authority.descriptors` for scenario ① rows by mapping each reference author to their `familyName`. No splitting, decoding, or filtering is applied at this stage; the reference data is already structured.

#### Scenario: Multiple authors
- **WHEN** a scenario ① row links to a ref with `authors=[{familyName:'Smith'},{familyName:'Jones'},{familyName:'Brown'}]`
- **THEN** `authority.descriptors = ['Smith', 'Jones', 'Brown']`

#### Scenario: Zero-author reference
- **WHEN** a scenario ① row links to a ref with `authors=[]`
- **THEN** `authority.descriptors = []` (empty array, allowed by schema)


### Requirement: Build descriptors for scenarios ②/③ from legacy fields
The script SHALL set `authority.descriptors` for scenarios ②/③ by processing each of `author1last`, `author2last`, `otherauthors` in order through this pipeline:

1. Decode HTML entities (`&#345;` → ř, `&amp;` → &) **before** any splitting.
2. Split on the regex `/[,;:&]/`.
3. Trim whitespace from each token.
4. Drop empty tokens.
5. Drop tokens equal to the literal string `et al.` (exact match, case-sensitive).

The flattened, filtered result is `authority.descriptors`.

#### Scenario: Simple multi-author otherauthors
- **WHEN** a row has `author1last='Smith'`, `author2last='Jones'`, `otherauthors='Brown, Davis, Evans'`
- **THEN** `authority.descriptors = ['Smith', 'Jones', 'Brown', 'Davis', 'Evans']`

#### Scenario: HTML entity decoded before splitting
- **WHEN** a row has `author1last='Dvo&#345;ák'`
- **THEN** `authority.descriptors` contains `'Dvořák'` as a single token, not `['Dvo','#345;ák']`

#### Scenario: Empty fields produce no tokens
- **WHEN** a row has `author1last='Smith'`, `author2last=''`, `otherauthors=''`
- **THEN** `authority.descriptors = ['Smith']`

#### Scenario: et al. is dropped
- **WHEN** a row has `author1last='Smith'`, `otherauthors='et al.'`
- **THEN** `authority.descriptors = ['Smith']` (the literal `et al.` token is filtered out)

#### Scenario: Empty splits dropped
- **WHEN** a row has `otherauthors='Brown,,Davis,'`
- **THEN** the descriptors derived from `otherauthors` are `['Brown', 'Davis']` (empty tokens dropped)

#### Scenario: Whitespace trimmed
- **WHEN** a row has `otherauthors='Brown , Davis'`
- **THEN** the descriptors derived from `otherauthors` are `['Brown', 'Davis']`

#### Scenario: Raw mess preserved as a single token
- **WHEN** a row has `author1last='Lepeletier de Saint Fargeau'`
- **THEN** `authority.descriptors` contains `'Lepeletier de Saint Fargeau'` as a single token (no splitting on whitespace or "and"/"de")


### Requirement: Set authority.year as-is
The script SHALL set `authority.year` to `pubyr` (scenarios ②/③) or `ref.publicationYear` (scenario ①). Empty values are stored as empty/absent per the schema (year is optional). No parsing of years embedded in author fields is performed.

#### Scenario: Year present
- **WHEN** a row has `pubyr='1969'`
- **THEN** `authority.year = '1969'`

#### Scenario: Year empty
- **WHEN** a row has `pubyr=''`
- **THEN** `authority.year` is omitted from the jsonb payload (or stored as empty string per the schema's acceptance)


### Requirement: Set publishedInReference per scenario
The script SHALL set `authority.publishedInReference` based on the row's `ref_is_authority` value: `true` for scenarios ① and ②, `false` for scenario ③. (Scenario ④ is not inserted.)

#### Scenario: ref_is_authority = 'YES'
- **WHEN** a scenario ① or ② row is migrated
- **THEN** `authority.publishedInReference = true`

#### Scenario: ref_is_authority != 'YES'
- **WHEN** a scenario ③ row is migrated
- **THEN** `authority.publishedInReference = false`


### Requirement: Deduplicate by (reference_id, citation, year, descriptors)
The script SHALL deduplicate authorities such that no two inserted rows share the same combination of `reference_id`, `authority.citation`, `authority.year`, and `authority.descriptors`. Dedup operates in-memory before insert (pre-aggregate); no post-insert delete pass is used. Approximate output: ~140K rows from ~500K migrated source rows.

#### Scenario: Same key collapses
- **WHEN** two source rows produce the same `(reference_id, citation, year, descriptors)` tuple
- **THEN** only one row is inserted into `authorities`

#### Scenario: Descriptor array equality
- **WHEN** two source rows produce identical descriptor arrays via the same parser pipeline
- **THEN** dedup treats them as equal (array element-wise, in order)

#### Scenario: No post-insert delete pass
- **WHEN** the script completes
- **THEN** no `DELETE` statements were issued against the `authorities` table


### Requirement: Smallest taxon_no wins the dedup tiebreaker
When multiple source rows collapse to the same dedup key, the row with the smallest `taxon_no` SHALL be the survivor whose data populates the inserted row. Achieved by iterating the source in `taxon_no ASC` order.

#### Scenario: First occurrence wins
- **WHEN** source rows with `taxon_no=100` and `taxon_no=200` share a dedup key
- **THEN** the `taxon_no=100` row's data populates the inserted authority (its `authorizer_no`, `enterer_no`, etc. are used)


### Requirement: Preserve all absorbed taxon_nos in legacyIDs.oldpbdbIDs
The script SHALL populate `authority.legacyIDs.oldpbdbIDs` as an array of strings containing every source `taxon_no` that collapsed to this surviving row, sorted ascending. The survivor's own `taxon_no` is the first entry. All absorbed `taxon_no`s are appended in the order encountered.

#### Scenario: Singleton (no dedup)
- **WHEN** a source row with `taxon_no=100` is unique by dedup key
- **THEN** the inserted row has `authority.legacyIDs.oldpbdbIDs = ['100']`

#### Scenario: Multiple absorbed
- **WHEN** source rows with `taxon_no=100, 200, 300` share a dedup key (encountered in that order due to ASC sort)
- **THEN** the inserted row has `authority.legacyIDs.oldpbdbIDs = ['100', '200', '300']`

#### Scenario: Always plural form
- **WHEN** the migration emits any authority row
- **THEN** the legacy id field is named `oldpbdbIDs` (plural array), never `oldpbdbID` (singular string)


### Requirement: Map reference_id from legacy reference_no
The script SHALL resolve each source row's `reference_no` to the new `refs.id` by looking up the ref whose `reference.legacyIDs.oldpbdbID` equals the source `reference_no` AND whose `succeeded_by_id IS NULL` (current version head).

#### Scenario: Standard lookup
- **WHEN** a source row has `reference_no=42` and a ref exists in PostgreSQL with `reference->'legacyIDs'->>'oldpbdbID' = '42'` and `succeeded_by_id IS NULL`
- **THEN** `authorities.reference_id` is set to that ref's `id`

#### Scenario: Versioned ref resolution
- **WHEN** the matching ref has been re-versioned (multiple rows share the same legacy id)
- **THEN** the lookup returns only the row with `succeeded_by_id IS NULL`


### Requirement: Skip and log rows with orphan reference_no
The script SHALL skip any source row whose `reference_no` does not resolve to a `refs` row, logging the `taxon_no` and `reference_no`. Approximate count: 3 rows. Skipped rows do not appear in the dedup Map and are not inserted.

#### Scenario: Orphan reference
- **WHEN** a source row has `reference_no=99999` and no matching ref exists in PostgreSQL
- **THEN** the row is not inserted, and the script logs the `taxon_no` and orphan `reference_no`


### Requirement: Resolve person FKs with zero-sentinel fallback
The script SHALL use `authorizer_no` and `enterer_no` directly as `persons.id` values (the `migrate-persons.js` migration inserted persons with `id = person_no`, so legacy and new ids are identical; no lookup map is required). When `authorizer_no=0` or `enterer_no=0` (MariaDB sentinel for "missing"), the script SHALL substitute the other field's value. When both are 0, the script SHALL fall back to `person_no=1`. Same fallback as `migrate-refs.js`. Approximate count: 1 row with `authorizer_no=0`, 1 with `enterer_no=0`.

#### Scenario: Both populated
- **WHEN** a source row has `authorizer_no=5`, `enterer_no=7`
- **THEN** `authorizer_person_id` resolves from person_no=5 and `enterer_person_id` resolves from person_no=7

#### Scenario: authorizer_no=0 fallback
- **WHEN** a source row has `authorizer_no=0`, `enterer_no=7`
- **THEN** both `authorizer_person_id` and `enterer_person_id` resolve from person_no=7

#### Scenario: enterer_no=0 fallback
- **WHEN** a source row has `authorizer_no=5`, `enterer_no=0`
- **THEN** both `authorizer_person_id` and `enterer_person_id` resolve from person_no=5


### Requirement: Generate fresh permid per inserted authority
The script SHALL generate a v4 UUID using `crypto.randomUUID()` for each inserted authority row and store it as the `permid` column. Same pattern as `migrate-refs.js`.

#### Scenario: UUID assignment
- **WHEN** a survivor row is inserted
- **THEN** its `permid` is a newly-generated v4 UUID, distinct from all other rows in the table


### Requirement: Log scenario ④ rows without migrating
The script SHALL log every scenario ④ row (`ref_is_authority != 'YES'` AND `author1last = ''`) with its `taxon_no` and SHALL NOT insert it. Approximate count: 16,606 rows.

#### Scenario: Scenario ④ skipped
- **WHEN** a source row has `ref_is_authority=''` and `author1last=''`
- **THEN** the row is logged with its `taxon_no` and no insert occurs


### Requirement: Log dedup merges
The script SHALL log each dedup merge with the surviving `taxon_no` and the absorbed `taxon_no`. Logging style matches the existing `console.warn` + counters pattern in `migrate-refs.js`.

#### Scenario: Merge logged
- **WHEN** a source row collapses into an existing survivor
- **THEN** a log entry records `{absorbed: <taxon_no>, survivor: <taxon_no>}` (or equivalent)

#### Scenario: Final counts logged
- **WHEN** the script completes
- **THEN** it logs total source rows read, scenario ④ count, orphan-ref count, total survivors inserted, and total dedup merges


### Requirement: Validate each authority payload during build, before any DB write
Every constructed `authority` jsonb SHALL be validated against `payloadSchemas/authority.schema.js` at the moment its survivor is finalized in the dedup Map — that is, during the in-memory aggregation phase, **before** any DB write has occurred. On validation failure, the script SHALL log the offending `taxon_no` (and the failing payload) and exit with a non-zero status. Because no insert has happened yet, no cleanup is required before re-running after a fix.

#### Scenario: Valid payload
- **WHEN** an authority object is built for a scenario ②/③ row with citation, descriptors, year, publishedInReference, legacyIDs.oldpbdbIDs
- **THEN** ajv validation passes and the survivor is retained in the dedup Map

#### Scenario: Invalid payload aborts before any insert
- **WHEN** a constructed authority object fails schema validation during the build phase
- **THEN** the script logs the offending `taxon_no` and the failing payload, exits with a non-zero status, and no rows have been inserted into `authorities`


### Requirement: Bulk insert is transaction-wrapped
The script SHALL wrap the entire bulk insert of survivor rows in a single Postgres transaction (`BEGIN` … `COMMIT`). On any failure during the insert phase — including FK violations, constraint errors, network interruption, or process termination prior to `COMMIT` — Postgres SHALL roll back the partial insert atomically, along with any history rows produced by the version trigger. After a rolled-back run, the `authorities` table SHALL be in the same state as before the script ran, requiring no manual cleanup before re-running.

#### Scenario: Successful bulk insert
- **WHEN** all ~140K survivor rows insert without error
- **THEN** the transaction commits and the table reflects all inserts

#### Scenario: Mid-insert failure rolls back atomically
- **WHEN** an unexpected error occurs after some survivor rows have been inserted but before `COMMIT`
- **THEN** the transaction rolls back; no survivor rows remain in `authorities`, and no history rows remain from the version trigger

#### Scenario: Re-run after abort needs no manual cleanup
- **WHEN** a prior run aborted (either pre-insert validation failure or mid-insert rollback)
- **THEN** re-running the script on the same source data produces the same result without requiring a `TRUNCATE` or other cleanup step
