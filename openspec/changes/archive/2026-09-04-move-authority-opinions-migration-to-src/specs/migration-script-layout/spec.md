## MODIFIED Requirements

### Requirement: Script citations are path-qualified only where they assert a source of truth
When a specification, code comment, or document refers to a migration script by filename, it SHALL be
path-qualified (for example `src/refs-migration/migrate-refs.js`) if and only if the reference directs the
reader to that file as the source of a stated guarantee. A reference that names a script as a comparative or
stylistic aside — "same fallback as", "same pattern as", "logging style matches" — SHALL remain an
unqualified bare filename.

A relocation change SHALL therefore update only the qualified citations of the scripts it moves, plus any
executable or tooling path that names the script's location. Bare filename mentions SHALL be left unchanged,
because a bare filename does not become inaccurate when a file moves.

**A rename is not a relocation, and this rule does not extend to one.** When a script's *filename* changes,
every mention of the old name becomes false — a bare filename now names nothing, where after a mere move it
still named the file correctly. A change that renames a script SHALL therefore update **every** mention of
the old name, bare and path-qualified alike, including comparative asides that a relocation would leave
untouched. The distinction is that a relocation invalidates only a citation's *path*, while a rename
invalidates its *identity*.

Where a specification names several scripts together in one list and only some of them have been relocated,
that list SHALL remain entirely unqualified until every script in it has moved, so that the list does not
imply the unqualified entries live somewhere other than the repository root. A rename of one member of such a
list SHALL still be applied, because the mixed-list rule governs path qualification, not correctness of the
name itself.

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

#### Scenario: A rename updates even a comparative aside
- **WHEN** `migrate-authorities-opinions.js` is renamed to `migrate-authority-opinions.js`, and another specification names it in a comparative aside such as "as in `migrate-authorities-opinions.js`"
- **THEN** that bare mention is updated to the new name, because the file it named no longer exists — unlike a relocation, where the bare name would have remained accurate

#### Scenario: A renamed member of a mixed list is still corrected
- **WHEN** a bare list names several scripts, one of which is renamed while others remain at the repository root
- **THEN** the renamed member's name is corrected in place while the list stays unqualified, because the mixed-list rule defers path qualification and says nothing about a name that has ceased to be correct

### Requirement: Inventory of migrated and not-yet-migrated scripts
This specification SHALL record which migration scripts have been relocated under `src/` and which remain
at the repository root, so that each successive relocation slice has an accurate starting point. Each
change that relocates a script SHALL update this inventory.

Under `src/`:

| Directory | Entry point |
|---|---|
| `src/opinions-migration/` | `migrate-opinions.js` |
| `src/persons-migration/` | `migrate-persons.js` |
| `src/pbot-persons-migration/` | `migrate-pbot-persons.js` |
| `src/refs-migration/` | `migrate-refs.js` |
| `src/pbot-refs-migration/` | `migrate-pbot-refs.js` |
| `src/pbot-schemas-migration/` | `migrate-pbot-schemas.js` |
| `src/authorities-migration/` | `migrate-authorities.js` |
| `src/authority-opinions-migration/` | `migrate-authority-opinions.js` |

Remaining at the repository root (one script):

`migrate-collections.js`

The two authorities-related directories differ in the number of the word *authority*, and the difference is
deliberate rather than an inconsistency. `authorities-migration` migrates the `authorities` **table**, where
*authorities* is the head noun and the plural is correct. `authority-opinions-migration` migrates *authority
opinions*, where *authority* is an attributive modifier of the head noun *opinions* and English takes the
singular, as in *car park* or *user account*. Each directory's grammar follows from what it migrates.

#### Scenario: Inventory reflects a completed relocation
- **WHEN** a change relocates a root-level `migrate-*.js` script under `src/`
- **THEN** that change moves the script's entry from the root list to the `src/` table in this specification

#### Scenario: Root scripts keep their existing conventions
- **WHEN** a script is still listed as remaining at the repository root
- **THEN** it continues to import root-level connection modules and is not required to follow the `src/` layout until it is relocated

#### Scenario: Relocation resolves a deliberate duplication
- **WHEN** a script is relocated whose code was previously copied into `src/lib/` so that a `src/` module could avoid importing from the repository root
- **THEN** the relocating change deletes the copy from the relocated script and imports the `src/lib/` definition, because the shared-utility requirement admits only one home for code two migrations under `src/` both use

#### Scenario: Sibling directories may differ in grammatical number
- **WHEN** a reader compares `src/authorities-migration/` with `src/authority-opinions-migration/`
- **THEN** the difference is read as correct grammar rather than drift, because one names a table and the other uses *authority* attributively, and neither is to be "corrected" to match the other
