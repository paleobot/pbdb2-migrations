## MODIFIED Requirements

### Requirement: Audit every stored payload against the resolved `db` variant
`src/audit-payloads.js` SHALL hold a registry of audited entities. Each entry names the entity, table, jsonb
column, and annotated source, and SHALL state whether the entity's table is versioned. The registry SHALL
contain collection (`collections.collection`), specimen (`specimens.specimen`) and person (`persons.person`).
Collection and specimen are versioned; person is not.

For each entry the script SHALL:
- resolve and compile the `db` variant once;
- read every row of the table, including superseded versions where the table has them, using keyset pagination on `id` in bounded batches rather than one unbounded result set;
- validate the jsonb column of each row.

The shared row query SHALL select `succeeded_by_id IS NULL AS head` only for a versioned entry. `persons` has
no `preceded_by_id`/`succeeded_by_id`, so selecting it unconditionally would raise *column does not exist*
rather than audit anything. `permid` SHALL still be selected for every entry.

#### Scenario: All versions audited
- **WHEN** `collections` holds 275,554 head rows and some superseded versions
- **THEN** the audit validates every row and reports head and superseded counts separately

#### Scenario: Empty table is not an error
- **WHEN** an audited table holds no rows
- **THEN** the audit reports zero rows for that entity and does not treat the table as a violation

#### Scenario: Unversioned entity is read without a head expression
- **WHEN** the person entry is read
- **THEN** the query selects `id`, `permid` and the `person` column and no `succeeded_by_id` expression, and every row in `persons` is validated

### Requirement: The audit reports violations and exits accordingly
The script SHALL print, per entity:
- rows checked — for a versioned entity, heads and superseded separately; for an unversioned one, a single count;
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

#### Scenario: Unversioned entity reports one count
- **WHEN** the person entry is reported
- **THEN** its line gives a single rows-checked count with no head/superseded split, and an offending person is still identified by `id` and `permid`

### Requirement: The audit can be narrowed to selected entities
`--entity <name>` MAY be repeated. When at least one is given, the audit SHALL read and report only those registry entries. With none, it SHALL audit every entry. An unknown name SHALL exit non-zero, listing the valid names, before any row is read.

#### Scenario: Single entity
- **WHEN** `--entity specimen` is passed
- **THEN** only `specimens` is read and reported

#### Scenario: Several entities
- **WHEN** `--entity collection --entity specimen` is passed
- **THEN** both are read and reported

#### Scenario: Person is a valid entity
- **WHEN** `--entity person` is passed
- **THEN** only `persons` is read and reported, and the script no longer treats `person` as an unknown name

#### Scenario: Unknown entity
- **WHEN** `--entity reference` is passed
- **THEN** the script exits non-zero listing `collection`, `specimen` and `person`

### Requirement: Round-trip mode verifies split and merge on stored data
With `--round-trip`, for every head row of an entity — every row, for an unversioned entity — the script SHALL additionally:
1. build the stored parts (jsonb, codec-selected columns, child rows);
2. `merge` them and validate the result against `out`;
3. remove `readOnly` properties and `split` the result.

It SHALL count a violation when the split jsonb or any column or child value differs from the stored value after codec normalization.

Where an entity's codecs declare lookup sources, the script SHALL pass a codec context to `merge` and `split`.
Sources outside the `dictionaries` schema SHALL be selected per batch, from the key values that batch holds,
so that no entity table is read more broadly than the batch references. Sources in the `dictionaries` schema
SHALL be read once for the run and reused across batches.

#### Scenario: Stable round trip
- **WHEN** `--round-trip` runs on a freshly migrated database
- **THEN** every head collection and specimen, and every person, round-trips with zero differences

#### Scenario: Codec defect detected
- **WHEN** a codec swaps latitude and longitude on merge
- **THEN** the round trip reports differing `location` values and the script exits non-zero

#### Scenario: Person round trip rebuilds its column-backed fields
- **WHEN** `--round-trip` runs on person
- **THEN** each row's `role`, `authorizer`, `active`, `totalHours` and `permid` are rebuilt from the columns, validated against `out`, and split back to the values stored

#### Scenario: Entity source is selected per batch
- **WHEN** a person batch of 5,000 rows is round-tripped
- **THEN** the `persons` lookup reads only the ids that batch references

#### Scenario: Dictionary source is read once for the run
- **WHEN** an entity is round-tripped across several batches
- **THEN** `dictionaries.roles` is read once and reused, not re-read per batch
