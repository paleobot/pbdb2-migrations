## Context

Four relocation slices have landed (`move-persons-migrations-to-src`, `move-refs-migrations-to-src`,
`move-pbot-schemas-migration-to-src`, `relocate-opinions-root-files`), each one a near-mechanical move whose
verification was a re-run and a row count. This slice is the one those changes deferred, and it differs from
all four in ways that shape the plan:

```
                      persons/refs/pbot-schemas slices        this slice
                      ────────────────────────────────        ──────────
verification          re-run the script (idempotent)          NOT idempotent — bare INSERT,
                                                              runner refuses a second run
moved file's lines    preserved exactly (a docs citation       changes by ~−34 (three function
                      named migrate-refs.js:300)              bodies leave the file)
existing harness      none                                    34 assertions in play/
duplicated code       none                                    3 functions byte-identical with
                                                              src/lib/authorities-builders.js
```

Current import graph, and what it becomes:

```
BEFORE                                          AFTER
──────                                          ─────
migrate-authorities.js                          src/authorities-migration/
  ./db.js ──▶ MIGRATION_TEST_MODE branch          migrate-authorities.js
  ./uuidv7.js                                       ../lib/db.js
  ./payloadSchemas/authority.schema.js               ../lib/uuidv7.js
  defines decodeEntities ─────────┐                  ../lib/authorities-builders.js ──┐
          buildDescriptorsFromFields │                ../../payloadSchemas/…            │
          buildCitationFromFields ───┤                                                  │
    ▲                                │ byte-                                            │
    │ play/test-…-transforms.js      │ identical  tests/test-…-transforms.js             │
    │                                │              ├─▶ ../migrate-authorities.js (5 fns)│
src/lib/authorities-builders.js ◀────┘              └─▶ ../../lib/authorities-builders ◀─┘
    ▲                                                       ▲
    └─ src/lib/attribution.js ◀─ src/opinions-migration/    └─ src/lib/attribution.js (unchanged)
```

`src/lib/authorities-builders.js:1-5` states its own expiry condition — *"keep the two in sync until the root
scripts move"* — so the duplication is a known, dated debt rather than a discovery. Once
`migrate-authorities.js` is under `src/`, `migration-script-layout`'s shared-utility requirement makes
collapsing it mandatory rather than optional, because both the authorities and opinions migrations then use
those functions from inside `src/`.

## Goals / Non-Goals

**Goals:**

- Relocate `migrate-authorities.js` under `src/` following the established one-directory-per-migration layout.
- Collapse the three-function duplication into `src/lib/authorities-builders.js` as its single home.
- Keep the relocated script's behaviour bit-for-bit identical: same scenario classification, same citations
  and descriptors, same dedup keys, same row count, same payload shape.
- Bring the relocated migration's harness under the layout convention, where a migration's tests belong.
- Reconcile the four spec lines that still mandate UUIDv4 permids, and refresh `permid-uuidv7`'s in-scope
  inventory so its completeness scenario is actually complete.

**Non-Goals:**

- Any behavioural refactor. `resolvePersons()` and `loadReferenceIdMap()` from `src/lib/identity.js` stay
  unadopted (decisions 4 and 5).
- Relocating `migrate-authorities-opinions.js` or `migrate-collections.js`.
- Deduplicating `uuidv7.js` against `src/lib/uuidv7.js` (decision 7).
- Establishing where a harness covering `src/lib/` code should live (decision 6).
- Any change to the MariaDB source schema, the PostgreSQL target schema, or the migrated data.

## Decisions

### 1. Collapse the duplication rather than carry it under `src/`

The three functions are byte-identical modulo the `export` keyword, verified by extracting both copies and
diffing them. `migrate-authorities.js` deletes its definitions and imports from
`../lib/authorities-builders.js`.

*Alternative considered — keep both copies.* This is the smallest diff and would make verification a pure
`git diff` of import lines. Rejected: `migration-script-layout` requires that code shared by more than one
migration under `src/` live in `src/lib/`, and after the move both the authorities and the opinions migration
are under `src/`. Carrying the copy forward would land a knowing violation in the same change that claims the
layout convention now covers this script.

*Alternative considered — move all seven pure transforms into `src/lib/`,* leaving
`migrate-authorities.js` as pure orchestration. Rejected: the other four (`classifyScenario`,
`buildDescriptorsFromRef`, `buildCitationFromRef`, `buildAuthorityPayload`, `dedupKey`) have exactly one
caller, and `src/lib/` is for code more than one migration uses. It would also force decision 6, which this
change deliberately leaves open.

### 2. Split the harness's imports; do not re-export from the migration

The harness moves to `src/authorities-migration/tests/` and imports each function from the module that now
defines it:

```js
import { buildCitationFromFields, buildDescriptorsFromFields } from '../../lib/authorities-builders.js';
import { classifyScenario, buildDescriptorsFromRef, buildCitationFromRef,
         buildAuthorityPayload, dedupKey } from '../migrate-authorities.js';
```

*Alternative considered — re-export the two shared builders from `migrate-authorities.js`* so the harness's
import block needs no edit. Rejected: the re-export would exist solely to spare a test file one edit, and it
would reassert in code the very claim this change corrects in two other specs — that these helpers come from
`migrate-authorities.js`. A repository this careful about citations pointing at the true source of a guarantee
should not plant a misleading one in an import graph.

A migration's `tests/` directory importing from `src/lib/` is not a cross-migration import: `src/lib/` is
what the layout convention directs migrations to import from. The prohibition is on reaching into a *sibling
migration's* directory.

### 3. `payloadSchemas/` keeps reaching above `src/`

`./payloadSchemas/authority.schema.js` becomes `../../payloadSchemas/authority.schema.js`.

The instruction motivating this change was that the script should use `src/lib/` utilities rather than
reaching above `src/`. That is satisfied for the two modules that have `src/lib/` counterparts.
`payloadSchemas/` is different in kind: it is a shared schema asset consumed by the application, not a
migration utility, and it has no `src/lib/` counterpart. `src/lib/attribution.js:5` already imports
`../../payloadSchemas/opinionAttribution.schema.js` exactly this way, so the relocated script is consistent
with the precedent already inside `src/lib/` itself.

*Alternative considered — an `src/lib/schemas.js` re-export barrel* so that only one file reaches upward.
Rejected as ceremony: it adds an indirection layer whose only benefit is cosmetic, and it would make the
schema a migration-owned asset when it is not one.

### 4. `resolvePersons()` stays unadopted

`src/lib/identity.js`'s `resolvePersons()` implements the identical 0-sentinel fallback, but the inline block
in `migrate-authorities.js` also increments `bothPersonsZero` and calls its `logBothZero` sample logger.
Adopting the shared helper means either losing those, or widening its return value — which changes a
`src/lib/` module that `src/opinions-migration/migrate-opinions.js` depends on.

The refs slice named this class of change precisely: *"a behavioral refactor wearing a relocation's
clothes."* Keeping it out is what lets this change's verification be a diff plus a reproduction, rather than
a re-audit of the opinions migration.

### 5. `loadReferenceIdMap()` genuinely cannot substitute

Recorded so that a later reader does not mistake it for an oversight. The authorities refs pre-load and
`identity.js`'s `loadReferenceIdMap()` look interchangeable and are not:

| | authorities pre-load | `identity.js` |
|---|---|---|
| key type | `String(legacy)` | `Number` |
| value | `{ id, refAuthors, publicationYear }` | `id` only |
| filter | `oldpbdbID IS NOT NULL` | none |

`refAuthors` and `publicationYear` are what scenario ① builds its citation and descriptors from, so the
narrower helper cannot serve this script at all.

### 6. Leave `src/lib/` harness placement unresolved

`migration-script-layout` gives a home to a migration's harness (`<migration>/tests/`) and to a harness for a
script sitting directly under `src/` (`src/tests/`), but says nothing about a harness covering `src/lib/`.
This change does not need the answer: the relocated harness is still principally about
`migrate-authorities.js` — five of its seven imported functions come from there — so `<migration>/tests/`
is the correct home under the existing rule. Deciding the general case here would be speculative. It will
surface the first time someone wants to test a `src/lib/` module on its own.

Relatedly, the harness keeps its `test-authorities-transforms.js` name rather than being renamed to match the
`*.test.js` form used by `src/tests/pbot-schemas-summary.test.js`. Nothing runs either automatically
(`package.json`'s test script is a stub), so the divergence is cosmetic, and normalising a filename the
layout spec does not govern is exactly the drive-by correction that spec warns against.

### 7. Leave the duplicated UUIDv7 helper alone

`uuidv7.js` and `src/lib/uuidv7.js` are byte-identical, which defeats `permid-uuidv7`'s stated rationale
("so the generation strategy can be changed in one place") — a live concern now that dev and prod run Aurora
PG18, where the native `uuidv7()` swap the module's own comment anticipates is available.

It is nonetheless left alone. Two root scripts still import the root copy, so deleting it is impossible and
deduplicating it gains nothing while `migrate-collections.js` remains at the root. It closes for free in the
final slice. The proposal records it as a known-remaining gap so that slice inherits the finding.

### 8. Fold the UUIDv4 spec contradiction in rather than deferring it

Three specs mandate what a fourth forbids. Two of the four offending lines are in `authorities-migration`,
which this change already modifies, and one of them (`:275`) is the same sentence whose `migrate-refs.js`
aside the citation-form rule tells us to leave bare — so the change is already editing within inches of it.
Splitting the fix across a separate change would mean two changes touching one requirement for unrelated
reasons.

The version fix and the citation form are orthogonal and both rules are applied independently: `:275`'s UUID
version is corrected while its bare `migrate-refs.js` aside is left exactly as it stands.

*Alternative considered — a standalone `reconcile-permid-uuidv7-specs` change* covering all four lines plus
the inventory. Rejected on the user's instruction, and it is the weaker option anyway: it would have to
re-derive the audit this change's scoping already performed.

### 9. Correct the two helper-source citations

`assignment-opinions-migration:93` and `synonymy-opinions-migration:117` cite the helpers as coming "from
`migrate-authorities.js`". These are source-of-guarantee citations, which `migration-script-layout`'s
citation-form rule requires to be path-qualified — and they name the very script this change relocates, so
they are in scope by that rule regardless of the permid work. They are also already false today, and become
misdirecting the moment the script stops defining the functions.

They are handled as **spec deltas, not prose corrections**: the text sits inside a `### Requirement:` block,
and main specs are never hand-edited — a delta is the only route by which that text can legitimately change.

### 10. Verify with three `--only` runs, not `--from authorities`

`migrate-authorities.js` performs a bare `INSERT` with no upsert and no natural key; the runner declares it
`firstWriterOf: ['authorities']` so a second run is refused rather than silently doubling the table. A re-run
is therefore not available as a verification, which is what every prior slice used.

`--from authorities` also fails, and it is worth recording why so the next slice does not retry it. Preflight
4/5 requires every first-writer table across the *selected* steps to be empty, unioned over steps 6-9. The
recursive FK closure from `authorities` reaches only `name_opinions` and the three currently-empty taxa
tables:

```
authorities ─▶ name_opinions, taxa, taxa_clades, taxa_linnaean
   ✗ assignment_opinions and validity_opinions have NO FK to authorities or name_opinions

so TRUNCATE authorities CASCADE leaves populated:
   assignment_opinions 927,497   validity_opinions 11,327
   collections 275,554           additional_collection_refs 371,774
   ⇒ preflight aborts on four tables, before spawning anything
```

Satisfying it would mean rebuilding `collections` too — unrelated work, and it re-admits the live-PBot
GraphQL leg into the comparison.

Three `--only` invocations narrow preflight to one step's tables at a time:

| Step | Expected result |
|---|---|
| `TRUNCATE authorities, name_opinions, assignment_opinions, validity_opinions RESTART IDENTITY CASCADE` | all four empty |
| `--only authorities` | `authorities` = 163,067 |
| `--only authorities-opinions` | `name_opinions` = 517,284 root rows |
| `--only opinions` | `name_opinions` = 766,427; `assignment_opinions` = 927,497; `validity_opinions` = 11,327 |

`persons`, `refs`, `collections`, and `additional_collection_refs` are never touched, so the comparison has
zero live-source nondeterminism. This matters concretely: `refs` stands at 93,940 today against the 93,879
the refs slice recorded, so upstream PBot drift has already occurred once, and a full rebuild would have to
explain that delta before it could confirm anything about authorities.

*Alternative considered — a full `dropdb`/`createdb` and `--createdb` run* (~3m04s, all nine steps).
Rejected: strictly more work, destroys a known-good database, and imports the PBot drift problem above for no
additional coverage of the code this change touches.

*Alternative rejected during implementation — `src/opinions-migration/tests/reset-opinions.sql`.* This design
originally called for that script to clear the three opinion tables, since its header advertises exactly that
while preserving `persons`, `refs`, and `authorities`. **It no longer works against the current schema.** Its
`DROP TABLE name_opinions` is refused because `taxa`, `taxa_clades`, and `taxa_linnaean` each carry a
`winning_name_opinion_id` foreign key into `name_opinions` — constraints that did not exist when the script
was written. Run under `ON_ERROR_STOP` inside its own transaction it aborts cleanly, changing nothing, so the
discovery cost nothing; but the script is stale and any change relying on it will hit the same wall.

A plain `TRUNCATE … RESTART IDENTITY CASCADE` over the four tables is used instead, and is the better
instrument regardless: preflight requires only that the tables be **empty**, so the drop-and-recreate was
always doing more than the job needed. It performs no DDL, leaves every constraint and index in place, and
does not touch the three dictionary tables `reset-opinions.sql` would have dropped and reseeded — which are
inputs the opinions migration reads and which this change has no reason to disturb. Repairing
`reset-opinions.sql` is left out of scope: it belongs to the opinions migration, not this one.

### 11. Renumber the `docs/` citation rather than preserving line count

`docs/taxa-opinions-migration-mapping.md:659` cites `migrate-authorities.js:143` for the
`persons.id == person_no` guarantee. Two things are true: the citation is already stale by seven lines (the
comment sits at 150-151 today), and removing three function bodies moves it by roughly 34 more.

Every prior slice preserved the moved file's line count, so this is the first slice where a line-numbered
inbound citation must actually be recomputed. It is path-qualified *and* renumbered against the post-move
file, with the target line's content confirmed rather than arithmetic assumed.

## Risks / Trade-offs

**The builder collapse is the only silent-failure path in this change** → If the two copies were not in fact
identical, citations and descriptors would shift and the row count would not move, because `dedupKey` is
built from those very strings — so a count-only check would pass while the payloads changed. Mitigated three
ways: the copies were diffed before the change was written; the 34-assertion harness covers all three
collapsed functions directly, including HTML-entity decoding and every delimiter split; and the
`--only authorities` run must reproduce 163,067 exactly, a figure that is itself a function of the dedup key.

**Losing root `db.js`'s `MIGRATION_TEST_MODE` branch** → Verified a no-op for this script:
`migration_exploration/testing/db-test-shim.js` intercepts on `/ORDER BY opinion_no ASC/` against the
`opinions` table and cannot answer an authorities query at all. The same reasoning the refs slice used, and
it holds more cleanly here.

**Eight delta specs is a large surface for a relocation** → Accepted deliberately, and the proposal justifies
each. Two are the relocation, three the UUIDv4 contradiction, two the helper citations, one
`permid-uuidv7`'s own inventory. The risk is review fatigue rather than technical: none of the eight changes
any behaviour, and six of them correct text that is already false.

**Verification destroys and rebuilds three opinion tables** → `reset-opinions.sql` exists for exactly this
and documents the sequence; the tables are fully reproducible from steps 7 and 8, and the expected counts are
known in advance. The taxa tables that `CASCADE` also empties currently hold zero rows, so nothing is lost.
The derived taxa layer is not part of the nine-step pipeline and is rebuilt separately if it is ever
populated.

**A partially-completed verification leaves the database mid-pipeline** → The three `--only` runs must all
complete. If one fails, `authorities` and the opinion tables are in a known-empty-or-partial state, and the
remedy is to fix the fault and re-run the sequence from `reset-opinions.sql`, not to patch forward.

## Migration Plan

No deployment. The relocation is a working-tree change verified against localhost `pbdb`.

**Rollback:** `git revert` restores both files to the repository root; the `src/lib/` copy of the builders was
never deleted, so no code is lost by reverting. The database needs no rollback — the verification sequence
rebuilds the same rows either way, and can be re-run against the pre-change script to reproduce the identical
baseline.

## Open Questions

None blocking. Two items are deliberately deferred with their reasoning recorded above: where a harness
covering `src/lib/` code belongs (decision 6), and deduplicating the UUIDv7 helper (decision 7). Both are
inherited by the final relocation slice.
