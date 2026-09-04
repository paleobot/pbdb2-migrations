## MODIFIED Requirements

### Requirement: Generate a fresh permid per collection
The script SHALL generate a fresh UUIDv7 `permid` for each inserted collection, obtaining it from the shared
UUIDv7 helper module rather than generating a UUID inline, and inserting rows as single versions
(`succeeded_by_id IS NULL`).

This requirement previously specified a `randomUUID()` permid. That was superseded by the `permid-uuidv7`
capability, which forbids `crypto.randomUUID()` for permid generation; the superseding change did not correct
this text, leaving the two specifications in direct contradiction. The script has generated UUIDv7 values
since that change landed.

#### Scenario: Unique permid assigned
- **WHEN** a collection is inserted
- **THEN** it receives a fresh UUIDv7 `permid` and no `preceded_by_id`/`succeeded_by_id`
