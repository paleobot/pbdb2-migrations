## MODIFIED Requirements

### Requirement: Generate fresh permid per inserted authority
The script SHALL generate a UUIDv7 for each inserted authority row and store it as the `permid` column,
obtaining it from the shared UUIDv7 helper module rather than generating a UUID inline. Same pattern as
`migrate-refs.js`.

This requirement previously specified a v4 UUID from `crypto.randomUUID()`. That was superseded by the
`permid-uuidv7` capability, which forbids `crypto.randomUUID()` for permid generation; the superseding change
did not correct this text, leaving the two specifications in direct contradiction. The script has generated
UUIDv7 values since that change landed.

#### Scenario: UUID assignment
- **WHEN** a survivor row is inserted
- **THEN** its `permid` is a newly-generated UUIDv7, distinct from all other rows in the table, and the `authorities` table's version-nibble CHECK constraint accepts it
