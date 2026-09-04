## Why

Slice 6 of the root-script relocation, and the second-to-last. `move-authorities-migration-to-src` left two
scripts at the repository root and named this one as separable: it *"imports nothing from the relocated
script — only `db.js`, `uuidv7.js`, and `opinionAttribution.schema.js` — so it separates cleanly into a later
slice"* (that change's `proposal.md`).

Relocating it forces a naming question that is worth settling properly rather than carrying forward. The
script is currently `migrate-authorities-opinions.js`, and under the `<subject>-migration` ↔
`migrate-<subject>.js` pairing rule that would give `src/authorities-opinions-migration/`. But *authority* in
this phrase is an **attributive noun**, not a plural: the head noun is *opinions*, and *authority* modifies
it — these are the opinions of authorities. English attributive nouns take the singular (*car park*, *book
shelf*, *user account*, never *cars park*). The correct form is `authority-opinions`.

## What Changes

Three renames expressing one decision about the script's identity:

| | From | To |
|---|---|---|
| Directory | *(at repository root)* | `src/authority-opinions-migration/` |
| Entry point | `migrate-authorities-opinions.js` | `migrate-authority-opinions.js` |
| Runner step name | `authorities-opinions` | `authority-opinions` |

- Repoint three imports: `./db.js` → `../lib/db.js`, `./uuidv7.js` → `../lib/uuidv7.js`, and
  `./payloadSchemas/opinionAttribution.schema.js` → `../../payloadSchemas/opinionAttribution.schema.js`.
  The last deliberately still reaches above `src/`, matching the precedent this repository already set in the
  authorities slice and in `src/lib/attribution.js:5`.
- Update every executable path that names the script or the step: the runner's `STEPS` entry (both `name` and
  `script`) and its dependency-graph comment, the spawn path and error string in
  `src/opinions-migration/tests/run-migration.js`, and the copy-pasteable command documented at
  `src/opinions-migration/tests/reset-opinions.sql:15`.
- Give step names, in `migration-runner`, the same escape hatch directory names already have in
  `migration-script-layout`: literal, changed only by a deliberate decision recorded in the specification,
  never as incidental cleanup.

**The step rename is the larger half.** Seven of `migration-runner`'s twelve requirements name the step —
the run-order table and dependency graph, the preflight environment grouping, the per-step precondition and
postcondition tables, the `--from`/`--only` narrowing scenario, and the halt-on-failure scenario. The
relocation itself touches two requirements. This is bundled rather than split because both are one decision
about one script's identity, and splitting would mean editing `migration-runner` twice in a week.

**This slice is unusually low-risk.** The two features that made the authorities slice dangerous are both
absent: there is no harness to relocate, and no duplicated code to collapse. The 282-line script exports
`buildAttribution` and `parsePublicationYear`, and nothing anywhere imports either.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `migration-runner`: **Modified**, seven requirements. Six carry the step-name change through the run-order
  table, dependency graph, environment grouping, precondition table, postcondition mapping, and two
  scenarios. The seventh — "Steps are addressed by name" — gains the deliberate-decision escape hatch that
  makes this rename legitimate rather than a violation of its own stability rule.
- `migration-script-layout`: **Modified**, two requirements. The inventory gains
  `src/authority-opinions-migration/` and its root list drops from two scripts to one. The citation-form
  requirement gains a sentence distinguishing a **rename** from a **relocation** (see below).
- `permid-uuidv7`: **Modified** — the minted-columns table and the "Opinion permid is v7" scenario both name
  the old filename. Both were written by the previous slice, one day ago.
- `synonymy-opinions-migration`: **Modified** — one requirement cites the script by its old name.

**A citation-form finding that changes how this slice behaves.** Every prior slice relied on
`migration-script-layout`'s rule that *"a bare filename does not become inaccurate when a file moves"* and
left bare mentions untouched. That reasoning holds for a move and **fails for a rename**:
`migrate-authorities-opinions.js` ceases to exist, so every mention of it becomes false whether or not it
carries a path. This is the first slice where bare filename mentions must also be updated, and the rule as
written would tell a reader to leave them alone. The citation-form requirement is therefore extended to state
that a relocation invalidates only path-qualified citations, while a rename invalidates every mention.

**One correction with no delta mechanism.** `name-opinions-migration:4` reads *"Implemented by
`migrate-authorities-opinions.js`"* — but that line sits in the spec's `## Purpose` section, not inside a
`### Requirement:` block, and OpenSpec deltas operate only on requirements. It is applied as a non-delta
correction alongside the sync and recorded in `design.md` as a tooling gap, rather than being silently
skipped or forced into a spurious requirement delta. That spec's other two mentions (lines 18 and 96) name
`migrate-authorities.js` — a different script — and stay unchanged.

## Impact

**Source and target tables.** MariaDB `authorities` (517K rows) is read; PostgreSQL `name_opinions` is
written as root (`edge_class = 'root'`, reason `original`) rows. Neither schema changes. No transformation,
type mapping, or sentinel handling is altered: the scenario ④ `'0'` year sentinel, the `informal → 'unranked'`
rank collapse, the person zero-sentinel fallback, and the orphan skip-and-log all carry across untouched. No
anomaly class from `anomaly-report.md` newly enters or leaves play.

**Code moved and renamed.** `migrate-authorities-opinions.js` (282 lines, ~11 KB) becomes
`src/authority-opinions-migration/migrate-authority-opinions.js`. Three import lines change; nothing else in
the file is touched.

**Code edited in place.** `src/run-migrations.js` (step name, script path, dependency-graph comment);
`src/opinions-migration/tests/run-migration.js` (spawn path and error string);
`src/opinions-migration/tests/reset-opinions.sql` (one documented command);
`docs/taxa-opinions-migration-mapping.md` (two prose mentions).

**Databases.** This change performs no migration and alters no schema. Verification re-runs two existing
steps against localhost.

**Data-integrity risk: low.** A script that no longer resolves an import fails loudly at module load, before
any query. The one path that fails *late* rather than early is a missed executable path — the runner and the
opinions test harness both spawn this script by name, so a stale reference surfaces at spawn time, not import
time. `src/opinions-migration/tests/run-migration.js:26` is the easiest to miss because it lives in another
migration's `tests/` directory.

Unlike the authorities slice there is no silent-failure path: no functions are being collapsed, so payload
content cannot drift while row counts hold steady. Verification nonetheless checks content as well as
cardinality, following that slice's lesson.

**Verification baseline**, from localhost `pbdb` on 2026-09-04:

| Measure | Value |
|---|---|
| `name_opinions` | 766,427 — 517,284 root rows from this step, 249,143 from the opinions step |
| `assignment_opinions` / `validity_opinions` | 927,497 / 11,327 |
| `authorities` | 163,067 — this step's **input**, and untouched by verification |
| `refs` / `collections` / `additional_collection_refs` | 93,940 / 275,554 / 371,774 — untouched |

**Verification cannot be a re-run.** The script inserts without an upsert and the runner declares it
`firstWriterOf: ['name_opinions']`, so a second run is refused rather than silently doubling the table.
`src/opinions-migration/tests/reset-opinions.sql` cannot be used either — it is broken against the current
schema, its `DROP TABLE name_opinions` refused by three `winning_name_opinion_id` foreign keys on `taxa`,
`taxa_clades`, and `taxa_linnaean` (found during the previous slice). A plain
`TRUNCATE name_opinions, assignment_opinions, validity_opinions RESTART IDENTITY CASCADE` is used instead,
followed by `--only authority-opinions` and `--only opinions`.

This leaves `authorities` standing — it is this step's input layer, not its output — along with `persons`,
`refs`, and `collections`, so the comparison carries no live-PBot GraphQL nondeterminism at all.

**Not in scope.**

- **`migrate-collections.js`**, the final slice. It carries with it the deletion of root `db.js`,
  `uuidv7.js`, `pg-pool.js`, and `mariadb-pool.js`, and therefore the closing of `permid-uuidv7`'s "single
  ESM helper module" gap, deferred through three slices now. After this change `migrate-collections.js` is
  the *only* remaining importer of those root copies, so it is genuinely the last blocker.
- **Promoting `parsePublicationYear` into `src/lib/`.** It and `src/lib/attribution.js`'s `parseYear` are
  near-twins differing by a `String(year).trim()`, and they read different sources — `authority.year`
  carrying the scenario ④ `'0'` sentinel, versus `opinions.pubyr`. Neither imports the other and no file
  carries a "keep in sync" note, so the shared-utility requirement does not compel promotion the way it did
  for `authorities-builders.js`. Declined for the reason the refs slice gave: a behavioral refactor wearing a
  relocation's clothes.
- **Renaming `payloadSchemas/mappings/authorities-opinions.md`.** A mapping document, not an executable path
  or a source-of-guarantee citation — the drive-by cleanup the layout spec warns against.
- **Repairing `reset-opinions.sql`.** It belongs to the opinions migration; only its line-15 comment is
  touched here.
- **`migration_exploration/` references.** That tree is superseded and was already broken by the previous
  slice.
