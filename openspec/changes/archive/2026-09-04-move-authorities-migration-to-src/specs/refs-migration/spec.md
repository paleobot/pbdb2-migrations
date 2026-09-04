## MODIFIED Requirements

### Requirement: Generate permid UUID
The script SHALL generate a UUIDv7 for each reference and store it as the `permid` column, obtaining it from
the shared UUIDv7 helper module rather than generating a UUID inline. On idempotent re-runs, the `permid`
MUST NOT be overwritten.

This requirement previously specified a v4 UUID from `crypto.randomUUID()`. That was superseded by the
`permid-uuidv7` capability, which forbids `crypto.randomUUID()` for permid generation; the superseding change
did not correct this text, leaving the two specifications in direct contradiction. The script has generated
UUIDv7 values since that change landed.

#### Scenario: First insertion
- **WHEN** a reference is inserted for the first time
- **THEN** a new UUIDv7 is generated and stored as `permid`

#### Scenario: Idempotent re-run preserves permid
- **WHEN** the script is re-run and a reference with the same `id` already exists
- **THEN** the existing `permid` value is preserved (not overwritten by the upsert)
