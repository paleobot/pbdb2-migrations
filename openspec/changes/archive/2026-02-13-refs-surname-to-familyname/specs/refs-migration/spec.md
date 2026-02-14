## MODIFIED Requirements

### Requirement: Author assembly
The script SHALL build a jsonb `authors` array of `{familyName, givenName}` objects for each reference. If `ref_authors` entries exist for a `reference_no`, those SHALL be used (ordered by `place`). Otherwise, the script SHALL build authors from the flat fields (`author1init`/`author1last`, `author2init`/`author2last`, `otherauthors`).

#### Scenario: ref_authors entries available
- **WHEN** a reference has entries in `ref_authors`
- **THEN** the `authors` array is built from `ref_authors` ordered by `place`, each as `{familyName, givenName}`

#### Scenario: Flat fields only
- **WHEN** a reference has no `ref_authors` entries and `author1last = 'Smith'`, `author1init = 'J.'`
- **THEN** the `authors` array contains at least `[{familyName: "Smith", givenName: "J."}]`

#### Scenario: otherauthors parsing
- **WHEN** a reference has no `ref_authors` entries and `otherauthors` is non-empty
- **THEN** the script attempts to parse `otherauthors` into additional author entries with `{familyName, givenName}` and logs a warning for unparseable values

#### Scenario: No author data
- **WHEN** a reference has no `ref_authors` entries and all flat author fields are empty
- **THEN** the `authors` array is empty and the script logs a warning with the `reference_no`
