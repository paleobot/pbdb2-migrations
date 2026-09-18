# payload-audit Specification

## Purpose
Define `src/audit-payloads.js`: validating every stored jsonb payload of the converted entities against the resolved `db` variant, reporting violations, and, with `--round-trip`, checking that merge and split reproduce each stored row. It is the after-the-fact guard that stands in for deferred database-level validation.

## Requirements

### Requirement: Audit every stored payload against the resolved `db` variant
`src/audit-payloads.js` SHALL hold a registry of audited entities. Each entry names the entity, table, jsonb column, and annotated source. The registry SHALL initially contain collection (`collections.collection`) and specimen (`specimens.specimen`).

For each entry the script SHALL:
- resolve and compile the `db` variant once;
- read every row of the table, including superseded versions, using keyset pagination on `id` in bounded batches rather than one unbounded result set;
- validate the jsonb column of each row.

#### Scenario: All versions audited
- **WHEN** `collections` holds 275,554 head rows and some superseded versions
- **THEN** the audit validates every row and reports head and superseded counts separately

#### Scenario: Empty table is not an error
- **WHEN** an audited table holds no rows
- **THEN** the audit reports zero rows for that entity and does not treat the table as a violation

### Requirement: The audit reports violations and exits accordingly
The script SHALL print, per entity:
- rows checked (heads and superseded);
- violation count;
- up to `--sample <n>` offending rows (default 10), each with its `id`, `permid`, and ajv errors.

It SHALL write the same report as a run artifact beside itself. It SHALL exit 0 when there are no violations, and non-zero when there is any violation or when resolution or compilation fails.

#### Scenario: Clean database
- **WHEN** every row validates
- **THEN** the script exits 0 and the report shows 0 violations per entity

#### Scenario: Orphaned dictionary value
- **WHEN** a stored collection holds a `lithology` value later deleted from `dictionaries.lithologies`
- **THEN** the report lists that row's `id` and the enum error, and the script exits non-zero

#### Scenario: Resolution failure
- **WHEN** a dictionary table used by an audited source is empty
- **THEN** the script exits non-zero before reading any payload rows

### Requirement: The audit can be narrowed to selected entities
`--entity <name>` MAY be repeated. When at least one is given, the audit SHALL read and report only those registry entries. With none, it SHALL audit every entry. An unknown name SHALL exit non-zero, listing the valid names, before any row is read.

#### Scenario: Single entity
- **WHEN** `--entity specimen` is passed
- **THEN** only `specimens` is read and reported

#### Scenario: Several entities
- **WHEN** `--entity collection --entity specimen` is passed
- **THEN** both are read and reported

#### Scenario: Unknown entity
- **WHEN** `--entity person` is passed
- **THEN** the script exits non-zero listing `collection` and `specimen`

### Requirement: Round-trip mode verifies split and merge on stored data
With `--round-trip`, for every head row of an entity the script SHALL additionally:
1. build the stored parts (jsonb, codec-selected columns, child rows);
2. `merge` them and validate the result against `out`;
3. remove `readOnly` properties and `split` the result.

It SHALL count a violation when the split jsonb or any column or child value differs from the stored value after codec normalization.

#### Scenario: Stable round trip
- **WHEN** `--round-trip` runs on a freshly migrated database
- **THEN** every head collection and specimen round-trips with zero differences

#### Scenario: Codec defect detected
- **WHEN** a codec swaps latitude and longitude on merge
- **THEN** the round trip reports differing `location` values and the script exits non-zero

