## MODIFIED Requirements

### Requirement: Validate the stored jsonb against the lenient migration schema
The script SHALL build its validator once at startup by deriving the `db` variant of the annotated collection source (`deriveVariant(source, 'db')`), resolving its enums from `dictionaries` (`resolveEnums`), and compiling it with `createAjv()`. It SHALL then validate each built `collection` payload, unwrapped (the object that is stored in the jsonb column), before any DB write.

The `db` variant is the lenient schema:
- it has no `latitude`/`longitude`, `references`, or `permid` properties, which are stored in columns or child rows;
- it applies only base `required` lists, so create-time rules such as the admin1-required country list do not apply.

Enum resolution failures, including an empty dictionary table, SHALL abort the migration before any source row is read.

#### Scenario: Coordinate-less, reference-less jsonb validates
- **WHEN** a payload contains `name` and valid sub-objects but no `latitude`/`longitude` or `references` keys
- **THEN** validation passes

#### Scenario: Validation failure aborts the run
- **WHEN** a built payload fails `db`-variant validation
- **THEN** the offending `collection_no`, errors, and payload are logged and the migration aborts

#### Scenario: Legacy admin1 gap tolerated
- **WHEN** a payload has `admin0: "US"` and no `admin1`
- **THEN** validation passes

#### Scenario: Empty dictionary aborts before reading
- **WHEN** `dictionaries.admin1` holds no rows at startup
- **THEN** the migration aborts naming `dictionaries.admin1.iso` before streaming any MariaDB row

## REMOVED Requirements

### Requirement: Hydrate DB-driven enums before compiling the migration schema
**Reason**: Per-script hydration, which mutated `collectionMigrationSchema` in place, is replaced by the generic `x-enumFrom` resolver (payload-schema-enums). The admin0, admin1, and maritime enums are now declared in the collection source, and every other open vocabulary is resolved the same way. The `if`-condition country list is no longer DB-driven: it is an inline `x-create` rule absent from the `db` variant.
**Migration**: The script calls `resolveEnums` on the derived `db` variant (see the modified validation requirement). `loadDicts()` remains for its name→ISO lookup maps, which are transformation logic, not schema logic.
