## Why

The classic `specimens` table (167,150 rows) is the last of the large core entities with a target table
defined in `postgresql/create_new.sql` but no migration behind it. Its mapping in
`payloadSchemas/mappings/specimens.md` is settled, every enum it needs has been verified identical to its
classic source, and every foreign key it needs already resolves against migrated PostgreSQL data — so the
work is ready to be specified rather than explored further.

Migrating specimens now also unblocks nothing else and blocks nothing else, which is what makes it a clean
slice: occurrences, measurements, and the revised collections pass each land on their own schedule, and none
of them is a prerequisite here.

## What Changes

- **New migration** `src/specimens-migration/migrate-specimens.js`, reading MariaDB `specimens` (joined to
  `occurrences` and `collections` for derived fields) and writing the PostgreSQL `specimens` table.
- **Apply the `specimens` DDL.** The table is defined in `create_new.sql` but does not exist in the
  localhost database. Four foreign keys in that definition were recently corrected from `refs` to
  `collections`/`specimens`; the applied table must carry the corrected form.
- **Tenth step in the migration runner.** `specimens` is appended to the frozen run order after
  `collections`, with preconditions and postconditions in the same style as the existing nine.
- **Scope is specimens only.** Occurrences, measurements, and the revised collections pass are explicitly
  out of scope. `oldpbdb_occurrence_no` is populated as the join key those later migrations will use.
- **Mapping-doc corrections** in `payloadSchemas/mappings/specimens.md`: name the repository's established
  *0-sentinel fallback* rather than an undefined "house rule", trigger the person fallback on `0` rather than
  on "blank or null" (the columns are `NOT NULL DEFAULT 0` and are never null), and fix the one remaining
  lowercase `oldpbdbid`.
- **Fix the invalid example** in `payloadSchemas/specimen.schema.js`. The schema's own `examples[0]` fails
  `ajv` validation against the schema three ways: `preservationModes: ["compression"]` is not an enum member,
  and `provenance` and `specimenNumber` are unevaluated properties (`specimenNumber` is the old name for
  `identifiers`).

### Not in scope

- Deriving a specimen's taxon from its occurrence. `name_opinions_permid` is populated from
  `specimens.taxon_no` alone, which leaves it NULL on 144,690 rows (86.6%). This is the expected outcome:
  `taxon_no` has no meaning in 2.0, and resolving an occurrence's taxon means resolving reidentifications,
  which is the occurrences migration's decision to make.
- Migrating `measurements`, or the `specelt_*` element hierarchy.
- Moving `museum` / `pres_mode` into the `collections` payload where they arguably belong. The collections
  migration will be revisited separately; this change reads them from MariaDB directly.

## Capabilities

### New Capabilities
- `specimen-migration`: Migrate legacy MariaDB `specimens` rows into the new PostgreSQL `specimens` table —
  source extraction, the bimodal occurrence/taxon row shape, foreign-key resolution against migrated
  PostgreSQL data, payload construction and validation, sentinel and fallback rules, and anomaly reporting.

### Modified Capabilities
- `migration-runner`: The frozen run order gains a tenth step, `specimens`, after `collections`, with its
  own dependency edges, preconditions, and postconditions.
- `migration-script-layout`: The inventory of relocated migrations gains `src/specimens-migration/`, and the
  "nine migrations" count becomes ten.

## Impact

**Source (MariaDB `pbdb_archive`)**
- `specimens` — 167,150 rows, the migration subject.
- `occurrences` — read for `collection_no` and, for the reference fallback, `reference_no`. Read-only.
- `collections` — read for `museum` and `pres_mode`. Read-only.

**Target (PostgreSQL)**
- `specimens` — created and populated. Expected final count: 167,150.
- No other table is written.

**Reads from previously migrated PostgreSQL data**
- `persons` (`persons.id = person_no` by construction), `refs` and `collections` (via
  `legacyIDs.oldpbdbID`), `name_opinions` (via `oldpbdb_taxon_no` on root rows).

**Code**
- New: `src/specimens-migration/migrate-specimens.js`.
- Modified: `src/run-migrations.js` (tenth step), `payloadSchemas/mappings/specimens.md`,
  `payloadSchemas/specimen.schema.js` (example only), `postgresql/create_new.sql` (already edited; applied
  here).
- Reused unchanged from `src/lib/`: `resolvePersons`, `loadReferenceIdMap`, `loadNamePermidMap`
  (`identity.js`), `uuidv7.js`, `anomaly-log.js`, the two pool modules.

**Type and value mappings**
- `enum` → JSON string. All seven classic enums (`is_type`, `specimen_coverage`, `specimen_side`, `sex`,
  `measurement_source`, and collections' `pres_mode`, `museum`) were compared value-for-value against the
  schema enums: **identical, no gaps in either direction.**
- `set` → JSON array (`pres_mode` → `paleontology.preservationModes`) or first member
  (`museum` → `identifiers.institutionCode`).
- `float` → JSON number (`specimens_measured`; verified 0 non-integral values).
- `int unsigned` 0-sentinel → SQL NULL or a documented fallback.
- `varchar`/`mediumtext` → JSON string, key omitted when absent.

**Data-integrity risks**
- `reference_id` is `NOT NULL` and 11 source rows carry `reference_no = 0`. The fallback to the occurrence's
  reference is what keeps those rows migratable; a null-valued test would silently miss all 11 and abort the
  run, because the column is `NOT NULL DEFAULT 0` and never null.
- NULL and `0` are **both** used for "unset", unevenly per column — `occurrence_no` is 8,995 NULL plus
  12,397 zero, `taxon_no` is 140,525 NULL plus 4,165 zero. Testing only one form mis-buckets thousands of
  rows into the wrong branch of the bimodal split, which silently changes whether `collection_id`,
  `institutionCode` and `preservationModes` get populated at all.
- `is_type = ''` on 8,453 rows is not an enum member and would fail payload validation if written through.
- Two rows (`specimen_no` 67161, 67162) carry `authorizer_no = 0` and `enterer_no = 0` against `NOT NULL`
  columns.
- One occurrence (926337, `specimen_no` 20612) points at collection 3122352, which does not exist in classic
  `collections` at all.

**Relevant anomalies from `anomaly-report.md`**
- *"NULL vs empty string vs 0 used inconsistently for 'no value'"* (MEDIUM) — the dominant hazard here, in
  all three of its forms.
- *"0 as sentinel for NULL in FK columns"* — affects `occurrence_no`, `taxon_no`, `reference_no`,
  `authorizer_no`, `enterer_no`.
- `specimens` is listed among the tables with **zero orphans** on all three of its declared FKs, which this
  change's own cross-checks confirmed against migrated data.
- `modifier_no` is set on 25,956 rows and `updater_no` on none; neither has a target column, matching every
  other migrated table.
