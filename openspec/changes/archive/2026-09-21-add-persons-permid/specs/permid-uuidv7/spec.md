## MODIFIED Requirements

### Requirement: Permids are generated as UUIDv7
Every migration script that mints a `permid` SHALL generate it as a UUIDv7 value. Scripts SHALL NOT use
`crypto.randomUUID()` (UUIDv4) or any externally-sourced identifier as the permid for these tables.

The in-scope tables are every table whose rows carry a minted `permid`:

| Table | Minted by |
|---|---|
| `persons` | `src/persons-migration/migrate-persons.js`, `src/pbot-persons-migration/migrate-pbot-persons.js` |
| `refs` | `src/refs-migration/migrate-refs.js`, `src/pbot-refs-migration/migrate-pbot-refs.js` |
| `authorities` | `src/authorities-migration/migrate-authorities.js` |
| `collections` | `src/collections-migration/migrate-collections.js` |
| `schemas`, `characters`, `states` | `src/pbot-schemas-migration/migrate-pbot-schemas.js` |
| `name_opinions` | `src/authority-opinions-migration/migrate-authority-opinions.js`, `src/opinions-migration/migrate-opinions.js` |
| `assignment_opinions`, `validity_opinions` | `src/opinions-migration/migrate-opinions.js` |
| `taxa`, `taxa_clades`, `taxa_linnaean`, `taxon_annotations` | the SQL derivation layer |

This list previously named only `authorities`, `collections`, `refs`, `schemas`, `characters`, and `states`.
Eight further minted-permid columns have appeared since, all of which already comply; the list is expanded so
that its completeness scenario actually covers them. Its previous form would have passed with a UUIDv4 sitting
in `name_opinions`.

`persons` is the most recent addition and the first entry added at the moment its column was created rather
than retroactively. It is listed first because it is the first table written by the migration runner, and
because it is the one minted-permid table that is not versioned.

Script names in this requirement were previously unqualified bare filenames, because they formed one list of
which `migrate-collections.js` was still at the repository root, and `migration-script-layout`'s citation-form
rule keeps such a mixed list unqualified until the last of its members has been relocated. That condition is
now discharged: every script named here lives under `src/`, so the list is path-qualified in one edit, which
is what that rule anticipated. The table directs a reader to these files as the source of the guarantee that
each permid is a v7 value, so qualification is required rather than merely permitted.

#### Scenario: Person permid is v7
- **WHEN** `src/persons-migration/migrate-persons.js` or `src/pbot-persons-migration/migrate-pbot-persons.js` inserts a `persons` row
- **THEN** the `permid` is a UUIDv7 drawn from the shared helper, whose version nibble equals 7

#### Scenario: Authorities/collections/refs permid is v7
- **WHEN** `src/authorities-migration/migrate-authorities.js`, `src/collections-migration/migrate-collections.js`, or `src/refs-migration/migrate-refs.js` inserts a row
- **THEN** the `permid` is a UUIDv7 whose version nibble equals 7

#### Scenario: Pbot-sourced permid is v7
- **WHEN** `src/pbot-refs-migration/migrate-pbot-refs.js` or `src/pbot-schemas-migration/migrate-pbot-schemas.js` inserts a refs/schemas/characters/states row
- **THEN** the `permid` is a freshly generated UUIDv7, not the source `pbotID`

#### Scenario: Opinion permid is v7
- **WHEN** `src/authority-opinions-migration/migrate-authority-opinions.js` mints a root `name_opinions` row, or `src/opinions-migration/migrate-opinions.js` mints a `name_opinions`, `assignment_opinions`, or `validity_opinions` row
- **THEN** the `permid` is a UUIDv7 drawn from the shared helper, whose version nibble equals 7

#### Scenario: No UUIDv4 permids remain
- **WHEN** the in-scope migrations have completed
- **THEN** no row in any table listed above has a permid whose version nibble is 4

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
| Minted — CHECK required | `persons.permid`, `refs.permid`, `authorities.permid`, `collections.permid`, `schemas.permid`, `characters.permid`, `states.permid`, `name_opinions.permid`, `assignment_opinions.permid`, `validity_opinions.permid`, `taxa.permid`, `taxa_clades.permid`, `taxa_linnaean.permid`, `taxon_annotations.permid`, `homonyms.homonym_group_id` |
| Reference — no CHECK | `name_opinions.subject_permid`, `name_opinions.target_permid`, `assignment_opinions.subject_permid`, `assignment_opinions.containing_permid`, `validity_opinions.subject_permid`, `cycle_cuts.concept_permid`, `homonyms.permid`, and every other column holding a permid minted elsewhere |

`homonyms` is the clearest illustration of the distinction: it mints `homonym_group_id`, which carries the
CHECK, and references a taxon's `permid` beside it, which does not.

`persons.permid` is minted, so it carries the CHECK. The ~30 columns that reference a person —
`authorizer_person_id` and `enterer_person_id` throughout the schema — are not permid columns at all: they
reference `persons.id`, and they remain `integer` under `entity-versioning-triggers`. Adding a permid to
`persons` does not move them.

#### Scenario: Non-v7 permid rejected
- **WHEN** an INSERT or UPDATE sets a minted permid column to a UUIDv4 value
- **THEN** PostgreSQL rejects the write with a check-constraint violation

#### Scenario: v7 permid accepted
- **WHEN** an INSERT sets a minted permid column to a valid UUIDv7 value
- **THEN** the write succeeds

#### Scenario: Reference column is deliberately unconstrained
- **WHEN** a reader finds `name_opinions.subject_permid` or `homonyms.permid` carrying no version CHECK
- **THEN** that is the specified behaviour rather than a gap, because the value is another row's minted permid and was constrained at its own minting site

## ADDED Requirements

### Requirement: Minted permid on an unversioned table is UNIQUE
A table that mints a `permid` and is **not** versioned SHALL declare `permid uuid NOT NULL UNIQUE`, and SHALL
NOT call `install_version_triggers`.

On a versioned table, many rows share one `permid` — one per edit — and "one row per permid" is meaningless;
what holds instead is "one *head* per permid", enforced by `place_in_lineage()`, which raises on a second row
with the same permid and `succeeded_by_id IS NULL`. An unversioned table has no succession chain to carry that
guarantee, so `UNIQUE (permid)` carries it directly. `taxa_linnaean` already states this reasoning inline in
`postgresql/create_new.sql`; this requirement generalises it so that the next unversioned minting table does
not have to rediscover it.

`persons` is such a table: it mints a permid and stays unversioned, so `persons.permid` is
`uuid NOT NULL UNIQUE` with the version CHECK, and `persons` has no `preceded_by_id`/`succeeded_by_id`.

The prohibition on `install_version_triggers` is not merely advisory — it is self-enforcing. The installer
creates `CREATE INDEX ... WHERE succeeded_by_id IS NULL`, and `place_in_lineage()` assigns to both chain
columns, so calling it on a table lacking them fails rather than silently misbehaving.

#### Scenario: persons.permid is unique
- **WHEN** an INSERT sets `persons.permid` to a value already held by another `persons` row
- **THEN** PostgreSQL rejects the write with a unique-constraint violation

#### Scenario: persons.permid is required
- **WHEN** an INSERT into `persons` omits `permid` or sets it to NULL
- **THEN** PostgreSQL rejects the write with a not-null violation

#### Scenario: persons is not versioned
- **WHEN** `create_new.sql` is executed
- **THEN** `persons` has no `preceded_by_id` or `succeeded_by_id` column, and no `install_version_triggers('persons')` call appears in the schema

#### Scenario: Versioned table permid stays non-unique
- **WHEN** a second version of a `refs` row is inserted with the same `permid` as its predecessor
- **THEN** the write succeeds, because `refs` is versioned and its permid is deliberately not UNIQUE

### Requirement: UUIDv7 time-ordering is accepted for persons
`persons.permid` SHALL be a UUIDv7 like every other minted permid, and the ordering information that UUIDv7
carries SHALL be treated as a known and accepted property of that column rather than a defect.

A permid on `persons` serves as an opaque, externally-facing identifier: one purpose of minting it is to avoid
exposing the sequential `persons.id`. UUIDv7 satisfies the part of that goal which matters — its 74 random bits
make a permid unguessable, so holding one permid gives no purchase on any other. But UUIDv7 is time-ordered by
construction, and `src/lib/uuidv7.js` is monotonic within a single millisecond. Two consequences follow, both
accepted:

1. `migrate-persons.js` walks its source rows in `person_no` order and mints one permid per row inside a single
   bulk run, so for the migrated cohort `ORDER BY permid` reproduces `ORDER BY id` exactly. The permid does not
   reveal the `id`'s *value*, but it does preserve its *ordering*.
2. A person created after migration carries their creation time, to the millisecond, inside their permid.

These are disclosed here because `persons` rows describe people, where creation-time and ordering disclosure
reads differently than it does for a fossil collection or a bibliographic reference. They are accepted rather
than mitigated: the threat this column is meant to close is enumeration, which UUIDv7 closes. Minting persons
as UUIDv4 instead was considered and rejected, because it would except one table from the project-wide v7 rule
and from every generic check built on it, in exchange for hiding an ordering that `persons.created_at` already
records.

#### Scenario: Bulk-minted permids sort in mint order
- **WHEN** `migrate-persons.js` mints permids for the full source cohort in one run
- **THEN** sorting those permids lexically reproduces the order in which they were minted, and this is the specified behaviour rather than a defect

#### Scenario: Permid is not guessable from another permid
- **WHEN** an API consumer holds one person's permid
- **THEN** no other person's permid is derivable from it, because the non-timestamp bits are random

#### Scenario: persons is not excepted from the v7 rule
- **WHEN** a reader asks why `persons` mints v7 despite the ordering disclosure
- **THEN** the answer is this requirement, and `persons.permid` remains subject to the same version CHECK and the same completeness scenario as every other minted permid
