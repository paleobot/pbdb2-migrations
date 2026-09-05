## MODIFIED Requirements

### Requirement: Permids are generated as UUIDv7
Every migration script that mints a `permid` SHALL generate it as a UUIDv7 value. Scripts SHALL NOT use
`crypto.randomUUID()` (UUIDv4) or any externally-sourced identifier as the permid for these tables.

The in-scope tables are every table whose rows carry a minted `permid`:

| Table | Minted by |
|---|---|
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

Script names in this requirement were previously unqualified bare filenames, because they formed one list of
which `migrate-collections.js` was still at the repository root, and `migration-script-layout`'s citation-form
rule keeps such a mixed list unqualified until the last of its members has been relocated. That condition is
now discharged: every script named here lives under `src/`, so the list is path-qualified in one edit, which
is what that rule anticipated. The table directs a reader to these files as the source of the guarantee that
each permid is a v7 value, so qualification is required rather than merely permitted.

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

### Requirement: Shared UUIDv7 generation helper
The project SHALL provide a single ESM helper module that exports a UUIDv7 generator backed by the `uuid` npm
package's `v7` function. All migration scripts that mint permids SHALL import this helper rather than
generating UUIDs inline, so the generation strategy can be changed in one place.

That module is `src/lib/uuidv7.js`, and it is now the only one. A byte-identical copy stood at the repository
root throughout the relocation of migration scripts under `src/`, so that a root-level script could import a
helper without reaching into `src/`. Two identical modules satisfied the letter of "a single ESM helper
module" only by accident of their being identical: a change to one would have left the other generating
permids by the old strategy, which is precisely what this requirement exists to prevent. The root copy was
deleted with the last root-level migration script, and this requirement's "single" is now literal.

#### Scenario: Scripts import the shared helper
- **WHEN** a migration script needs a new permid
- **THEN** it calls the shared helper's exported generator, and no script imports `randomUUID` from `crypto` for permid generation

#### Scenario: One module, not two identical ones
- **WHEN** the UUIDv7 generation strategy is changed
- **THEN** editing `src/lib/uuidv7.js` changes it for every script that mints a permid, because no second copy of the helper exists to be missed

#### Scenario: Backed by the uuid package
- **WHEN** the helper generates a value
- **THEN** the value is produced by the `uuid` package's `v7` function and is a valid UUIDv7
