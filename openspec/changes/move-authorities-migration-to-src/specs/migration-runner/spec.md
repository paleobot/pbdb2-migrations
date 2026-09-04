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
| 7 | `authorities-opinions` | `migrate-authorities-opinions.js` |
| 8 | `opinions` | `src/opinions-migration/migrate-opinions.js` |
| 9 | `collections` | `migrate-collections.js` |

The order SHALL satisfy these dependency edges, each of which exists because the later step reads from
PostgreSQL what the earlier step wrote:

```
persons ──┬─▶ pbot-persons ──┐
          │                  ├─▶ pbot-refs ──▶ pbot-schemas
          └─▶ refs ──────────┤
                             ├─▶ authorities ──▶ authorities-opinions ──▶ opinions
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
- `authorities-opinions` reads `authorities`.
- `opinions` builds its name permid map from `name_opinions` and its reference map from `refs`.
- `collections` reads `refs` filtered on `reference->'legacyIDs'->>'oldpbdbID' IS NOT NULL`.

The order SHALL NOT be changed except by a change that records the new order in this specification.

Only the entry-point path in row 6 changes here, following the relocation of `migrate-authorities.js` under
`src/`. The order itself, the step names, and every dependency edge are unchanged.

#### Scenario: Full pipeline runs in the specified order
- **WHEN** `src/run-migrations.js` is invoked with no step-selection flag
- **THEN** it runs all nine steps in the order given in the table, and does not begin a step until the preceding step has completed successfully

#### Scenario: PBot leg is interleaved rather than deferred
- **WHEN** the run order is read
- **THEN** `pbot-persons` follows `persons` and `pbot-refs` follows `refs`, so that each shared target table is complete from every source before any step that depends on that table runs

### Requirement: Steps are addressed by name
The runner SHALL identify steps by the step names in the run-order table, and SHALL NOT require or accept
a numeric position as a step identifier. A step name SHALL remain stable when the script it names is
relocated, and SHALL NOT change when steps are appended to the pipeline.

The runner SHALL provide `--list`, which prints the step names in run order and exits without running any
migration or connecting to any database.

#### Scenario: Step named, not numbered
- **WHEN** a user selects a step on the command line
- **THEN** they write `--from authorities`, and `--from 6` is rejected as an unknown step name

#### Scenario: Name survives relocation
- **WHEN** `migrate-collections.js` is later relocated to `src/collections-migration/migrate-collections.js`
- **THEN** the step name `collections` is unchanged and only the entry-point path in the run-order table is updated

#### Scenario: Relocation already exercised this guarantee
- **WHEN** `migrate-authorities.js` was relocated to `src/authorities-migration/migrate-authorities.js`
- **THEN** the step name `authorities` did not change, so `--from authorities` and `--only authorities` kept working across the move and only row 6's entry-point path was edited

#### Scenario: Listing steps touches nothing
- **WHEN** `--list` is passed
- **THEN** the nine step names are printed in run order and the process exits 0 without opening a database connection
