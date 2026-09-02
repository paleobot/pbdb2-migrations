## Context

The archived `create-opinions-migration` change created `src/` with two tenants — `src/lib/` (shared
utilities) and `src/opinions-migration/` (one migration) — and deferred moving the eight root-level
`migrate-*.js` scripts to a later refactor. This change is the first slice of that refactor, covering the
two persons scripts.

Current state, verified by inspection:

```
migrate-persons.js
  └── './db.js'  (root) ──────────┐  root db.js has a MIGRATION_TEST_MODE branch delegating to
                                  │  migration_exploration/testing/db-test-shim.js;
                                  │  src/lib/db.js deliberately dropped it
migrate-pbot-persons.js
  └── './pg-pool.js' (root) ──────┘  byte-identical to src/lib/pg-pool.js
  └── fetch() → pbot.paleobiodb.org/graphql   (no local module dependency)
  └── @countrystatecity/countries              (npm; migrate-persons.js only)
```

Root `pg-pool.js`, `mariadb-pool.js`, and `uuidv7.js` were diffed against their `src/lib/` counterparts and
are byte-identical. Nothing in the repo imports either persons script programmatically; the only inbound
references are three prose/config mentions of the old paths.

The constraint that shapes most decisions below: this is slice 1 of 8. Choices made here become the
default for `migrate-refs.js`, `migrate-pbot-refs.js`, `migrate-collections.js`, `migrate-pbot-schemas.js`,
`migrate-authorities.js`, and `migrate-authorities-opinions.js`.

## Goals / Non-Goals

**Goals:**

- Relocate both persons scripts under `src/` with their behavior byte-for-byte unchanged apart from the
  single import line each.
- Leave no stale reference to the old paths anywhere in the repo.
- Correct the `db-connection-config` spec, which predates `src/lib/` and describes the connection modules
  as one unprefixed set.
- Record the `src/` layout convention where the six remaining slices can cite it, rather than in an
  archived change's design notes.

**Non-Goals:**

- Extracting anything new into `src/lib/` (`normalizeOrcid` stays where it is).
- Unifying the nine divergent `setval(pg_get_serial_sequence(...))` call sites.
- Adding `payloadSchemas/person.schema.js` validation to either script.
- Amending the `pbot-person-migration` spec's reference to `migrate-pbot-refs.js`.
- Moving any of the other six root-level `migrate-*.js` scripts.
- Renaming the `person-migration` / `pbot-person-migration` capabilities to match the new directory names.

## Decisions

### 1. One directory per script, not one shared `persons` directory

```
CHOSEN                                    REJECTED
src/                                      src/
├── persons-migration/                    └── persons-migration/
│   └── migrate-persons.js                    ├── migrate-persons.js
└── pbot-persons-migrations/                  └── migrate-pbot-persons.js
    └── migrate-pbot-persons.js
```

The rejected alternative has a real argument behind it: `src/opinions-migration/` is named for its *target
tables*, both persons scripts write the same `persons` table, and they are order-dependent —
`migrate-persons.js` establishes `id = person_no` first, then `migrate-pbot-persons.js` matches, backfills,
and inserts on top. A shared folder would make that sequencing a property of the directory.

Separate directories win on connection isolation, which is the sharper distinction in practice. The two
scripts have genuinely different environment requirements, and `pbot-person-migration`'s "PG-only
connection" requirement is normative — the script must not acquire a MariaDB dependency. Sibling
directories with different `../lib/` imports keep that visible at a glance. The ordering dependency is
recorded in the layout spec instead of being implied by co-location.

The refs pair (`migrate-refs.js` / `migrate-pbot-refs.js`) has the identical shape and will follow this
same split.

### 2. Directory names carry a deliberate asymmetry

`src/persons-migration/` (singular *migration*) and `src/pbot-persons-migrations/` (plural *migrations*).

The asymmetry is intentional and user-confirmed, not a typo to be quietly normalized. It is called out
here because a future contributor — or a future slice following this precedent — will otherwise read it as
an error and "fix" it, breaking the path. Three naming conventions are now in play across the repo, and
none is being retrofitted onto the others:

| Layer | Form |
|---|---|
| `src/` directories | `opinions-migration`, `persons-migration`, `pbot-persons-migrations` |
| OpenSpec capabilities | `person-migration`, `pbot-person-migration` |

Renaming capabilities to match directories is explicitly out of scope; the divergence is tolerated.

### 3. This is a move; `src/lib/` was a copy

The root originals are deleted. This differs from how `create-opinions-migration` populated `src/lib/`,
which copied `migration_exploration/lib/` and left the originals in place — a deliberate choice there,
because live exploration handlers still imported them.

No such constraint exists here: nothing imports the persons scripts. Copying would create a second
divergence to maintain, on top of the one `src/lib/authorities-builders.js` already carries against
`migrate-authorities.js`. One canonical location per script.

### 4. "Use `src/lib`" is read narrowly

Only the two import lines change. No new module is extracted into `src/lib/`, even where a candidate is
visible — `normalizeOrcid` in `migrate-pbot-persons.js` is a domain rule with its own spec requirement and
would sit naturally beside `src/lib/identity.js`.

Rationale: extraction is a behavioral refactor wearing a relocation's clothes. Keeping this change to pure
relocation means its verification is a re-run and a diff, and it keeps the precedent for the remaining six
slices cheap. Extractions can follow once more scripts are under `src/` and the genuinely shared surface
is visible rather than guessed at.

### 5. `db-connection-config` describes two parallel sets, with a scoped rule

The spec's "Shared connection module" requirement names `pg-pool.js` / `mariadb-pool.js` / `db.js` with no
path prefix, written before `src/lib/` existed. There are now two copies of each.

The tempting fix — a blanket *"scripts under `src/` import from `src/lib/`, never above"* — is rejected
because it is already false in two places:

```
src/lib/attribution.js
  └── '../../payloadSchemas/opinionAttribution.schema.js'
      DELIBERATE. create-opinions-migration design.md:59 — a payload contract,
      not a utility; copying it would fork the contract.

src/opinions-migration/tests/cross-check-aurora.js
  └── '../../../pg-migrated-pool.js'
      GAP. src/lib/ has no counterpart. Same for pg-classic-pool.js, pg-play-pool.js.
```

So the rule is scoped: scripts under `src/` import from `src/lib/` **where a counterpart exists**.
`src/lib/` today covers exactly the target-PG + source-MariaDB pair; the three specialty pools
(`pg-classic-pool.js`, `pg-migrated-pool.js`, `pg-play-pool.js`) remain root-only. The spec states that
boundary honestly rather than asserting a rule the repo does not honor, and without pre-committing what the
remaining six slices should do about it.

Neither persons script needs a specialty pool, so this change is unaffected by the gap.

**Also decided:** the `MIGRATION_TEST_MODE` difference between the two `db.js` copies stays out of the
spec. The spec has never described that shim, and widening its surface mid-refactor is scope creep. The
difference is recorded here and in the proposal instead.

### 6. The layout convention becomes a capability spec, not a design note

The convention needs a durable home because six more slices will cite it. `design.md` is the wrong home —
this change gets archived, and archived design notes are not a source of truth (which is exactly why this
change had to re-derive the `src/` convention from `create-opinions-migration`'s archived design).

A small `migration-script-layout` capability spec fixes that: it states the layout, the import rule, the
run-artifact convention, and — usefully for the slices ahead — which scripts have moved and which have
not. Each future slice updates that inventory as it lands.

## Risks / Trade-offs

- **[Risk] A repointed import fails to resolve.** → Fails at module load, before any query, with a
  standard Node resolution error. Both scripts are idempotent, so a failed or partial run is recoverable by
  re-running after the fix. Caught immediately by the verification re-run.

- **[Risk] `migrate-persons.js` silently loses the `MIGRATION_TEST_MODE` escape hatch.** → Verified as a
  no-op: the shim targets `migration_exploration/testing/db-test-shim.js`, built for the opinions
  exploration harness, and was never exercised by the persons migration. Recorded in decision 5 so the
  loss is deliberate and findable rather than discovered later.

- **[Risk] The `pbot-persons-migrations` plural reads as a typo and gets "corrected".** → Decision 2
  documents it as intentional, and the layout spec carries the literal directory names.

- **[Trade-off] Separate directories hide the run-order dependency** between the two scripts that a shared
  folder would have made obvious. → The layout spec states the ordering requirement explicitly, which is
  more reliable than co-location anyway.

- **[Trade-off] Three naming conventions now coexist** (directories, capabilities, script filenames)
  without reconciliation. → Accepted. Renaming capabilities is a noisier change touching archived history;
  the divergence costs a lookup, not correctness.

- **[Risk] Slice 1 sets a precedent that turns out wrong at slice 6.** → Persons is the least entangled
  pair in the repo, so it tests the layout but not the hard cases (notably `migrate-authorities.js`, whose
  move should collapse the `src/lib/authorities-builders.js` duplication). The layout spec is written to be
  amendable by later slices rather than as a final settlement.

## Migration Plan

1. Create `src/persons-migration/` and `src/pbot-persons-migrations/`.
2. `git mv` each script into place — preserves history and makes the single import change legible in the
   diff.
3. Repoint one import line in each script. Change nothing else.
4. Update the three inbound references: `.claude/settings.local.json` permission entry,
   `migrate-authorities.js:150` comment, and the `authorities-migration` spec's path citation (via this
   change's delta spec, not by hand-editing the main spec).
5. Verify: record the current `persons` row count, run both scripts against localhost in order, confirm the
   count is unchanged and `migrate-pbot-persons.js` reports zero new inserts.
6. Confirm no reference to the old paths survives anywhere outside `openspec/changes/archive/`.

**Rollback:** `git revert`. Both scripts are idempotent and neither performs a destructive operation, so a
revert after a run leaves the database in a consistent state; no data restoration is needed.

## Open Questions

- **What happens when a slice needs a specialty pool?** `migrate-collections.js` or a future cross-check
  may need `pg-classic-pool.js`, `pg-migrated-pool.js`, or `pg-play-pool.js`, none of which have `src/lib/`
  counterparts — and `src/opinions-migration/tests/cross-check-aurora.js` already reaches above `src/` for
  one. Deferred: neither persons script needs them, and the right answer (copy into `src/lib/`, move, or
  keep the upward reach) depends on which slice hits it first.

- **Does `migrate-authorities.js`'s eventual move collapse the `src/lib/authorities-builders.js`
  duplication?** That file's header says "keep the two in sync until the root scripts move." Presumably
  yes, but it is that slice's decision, not this one's.
