## ADDED Requirements

### Requirement: Script citations are path-qualified only where they assert a source of truth
When a specification, code comment, or document refers to a migration script by filename, it SHALL be
path-qualified (for example `src/refs-migration/migrate-refs.js`) if and only if the reference directs the
reader to that file as the source of a stated guarantee. A reference that names a script as a comparative or
stylistic aside — "same fallback as", "same pattern as", "logging style matches" — SHALL remain an
unqualified bare filename.

A relocation change SHALL therefore update only the qualified citations of the scripts it moves, plus any
executable or tooling path that names the script's location. Bare filename mentions SHALL be left unchanged,
because a bare filename does not become inaccurate when a file moves.

Where a specification names several scripts together in one list and only some of them have been relocated,
that list SHALL remain entirely unqualified until every script in it has moved, so that the list does not
imply the unqualified entries live somewhere other than the repository root.

The authoritative answer to where any migration script lives is the inventory in this specification, not a
citation embedded in prose elsewhere.

#### Scenario: Source-of-guarantee citation is qualified
- **WHEN** a requirement states that persons ids equal legacy `person_no` "by construction" and names the migration that established it
- **THEN** that citation carries the script's full path under `src/`, because the reader is being sent to that file to verify the guarantee

#### Scenario: Comparative aside stays bare
- **WHEN** a requirement notes that a script's zero-sentinel fallback is the "same fallback as `migrate-refs.js`"
- **THEN** the mention remains an unqualified bare filename, and a relocation of `migrate-refs.js` does not edit it

#### Scenario: Mixed list stays unqualified until fully relocated
- **WHEN** a scenario names five scripts as actors and only two of them have been relocated under `src/`
- **THEN** all five remain unqualified bare filenames, and the list is path-qualified in a single later change once the last of them has moved

#### Scenario: Executable path is always updated
- **WHEN** a tooling configuration or permission entry names a script as an executable path, such as `node migrate-refs.js`
- **THEN** the relocation change updates it to the new path, regardless of the citation-form rule, because the old path no longer resolves

## MODIFIED Requirements

### Requirement: Inventory of migrated and not-yet-migrated scripts
This specification SHALL record which migration scripts have been relocated under `src/` and which remain
at the repository root, so that each successive relocation slice has an accurate starting point. Each
change that relocates a script SHALL update this inventory.

Under `src/`:

| Directory | Entry point |
|---|---|
| `src/opinions-migration/` | `migrate-opinions.js` |
| `src/persons-migration/` | `migrate-persons.js` |
| `src/pbot-persons-migrations/` | `migrate-pbot-persons.js` |
| `src/refs-migration/` | `migrate-refs.js` |
| `src/pbot-refs-migrations/` | `migrate-pbot-refs.js` |

Remaining at the repository root (four scripts):

`migrate-authorities.js`, `migrate-authorities-opinions.js`, `migrate-collections.js`,
`migrate-pbot-schemas.js`

#### Scenario: Inventory reflects a completed relocation
- **WHEN** a change relocates a root-level `migrate-*.js` script under `src/`
- **THEN** that change moves the script's entry from the root list to the `src/` table in this specification

#### Scenario: Root scripts keep their existing conventions
- **WHEN** a script is still listed as remaining at the repository root
- **THEN** it continues to import root-level connection modules and is not required to follow the `src/` layout until it is relocated
