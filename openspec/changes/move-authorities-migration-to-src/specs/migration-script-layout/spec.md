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

Remaining at the repository root (two scripts):

`migrate-authorities-opinions.js`, `migrate-collections.js`

#### Scenario: Inventory reflects a completed relocation
- **WHEN** a change relocates a root-level `migrate-*.js` script under `src/`
- **THEN** that change moves the script's entry from the root list to the `src/` table in this specification

#### Scenario: Root scripts keep their existing conventions
- **WHEN** a script is still listed as remaining at the repository root
- **THEN** it continues to import root-level connection modules and is not required to follow the `src/` layout until it is relocated

#### Scenario: Relocation resolves a deliberate duplication
- **WHEN** a script is relocated whose code was previously copied into `src/lib/` so that a `src/` module could avoid importing from the repository root
- **THEN** the relocating change deletes the copy from the relocated script and imports the `src/lib/` definition, because the shared-utility requirement admits only one home for code two migrations under `src/` both use
