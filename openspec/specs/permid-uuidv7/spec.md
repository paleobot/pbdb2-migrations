# permid-uuidv7 Specification

## Purpose
Require every minted `permid` across the migration scripts to be a UUIDv7 value.

## Requirements

### Requirement: Permids are generated as UUIDv7
Every migration script that mints a `permid` SHALL generate it as a UUIDv7 value. Scripts SHALL NOT use
`crypto.randomUUID()` (UUIDv4) or any externally-sourced identifier as the permid for these tables.

The in-scope tables are every table whose rows carry a minted `permid`:

| Table | Minted by |
|---|---|
| `refs` | `migrate-refs.js`, `migrate-pbot-refs.js` |
| `authorities` | `migrate-authorities.js` |
| `collections` | `migrate-collections.js` |
| `schemas`, `characters`, `states` | `migrate-pbot-schemas.js` |
| `name_opinions` | `migrate-authorities-opinions.js`, `migrate-opinions.js` |
| `assignment_opinions`, `validity_opinions` | `migrate-opinions.js` |
| `taxa`, `taxa_clades`, `taxa_linnaean`, `taxon_annotations` | the SQL derivation layer |

This list previously named only `authorities`, `collections`, `refs`, `schemas`, `characters`, and `states`.
Eight further minted-permid columns have appeared since, all of which already comply; the list is expanded so
that its completeness scenario actually covers them. Its previous form would have passed with a UUIDv4 sitting
in `name_opinions`.

Script names in this requirement remain unqualified bare filenames: they form one list of which
`migrate-collections.js` is still at the repository root, and `migration-script-layout`'s citation-form rule
keeps such a mixed list unqualified until the last of its members has been relocated.

#### Scenario: Authorities/collections/refs permid is v7
- **WHEN** `migrate-authorities.js`, `migrate-collections.js`, or `migrate-refs.js` inserts a row
- **THEN** the `permid` is a UUIDv7 whose version nibble equals 7

#### Scenario: Pbot-sourced permid is v7
- **WHEN** `migrate-pbot-refs.js` or `migrate-pbot-schemas.js` inserts a refs/schemas/characters/states row
- **THEN** the `permid` is a freshly generated UUIDv7, not the source `pbotID`

#### Scenario: Opinion permid is v7
- **WHEN** `migrate-authorities-opinions.js` mints a root `name_opinions` row, or `migrate-opinions.js` mints a `name_opinions`, `assignment_opinions`, or `validity_opinions` row
- **THEN** the `permid` is a UUIDv7 drawn from the shared helper, whose version nibble equals 7

#### Scenario: No UUIDv4 permids remain
- **WHEN** the in-scope migrations have completed
- **THEN** no row in any table listed above has a permid whose version nibble is 4

### Requirement: Shared UUIDv7 generation helper
The project SHALL provide a single ESM helper module that exports a UUIDv7 generator backed by the `uuid` npm package's `v7` function. All migration scripts that mint permids SHALL import this helper rather than generating UUIDs inline, so the generation strategy can be changed in one place.

#### Scenario: Scripts import the shared helper
- **WHEN** a migration script needs a new permid
- **THEN** it calls the shared helper's exported generator, and no script imports `randomUUID` from `crypto` for permid generation

#### Scenario: Backed by the uuid package
- **WHEN** the helper generates a value
- **THEN** the value is produced by the `uuid` package's `v7` function and is a valid UUIDv7

### Requirement: External legacy identifiers preserved in legacyIDs
When a migration stops using an externally-sourced identifier (e.g. PBot `pbotID`) as the permid, that identifier SHALL remain captured in the entity's JSONB `legacyIDs` object so that no source identifier is lost and cross-entity lookups keyed on `legacyIDs->>'pbotID'` continue to resolve.

#### Scenario: pbotID retained after permid change
- **WHEN** a pbot-sourced row is migrated with a generated UUIDv7 permid
- **THEN** the row's JSONB contains `legacyIDs.pbotID` equal to the original PBot `pbotID`

### Requirement: Database enforces UUIDv7 version on in-scope permid columns
The target schema in `postgresql/create_new.sql` SHALL apply a CHECK constraint on each minted permid column
asserting the UUID version nibble is 7, using `CHECK ((get_byte(uuid_send(permid), 6) >> 4) = 7)`. This form
is valid on PostgreSQL 16; it MAY be replaced with `uuid_extract_version(permid) = 7` once the database is on
PostgreSQL 18.

The constraint follows minting, not the column's name or type. A column that **mints** an identity SHALL
carry the CHECK; a column that **holds another row's** permid SHALL NOT, because the value was already
constrained where it was minted and re-checking it would duplicate that guarantee at every reference site.
The schema has followed this rule consistently since the columns were introduced; this requirement states it
so that a reader can tell an intentional omission from an oversight.

| | Columns |
|---|---|
| Minted — CHECK required | `refs.permid`, `authorities.permid`, `collections.permid`, `schemas.permid`, `characters.permid`, `states.permid`, `name_opinions.permid`, `assignment_opinions.permid`, `validity_opinions.permid`, `taxa.permid`, `taxa_clades.permid`, `taxa_linnaean.permid`, `taxon_annotations.permid`, `homonyms.homonym_group_id` |
| Reference — no CHECK | `name_opinions.subject_permid`, `name_opinions.target_permid`, `assignment_opinions.subject_permid`, `assignment_opinions.containing_permid`, `validity_opinions.subject_permid`, `cycle_cuts.concept_permid`, `homonyms.permid`, and every other column holding a permid minted elsewhere |

`homonyms` is the clearest illustration of the distinction: it mints `homonym_group_id`, which carries the
CHECK, and references a taxon's `permid` beside it, which does not.

#### Scenario: Non-v7 permid rejected
- **WHEN** an INSERT or UPDATE sets a minted permid column to a UUIDv4 value
- **THEN** PostgreSQL rejects the write with a check-constraint violation

#### Scenario: v7 permid accepted
- **WHEN** an INSERT sets a minted permid column to a valid UUIDv7 value
- **THEN** the write succeeds

#### Scenario: Reference column is deliberately unconstrained
- **WHEN** a reader finds `name_opinions.subject_permid` or `homonyms.permid` carrying no version CHECK
- **THEN** that is the specified behaviour rather than a gap, because the value is another row's minted permid and was constrained at its own minting site

### Requirement: Timescales and intervals excluded from scope
The `timescales` and `intervals` permid columns SHALL NOT receive the UUIDv7 generation change nor the CHECK
constraint in this change, because their migration design is not yet finalized.

These two remain the only minted permid columns without the CHECK. The expanded inventory above is what makes
that statement checkable: every other minted column is enumerated as requiring the constraint, so these two
are excluded by name rather than by absence from a short list.

#### Scenario: No CHECK on deferred tables
- **WHEN** `create_new.sql` is applied
- **THEN** neither `timescales.permid` nor `intervals.permid` has a UUIDv7 CHECK constraint
