## Context

This is slice 3 of the `src/` relocation opened by `move-persons-migrations-to-src` and continued by
`move-refs-migrations-to-src`. Nearly all of the architectural work was settled by those two: the layout,
the one-directory-per-migration rule, the `src/lib/` import rule, the move-don't-copy rule, and the
citation-form rule. This design records only what is genuinely decided here, and reaffirms the inherited
choices where a reader might reasonably expect them to be revisited.

Current state, verified by inspection:

```
migrate-pbot-schemas.js                            18.7 KB / 602 lines
  ├── './pg-pool.js'  (root) ──── byte-identical to src/lib/pg-pool.js   (diffed)
  ├── './uuidv7.js'   (root) ──── byte-identical to src/lib/uuidv7.js    (diffed)
  └── fetch() → pbot.paleobiodb.org/graphql   (Bearer ${PBOT_TOKEN})

  writes: schemas · characters · states · additional_schema_refs
  reads:  persons (by legacyIDs.pbotID) · refs (by legacyIDs.pbotID)
```

Two import lines. No `db.js`, so none of the `MIGRATION_TEST_MODE` reasoning slices 1 and 2 each had to
work through. No MariaDB. No specialty pool, so the question left open by both prior slices stays open
rather than being forced by this one.

The mechanical part of this change is therefore smaller than either predecessor's — the smallest slice in
the sequence. What is *not* smaller is proving it. The prior slices both leaned on
`ON CONFLICT (id) DO UPDATE`, which made "re-run it and confirm the row counts hold" a legitimate proof
that a move was behavior-preserving. This script has no `ON CONFLICT` anywhere, so that recipe is
unavailable and something has to replace it. Working out what, and establishing that the replacement is
safe, is the substantive content of this design.

## Goals / Non-Goals

**Goals:**

- Relocate `migrate-pbot-schemas.js` under `src/` with behavior unchanged apart from the two import lines.
- Leave no stale *path* reference to the old location anywhere outside `openspec/changes/archive/`.
- Establish a verification method that works for a non-idempotent script, and establish that the
  destructive step it requires is actually safe rather than assumed to be.
- Settle the directory-naming question explicitly, since this is the first PBot-sourced migration with no
  PBDB sibling and the two existing precedents are silent on the case.
- Record the non-idempotency and the run-order chain as findings without acting on either.

**Non-Goals:**

- Making the script idempotent, or adding a natural-key constraint that would detect a duplicate run.
- Wrapping the migration in a transaction.
- Documenting or enforcing the run order in a capability spec (deferred to the `src/` runner script —
  see decision 5).
- Extracting anything into `src/lib/`.
- Correcting the `pbot-schema-migration` enum-source drift, or path-qualifying the `permid-uuidv7` list.
- Moving the three remaining root-level scripts, or renaming the `pbot-schema-migration` capability to
  match the new directory name.

## Decisions

### 1. Move to a single directory; nothing else changes

```
src/
└── pbot-schemas-migration/
    └── migrate-pbot-schemas.js      PG_* + PBOT_TOKEN
```

Inherited wholesale. One migration, one directory, entry point at its root, imports repointed to
`../lib/`. Both modules it needs have byte-identical `src/lib/` counterparts, so the swap has provably zero
behavior delta — the strongest form of this argument available in the sequence, since neither prior slice
had *all* of its dependencies come out byte-identical (`migrate-refs.js` had to dispose of `db.js`'s
`MIGRATION_TEST_MODE` branch).

Unlike the persons and refs slices there is no pairing decision to make: this script has no PBDB-sourced
counterpart writing the same tables. The `schemas` / `characters` / `states` cluster is populated by this
script alone. The "related migrations stay in separate directories with documented run order" requirement
in the layout spec therefore has nothing to say here.

The run-artifact rule is satisfied vacuously: the script writes no anomaly ledger, run summary, or report —
only console output. Nothing needs to move alongside it.

### 2. The directory name is singular, and this needs saying out loud

`src/pbot-schemas-migration/` — **not** `pbot-schemas-migrations`.

This is the one place this change deviates from the surface pattern of its predecessors, so the reasoning
matters more than the outcome:

```
slice 1   src/persons-migration/          ←→  src/pbot-persons-migrations/
slice 2   src/refs-migration/             ←→  src/pbot-refs-migrations/
                    singular                            plural
                    └──────── a contrast within a pair ────────┘

slice 3   (no PBDB sibling)                   src/pbot-schemas-migration/
                                                        singular
                                              nothing to contrast with
```

The persons design introduced the trailing `s` as an *asymmetry* — its decision 2 is titled "Directory
names carry a deliberate asymmetry," and it justifies the plural entirely by reference to the singular
sibling it sits beside. It never claims the `s` marks "PBot-sourced." Neither does the refs design, which
inherited the pattern by explicit analogy to the persons pair rather than by appeal to any rule. So there
are two readings available, and only one of them is supported by the record:

| Reading | Implies here | Support in the record |
|---|---|---|
| The `s` marks a PBot-sourced migration | `pbot-schemas-migrations` | none — neither prior design says this |
| The `s` contrasts a PBot script with its paired PBDB sibling | `pbot-schemas-migration` | both prior designs frame it exactly this way |

One script in one directory is one migration, and with no sibling to distinguish it from, the plural would
be decoration rather than signal. Singular it is.

The layout spec already permits this without amendment. Its name-asymmetry requirement says directory names
are literal and SHALL NOT be normalized for consistency with one another — a rule that protects a singular
PBot directory sitting beside two plural ones exactly as readily as it protects the plurals themselves. The
delta spec nonetheless adds a scenario recording *why* this one is singular, because the failure mode here
is the mirror image of the one the persons slice worried about: that slice feared a contributor would see
`pbot-persons-migrations` and "correct" the plural to singular; the risk now is a contributor seeing two
plurals and "correcting" this singular to match. A name that is deliberate in both directions needs the
reason recorded, not just the spelling.

**Alternative considered and rejected:** normalize all three PBot directories to one form. Rejected on the
layout spec's own terms — it explicitly forbids normalizing directory names for mutual consistency — and it
would break two working paths to fix a cosmetic complaint.

### 3. Verification is a clear-and-reload, and the destructive step was checked rather than assumed

The script is not idempotent. Every insert is bare:

```
line 349  INSERT INTO schemas …                  no ON CONFLICT
line 379  INSERT INTO additional_schema_refs …   no ON CONFLICT
line 445  INSERT INTO characters …               no ON CONFLICT
line 539  INSERT INTO states …                   no ON CONFLICT

no BEGIN / COMMIT anywhere; each statement autocommits
```

And nothing in the database detects the duplication a second run causes. This is worth spelling out because
the schema *looks* like it should catch it — there is a versioning trigger system on all three main tables,
and it is precisely the mechanism that ought to notice a re-inserted entity:

```
a_place_in_lineage  BEFORE INSERT
    SELECT count(*), max(id) FROM <tbl> WHERE permid = NEW.permid AND succeeded_by_id IS NULL
    IF head_count > 1 THEN RAISE 'Corrupted lineage: % heads found …'
                            ▲
                            └── keys on permid …

migrate-pbot-schemas.js:353,449,543
    uuidv7(),   // generated permid; pbotID preserved in <x>.legacyIDs.pbotID
      ▲
      └── … which the script mints fresh for every row, every run.
          head_count is therefore always 0. The check can never trip.
```

So a re-run produces a second complete set of rows with fresh permids and independent lineage heads, which
the versioning system reads as ten brand-new entities rather than duplicates of the existing ten. The
AFTER INSERT trigger `b_swing_fks_on_new_version` never fires at all — it is guarded by
`WHEN (new.preceded_by_id IS NOT NULL)` and the script always inserts `NULL`. The partial head indexes
(`schemas_permid_head_idx` and siblings) are non-unique, so they do not block it either, and nothing indexes
or constrains `legacyIDs->>'pbotID'`, which is the only natural key in play. The full accounting is in the
proposal.

Given that, verification has to reset to a known state first. The chosen method:

```
1. capture baseline (done — see decision 4)
2. TRUNCATE additional_schema_refs, states, characters, schemas;
3. node src/pbot-schemas-migration/migrate-pbot-schemas.js
4. diff reload against baseline in pbotID space
```

The `TRUNCATE` is safe, and this was established by querying the catalog rather than by inspection of the
DDL:

```
inbound FKs to the cluster: 11, ALL internal, ALL NO ACTION (confdeltype = 'a')

  additional_schema_refs ──schema_id──▶ schemas
  characters ──parent_schema_id──▶ schemas       characters ──parent_character_id──▶ characters
  states ──parent_character_id──▶ characters     states ──parent_state_id──▶ states
  schemas/characters/states ──preceded_by_id, succeeded_by_id──▶ self

  external referents: none
  DELETE triggers on any of the four: none
  specimens table: does not exist (29c78a6 added payloadSchemas/specimen.schema.js only)
```

Listing all four tables in a single `TRUNCATE` closes the FK graph, so no `CASCADE` is needed — and *not*
needing `CASCADE` is itself the check that nothing outside the cluster would be caught by it. Nothing
cascades on delete and nothing is `RESTRICT`, so there is no ordering subtlety and no risk of silently
removing rows elsewhere.

**Alternatives considered:**

- **Don't run it at all** — argue the two-line diff against byte-identical modules is self-evidently
  behavior-preserving, and verify only that the module resolves. Genuinely defensible, and it is the
  fallback if the reload cannot be completed (no `PBOT_TOKEN`, upstream unreachable). Rejected as the
  primary method because the cluster is small enough that a real reload costs little and proves much more.
- **Make the script idempotent as part of the move** — then verify by re-running, as slices 1 and 2 did.
  Rejected: it is a behavioral rewrite wearing a relocation's clothes. Both prior slices held the line that
  a relocation changes only import lines precisely so the diff stays trivially auditable, and this slice has
  the cleanest such diff of the three. Trading that away to make verification more convenient inverts the
  priority. The non-idempotency is recorded as a finding instead.
- **Reload into a scratch database** and diff two databases. Avoids touching localhost at all, but the
  identity-sequence and trigger behavior would differ from the real target, so it would prove less while
  costing more setup.

### 4. The baseline is captured in pbotID space, because ids do not survive a reload

The obvious baseline — snapshot the four tables, reload, diff — fails on its own terms:

```
finalization, line 582:
  SELECT setval(pg_get_serial_sequence('<tbl>', 'id'), (SELECT COALESCE(MAX(id), 1) FROM <tbl>))
                                                                       ▲
   sets the sequence to MAX(id) — it does not RESTART IDENTITY, so a reload
   after a TRUNCATE continues from where the old rows left off.

   ⇒ every surrogate id changes
   ⇒ every parent_schema_id / parent_character_id / parent_state_id / reference_id changes
   ⇒ every permid changes (freshly minted per insert, by design)
```

So a naive column-wise diff would report every row as different while nothing was actually wrong. The
baseline is therefore captured in two forms:

| Form | Files | What it proves |
|---|---|---|
| Payload | `schemas.json`, `characters.json`, `states.json`, `additional_schema_refs.json` | the JSONB documents round-trip unchanged, with `id`/`permid` projected out |
| Structure | `*_structure.json` | parentage, reference, and enterer linkage re-expressed by **pbotID**, so it is invariant under renumbering |

The structural form is the one that actually proves the move. It resolves each FK through to the target
row's `legacyIDs->>'pbotID'`, so `characters.parent_schema_id` becomes `parent_schema_pbot_id` and compares
across a reload. A sanity check confirmed the join is total — 0 schemas with an unresolvable
`reference_id` — so the diff will be meaningful rather than a field of nulls.

Baseline as captured from localhost `pbdb`: **10 schemas / 301 characters / 1,183 states /
1 additional_schema_ref**.

The baseline is **re-capturable at any point before the `TRUNCATE`**, since the move touches no data. That
makes the captured copy a convenience rather than a critical artifact, but the capture query is not
reproducible from memory, so it is preserved in the change directory as a script.

One caveat that the counts cannot resolve on their own: PBot is a **live** GraphQL source. A reload may
legitimately return schemas, characters, or states added upstream since the last run, so a count delta is
not by itself a failure. The structural diff is the proof; the counts are the fast check, and any delta must
be individually attributed to an upstream change rather than waved through.

**Observed during apply, and it went the other way too.** Probing the endpoint before the truncate found
upstream at 8 schemas / 336 characters / 1,326 states against localhost's 10 / 301 / 1,183 — a drift that
includes **deletions**, which this design had not anticipated. It reconciles exactly:

| Delta | Detail |
|---|---|
| −3 schemas | `3e97bfeb…`, `61115b59…`, `d54653b3…` — all titled "To be deleted", deleted upstream since the last run. Verified to have zero characters, zero states, and zero additional refs between them: empty stubs |
| +1 schema | `aeef6256…` "Holian et al. Fern Schema" |
| +35 characters, +143 states | upstream growth |

The consequence is that "reload and expect the baseline back" is not achievable against a live source, and
was never quite the right criterion. What the reload can prove is that **every entity present on both sides
round-trips identically in pbotID space**, with the non-intersecting rows individually attributed to
upstream changes. That is the criterion the tasks were amended to, and it is strictly the honest version of
what the exact-match criterion was reaching for: it isolates "did the move change the script's behavior"
from "did the source change underneath us," which an exact match silently conflates.

A second consequence worth stating: the reload leaves localhost **synced with upstream** rather than
restored to its prior state. For this cluster that is benign — the rows lost are three empty stubs, their
payloads are preserved in `baseline/schemas.json`, and nothing outside the cluster references them — but it
means the verification step is not state-preserving, and a future slice should not assume a clear-and-reload
against a live source ever is.

### 5. Run order is deferred to the runner script — and the deferral is now three findings deep

This script sits at the end of the chain, and depends on two prior migrations rather than one:

```
persons → pbot-persons → refs → pbot-refs → pbot-schemas
              │                     │            │
              │  line 167  lookupPersonByPbotID(persons.person->'legacyIDs'->>'pbotID')
              │  line 175  lookupRefByPbotID(refs.reference->'legacyIDs'->>'pbotID')
              └─────────────────────┴────────────┘

RUN EARLY:
  enterer unresolved      → console.warn, stats.schemasSkipped++, continue
  primary ref unresolved  → console.warn, stats.schemasSkipped++, continue
  ⇒ partial migration, exit 0
```

Refs' footgun was a silent *overwrite*; this one is a silent *under-migration*. Same severity class,
arguably worse discoverability — the summary block prints `skipped=N` and a reader who is not looking for it
will read a clean exit.

Following the refs slice's decision 3, this is **not** written into a capability spec. Ordering for all
migrations will be encoded in an overall run script under `src/` in a later change, which is the better home
because an executable order cannot drift from prose describing it. The finding goes in the proposal so that
change inherits it.

**Observed during apply, not just reasoned about.** This change's own first clear-and-reload hit it:

```
localhost prerequisites, stale against upstream
  pbot persons  70 / 313        pbot refs  174 / 280
                    │                          │
                    └────────────┬─────────────┘
                                 ▼
  schemas   fetched=8    inserted=5    skipped=3     ← aeef6256 (ref + enterer)
  characters fetched=336 inserted=168  orphans=168     93e1379b (enterer Currano)
  states    fetched=1326 inserted=797  orphans=528     1f418977 (enterer Moore)
                                                     exit 0
```

Two thirds of the states silently missing, and the only signal anywhere was `skipped=3` in a summary block.
Running `migrate-pbot-persons.js` and `migrate-pbot-refs.js` — the documented prerequisites — then
reloading produced the full set.

Worth flagging that the deferred change is now carrying three inherited findings: the refs ordering footgun,
the nine divergent `setval(pg_get_serial_sequence(...))` call sites, and this chain. Two slices ago that
deferral was cheap; it is getting less so. Two of the three findings are now observed rather than reasoned
about, and this one cost a full reload cycle to diagnose — which sharpens the question into a
recommendation: the runner change should probably come **before** the three remaining relocation slices,
since each of them is another chance to hit the same class of failure with the same absent signal.

### 6. `src/lib` extraction stays out, and this slice barely tempts it

Reaffirmed from persons decision 4 and refs decision 4, and easier to hold here than in either. Refs
presented a genuine temptation — `mapPersonIds()` was a behavioral twin of `src/lib/identity.js`'s
`resolvePersons()`. This script offers nothing comparable: `lookupPersonByPbotID` and `lookupRefByPbotID`
are two-line single-column queries against a JSONB path, not a policy-bearing helper, and its enum-mapping
and lineage-walking logic is specific to the schema/character/state hierarchy.

The one thing that *would* have been interesting is the enum lists. `pbot-schema-migration` states the
`partsPreserved` and `notableFeatures` enums are mapped "to the enum values defined in `schema.schema.js`"
(spec lines 116, 129), but the script hardcodes both inline at lines 14–34 and imports nothing from
`payloadSchemas/`. That is a pre-existing spec drift, out of scope, and left alone.

Its counterfactual is the part worth recording. Had the script actually imported that module, this would
have been the first slice to need something above `src/` with **no** `src/lib/` counterpart — and
`payloadSchemas/` is a much larger question than a connection pool, because it is shared with the API layer
rather than being migration-private. Copying it into `src/lib/` would fork a contract two consumers depend
on; leaving it above `src/` would breach the "no reaching above `src/`" rule this refactor exists to
establish. Neither answer is obvious, and this slice does not have to give one. The question stays deferred
alongside the specialty-pool question, and `migrate-collections.js` remains the likeliest script to force
either.

### 7. One delta spec

Only `migration-script-layout` changes, and only its inventory requirement (plus one scenario recording the
singular-name reasoning from decision 2). Everything else in that spec already covers this script as
written, and `db-connection-config` needs no delta because both modules the script needs have `src/lib/`
counterparts. The full spec-by-spec accounting, including why `permid-uuidv7:16` stays bare, is in the
proposal.

## Risks / Trade-offs

- **[Risk] The `TRUNCATE` removes production-relevant data.** → It runs against localhost `pbdb` only, and
  the reload restores from the live upstream source that populated it in the first place. The four tables
  hold 1,495 rows total, all derived — none of it is hand-entered or otherwise unrecoverable. The catalog
  check in decision 3 confirms nothing outside the cluster references them, so the blast radius is exactly
  those four tables. Mitigated further by capturing the baseline *before* the truncate, so even a total
  failure of the reload leaves the content recoverable from JSON.

- **[Risk] The reload cannot be completed** — `PBOT_TOKEN` missing, or the GraphQL endpoint unreachable. →
  The truncate must not be run until the reload is known to be possible. Sequencing the tasks so the script
  is exercised against the live endpoint *before* anything is cleared removes this entirely; if the endpoint
  is down, the change falls back to decision 3's rejected-but-defensible alternative (resolution check only)
  and says so plainly rather than leaving the tables empty.

- **[Risk] The reload silently drops rows because an upstream dependency regressed.** → This is exactly the
  run-order failure mode from decision 5, and a clear-and-reload is the one operation that would expose it.
  If `persons` or `refs` had lost `legacyIDs.pbotID` coverage since the original run, the reload would skip
  schemas and report `skipped=N` on a clean exit. Mitigated by checking `schemasSkipped` /
  `charactersSkipped` / `statesSkipped` and the orphan counters explicitly rather than only checking
  the exit code — a step the prior slices did not need.

- **[Risk] A repointed import fails to resolve.** → Fails at module load with a standard Node resolution
  error, before any query and before any truncate. Caught immediately.

- **[Trade-off] Verification changes the database, where the prior two slices left it untouched.** →
  Accepted, and it is the direct consequence of the non-idempotency. The alternative — verifying nothing but
  module resolution — proves considerably less. The offsetting benefit is that this slice's verification is
  actually *stronger* than its predecessors': reproducing 10 / 301 / 1,183 / 1 with matching structure from
  an empty start exercises the whole script, where an idempotent re-run mostly exercises the conflict path.

- **[Trade-off] Ids and permids change, so the "after" state is not byte-identical to the "before" state.**
  → Unavoidable given `setval(…, MAX(id))` and per-insert permid minting, and harmless: nothing outside the
  cluster references these ids or permids, on localhost or anywhere else this change touches. It does mean
  the diff has to be run in pbotID space (decision 4) rather than naively.

- **[Risk] The singular directory name gets "corrected" to match its plural neighbours.** → Decision 2
  documents the reasoning in both directions, and the delta spec carries a scenario stating it normatively.
  The layout spec's existing literal-names rule already forbids the normalization.

- **[Trade-off] The non-idempotency is documented rather than fixed.** → It stays a live hazard: anyone who
  runs this script twice against any database doubles four tables with no error. Accepted to keep the
  relocation diff auditable, and narrowed by the fact that the finding is now written down in a durable
  place rather than latent in the code. The fix is a real design question — natural-key `ON CONFLICT`,
  guarded pre-clear, unique index on `legacyIDs->>'pbotID'`, or a derivable permid — and deserves its own
  change.

- **[Risk] Slice 3 sets a precedent that the last three slices cannot follow.** → It does not add one. Every
  decision here either inherits from slices 1–2 or narrows scope. The two genuinely hard questions —
  specialty pools, and modules above `src/` with no `src/lib/` counterpart — are both left open rather than
  answered prematurely, and `migrate-collections.js` is still the script most likely to force them.

## Migration Plan

1. Capture (or re-verify) the baseline from localhost while the tree is still clean.
2. Create `src/pbot-schemas-migration/` — singular, per decision 2.
3. `git mv` the script into place, preserving history and rename detection.
4. Repoint the two import lines. Change nothing else; confirm the diff is exactly two lines and the file is
   still 602 lines.
5. Update the `migration-script-layout` inventory via the delta spec (not by hand-editing the main spec).
6. Exercise the moved script against the live PBot endpoint *before* truncating, so a missing token or a
   dead endpoint is discovered while the database is still intact.
7. `TRUNCATE additional_schema_refs, states, characters, schemas;` then reload, then diff in pbotID space.
8. Confirm no *path* reference to the old location survives outside `openspec/changes/archive/`.

**Rollback:** `git revert` restores the script to root. If the revert happens after a reload, the database
is left holding a correctly reloaded cluster with different surrogate ids and permids than it started
with — semantically equivalent, and referenced by nothing outside the cluster, so no restoration is needed.
If the reload itself fails partway, re-truncate and re-run; the script has no partial-state recovery of its
own, which is another face of the non-idempotency finding.

## Open Questions

- **When should the `src/` runner script be written?** It is now inheriting three findings (decision 5), and
  each further slice adds to the pile rather than drawing it down. Worth asking whether it should be
  sequenced before the remaining three relocations rather than after them.

- **What happens when a slice needs a module above `src/` that has no `src/lib/` counterpart?** Carried
  forward unresolved, now in two flavours: the specialty pools (`pg-classic-pool.js`,
  `pg-migrated-pool.js`, `pg-play-pool.js`) from slice 1, and `payloadSchemas/` — nearly forced by this
  slice, and harder, because it is shared with the API layer (decision 6). `migrate-collections.js` remains
  the likeliest to force either.

- **Does `migrate-authorities.js`'s move collapse the `src/lib/authorities-builders.js` duplication?** Still
  that slice's decision, unchanged by this one.

- **How should the non-idempotency be fixed, and does the same gap exist elsewhere?** The permid-minting
  pattern that defeats `place_in_lineage` here is not obviously unique to this script — any migration that
  mints a fresh permid per insert into a versioned table has the same hole. Worth a survey when the fix is
  designed, rather than patching this one script in isolation.
