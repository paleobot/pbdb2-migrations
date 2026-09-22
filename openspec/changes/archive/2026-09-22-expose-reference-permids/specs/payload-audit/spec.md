## MODIFIED Requirements

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

`refs` is pre-loaded. `collectionReferences` is annotated `{ table, codec }`, so it contributes no key columns,
and the refs a batch cites are split between `collections.reference_id` and the pre-loaded child rows. Reading
it whole is also the cheaper choice: the lookup is 93,944 rows of `(bigint, uuid)`, while selecting it per
batch would issue 56 queries across a collections audit.

#### Scenario: Stable round trip
- **WHEN** `--round-trip` runs on a freshly migrated database
- **THEN** every head collection and specimen, and every person, round-trips with zero differences

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
- **THEN** `refs` is read once for the run and reused, not once per batch, because `collectionReferences` offers no key columns to select on
