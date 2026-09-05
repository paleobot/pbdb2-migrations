## MODIFIED Requirements

### Requirement: The migration run order is frozen in the runner
`src/run-migrations.js` SHALL execute the migration scripts in exactly this order, and this order SHALL be
the authoritative statement of the sequence:

| # | Step name | Entry point |
|---|---|---|
| 1 | `persons` | `src/persons-migration/migrate-persons.js` |
| 2 | `pbot-persons` | `src/pbot-persons-migration/migrate-pbot-persons.js` |
| 3 | `refs` | `src/refs-migration/migrate-refs.js` |
| 4 | `pbot-refs` | `src/pbot-refs-migration/migrate-pbot-refs.js` |
| 5 | `pbot-schemas` | `src/pbot-schemas-migration/migrate-pbot-schemas.js` |
| 6 | `authorities` | `src/authorities-migration/migrate-authorities.js` |
| 7 | `authority-opinions` | `src/authority-opinions-migration/migrate-authority-opinions.js` |
| 8 | `opinions` | `src/opinions-migration/migrate-opinions.js` |
| 9 | `collections` | `src/collections-migration/migrate-collections.js` |

Every entry point in this table now sits under `src/`. The table is the runner's own `STEPS` array restated,
so it is verifiable by reading `src/run-migrations.js` rather than by trusting this specification.

The order SHALL satisfy these dependency edges, each of which exists because the later step reads from
PostgreSQL what the earlier step wrote:

```
persons ──┬─▶ pbot-persons ──┐
          │                  ├─▶ pbot-refs ──▶ pbot-schemas
          └─▶ refs ──────────┤
                             ├─▶ authorities ──▶ authority-opinions ──▶ opinions
                             ├─────────────────────────────────────────────▶ (refs)
                             └─▶ collections
```

- `pbot-persons` matches and updates the rows `persons` created.
- `refs` requires `persons` for its `authorizer_person_id` / `enterer_person_id` foreign keys.
- `pbot-refs` resolves its enterer through `persons.person->'legacyIDs'->>'pbotID'` and deduplicates
  against `refs`.
- `pbot-schemas` resolves its enterer through `persons.person->'legacyIDs'->>'pbotID'` and its primary
  reference through `refs.reference->'legacyIDs'->>'pbotID'`.
- `authorities` reads `refs` filtered on `reference->'legacyIDs'->>'oldpbdbID' IS NOT NULL`.
- `authority-opinions` reads `authorities`.
- `opinions` builds its name permid map from `name_opinions` and its reference map from `refs`.
- `collections` reads `refs` filtered on `reference->'legacyIDs'->>'oldpbdbID' IS NOT NULL`.

The order SHALL NOT be changed except by a change that records the new order in this specification.

Row 9's entry point changes here, and nothing else does: the step keeps its name, its position, and every
dependency edge. This is the last of the nine relocations, so no future change to this table will be a
relocation.

#### Scenario: Full pipeline runs in the specified order
- **WHEN** `src/run-migrations.js` is invoked with no step-selection flag
- **THEN** it runs all nine steps in the order given in the table, and does not begin a step until the preceding step has completed successfully

#### Scenario: Every entry point resolves under src/
- **WHEN** the runner spawns any of the nine steps
- **THEN** the path it spawns is under `src/`, because no migration entry point remains at the repository root

### Requirement: Steps are addressed by name
The runner SHALL identify steps by the step names in the run-order table, and SHALL NOT require or accept
a numeric position as a step identifier. A step name SHALL remain stable when the script it names is
relocated, and SHALL NOT change when steps are appended to the pipeline.

A step name is nonetheless literal: it changes only by a deliberate decision recorded in this
specification, and SHALL NOT be changed as incidental cleanup by a passing reader, nor as a side effect of
relocating the script it names. This mirrors the rule `migration-script-layout` applies to migration
directory names, and it is what distinguishes a renamed step from a step whose name drifted.

Relocation-stability and deliberate renaming are therefore separate rules, not competing ones: a relocation
SHALL NOT change a step name, and a change that does rename a step SHALL record the reason here rather than
letting the rename ride along unexplained with a move that happens to accompany it.

The runner SHALL provide `--list`, which prints the step names in run order and exits without running any
migration or connecting to any database.

#### Scenario: Step named, not numbered
- **WHEN** a user selects a step on the command line
- **THEN** they write `--from authorities`, and `--from 6` is rejected as an unknown step name

#### Scenario: Name survives relocation
- **WHEN** `migrate-collections.js` was relocated to `src/collections-migration/migrate-collections.js`
- **THEN** the step name `collections` was unchanged and only the entry-point path in row 9 of the run-order table was edited, so `--only collections` kept working across the move

#### Scenario: Relocation already exercised this guarantee
- **WHEN** `migrate-authorities.js` was relocated to `src/authorities-migration/migrate-authorities.js`
- **THEN** the step name `authorities` did not change, so `--from authorities` and `--only authorities` kept working across the move and only row 6's entry-point path was edited

#### Scenario: Relocation-stability has no remaining cases
- **WHEN** a reader asks which steps might still change their entry point through a relocation
- **THEN** the answer is none, because all nine scripts are under `src/`, and the relocation-stability rule now governs only hypothetical future moves rather than pending ones

#### Scenario: A deliberate rename is recorded, not inferred from a move
- **WHEN** the step `authorities-opinions` is renamed to `authority-opinions` in the same change that relocates its script
- **THEN** the rename is justified by its own recorded reason — *authority* is attributive, so the singular is correct — and not by the relocation, which on its own would have left the name untouched exactly as it did for `authorities` and `collections`

#### Scenario: Old step name stops resolving
- **WHEN** `--only authorities-opinions` is passed after that step has been renamed
- **THEN** it is rejected as an unknown step name, because step names are addresses rather than aliases and the runner keeps no historical spellings
