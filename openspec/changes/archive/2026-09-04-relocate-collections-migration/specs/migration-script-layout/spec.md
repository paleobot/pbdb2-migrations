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
| `src/pbot-persons-migration/` | `migrate-pbot-persons.js` |
| `src/refs-migration/` | `migrate-refs.js` |
| `src/pbot-refs-migration/` | `migrate-pbot-refs.js` |
| `src/pbot-schemas-migration/` | `migrate-pbot-schemas.js` |
| `src/authorities-migration/` | `migrate-authorities.js` |
| `src/authority-opinions-migration/` | `migrate-authority-opinions.js` |
| `src/collections-migration/` | `migrate-collections.js` |

Remaining at the repository root:

**(none)**

**The relocation is complete.** All nine migrations live under `src/`, and the root list is stated as an
explicit *(none)* rather than removed, so that its emptiness reads as an assertion this specification makes
and not as a section someone forgot to fill in. A migration script SHALL NOT be added at the repository root:
a new migration begins in its own directory under `src/`, and the transitional allowance that let a
root-level script keep root-level conventions is spent.

Completion is checkable at the root itself. Once the last script moved, the duplicated root helper modules
were deleted, and the repository root now holds connection-pool modules and nothing else — no migration entry
point, no shared helper, no dual-database composite. Which pools remain there, and why, is
`db-connection-config`'s to state.

`collections-migration` is plural because *collections* is the head noun naming the table it migrates, the
same grammar as `authorities-migration`. It is not the attributive-noun case that requires the singular in
`authority-opinions-migration`.

The two authorities-related directories differ in the number of the word *authority*, and the difference is
deliberate rather than an inconsistency. `authorities-migration` migrates the `authorities` **table**, where
*authorities* is the head noun and the plural is correct. `authority-opinions-migration` migrates *authority
opinions*, where *authority* is an attributive modifier of the head noun *opinions* and English takes the
singular, as in *car park* or *user account*. Each directory's grammar follows from what it migrates.

#### Scenario: Inventory reflects a completed relocation
- **WHEN** a change relocates a root-level `migrate-*.js` script under `src/`
- **THEN** that change moves the script's entry from the root list to the `src/` table in this specification

#### Scenario: The root list is empty by assertion
- **WHEN** a reader consults the inventory to find which migration scripts are still at the repository root
- **THEN** they find an explicit *(none)*, which states that the relocation finished rather than leaving them to infer it from a missing section

#### Scenario: A new migration does not start at the root
- **WHEN** a migration is added to the repository after the relocation completed
- **THEN** it is created directly at `src/<subject>-migration/migrate-<subject>.js`, because the root-level convention was transitional and no longer applies to anything

#### Scenario: Relocation resolves a deliberate duplication
- **WHEN** a script is relocated whose code was previously copied into `src/lib/` so that a `src/` module could avoid importing from the repository root
- **THEN** the relocating change deletes the copy from the relocated script and imports the `src/lib/` definition, because the shared-utility requirement admits only one home for code two migrations under `src/` both use

#### Scenario: Sibling directories may differ in grammatical number
- **WHEN** a reader compares `src/authorities-migration/` with `src/authority-opinions-migration/`
- **THEN** the difference is read as correct grammar rather than drift, because one names a table and the other uses *authority* attributively, and neither is to be "corrected" to match the other

#### Scenario: A plural directory name is not corrected to match a singular sibling
- **WHEN** a reader compares `src/collections-migration/` with `src/authority-opinions-migration/`
- **THEN** the plural stands, because `collections-migration` names the `collections` table with *collections* as its head noun, which is the same construction as `authorities-migration` and not the attributive case
