## MODIFIED Requirements

### Requirement: Build the identifiers object
The script SHALL build `specimen.identifiers` from two collection- and specimen-level sources:

- `identifiers.catalogNumber` from `specimen_id`, verbatim. Classic values frequently embed the institution
  or free text (`"USNM 550991a"`, `"Museum of Cagli P707"`, `"P. tricostata Oeningen type"`); the script
  SHALL NOT attempt to parse, split, or normalise them. The key SHALL be omitted when `specimen_id` is null.
- `identifiers.institutionCode` from the joined collection's `museum`. When `museum` holds more than one
  value, the script SHALL take the first member of the MySQL `SET`. When there is no `museum` value — whether
  because the collection records none, or because the row has no collection at all — the script SHALL write
  the sentinel `'none specified'`, which is seeded as the first value of `dictionaries.institution_codes`
  for this purpose.

The sentinel is the value for 118,877 rows (71%): 97,485 occurrence-linked rows whose collection records no
museum, and all 21,392 rows with no collection. `institutionCode` is therefore never absent.

#### Scenario: Multi-valued museum takes the first member
- **WHEN** the joined collection's `museum` is `'BMNH,USNM'`
- **THEN** `identifiers.institutionCode` is `'BMNH'`

#### Scenario: Sentinel covers both no-museum cases
- **WHEN** a row's collection records a blank `museum`, or the row has no collection at all
- **THEN** `identifiers.institutionCode` is `'none specified'` in both cases

#### Scenario: Catalog number is verbatim
- **WHEN** `specimen_id` is `'Slide F-III-72-487 (Catatumbo) Loc: 43.4X118.9 (micr. P0-58)'`
- **THEN** `identifiers.catalogNumber` holds that string unchanged

### Requirement: Validate the payload before writing
The script SHALL build its validator once at startup by deriving the `db` variant of the annotated specimen
source in `payloadSchemas/specimen.schema.js`, resolving its enums from `dictionaries`, and compiling it with
`createAjv()`. It SHALL validate every built `specimen` payload, unwrapped (the object stored in the jsonb
column), before any database write. A validation failure SHALL log the offending `specimen_no`, the
validation errors, and the payload, and SHALL abort the migration. An enum resolution failure SHALL abort
the migration before any source row is read.

Validation is a meaningful gate here because all seven enums the payload carries were verified to match their
classic sources value-for-value. Two of them (`institutionCode`, `preservationModes`) are now resolved from
dictionary tables seeded with those same values, and five remain inline. So any enum violation reaching the
validator indicates a transformation bug rather than unexpected source data.

#### Scenario: Invalid payload aborts the run
- **WHEN** a built payload fails schema validation
- **THEN** the `specimen_no`, errors, and payload are logged and the migration aborts without writing

#### Scenario: Payload validated without an envelope
- **WHEN** a built payload `{ name, identifiers, paleontology }` is validated
- **THEN** it is passed to the validator as-is, not wrapped as `{ specimen: ... }`
