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
| `src/pbot-schemas-migration/` | `migrate-pbot-schemas.js` |

Remaining at the repository root (three scripts):

`migrate-authorities.js`, `migrate-authorities-opinions.js`, `migrate-collections.js`

#### Scenario: Inventory reflects a completed relocation
- **WHEN** a change relocates a root-level `migrate-*.js` script under `src/`
- **THEN** that change moves the script's entry from the root list to the `src/` table in this specification

#### Scenario: Root scripts keep their existing conventions
- **WHEN** a script is still listed as remaining at the repository root
- **THEN** it continues to import root-level connection modules and is not required to follow the `src/` layout until it is relocated

#### Scenario: A PBot-sourced migration without a PBDB sibling is named in the singular
- **WHEN** `migrate-pbot-schemas.js` is relocated and the two existing PBot directories (`src/pbot-persons-migrations/`, `src/pbot-refs-migrations/`) both carry a trailing `s` on `migrations`
- **THEN** its directory is nonetheless `src/pbot-schemas-migration/`, singular, because the trailing `s` marked a contrast with a paired PBDB-sourced sibling and the schemas migration has no such sibling — and the inventory, not the surface pattern of neighbouring names, is the authority on the literal directory name
