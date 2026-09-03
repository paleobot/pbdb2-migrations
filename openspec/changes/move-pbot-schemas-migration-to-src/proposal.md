## Why

`move-persons-migrations-to-src` opened the `src/` relocation refactor and `move-refs-migrations-to-src`
continued it, leaving four `migrate-*.js` scripts at the repository root. This change is slice 3, covering
`migrate-pbot-schemas.js`.

It is the right next slice because it is the smallest remaining one by every measure that matters. The
script depends on exactly two root-level modules, both byte-identical to their `src/lib/` counterparts;
nothing imports it programmatically; and it has precisely **one** stale inbound reference in the entire repo
outside the archive. The three scripts left after this one are the entangled cases —
`migrate-authorities.js` must resolve the `src/lib/authorities-builders.js` duplication when it moves, and
`migrate-collections.js` is the likeliest to force the still-open specialty-pool question.

There is one respect in which this slice is *harder* than its predecessors, and it is a verification problem
rather than a code problem: unlike the persons and refs scripts, `migrate-pbot-schemas.js` is not
idempotent. The "re-run it and confirm the counts hold" recipe both prior slices used to prove a move
behavior-preserving does not work here. This change replaces it with a clear-and-reload against a captured
baseline, and records the non-idempotency as a finding rather than fixing it.

## What Changes

- Move `migrate-pbot-schemas.js` → `src/pbot-schemas-migration/migrate-pbot-schemas.js`, repointing
  `./pg-pool.js` → `../lib/pg-pool.js` and `./uuidv7.js` → `../lib/uuidv7.js`.
- Delete the root-level original. This is a move, not a copy.
- Update the `migration-script-layout` inventory: one script moves from the root list (four → three) into
  the `src/` directory table.

**Two import lines change. No other line of the 602-line script is touched.** No behavior changes, no source
or target schema changes, no new database access, no new environment variables. Root `pg-pool.js` and
`uuidv7.js` were diffed against their `src/lib/` counterparts and are byte-identical, so both swaps have
zero behavior delta. Unlike `migrate-refs.js`, this script does not import `db.js`, so the
`MIGRATION_TEST_MODE` question the two prior slices each had to dispose of does not arise at all.

**Directory name is singular** — `src/pbot-schemas-migration/`, not `pbot-schemas-migrations`. This breaks
the surface pattern set by `src/pbot-persons-migrations/` and `src/pbot-refs-migrations/` and is deliberate;
see `design.md` decision 2. In short: that trailing `s` was a pair-contrast device distinguishing a PBot
script from its PBDB sibling, and the schemas migration has no PBDB sibling to contrast with. The layout
spec's existing rule — directory names are literal and are not normalized for consistency with one another —
already permits this and needs no amendment.

## Capabilities

### New Capabilities

None. `migration-script-layout` is the durable home this change writes to.

### Modified Capabilities

- `migration-script-layout`: one requirement change.
  - **Modified** — "Inventory of migrated and not-yet-migrated scripts" moves `migrate-pbot-schemas.js` from
    the root list (four scripts → three) into the `src/` directory table as
    `src/pbot-schemas-migration/`.

  Every other requirement in that spec already covers this script as written and is unchanged: the
  one-directory-per-migration rule, the deliberate-name-asymmetry rule (which is written about directory
  names generally, not about the persons pair specifically, and so accommodates a singular PBot directory as
  readily as a plural one), the `src/lib/` shared-utility rule, the run-artifact rule (vacuous — the script
  writes no artifacts, only console output), and the citation-form rule added by the refs slice.

`db-connection-config` needs no delta either. Its rule — scripts under `src/` import connection modules from
`src/lib/` where a counterpart exists — already governs this script, and both modules it needs have
counterparts. The specialty-pool gap left open by slices 1 and 2 (`pg-classic-pool.js`,
`pg-migrated-pool.js`, `pg-play-pool.js` have no `src/lib/` counterparts) is untouched here, because this
script needs none of them.

**Deliberately not modified.** Two specs mention the script and one of them is left alone, following the
citation-form rule the refs slice wrote into `migration-script-layout`:

| Spec | Mention | Verdict |
|---|---|---|
| `migration-script-layout` | 126 | **stale** — the root inventory list; this is the one forced edit |
| `permid-uuidv7` | 16 | leave bare (see below) |
| `pbot-schema-migration` | — | contains no filename or path citation at all; every requirement reads "The script SHALL …" |

`permid-uuidv7:12,16` is the mixed list the refs slice reasoned about explicitly. Its two scenarios name five
scripts as normative actors: `migrate-authorities.js`, `migrate-collections.js`, `migrate-refs.js`,
`migrate-pbot-refs.js`, `migrate-pbot-schemas.js`. After this change three of the five are relocated and two
remain at root, so the list is still mixed and the rule still says leave it entirely unqualified —
path-qualifying three of five would actively imply the other two live somewhere other than the root. The
list becomes qualifiable in a single edit once `migrate-authorities.js` and `migrate-collections.js` land,
which is now two slices away rather than four.

No `.claude/settings.local.json` permission entry names this script, so there is no executable path to
update — the one category the citation-form rule says is always updated regardless.

## Impact

**Code moved:** `migrate-pbot-schemas.js` (1 file, 18.7 KB, 602 lines). Two import lines change; nothing
else. Because no line is added or removed, every line number in the file is preserved — relevant if any
future citation carries one.

**Code edited in place:** none.

**Databases:** the change itself performs no migration, alters no schema, transforms no data, and introduces
no type mappings. The MariaDB side is not involved at all — this script's source is PBot's GraphQL API, not
`pbdb_archive` — so the anomaly classes tracked in `anomaly-report.md` are entirely out of play. The
PostgreSQL `schemas`, `characters`, `states`, and `additional_schema_refs` tables are untouched by the move;
they are only cleared and reloaded as part of *verifying* it (see below).

**Data-integrity risk:** the failure mode of the move itself is minimal and loud — a script that no longer
resolves a connection module fails at import, before any query. The real risk in this change lives in its
verification step, and is stated plainly here.

### Verification requires a destructive step, because the script is not idempotent

Every insert in `migrate-pbot-schemas.js` is a bare `INSERT` — `schemas` (line 349),
`additional_schema_refs` (379), `characters` (445), `states` (539). There is no `ON CONFLICT`, no
pre-clear, no existence guard, and no `BEGIN`/`COMMIT`. A second run duplicates all four tables.

Nothing in the database catches this:

| Guard | Why it does not fire |
|---|---|
| `ON CONFLICT` | absent from all four inserts |
| `place_in_lineage` BEFORE INSERT trigger, which raises `Corrupted lineage: N heads found` | keys on `permid`, and the script mints a fresh `uuidv7()` for every row (lines 353, 449, 543), so `head_count` is always 0 and the check can never trip |
| `handle_new_version` AFTER INSERT trigger | guarded by `WHEN (new.preceded_by_id IS NOT NULL)`; the script always inserts `NULL`, so it never runs |
| `schemas_permid_head_idx` and siblings | **non-unique** (`CREATE INDEX`, partial on `succeeded_by_id IS NULL`) |
| any constraint on `legacyIDs->>'pbotID'` | none exists — the natural key is entirely unenforced |
| `schemas_permid_check` | only asserts the UUID version nibble is 7 |

So a duplicate run produces a second complete set of rows carrying fresh permids and independent lineage
heads, which the versioning system reads as new entities, and exits 0. **This is a pre-existing property of
the script, not something this change introduces, and this change does not fix it** — adding `ON CONFLICT`
would be a behavioral rewrite wearing a relocation's clothes, forfeiting the property that makes this change
cheap to review. It is recorded here so a later change inherits the finding.

The consequence for verification is that the prior slices' recipe is unavailable, and the substitute is a
clear-and-reload:

```sql
TRUNCATE additional_schema_refs, states, characters, schemas;
```

This is safe, and was checked rather than assumed. All eleven foreign keys pointing at the four tables are
**internal to the cluster** — nothing outside it references them; `specimens` does not yet exist as a table
(commit `29c78a6` added `payloadSchemas/specimen.schema.js` only). All eleven are `NO ACTION`, so nothing
cascades. There are no `DELETE` triggers on any of the four. Listing all four tables in one `TRUNCATE`
closes the FK graph, so no `CASCADE` is needed.

Baseline captured from localhost `pbdb` before any move:

| Table | Rows |
|---|---|
| `schemas` | 10 |
| `characters` | 301 |
| `states` | 1,183 |
| `additional_schema_refs` | 1 |

Captured to `<scratchpad>/pbot-schemas-baseline/`: full JSONB payloads with `id`/`permid` projected out, plus
companion `*_structure.json` files re-expressing parentage, references, and enterers in **pbotID space**.
That second form is the one that matters — the script's finalization does `setval(…, MAX(id))` rather than
restarting identity, so a reload continues the sequence and every surrogate id changes. Ids and permids will
therefore differ legitimately after the reload; the pbotID-keyed structural diff is what actually proves the
move preserved behavior. A sanity check confirmed the structural join is total (0 schemas with an
unresolvable `reference_id`), so the diff will be meaningful rather than full of nulls.

The baseline is re-capturable at any point before the `TRUNCATE`, since the move does not touch data — the
scratchpad copy is a convenience, not a critical artifact. The capture query is preserved in the change
directory so it can be re-run.

Two caveats on the reload: it requires `PBOT_TOKEN`, and PBot is a **live** GraphQL source, so a run may
legitimately return schemas, characters, or states **added or deleted** upstream since the last one. Row
counts are therefore the fast check, not the proof; the structural diff is the proof, and any count delta
must be individually accounted for as an upstream change.

The deletion half of that is not hypothetical — it is what actually happened. Probing upstream before the
truncate found 8 schemas / 336 characters / 1,326 states against localhost's 10 / 301 / 1,183: three
schemas titled "To be deleted" had been removed upstream (empty stubs, zero characters and states between
them), one real schema added, plus routine growth. Because a live source can move in both directions,
"reload and expect the baseline back" is not achievable and was never quite the right criterion. What the
reload proves is that **every entity present on both sides round-trips identically in pbotID space**, with
the non-intersecting rows individually attributed. That isolates "did the move change the script's
behavior" from "did the source change underneath us," which an exact match silently conflates. It also
means the reload leaves localhost synced with upstream rather than restored — benign here, but a future
slice should not assume a clear-and-reload against a live source is state-preserving.

**Not in scope:**

- **Fixing the non-idempotency.** Recorded above as a finding for a later change. Whether the fix is
  `ON CONFLICT` on a natural key, a guarded pre-clear, a unique index on `legacyIDs->>'pbotID'`, or making
  the permid derivable rather than freshly minted is a real design question, and it is not a relocation's
  business to answer it.
- **The run order.** `migrate-pbot-schemas.js` sits at the end of the chain
  `persons → pbot-persons → refs → pbot-refs → pbot-schemas`: it resolves its enterer via
  `lookupPersonByPbotID` against `persons.person->'legacyIDs'->>'pbotID'` (line 167) and its primary
  reference via `lookupRefByPbotID` against `refs.reference->'legacyIDs'->>'pbotID'` (line 175). Run early,
  every schema whose enterer or primary reference is unresolved is **skipped with a `console.warn`** and the
  script exits 0 — a silent under-migration, the same severity class as the silent overwrite the refs slice
  documented.

  **This stopped being theoretical during this change's own verification.** The first clear-and-reload
  exited 0 having inserted 5 of 8 schemas, 168 of 336 characters, and 797 of 1,326 states, because
  localhost's PBot-sourced `persons` (70 of 313 upstream) and `refs` (174 of 280) were stale. Three schemas
  could not resolve a prerequisite: `aeef6256…` needed both its primary reference `a093e770…` and its
  enterer; `93e1379b…` and `1f418977…` needed enterers Ellen Currano and Julian Moore. The character and
  state shortfalls were pure fallout from the schemas that never landed. Nothing errored, nothing warned at
  the top level, and the exit code was 0 — the summary block's `skipped=3` was the only signal. Running the
  documented prerequisites `migrate-pbot-persons.js` and `migrate-pbot-refs.js`, then reloading, produced
  the full set.

  Per the refs slice's precedent this is still **deliberately deferred** to the overall `src/` run script
  rather than written into a capability spec, and recorded here so that change inherits it. Note that this
  is now the **third** finding that deferred change is carrying: the refs ordering footgun, the nine
  divergent `setval(pg_get_serial_sequence(...))` call sites, and this chain. Two of the three are now
  observed rather than reasoned about, and the observation cost a full reload cycle to diagnose — which is
  the argument for sequencing the runner change **before** the three remaining relocation slices rather
  than after them, since each of those slices is a fresh opportunity to hit the same class of failure.
- **Extracting anything into `src/lib/`.** Per the persons slice's decision 4, upheld by the refs slice.
- Path-qualifying the `permid-uuidv7` script list, per the citation-form rule.
- **A pre-existing spec drift found while scoping, and left alone:** `pbot-schema-migration` states that the
  `partsPreserved` and `notableFeatures` enums are mapped "to the enum values defined in `schema.schema.js`"
  (lines 116, 129), but the script hardcodes both lists inline at lines 14–34 and imports nothing from
  `payloadSchemas/`. Worth noting for its counterfactual as much as its own sake: had the script actually
  imported that module, this would have been the first slice to need something above `src/` with **no**
  `src/lib/` counterpart — and `payloadSchemas/` is a considerably larger question than a connection pool,
  since it is shared with the API layer rather than being migration-private. It does not, so that question
  stays deferred alongside the specialty-pool one.
- Moving the three remaining root-level scripts, or renaming the `pbot-schema-migration` capability to match
  the new directory name. The capability/directory divergence tolerated since slice 1 continues.
