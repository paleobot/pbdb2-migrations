## MODIFIED Requirements

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
| `name_opinions` | `migrate-authority-opinions.js`, `migrate-opinions.js` |
| `assignment_opinions`, `validity_opinions` | `migrate-opinions.js` |
| `taxa`, `taxa_clades`, `taxa_linnaean`, `taxon_annotations` | the SQL derivation layer |

This list previously named only `authorities`, `collections`, `refs`, `schemas`, `characters`, and `states`.
Eight further minted-permid columns have appeared since, all of which already comply; the list is expanded so
that its completeness scenario actually covers them. Its previous form would have passed with a UUIDv4 sitting
in `name_opinions`.

Script names in this requirement remain unqualified bare filenames: they form one list of which
`migrate-collections.js` is still at the repository root, and `migration-script-layout`'s citation-form rule
keeps such a mixed list unqualified until the last of its members has been relocated. The `name_opinions` row
nonetheless changes here, because `migrate-authorities-opinions.js` was **renamed** to
`migrate-authority-opinions.js` — and unlike a relocation, a rename leaves a bare filename naming nothing.

#### Scenario: Authorities/collections/refs permid is v7
- **WHEN** `migrate-authorities.js`, `migrate-collections.js`, or `migrate-refs.js` inserts a row
- **THEN** the `permid` is a UUIDv7 whose version nibble equals 7

#### Scenario: Pbot-sourced permid is v7
- **WHEN** `migrate-pbot-refs.js` or `migrate-pbot-schemas.js` inserts a refs/schemas/characters/states row
- **THEN** the `permid` is a freshly generated UUIDv7, not the source `pbotID`

#### Scenario: Opinion permid is v7
- **WHEN** `migrate-authority-opinions.js` mints a root `name_opinions` row, or `migrate-opinions.js` mints a `name_opinions`, `assignment_opinions`, or `validity_opinions` row
- **THEN** the `permid` is a UUIDv7 drawn from the shared helper, whose version nibble equals 7

#### Scenario: No UUIDv4 permids remain
- **WHEN** the in-scope migrations have completed
- **THEN** no row in any table listed above has a permid whose version nibble is 4
