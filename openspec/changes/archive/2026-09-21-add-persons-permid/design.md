## Context

`persons` (`postgresql/create_new.sql:4803`) is the only payload-bearing entity table in the target schema
without a `permid`. Every other one — `refs`, `collections`, `authorities`, `schemas`, `characters`,
`states`, the three opinion tables, and the four derived taxa tables — mints one.

It is also the only such table that will not be versioned. That is the constraint shaping this design: on
every existing minted-permid table, `permid` means *lineage identity* and many rows share one. On `persons`
it means *row identity*, one-to-one with `id`. The word is the same; the guarantees are not.

```
  VERSIONED (refs)                     UNVERSIONED (persons)
  ────────────────                     ─────────────────────
  id   permid   succ_by                id   permid
   1 ──▶ A ──────▶ 2                    1 ──▶ P1
   2 ──▶ A ──────▶ 3                    2 ──▶ P2
   3 ──▶ A       NULL ◀─ head           3 ──▶ P3
   4 ──▶ B       NULL ◀─ head

  "one HEAD per permid", enforced      "one ROW per permid", enforced
  by place_in_lineage()                by UNIQUE (permid)
```

There is one precedent in the schema: `taxa_linnaean` is unversioned, mints a permid, and carries
`UNIQUE (permid)` with the reasoning written inline at `postgresql/create_new.sql:5331`. The structural
pattern transfers. What does not transfer is durability — `taxa_linnaean` is a rebuildable cache whose
permids are re-derived by `rebuild_linnaean()`, whereas a person's permid must survive forever.

`persons` is rebuilt from scratch by the migration runner (`src/run-migrations.js`), whose first two steps
are `persons` and `pbot-persons`, with an `empty('persons')` precondition on the first. There is no deployed
`persons` data to preserve, so no backfill path is needed.

## Goals / Non-Goals

**Goals:**

- Give `persons` a native, opaque, unguessable identifier suitable for external exposure, so that the
  sequential `persons.id` need not be the API-facing key.
- Make that identifier canonical above the two legacy identifiers the row already carries
  (`legacyIDs.oldpbdbID`, `legacyIDs.pbotID`).
- Satisfy the structural precondition for converting `payloadSchemas/person.schema.js` to the annotated-source
  form, where a root-level `permid` with `x-storage: { column: "permid" }` is the shape `collection` and
  `specimen` already use.
- Guarantee the identifier is *permanent* — specifically, that it survives the re-runs that
  `person-migration`'s "Idempotent upsert" requirement mandates.

**Non-Goals:**

- Versioning `persons`. No `preceded_by_id`/`succeeded_by_id`, no `install_version_triggers('persons')`.
- Moving any foreign key onto `permid`. The ~30 `authorizer_person_id`/`enterer_person_id` columns keep
  referencing `persons(id)` and stay `integer`.
- Converting `payloadSchemas/person.schema.js`, or adding `person` to `REGISTRY` in `src/audit-payloads.js`.
  That is the separate step this change unblocks.
- Deduplicating person records. Two rows that describe one human keep two permids.
- Any change to `timescales` or `intervals`, which remain outside the UUIDv7 CHECK scope.

## Decisions

### D1 — `UNIQUE`, not merely `NOT NULL`

`persons.permid` is `uuid NOT NULL UNIQUE` plus the version CHECK.

*Alternative considered: leave it non-unique, matching every existing minted-permid column.* Rejected. On
versioned tables the non-uniqueness is not a choice but a consequence — rows accumulate per edit — and
uniqueness of the *head* is still enforced, by `place_in_lineage()`. Omitting `UNIQUE` here would drop that
guarantee entirely rather than relocate it.

*Alternative considered: defer `UNIQUE` in case `persons` is versioned later.* Rejected on the user's
explicit direction that pre-positioning for versioning is not a motivation. Were that to change, dropping a
unique constraint is a one-line migration; the expensive part would be code written against a 1:1 assumption,
and that cost is incurred by the assumption, not by the constraint that documents it.

`UNIQUE` also supplies the index that permid-keyed lookups need, so no separate index is created.

### D2 — Mint in the application, not via a column DEFAULT

Both scripts import the generator from `src/lib/uuidv7.js`.

*Alternative considered: `DEFAULT uuidv7()` in the DDL.* Rejected for two reasons. `permid-uuidv7` already
requires that every script minting a permid import the shared helper, "so the generation strategy can be
changed in one place"; a column default would be a second, divergent strategy. And `uuidv7()` is a
PostgreSQL 18 builtin — dev and prod are on Aurora 18, but localhost is on PostgreSQL 16, which is why the
project's CHECK is written in the `get_byte(uuid_send(...))` form rather than using
`uuid_extract_version()`. A DEFAULT would not run on the machine the migrations are developed against.

### D3 — The permid is insert-only

`migrate-persons.js` supplies `permid` in the INSERT column list and omits it from `ON CONFLICT (id) DO
UPDATE SET`.

This is the load-bearing decision of the change. The script mints a fresh permid on every pass over a source
row, including passes that resolve to updates. If `permid` appeared in the `DO UPDATE SET` list, every
re-run would reissue every person a new permanent identifier — the precise failure the column exists to
prevent, and one that would be silent, since the result satisfies `NOT NULL`, `UNIQUE`, and the version
CHECK equally well.

No existing minted-permid table has this hazard, because none of them upserts on a surrogate `id`. That is
why the exclusion is written into the spec rather than left as an implementation detail: a future reader
tidying the `DO UPDATE SET` list toward completeness would otherwise be making an improvement.

*Alternative considered: mint lazily, only on the insert branch.* This is `ON CONFLICT`-incompatible —
PostgreSQL decides insert-versus-update after the row is supplied. Minting unconditionally and discarding
the value on the update branch is correct and costs one UUID generation per skipped row.

### D4 — Accept UUIDv7's time-ordering rather than mitigate it

Measured against `src/lib/uuidv7.js`: lexical sort reproduced mint order for 2,000 IDs minted in one loop,
2,000/2,000. The generator is monotonic within a millisecond and time-ordered across millisecond boundaries;
both halves matter here, and only the pair of them is reproducible. How many milliseconds a given run spans
is a property of the machine it runs on and varies between runs, so it is not evidence of anything and is
not recorded as such.

Because `migrate-persons.js` walks source rows in `person_no` order, `ORDER BY permid` therefore reproduces
`ORDER BY id` exactly across the migrated cohort. The permid hides the `id`'s value but preserves its
ordering. Separately, persons created after migration carry their creation time to the millisecond.

This is accepted and documented rather than fixed, because the goal the column serves is non-enumerability,
which UUIDv7's 74 random bits deliver in full. The disclosure is ordering, not guessability, and
`persons.created_at` already records creation time.

*Alternative considered: shuffle the mint order across the cohort.* A one-line change that would decorrelate
the migrated rows, but not later signups. Rejected as buying little for a non-obvious loop invariant that a
later reader would likely "simplify" away.

*Alternative considered: mint `persons` permids as UUIDv4.* Rejected. It would except one table from a
project-wide rule and from the generic completeness check built on it, in exchange for concealing an ordering
that is already recorded in an adjacent column.

### D5 — No migration-runner postcondition

`src/run-migrations.js` builds its checks from four `COUNT(*)` predicates. A permid check expressible in that
vocabulary — all present, all distinct, all v7 — asserts exactly what `NOT NULL`, `UNIQUE`, and the version
CHECK have already made unrepresentable. Adding one would test PostgreSQL rather than the migration. The two
person steps keep their current `preconditions` and gain nothing else.

The one failure the constraints cannot catch — `migrate-pbot-persons.js` inserting a duplicate *person* on
re-run, with a new `id` and a valid new `permid` — is a duplicate row, not a duplicate permid. It is already
covered by that spec's "Idempotent operation" requirement and guarded by the runner's existing
`noneHave('persons', ..., 'legacyIDs.pbotID')` precondition.

### D6 — Column placement and ordering

`permid` goes immediately after `id`, matching `refs`, `collections`, `authorities`, and every other
minted-permid table. `persons` is created before every table that references it, and nothing references
`permid`, so no DDL reordering is required.

## Risks / Trade-offs

**Churning permid on re-run (D3)** → Closed structurally: `permid` is absent from the `DO UPDATE SET` list,
and `person-migration` carries a scenario asserting the value is byte-for-byte identical after a second run.
This is the risk most worth a reviewer's attention.

**A second permid minted for a person the cascade should have matched** → `migrate-pbot-persons.js` mints
only on its insert branch; matched rows are touched only by the existing `jsonb_set` backfills, which target
the `person` JSONB and cannot reach a flat column. Covered by a scenario.

**Ordering disclosure through UUIDv7 (D4)** → Accepted, not mitigated. Recorded as a requirement in
`permid-uuidv7` so that it reads as a decision rather than an oversight, and so that a future reviewer who
rediscovers it finds the reasoning instead of filing a bug.

**"Canonical identity" misread as "deduplicated identity"** → Persons 414 and 911 are a known intentional
pair for one human and will hold two permids. Stated explicitly in the proposal and as a scenario in
`pbot-person-migration`.

**The unblocked follow-on is larger than it looks** → Converting `person.schema.js` needs more than this
column. `src/audit-payloads.js:114` selects `succeeded_by_id IS NULL AS head` in a query shared by every
audited entity, which an unversioned `persons` can never satisfy. That step must teach the audit about
unversioned entities; this change does not, and does not pretend to.

**Accidental versioning of `persons`** → Self-enforcing rather than merely prohibited.
`install_version_triggers` creates `CREATE INDEX ... WHERE succeeded_by_id IS NULL` and `place_in_lineage()`
assigns to both chain columns, so a stray call fails loudly at schema-load time.

## Migration Plan

No deployment sequencing and no rollback procedure: `persons` is rebuilt from an empty database by
`src/run-migrations.js`, whose `persons` step already asserts `empty('persons')`. The change lands as a
schema edit plus two script edits, verified by a full runner pass. Rollback is reverting the commit and
rebuilding.

Verification after a full run: every `persons` row has a v7 `permid`; distinct permid count equals row count;
a second `migrate-persons.js` pass leaves every permid unchanged while still refreshing the mutable columns;
a second `migrate-pbot-persons.js` pass inserts nothing.

## Open Questions

None. Uniqueness (D1), minting site (D2), upsert exclusion (D3), the UUIDv7 ordering trade-off (D4), runner
scope (D5), and the schema-annotation boundary were all settled before this change was written.
