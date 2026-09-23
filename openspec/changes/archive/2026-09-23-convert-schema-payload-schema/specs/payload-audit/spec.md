## MODIFIED Requirements

### Requirement: Audit every stored payload against the resolved `db` variant
`src/audit-payloads.js` SHALL hold a registry of audited entities. Each entry names the entity, table, jsonb
column, and annotated source, and SHALL state whether the entity's table is versioned. The registry SHALL
contain collection (`collections.collection`), specimen (`specimens.specimen`), person (`persons.person`),
reference (`refs.reference`), authority (`authorities.authority`) and schema (`schemas.schema`). Collection,
specimen, reference, authority and schema are versioned; person is not.

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

#### Scenario: Every stored ref validates at rest
- **WHEN** the reference entry is audited on a freshly migrated database
- **THEN** every row is checked (93,946 on 2026-09-23: 93,705 PBDB and 241 PBot, a number the live PBot API grows), reported as heads and superseded, with zero violations, including the PBDB refs that carry a field their type does not allow on create

#### Scenario: Every stored authority validates at rest
- **WHEN** the authority entry is audited on a freshly migrated database
- **THEN** every row is checked (163,067 on 2026-09-23, all heads), with zero violations, including the 1,299 scenario ④ sentinel authorities with `year: "0"` and the 898 with no `year`

#### Scenario: Every stored schema validates at rest
- **WHEN** the schema entry is audited on a freshly migrated database
- **THEN** every row is checked (8 on localhost `pbdb` on 2026-09-23, all heads, a number the live PBot API grows), with zero violations, with `partsPreserved` and `notableFeatures` checked against the resolved dictionary enums

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
- **WHEN** `--entity character` is passed
- **THEN** the script exits non-zero listing `collection`, `specimen`, `person`, `reference`, `authority` and `schema`

#### Scenario: Schema is a valid entity
- **WHEN** `--entity schema` is passed
- **THEN** only `schemas` is read and reported

### Requirement: Round-trip mode verifies split and merge on stored data
With `--round-trip`, for every head row of an entity — every row, for an unversioned entity — the script SHALL additionally:
1. build the stored parts (jsonb, codec-selected columns, child rows);
2. `merge` them and validate the result against `out`;
3. remove `readOnly` properties and `split` the result.

It SHALL count a violation when the split jsonb or any column or child value differs from the stored value after codec normalization.

Where an entity's codecs declare lookup sources, the script SHALL pass a codec context to `merge` and `split`.
Sources in the `dictionaries` schema SHALL be read once for the run and reused across batches. For every other
source the script SHALL select per batch, from the key values that batch holds, when `codecKeyColumns` names
the columns those keys come from, so that no entity table is read more broadly than the batch references; and
SHALL pre-load the source once for the run when it does not.

Whether `refs` is pre-loaded depends on the entity, not the table. For collection and schema it is pre-loaded:
`referenceList` is annotated `{ table, codec }`, so it contributes no key columns, and the refs a batch
cites are split between `collections.reference_id` and the pre-loaded child rows. Reading it whole is also the
cheaper choice there: the lookup is 93,944 rows of `(bigint, uuid)`, while selecting it per batch would issue
56 queries across a collections audit. Schema pre-loads it for the same reason, the annotation, although its
few rows would make either choice cheap. For authority it is selected per batch: `referencePermid` is annotated
with `column: "reference_id"`, so `codecKeyColumns` names the column the batch's keys come from.

#### Scenario: Stable round trip
- **WHEN** `--round-trip` runs on a freshly migrated database
- **THEN** every head collection, specimen, reference, authority and schema, and every person, round-trips with zero differences

#### Scenario: Codec defect detected
- **WHEN** a codec swaps latitude and longitude on merge
- **THEN** the round trip reports differing `location` values and the script exits non-zero

#### Scenario: Person round trip rebuilds its column-backed fields
- **WHEN** `--round-trip` runs on person
- **THEN** each row's `role`, `authorizer`, `active`, `totalHours` and `permid` are rebuilt from the columns, validated against `out`, and split back to the values stored

#### Scenario: Collection round trip rebuilds its citations as permids
- **WHEN** `--round-trip` runs on collection
- **THEN** each row's `references[]` is rebuilt as reference permids, validated against `out`, and split back to the same `collections.reference_id` and the same `additional_collection_refs` rows that are stored

#### Scenario: Entity source is selected per batch
- **WHEN** a person batch of 5,000 rows is round-tripped
- **THEN** the `persons` lookup reads only the ids that batch references

#### Scenario: Dictionary source is read once for the run
- **WHEN** an entity is round-tripped across several batches
- **THEN** `dictionaries.roles` is read once and reused, not re-read per batch

#### Scenario: Unaddressable source is read once for the run
- **WHEN** 275,554 collections are round-tripped in 5,000-row batches
- **THEN** `refs` is read once for the run and reused, not once per batch, because `referenceList` offers no key columns to select on

#### Scenario: Reference round trip needs no codec context
- **WHEN** `--round-trip` runs on reference
- **THEN** each head row's `permid` is rebuilt from its column, the payload validates against `out`, and the split jsonb equals the stored jsonb; no codec source is loaded, because the reference source declares none

#### Scenario: Authority round trip rebuilds its reference as a permid
- **WHEN** `--round-trip` runs on authority
- **THEN** each head row's `permid` and `reference` are rebuilt from their columns, the payload validates against `out`, and splitting it back yields the stored jsonb and the same `reference_id`

#### Scenario: Authority batches select refs by id
- **WHEN** a 5,000-row batch of authorities is round-tripped
- **THEN** `refs` is read by `WHERE id = ANY($1)` restricted to the `reference_id`s that batch holds, from lineage heads only

#### Scenario: Schema round trip rebuilds its citations as permids
- **WHEN** `--round-trip` runs on schema
- **THEN** each head row's `permid` and `references[]` are rebuilt from `schemas.permid`, `schemas.reference_id` and the `additional_schema_refs` rows keyed by `schema_id`, the payload validates against `out`, and splitting it back yields the stored jsonb, the same `reference_id` and the same child rows in `id` order
