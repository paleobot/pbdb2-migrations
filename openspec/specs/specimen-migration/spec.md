# specimen-migration Specification

## Purpose
Migrate legacy MariaDB `specimens` rows into the new PostgreSQL `specimens` table — source
extraction, the bimodal occurrence/taxon row shape, foreign-key resolution against migrated
PostgreSQL data, payload construction and validation, sentinel and fallback rules, and anomaly
reporting. Specimens only: occurrences and measurements are later migrations.
## Requirements
### Requirement: Read all source data from MariaDB
The script SHALL stream all rows from the MariaDB `specimens` table, ordered by `specimen_no ASC`, without
buffering the full result set, and SHALL log a starting row count. Required columns are the audit pair
(`authorizer_no`, `enterer_no`), the identity and link columns (`specimen_no`, `occurrence_no`, `taxon_no`,
`reference_no`), and the payload columns (`specimens_measured`, `specimen_coverage`, `specimen_id`,
`specimen_side`, `sex`, `specimen_part`, `measurement_source`, `magnification`, `is_type`, `comments`).

The source query SHALL `LEFT JOIN` `occurrences` on `occurrence_no` for `collection_no` and the occurrence's
own `reference_no`, and SHALL `LEFT JOIN` `collections` on the occurrence's `collection_no` for `museum` and
`pres_mode`. Both joins SHALL be outer joins, because 21,392 rows have no occurrence and one occurrence
points at a collection that does not exist.

The columns `specelt_no`, `modifier_no`, `updater_no`, `upload`, `upload_id`, `created`, `modified`, and
`updated` SHALL NOT be migrated. `specelt_no` is 0 on all 167,150 rows and carries no information;
`modifier_no`/`updater_no` have no target column, matching every other migrated table; the timestamp columns
are not carried, matching `migrate-collections.js`.

#### Scenario: Full streaming extraction
- **WHEN** the migration script executes the source query
- **THEN** all 167,150 rows are streamed from MariaDB ordered by `specimen_no ASC`, without buffering the full result set, and a starting row count is logged

#### Scenario: Outer joins preserve occurrence-less rows
- **WHEN** a source row has no occurrence
- **THEN** the row is still returned by the source query, with the joined `collection_no`, `museum`, `pres_mode`, and occurrence `reference_no` all null

#### Scenario: Deferred columns are not read
- **WHEN** the source query is built
- **THEN** it does not select `specelt_no`, `modifier_no`, `updater_no`, `upload`, `upload_id`, `created`, `modified`, or `updated`

### Requirement: Treat both `0` and NULL as "unset" on every legacy foreign-key column
The script SHALL treat `0` and SQL NULL as one and the same condition in every test it makes for whether a
legacy foreign-key column is set.

This is required because classic uses the two interchangeably for "no value", and the split differs per
column: `occurrence_no` is 8,995 NULL plus 12,397 zero, `taxon_no` is 140,525 NULL plus 4,165 zero, and
`reference_no` is 0 NULL plus 11 zero.

A test written against only one of the two forms SHALL be considered a defect even where it happens to
produce the right answer for the current data, because the two forms are not distributed predictably across
columns.

#### Scenario: Zero and null are one condition
- **WHEN** the script decides whether a row has an occurrence
- **THEN** it treats `occurrence_no = 0` and `occurrence_no IS NULL` identically, classifying all 21,392 such rows the same way

#### Scenario: A null-only test is a defect
- **WHEN** the reference fallback tests `reference_no IS NULL` alone
- **THEN** that is a defect, because all 11 rows needing the fallback hold literal `0` in a `NOT NULL DEFAULT 0` column and would instead reach the `NOT NULL` target constraint and abort the run

### Requirement: Migrate every source row regardless of which link it carries
The script SHALL migrate all 167,150 source rows and SHALL NOT filter, skip, or defer rows of either mode;
the target row count after a successful run SHALL be 167,150.

Classic `specimens` is bimodal: 144,690 rows carry an occurrence and no taxon, 21,392 carry a taxon and no
occurrence, and 1,068 carry both. No row carries neither.

Columns derived through a link SHALL simply be absent for rows lacking that link: a row with no occurrence
SHALL have `collection_id` NULL and no `preservationModes` key, and a row with no taxon SHALL have
`name_opinions_permid` NULL.

#### Scenario: Both modes migrate
- **WHEN** the migration completes
- **THEN** the `specimens` table holds 167,150 rows, comprising both the occurrence-linked and the taxon-linked rows

#### Scenario: A missing link yields a null column, not a skipped row
- **WHEN** a source row has `taxon_no = 0`
- **THEN** the row migrates with `name_opinions_permid` NULL rather than being skipped

### Requirement: Resolve persons with the 0-sentinel fallback
The script SHALL resolve `authorizer_person_id` from `authorizer_no` and `enterer_person_id` from
`enterer_no` against `persons.id`, which equals the legacy `person_no` by construction (established by
`src/persons-migration/migrate-persons.js`).

Both source columns are `int(10) unsigned NOT NULL DEFAULT 0` and are therefore never null; the unset value
is `0`. When either is `0`, the script SHALL apply the repository's 0-sentinel fallback by calling
`resolvePersons` from `src/lib/identity.js`: the non-zero member of the pair substitutes for the zero one,
and when both are `0` both become person 1. The script SHALL NOT reimplement this rule locally.

#### Scenario: Both audit columns zero
- **WHEN** `specimen_no` 67161 is migrated, whose `authorizer_no` and `enterer_no` are both `0`
- **THEN** both `authorizer_person_id` and `enterer_person_id` are set to 1, satisfying the `NOT NULL` target columns

#### Scenario: The shared helper is used
- **WHEN** the script resolves the audit pair
- **THEN** it calls `resolvePersons` from `src/lib/identity.js` rather than inlining an equivalent rule

### Requirement: Resolve the reference, falling back to the occurrence when unset
The script SHALL resolve `reference_id` from `specimens.reference_no` through the map built by
`loadReferenceIdMap` in `src/lib/identity.js`, which keys migrated `refs` by
`reference->'legacyIDs'->>'oldpbdbID'`.

When `reference_no` is `0` or NULL, the script SHALL instead resolve the reference from the joined
occurrence's `reference_no`. The target column is `NOT NULL`, so a row whose reference resolves through
neither path SHALL abort the run rather than be written or silently dropped.

#### Scenario: Fallback supplies the missing reference
- **WHEN** `specimen_no` 51257 is migrated, whose `reference_no` is `0` and whose occurrence 763861 carries `reference_no = 11407`
- **THEN** `reference_id` resolves to the migrated `refs` row for legacy reference 11407

#### Scenario: Unresolvable reference aborts
- **WHEN** neither the specimen's nor the occurrence's reference resolves to a migrated `refs` row
- **THEN** the offending `specimen_no` and both legacy reference numbers are logged and the migration aborts

### Requirement: Resolve the collection through the occurrence
The script SHALL resolve `collection_id` from the joined occurrence's `collection_no` against migrated
`collections` keyed by `collection->'legacyIDs'->>'oldpbdbID'`. The target column is nullable, so a row
without an occurrence SHALL be written with `collection_id` NULL.

An occurrence whose `collection_no` resolves to no migrated collection SHALL yield `collection_id` NULL, be
recorded as an anomaly, and SHALL NOT abort the run — this is a defect in the source data, not in the
migration.

#### Scenario: Occurrence-linked row resolves its collection
- **WHEN** a source row carries an occurrence whose `collection_no` is present in migrated `collections`
- **THEN** `collection_id` is the id of that migrated collection

#### Scenario: Orphaned collection is recorded, not fatal
- **WHEN** `specimen_no` 20612 is migrated, whose occurrence 926337 names collection 3122352, which does not exist in classic `collections`
- **THEN** the row migrates with `collection_id` NULL and one anomaly is recorded

### Requirement: Resolve `name_opinions_permid` from `taxon_no` alone
The script SHALL resolve `name_opinions_permid` from `specimens.taxon_no` through the map built by
`loadNamePermidMap` in `src/lib/identity.js`, which selects `permid` from `name_opinions` where
`succeeded_by_id IS NULL` and `oldpbdb_taxon_no` is not null. The `edge_class = 'root'` filter named in the
mapping document is redundant and SHALL NOT be added: only root rows carry `oldpbdb_taxon_no`, which makes
the lookup unambiguous, and the repository's existing helper already encodes this.

The script SHALL NOT derive a taxon from the row's occurrence. `name_opinions_permid` is therefore NULL on
144,690 rows (86.6%), which is the expected and accepted outcome: `taxon_no` has no meaning in 2.0, and
resolving an occurrence's taxon requires resolving reidentifications, which belongs to the occurrences
migration.

#### Scenario: Taxon-linked row resolves its permid
- **WHEN** a source row carries `taxon_no` present in `name_opinions.oldpbdb_taxon_no`
- **THEN** `name_opinions_permid` is that root row's `permid`

#### Scenario: Occurrence-linked rows are left null
- **WHEN** the migration completes
- **THEN** 144,690 rows have `name_opinions_permid` NULL, and no attempt was made to derive a taxon from their occurrences

#### Scenario: All referenced taxa resolve
- **WHEN** the 10,245 distinct non-zero `taxon_no` values are resolved
- **THEN** every one of them resolves to exactly one `name_opinions` permid, and an unresolvable value aborts the run

### Requirement: Populate `oldpbdb_occurrence_no` as the later-migration join key
The script SHALL write the source `occurrence_no` to the `oldpbdb_occurrence_no` column, using NULL where it
is `0` or NULL. This column is the join key the later occurrences and measurements migrations will use to
attach to these rows, and is the only surviving record of which occurrence a specimen came from once the
MariaDB source is retired.

#### Scenario: Occurrence number carried through
- **WHEN** a source row has `occurrence_no = 926337`
- **THEN** `oldpbdb_occurrence_no` is 926337

#### Scenario: Zero becomes null
- **WHEN** a source row has `occurrence_no = 0`
- **THEN** `oldpbdb_occurrence_no` is NULL rather than 0, following the repository's 0-to-NULL convention

### Requirement: Build specimen identity
The script SHALL set `specimen.name` to the string `pbdb_classic:${specimen_no}` and
`specimen.legacyIDs.oldpbdbID` to `specimen_no` as a string.

`name` is the schema's only required payload field and has no classic counterpart — it is a PBot concept
that becomes required going forward. `specimen_id` SHALL NOT be used for it: `specimen_id` is blank on
31,572 rows and is not unique (11,929 `(occurrence_no, specimen_id)` pairs are duplicated), so it cannot
serve as an identity.

#### Scenario: Placeholder name generated
- **WHEN** a source row has `specimen_no = 20612`
- **THEN** `specimen.name` is `"pbdb_classic:20612"` and `specimen.legacyIDs.oldpbdbID` is `"20612"`

### Requirement: Build the identifiers object
The script SHALL build `specimen.identifiers` from two collection- and specimen-level sources:

- `identifiers.catalogNumber` from `specimen_id`, verbatim. Classic values frequently embed the institution
  or free text (`"USNM 550991a"`, `"Museum of Cagli P707"`, `"P. tricostata Oeningen type"`); the script
  SHALL NOT attempt to parse, split, or normalise them. The key SHALL be omitted when `specimen_id` is null.
- `identifiers.institutionCode` from the joined collection's `museum`. When `museum` holds more than one
  value, the script SHALL take the first member of the MySQL `SET`. When there is no `museum` value — whether
  because the collection records none, or because the row has no collection at all — the script SHALL write
  the sentinel `'none specified'`, which is seeded as the first value of `dictionaries.institution_codes`
  for this purpose.

The sentinel is the value for 118,877 rows (71%): 97,485 occurrence-linked rows whose collection records no
museum, and all 21,392 rows with no collection. `institutionCode` is therefore never absent.

#### Scenario: Multi-valued museum takes the first member
- **WHEN** the joined collection's `museum` is `'BMNH,USNM'`
- **THEN** `identifiers.institutionCode` is `'BMNH'`

#### Scenario: Sentinel covers both no-museum cases
- **WHEN** a row's collection records a blank `museum`, or the row has no collection at all
- **THEN** `identifiers.institutionCode` is `'none specified'` in both cases

#### Scenario: Catalog number is verbatim
- **WHEN** `specimen_id` is `'Slide F-III-72-487 (Catatumbo) Loc: 43.4X118.9 (micr. P0-58)'`
- **THEN** `identifiers.catalogNumber` holds that string unchanged

### Requirement: Build the paleontology object
The script SHALL build `specimen.paleontology` from the joined collection's `pres_mode` and the specimen's
own measurement-context columns:

| Payload field | Source | Transformation |
|---|---|---|
| `preservationModes` | `collections.pres_mode` | split the `SET` on `,` into an array of strings |
| `numberMeasured` | `specimens_measured` | `float` → number |
| `coverage` | `specimen_coverage` | verbatim enum |
| `side` | `specimen_side` | verbatim enum |
| `sex` | `sex` | verbatim enum |
| `part` | `specimen_part` | verbatim string |
| `measurementSource` | `measurement_source` | verbatim enum |
| `magnification` | `magnification` | verbatim string |

`preservationModes` SHALL be absent on the 23,942 rows that have no collection (21,392) or whose collection
records no `pres_mode` (2,550). `magnification` SHALL pass through unchanged including the two malformed
values (`'x 0.0'`, `'312/50'`), because the target field is an unconstrained string and the migration is not
the place to repair them.

#### Scenario: Preservation set split into an array
- **WHEN** the joined collection's `pres_mode` is `'body,replaced with silica'`
- **THEN** `paleontology.preservationModes` is `['body', 'replaced with silica']`

#### Scenario: Collection-less row has no preservation modes
- **WHEN** a source row has no occurrence, and therefore no collection
- **THEN** the built payload has no `paleontology.preservationModes` key

#### Scenario: Malformed magnification passes through
- **WHEN** `magnification` is `'x 0.0'`
- **THEN** `paleontology.magnification` is `'x 0.0'`, unrepaired

### Requirement: Omit absent payload keys, treating the empty string as absent
The script SHALL omit a payload key entirely when its source value is null or the empty string. It SHALL NOT
write `null`, `""`, or a placeholder in place of an absent value, except where a requirement names an
explicit sentinel (`identifiers.institutionCode`).

The empty string matters for exactly one column. `is_type` is `''` on 8,453 rows and NULL on 85,857; every
other payload-bearing column uses NULL alone. `''` is not a member of `specimen.type`'s enum, so writing it
through would fail payload validation on those 8,453 rows.

#### Scenario: Empty-string enum is omitted
- **WHEN** a source row has `is_type = ''`
- **THEN** the built payload has no `specimen.type` key, and validation passes

#### Scenario: Null source values omitted
- **WHEN** `comments` is NULL
- **THEN** the built payload has no `specimen.notes` key rather than `notes: null`

### Requirement: Validate the payload before writing
The script SHALL build its validator once at startup by deriving the `db` variant of the annotated specimen
source in `payloadSchemas/specimen.schema.js`, resolving its enums from `dictionaries`, and compiling it with
`createAjv()`. It SHALL validate every built `specimen` payload, unwrapped (the object stored in the jsonb
column), before any database write. A validation failure SHALL log the offending `specimen_no`, the
validation errors, and the payload, and SHALL abort the migration. An enum resolution failure SHALL abort
the migration before any source row is read.

Validation is a meaningful gate here because all seven enums the payload carries were verified to match their
classic sources value-for-value. Two of them (`institutionCode`, `preservationModes`) are now resolved from
dictionary tables seeded with those same values, and five remain inline. So any enum violation reaching the
validator indicates a transformation bug rather than unexpected source data.

#### Scenario: Invalid payload aborts the run
- **WHEN** a built payload fails schema validation
- **THEN** the `specimen_no`, errors, and payload are logged and the migration aborts without writing

#### Scenario: Payload validated without an envelope
- **WHEN** a built payload `{ name, identifiers, paleontology }` is validated
- **THEN** it is passed to the validator as-is, not wrapped as `{ specimen: ... }`

### Requirement: Generate a UUIDv7 permid per row
The script SHALL generate `permid` as a UUIDv7 using `src/lib/uuidv7.js`, satisfying the target table's
version CHECK constraint. Each source row SHALL receive exactly one new permid.

#### Scenario: Permid satisfies the version check
- **WHEN** a row is inserted
- **THEN** its `permid` is a UUIDv7 and the table's `get_byte(uuid_send(permid), 6) >> 4 = 7` constraint holds

### Requirement: Record anomalies and write a run summary
The script SHALL record anomalies to a ledger in its own directory, and SHALL write a run summary reporting
at minimum: source row count, migrated row count, the occurrence-linked/taxon-linked/both split, the count
of rows using the reference fallback, the count using the person 0-sentinel, the count receiving the
`'none specified'` institution sentinel, and the count with a null `name_opinions_permid`.

Expected anomalies for the current source data are one orphaned collection reference (`specimen_no` 20612).
A non-zero count for any other anomaly class SHALL be reported rather than suppressed.

#### Scenario: Ledger written beside the script
- **WHEN** the migration records anomalies
- **THEN** they are written under `src/specimens-migration/`, not to the repository root

#### Scenario: Summary reports the bimodal split
- **WHEN** the migration completes against the current source data
- **THEN** the summary reports 167,150 migrated, 144,690 occurrence-linked, 21,392 taxon-linked, 1,068 carrying both, and 144,690 with a null `name_opinions_permid`

### Requirement: Guard `main()` behind a direct-invocation check
The script SHALL invoke `main()` only when it is the process entry point, guarding the call behind an
`import.meta.url === \`file://${process.argv[1]}\`` check rather than calling `main()` unconditionally at
module load. This makes the module safe to import for inspection or testing without running a migration as
a side effect.

Five of the repository's ten migration entry points call `main()` unconditionally; this script SHALL join
the five that do not, so that the unguarded set does not grow.

#### Scenario: Import does not migrate
- **WHEN** the module is imported rather than executed
- **THEN** no database connection is opened and no migration runs

#### Scenario: Direct invocation runs the migration
- **WHEN** the script is invoked as `node src/specimens-migration/migrate-specimens.js`
- **THEN** `main()` runs

