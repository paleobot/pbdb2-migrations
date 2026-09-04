## Why

`move-persons-migrations-to-src` opened the root-script relocation and `move-refs-migrations-to-src`
continued it, naming this slice's obstacle in advance: *"The four remaining scripts are more entangled —
`migrate-authorities.js` in particular has to resolve the `src/lib/authorities-builders.js` duplication when
it moves"* (that change's `proposal.md:14`). This is slice 5, and it resolves that duplication.

The duplication is not incidental. `src/lib/authorities-builders.js:1-5` records its own expiry condition:
*"extracted verbatim from the root-level `migrate-authorities.js`… keep the two in sync **until the root
scripts move**."* Once `migrate-authorities.js` sits under `src/`, `migration-script-layout`'s
shared-utility requirement stops being advisory — the three functions are shared with the opinions migration
through `src/lib/attribution.js`, so they must live in `src/lib/` and both callers must import them there.

Scoping this slice also turned up a four-line contradiction between capability specs, folded in here rather
than deferred: three specs still *mandate* the UUIDv4 permids that `permid-uuidv7` forbids. Two of the four
lines are in `authorities-migration`, the spec this change already edits.

## What Changes

**Relocation.**

- Move `migrate-authorities.js` → `src/authorities-migration/migrate-authorities.js`, repointing
  `./db.js` → `../lib/db.js` and `./uuidv7.js` → `../lib/uuidv7.js`.
- Delete `decodeEntities`, `buildDescriptorsFromFields`, and `buildCitationFromFields` from the script and
  import them from `../lib/authorities-builders.js`. The two copies are byte-identical (verified by diff,
  modulo the `export` keyword), so this removes a duplicate rather than changing behaviour.
- Move `play/test-authorities-transforms.js` → `src/authorities-migration/tests/test-authorities-transforms.js`,
  splitting its import block across the two modules it now draws from. The script does **not** re-export the
  shared builders to spare the harness that edit.
- `./payloadSchemas/authority.schema.js` becomes `../../payloadSchemas/authority.schema.js` and continues to
  reach above `src/`. `payloadSchemas/` is a shared schema asset consumed by the application, not a migration
  utility; `src/lib/attribution.js:5` already imports from it exactly this way.
- Update the `authorities` step's entry point in `src/run-migrations.js` and the run-order table in
  `migration-runner`. The step **name** is unchanged, which is what that spec's "Steps are addressed by name"
  requirement exists to guarantee.

**Spec reconciliation.** `permid-uuidv7` was added in July without declaring the specs it superseded as
MODIFIED, so three specs instruct a reader to do what a fourth forbids:

| Spec line | Current text |
|---|---|
| `refs-migration:27` | "SHALL generate a v4 UUID using `crypto.randomUUID()`" |
| `authorities-migration:275` | "SHALL generate a v4 UUID using `crypto.randomUUID()`" |
| `authorities-migration:279` | "**THEN** its `permid` is a newly-generated v4 UUID" |
| `collection-migration:192` | "SHALL generate a fresh `randomUUID()` `permid`" |

against `permid-uuidv7:9`: *"Scripts SHALL NOT use `crypto.randomUUID()` (UUIDv4)."* All four are corrected
to UUIDv7. No code changes follow from this: an audit found zero `randomUUID` / v4 / `gen_random_uuid`
occurrences in any JavaScript, all eight permid-minting scripts already import the shared helper, and
localhost holds zero non-v7 permids across every table carrying one.

`permid-uuidv7`'s in-scope list is also refreshed. It names six tables; fourteen minted `permid` columns now
carry the v7 CHECK. The missing eight — `name_opinions`, `assignment_opinions`, `validity_opinions`, `taxa`,
`taxa_clades`, `taxa_linnaean`, `taxon_annotations`, and `homonyms.homonym_group_id` — are added, along with
the rule the schema already follows consistently but never states: **a column that mints an identity carries
the v7 CHECK; a column holding another row's permid does not** (`subject_permid`, `target_permid`,
`containing_permid`, `concept_permid`, `homonyms.permid`). `timescales.permid` and `intervals.permid` stay
excluded under that spec's existing final requirement.

The stale list has a live consequence worth recording: the "No UUIDv4 permids remain" scenario verifies only
six tables, so it would pass with a UUIDv4 sitting in `name_opinions`.

**Citation corrections.** Two specs cite the relocated script as the source of the shared builders —
`assignment-opinions-migration:93` and `synonymy-opinions-migration:117` both say the helpers come *"from
`migrate-authorities.js`"*. That is already false (`src/lib/attribution.js:6` imports them from
`authorities-builders.js`) and becomes actively misdirecting once the script no longer defines them. Both are
repointed at `src/lib/authorities-builders.js`.

## Capabilities

### New Capabilities

None. `migration-script-layout` remains the durable home for the layout convention.

### Modified Capabilities

- `migration-script-layout`: **Modified** — the inventory moves `migrate-authorities.js` from the root list
  (three scripts → two) into the `src/` directory table as `src/authorities-migration/`.
- `migration-runner`: **Modified** — run-order row 6 becomes
  `src/authorities-migration/migrate-authorities.js`. The "Name survives relocation" scenario is also
  rewritten: it uses *this move* as a future-tense illustration, so landing this change turns its example
  into a past event. It is repointed at `migrate-collections.js`, which remains at the root.
- `permid-uuidv7`: **Modified** — the in-scope table list is expanded from six to fourteen columns, and the
  minted-identity-versus-reference rule is stated.
- `authorities-migration`: **Modified** — permid generation is UUIDv7, not a `crypto.randomUUID()` v4
  (requirement text and its scenario's THEN clause).
- `refs-migration`: **Modified** — same UUIDv4 → UUIDv7 correction.
- `collection-migration`: **Modified** — same UUIDv4 → UUIDv7 correction.
- `assignment-opinions-migration`: **Modified** — the shared attribution helpers are cited as coming from
  `src/lib/authorities-builders.js` rather than `migrate-authorities.js`.
- `synonymy-opinions-migration`: **Modified** — the same citation correction.

Eight delta specs is a large surface for a relocation, and worth justifying. Two are the relocation proper.
Three are the UUIDv4 contradiction, which is folded in rather than deferred because two of its four lines sit
in `authorities-migration`, a spec this change edits regardless. Two are citations pointing at the moved
script as a source of guarantee, which `migration-script-layout`'s citation-form rule puts squarely in a
relocation's scope. One is `permid-uuidv7`'s own scope list, which cannot be corrected without touching that
spec.

## Impact

**Source and target tables.** MariaDB `authorities` (517K rows) is read; PostgreSQL `authorities` is written.
Neither schema changes. No new transformation or type mapping is introduced: the scenario classification,
citation and descriptor construction, dedup key, person 0-sentinel fallback, and JSONB payload shape are all
carried across unaltered. The MariaDB 0-as-NULL handling for `authorizer_no` / `enterer_no` is unchanged, as
is the scenario ④ "authority unknown" sentinel convention. No anomaly class from `anomaly-report.md` newly
enters or leaves play.

**Code moved.** `migrate-authorities.js` (~11.5 KB) and `play/test-authorities-transforms.js` (~6.5 KB).

**Code edited in place.** `src/run-migrations.js` (one entry-point path);
`src/lib/authorities-builders.js` (its header comment's "until the root scripts move" caveat is now
satisfied and should say so); `docs/taxa-opinions-migration-mapping.md:659`.

**A first for this slice: the moved file's line count changes.** Removing three function bodies drops roughly
34 lines. Every prior relocation preserved line count exactly — the refs slice did so deliberately, because a
`docs/` citation named `migrate-refs.js:300`. Here `docs/taxa-opinions-migration-mapping.md:659` cites
`migrate-authorities.js:143` for the `persons.id == person_no` guarantee, and that citation is **already
stale by seven lines** (the comment sits at 150-151 today). It must be both path-qualified and renumbered
against the post-move file, not carried over untouched.

**No permission-entry change.** Unlike the refs slice, `.claude/settings.local.json` carries no
`Bash(node migrate-authorities.js:*)` entry, so nothing there needs updating.

**Databases.** This change performs no migration and alters no schema. Verification re-runs three existing
steps against localhost to prove the relocated script produces identical output.

**Data-integrity risk: low, with one real failure mode.** A script that no longer resolves an import fails at
module load, loudly, before any query. The second-order risk is the builder collapse: if the two copies were
*not* in fact identical, citations and descriptors would shift silently and the row count would not move,
because dedup happens on a key built from those very strings. This is why the 34-assertion transform harness
is part of verification rather than an afterthought — it covers all three collapsed functions directly,
including the HTML-entity decode and every delimiter split.

Losing root `db.js`'s `MIGRATION_TEST_MODE` branch is a verified no-op here:
`migration_exploration/testing/db-test-shim.js` intercepts on `/ORDER BY opinion_no ASC/` against the
`opinions` table and cannot answer an authorities query at all.

**Verification baseline**, captured from localhost `pbdb` before any change:

| Measure | Value |
|---|---|
| `authorities` | 163,067 — matches the archived scenario-④ figure exactly |
| `name_opinions` | 766,427 (517,284 root rows from step 7, remainder from step 8) |
| `assignment_opinions` | 927,497 |
| `validity_opinions` | 11,327 |
| `refs` / `collections` | 93,940 / 275,554 — untouched by this verification |
| transform harness | 34 passed, 0 failed |

**Verification cannot be a re-run of the migration.** `migrate-authorities.js` issues a bare `INSERT` with no
upsert and no natural key; the runner declares it `firstWriterOf: ['authorities']` precisely so a second run
is refused rather than silently doubling the table. `--from authorities` does not work either: preflight 4/5
requires every first-writer table across the selected steps to be empty, and the FK closure from
`authorities` reaches only `name_opinions` and the three (currently empty) taxa tables — leaving
`assignment_opinions`, `validity_opinions`, `collections`, and `additional_collection_refs` populated, so
preflight aborts. Three `--only` invocations are used instead, which narrows preflight to one step's tables at
a time and leaves `persons`, `refs`, and `collections` alone — so the comparison carries **zero** live-PBot
GraphQL nondeterminism. That matters: `refs` stands at 93,940 today against the 93,879 the refs slice
recorded, so upstream drift has already occurred once and a full rebuild would have to account for it.

**Not in scope.**

- **Moving `migrate-authorities-opinions.js` or `migrate-collections.js`.** Two scripts remain at the root.
  `migrate-authorities-opinions.js` imports nothing from the relocated script — only `db.js`, `uuidv7.js`,
  and `opinionAttribution.schema.js` — so it separates cleanly into a later slice, even though verification
  here exercises it.
- **Adopting `src/lib/identity.js`'s `resolvePersons()`.** It is behaviourally identical to the inline block
  except that the inline version also increments `bothPersonsZero` and calls its `logBothZero` sample logger.
  Adopting it means either dropping those or widening a `src/lib/` return signature that
  `migrate-opinions.js` depends on — the refs slice's "behavioral refactor wearing a relocation's clothes".
- **Adopting `identity.js`'s `loadReferenceIdMap()`.** Recorded so nobody attempts it: it genuinely cannot
  substitute. The authorities pre-load keys by `String(legacy)`, carries `refAuthors` and `publicationYear`
  for scenario ①, and filters on `oldpbdbID IS NOT NULL`; `identity.js` keys by integer, returns only `id`,
  and applies no such filter.
- **Deduplicating the two copies of the UUIDv7 helper.** `uuidv7.js` and `src/lib/uuidv7.js` are
  byte-identical, which defeats that spec's own rationale — *"so the generation strategy can be changed in
  one place"* — and matters now that dev and prod are on Aurora PG18, where the native `uuidv7()` swap the
  module's comment anticipates is available. It closes on its own when `migrate-collections.js`, the last
  root script importing it, moves. Fixing it here would leave the root copy importable by two root scripts
  and nothing gained.
- **Path-qualifying the comparative asides.** `authorities-migration:259`/`275`/`311` ("Same fallback as",
  "Same pattern as", "Logging style matches"), `permid-uuidv7:12,16` (a mixed list of five scripts, two still
  at root), and `name-opinions-migration:18,96` all stay bare filenames per the citation-form rule. Note the
  UUIDv4 correction at `authorities-migration:275` is orthogonal: fixing the UUID version in that sentence
  does not path-qualify the `migrate-refs.js` aside sitting in it.
- **`refs-migration:24`**, which says the id sequence resets to `MAX(id) + 1` where the code does
  `setval(…, MAX(id))`. Pre-existing; the refs slice found and declined it too.
- **Repairing `migration_exploration/lib/attribution.js:6`**, which imports
  `'../../migrate-authorities.js'` and therefore stops resolving once this change lands, taking the 48 pair
  handlers under `migration_exploration/opinions/` with it. This is the first relocation slice to actually
  break that tree — nothing in it imported the scripts the earlier four slices moved — and it is left broken
  under the standing decision that `migration_exploration` is superseded by `src/opinions-migration/` and may
  be left to break during relocations. Recorded rather than silently accepted: the repair is a one-line
  repoint to `../../src/lib/authorities-builders.js` should that tree ever need to load again.
- **A stated home for a harness covering `src/lib/`.** `migration-script-layout` provides `<migration>/tests/`
  and `src/tests/` but nothing for `src/lib/` code tested on its own. Latent here, because the relocated
  harness is still principally about `migrate-authorities.js`; it will surface the first time someone wants
  to test a `src/lib/` module alone.
