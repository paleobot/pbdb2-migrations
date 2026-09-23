## MODIFIED Requirements

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
- **WHEN** a scenario ④ payload is validated against the `db` variant of `authoritySource`
- **THEN** `year` is the string `'0'` (not the number `0`) and validation passes

#### Scenario: Scenario ④ collapses by reference
- **WHEN** multiple scenario ④ rows share the same resolved `reference_id`
- **THEN** they produce the identical dedup key `(reference_id, 'authority unknown', '0', [])` and collapse to a single survivor whose `oldpbdbIDs` lists every absorbed `taxon_no`

#### Scenario: Scenario ④ subject to standard ref and person handling
- **WHEN** a scenario ④ row is processed
- **THEN** its `reference_id` is resolved via the standard `reference_no` lookup and its person FKs via the zero-sentinel fallback, and a row whose `reference_no` does not resolve is skipped-and-logged as an orphan like any other scenario

### Requirement: Validate each authority payload during build, before any DB write
Every constructed `authority` jsonb SHALL be validated against the `db` variant of `authoritySource`
(`payloadSchemas/authority.schema.js`), resolved with `resolveEnums` and compiled with `createAjv` before any
MariaDB row is read. The payload SHALL be validated as built, not wrapped in an `{ authority }` envelope. It
holds neither `permid` nor `reference`, which are columns and which the `db` variant does not declare.

Validation SHALL happen at the moment each survivor is finalized in the dedup Map, that is, during the in-memory aggregation phase, **before** any DB write has occurred. On validation failure, the script SHALL log the offending `taxon_no` (and the failing payload) and exit with a non-zero status. Because no insert has happened yet, no cleanup is required before re-running after a fix.

#### Scenario: Valid payload
- **WHEN** an authority object is built for a scenario ②/③ row with citation, descriptors, year, publishedInReference, legacyIDs.oldpbdbIDs
- **THEN** it validates against the `db` variant and the survivor is retained in the dedup Map

#### Scenario: Invalid payload aborts before any insert
- **WHEN** a constructed authority object fails schema validation during the build phase
- **THEN** the script logs the offending `taxon_no` and the failing payload, exits with a non-zero status, and no rows have been inserted into `authorities`

#### Scenario: No envelope
- **WHEN** a built payload is validated
- **THEN** the object passed to the validator is the payload itself, and it is the same object that is inserted into `authorities.authority`
