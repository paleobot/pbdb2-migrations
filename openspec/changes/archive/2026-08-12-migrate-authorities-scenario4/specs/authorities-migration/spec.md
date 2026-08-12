## MODIFIED Requirements

### Requirement: Classify each source row by scenario
The script SHALL classify each source row into one of four scenarios based on `(ref_is_authority, author1last)`. The classification SHALL drive citation construction, descriptor construction, and the payload-build path. All four scenarios are migrated; none are skipped on the basis of classification alone.

| Scenario | `ref_is_authority` | `author1last` | Action |
|---|---|---|---|
| ① | `'YES'` | `''` | Migrate; citation+descriptors from reference |
| ② | `'YES'` | non-empty | Migrate; citation+descriptors from `*last` fields |
| ③ | not `'YES'` | non-empty | Migrate; citation+descriptors from `*last` fields |
| ④ | not `'YES'` | `''` | Migrate; sentinel citation `authority unknown`, year `0`, empty descriptors |

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
- **THEN** the row is classified as scenario ④ and migrated with sentinel authority values (not skipped)

#### Scenario: Empty author1last test is exact
- **WHEN** `author1last` is the empty string `''`
- **THEN** classification treats it as empty; whitespace-only values (if encountered) are also treated as empty


### Requirement: Set publishedInReference per scenario
The script SHALL set `authority.publishedInReference` based on the row's `ref_is_authority` value: `true` for scenarios ① and ② (`ref_is_authority = 'YES'`), `false` for scenarios ③ and ④ (`ref_is_authority != 'YES'`).

#### Scenario: ref_is_authority = 'YES'
- **WHEN** a scenario ① or ② row is migrated
- **THEN** `authority.publishedInReference = true`

#### Scenario: ref_is_authority != 'YES'
- **WHEN** a scenario ③ row is migrated
- **THEN** `authority.publishedInReference = false`

#### Scenario: Scenario ④ publishedInReference
- **WHEN** a scenario ④ row is migrated
- **THEN** `authority.publishedInReference = false`


## ADDED Requirements

### Requirement: Migrate scenario ④ rows with sentinel authority
The script SHALL migrate every scenario ④ row (`ref_is_authority != 'YES'` AND empty `author1last`) by building an `authority` payload with fixed sentinel values, then flowing it through the same reference lookup, person resolution, dedup, payload validation, and transaction-wrapped insert pipeline as scenarios ②/③. The sentinel payload SHALL be:

- `citation`: the literal string `"authority unknown"`
- `year`: the literal string `"0"` (the schema types `year` as a string of maxLength 4; the numeric `0` is not used)
- `descriptors`: `[]` (empty array, allowed by the schema)
- `publishedInReference`: `false`
- `legacyIDs.oldpbdbIDs`: `[taxon_no]`, appended to as dedup merges absorb further scenario ④ rows

No authorship parsing is attempted; scenario ④ rows have none.

#### Scenario: Sentinel payload shape
- **WHEN** a source row has `ref_is_authority=''` and `author1last=''` and resolves to a ref
- **THEN** the built payload is `{ legacyIDs: { oldpbdbIDs: ['<taxon_no>'] }, publishedInReference: false, citation: 'authority unknown', year: '0', descriptors: [] }`

#### Scenario: Year sentinel is a string
- **WHEN** a scenario ④ payload is validated against `payloadSchemas/authority.schema.js`
- **THEN** `authority.year` is the string `'0'` (not the number `0`) and validation passes

#### Scenario: Scenario ④ collapses by reference
- **WHEN** multiple scenario ④ rows share the same resolved `reference_id`
- **THEN** they produce the identical dedup key `(reference_id, 'authority unknown', '0', [])` and collapse to a single survivor whose `oldpbdbIDs` lists every absorbed `taxon_no`

#### Scenario: Scenario ④ subject to standard ref and person handling
- **WHEN** a scenario ④ row is processed
- **THEN** its `reference_id` is resolved via the standard `reference_no` lookup and its person FKs via the zero-sentinel fallback, and a row whose `reference_no` does not resolve is skipped-and-logged as an orphan like any other scenario


## REMOVED Requirements

### Requirement: Log scenario ④ rows without migrating
**Reason**: Scenario ④ rows are now migrated with a sentinel authority (`citation: "authority unknown"`, `year: "0"`, empty descriptors) rather than dropped, so that the taxon→reference linkage and legacy `taxon_no`s are retained. Replaced by the "Migrate scenario ④ rows with sentinel authority" requirement.
**Migration**: Re-run `migrate-authorities.js`; the ~16,606 scenario ④ source rows collapse to ~1,299 sentinel authority survivors instead of being skipped.
