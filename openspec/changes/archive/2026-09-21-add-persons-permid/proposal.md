## Why

`persons` is the only payload-bearing entity table in `postgresql/create_new.sql` without a `permid`.
Its identity is spread across three borrowed values — the `id` (a sequence value seeded from the legacy
`person_no`), `person->legacyIDs.oldpbdbID`, and `person->legacyIDs.pbotID` — none of which is a native,
opaque, canonical identifier. Adding a minted `permid` gives persons one, and is the prerequisite for
converting `payloadSchemas/person.schema.js` to the annotated-source form that `collection` and `specimen`
already use.

## What Changes

- `persons` gains a `permid uuid NOT NULL UNIQUE` column carrying the project's UUIDv7 CHECK.
- `src/persons-migration/migrate-persons.js` and `src/pbot-persons-migration/migrate-pbot-persons.js` mint
  that permid from the shared `src/lib/uuidv7.js` helper.
- The permid is **insert-only**: it is excluded from `migrate-persons.js`'s `ON CONFLICT (id) DO UPDATE SET`
  list, so a re-run cannot churn a permanent identifier.
- `persons` remains **unversioned** — no `preceded_by_id`/`succeeded_by_id`, no
  `install_version_triggers('persons')`. `UNIQUE (permid)` therefore carries the "one row per permid"
  guarantee that a succession chain carries on versioned tables.
- The UUIDv7 time-ordering property is recorded as a stated and accepted consequence rather than left
  for a later reader to discover.

Not breaking: `persons` is rebuilt from scratch by the migration runner, so no backfill, no `ALTER TABLE`,
and no deployed data is touched.

## Capabilities

### New Capabilities

None. This change adds a field and its guarantees to behaviour that three existing specs already own.

### Modified Capabilities

- `permid-uuidv7`: the minted-permid inventory gains `persons.permid` — in the table of columns requiring the
  version CHECK, and in the list of scripts that mint permids. The spec's completeness scenario ("no row in
  any table listed above has a permid whose version nibble is 4") only covers persons once persons is named,
  which is the same gap this spec was previously rewritten to close. Two new requirements join it: one
  stating that a minted permid on an *unversioned* table is `UNIQUE` (generalising the reasoning already
  written inline for `taxa_linnaean`), and one recording the accepted UUIDv7 time-ordering property, which
  matters for `persons` because that table holds people rather than records about fossils.
- `person-migration`: a new requirement for minting the permid and for its stability across the re-runs that
  the existing "Idempotent upsert" requirement already mandates.
- `pbot-person-migration`: a new requirement for minting a permid on inserted persons only; persons matched
  by the ORCID/email/name cascade keep the permid they were given by `person-migration`.

## Impact

**Target schema** — `postgresql/create_new.sql`, `CREATE TABLE persons` (line 4803). One added column. The
table is created before every table that references it, and `permid` is not referenced by any FK, so no
ordering changes.

**Migration scripts** — `src/persons-migration/migrate-persons.js` (the `INSERT ... ON CONFLICT` at line 176)
and `src/pbot-persons-migration/migrate-pbot-persons.js` (the `INSERT` at line 191). Both already run under
the migration runner's frozen ten-step order; neither step's position, preconditions, nor `writes`/
`firstWriterOf` declarations change.

`migration_exploration/testing/seed-and-run-sample.js` and `migration_exploration/testing/run-full-migration.js`
also INSERT into `persons`, without a `permid`, and will fail the NOT NULL constraint after this change. They
are deliberately not updated: `migration_exploration/` is superseded by `src/` and is left to break under
schema changes rather than maintained in parallel. They are named here so the omission reads as a decision.

**Source data** — no new MariaDB columns are read. `person_no` continues to seed `persons.id` and
`legacyIDs.oldpbdbID`; the permid is newly minted, not derived from any source value. No type mapping and no
anomaly from `anomaly-report.md` applies: the affected source table is `person` (1.3K rows), which is not
among the tables carrying the coordinate, timestamp, or nested-set anomalies.

**Data integrity** — the risk this change introduces is a *churning* permid, which would silently break every
future reference to a person. It is closed at two levels: the migration scripts exclude `permid` from their
update paths, and `NOT NULL` + `UNIQUE` + the version CHECK make a missing, duplicated, or non-v7 permid a
write-time error rather than a latent inconsistency. No separate runner postcondition is added, because a
`COUNT(*)` predicate could only assert what those three constraints have already made unrepresentable.

**Not in scope** — the ~30 `authorizer_person_id`/`enterer_person_id` columns keep referencing `persons(id)`
and stay `integer`, as `entity-versioning-triggers` requires for bounded unversioned tables; `permid` is an
alternate key, not a foreign key. `payloadSchemas/person.schema.js` keeps its current wrapper form, and
`REGISTRY` in `src/audit-payloads.js` keeps its current `collection` + `specimen` membership. Those belong to
the separate annotated-source conversion that this change unblocks. Note that the conversion needs more than
this column: the audit's generic row query (`src/audit-payloads.js:114`) selects `succeeded_by_id IS NULL AS
head`, which an unversioned `persons` can never satisfy, so that step must also teach the audit about
unversioned entities.

`permid` is not a merge key. Where one human legitimately holds two person records — persons 414 and 911 are
a known intentional pair — they receive two permids. Deduplication is not in scope and is not implied by
calling the permid canonical.
