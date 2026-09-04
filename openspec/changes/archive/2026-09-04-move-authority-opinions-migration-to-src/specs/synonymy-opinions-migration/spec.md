## MODIFIED Requirements

### Requirement: Reset the identity sequence after insert
After a successful commit the script SHALL reset the `name_opinions` id sequence to `MAX(id)` (as in `migrate-authority-opinions.js` and `migrate-assignment-opinions.js`), so subsequent inserts do not collide with the migrated rows' identity values.

The first of those two filenames was `migrate-authorities-opinions.js` until that script was renamed. This
mention is a comparative aside and would ordinarily stay untouched by a relocation — but a rename is not a
relocation: the old filename no longer names any file, so the citation is corrected regardless of its form.

#### Scenario: Sequence reset
- **WHEN** the bulk insert has committed
- **THEN** the script sets the `name_opinions` id sequence to the table's current `MAX(id)`
