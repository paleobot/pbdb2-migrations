## Context

This is slice 2 of the `src/` relocation opened by `move-persons-migrations-to-src`, which left six
`migrate-*.js` scripts at the repository root. Most of the architectural work was settled by that slice —
the layout, the one-directory-per-migration rule, the `src/lib/` import rule, and the decision to move
rather than copy. This design records only what is genuinely decided here, and reaffirms the inherited
choices where a reader might reasonably expect them to be revisited.

Current state, verified by inspection:

```
migrate-refs.js                                    14.2 KB
  ├── './db.js'      (root) ──┐  root db.js carries a MIGRATION_TEST_MODE branch delegating to
  │                           │  migration_exploration/testing/db-test-shim.js;
  │                           │  src/lib/db.js deliberately dropped it
  └── './uuidv7.js'  (root) ──┼─ byte-identical to src/lib/uuidv7.js

migrate-pbot-refs.js                               10.9 KB
  ├── './pg-pool.js' (root) ──┼─ byte-identical to src/lib/pg-pool.js
  ├── './uuidv7.js'  (root) ──┘
  └── fetch() → pbot.paleobiodb.org/graphql   (unauthenticated; no local module dependency)
```

Root `pg-pool.js`, `mariadb-pool.js`, and `uuidv7.js` were diffed against their `src/lib/` counterparts and
are byte-identical. Nothing in the repo imports either script programmatically. Both scripts are idempotent
and neither writes run artifacts, so the "run artifacts beside the producing script" rule in the layout spec
is satisfied vacuously.

The shape is the same as the persons pair but one notch larger: four import lines rather than two, and ten
textual mentions of the two filenames across six files rather than three. Sorting which of those ten are
actually stale is the main analytical work, and it is what most of this design is about.

## Goals / Non-Goals

**Goals:**

- Relocate both refs scripts under `src/` with behavior unchanged apart from the four import lines.
- Leave no stale *path* reference to the old locations anywhere outside `openspec/changes/archive/`.
- State the citation-form rule the persons slice followed in practice but never wrote down, so the four
  remaining slices apply it consistently instead of re-litigating it each time.
- Keep the change small enough that verification is a re-run and a diff.

**Non-Goals:**

- Documenting or enforcing the refs run order (deferred to the future `src/` run script — see decision 3).
- Extracting anything into `src/lib/`, including the `mapPersonIds` / `resolvePersons` twin.
- Path-qualifying comparative filename mentions in `authorities-migration`, `permid-uuidv7`,
  `pbot-person-migration`, or the two comments in `migrate-authorities.js`.
- Correcting the pre-existing spec drifts noted in the proposal.
- Moving the four remaining root-level scripts, or renaming the `refs-migration` / `pbot-refs-migration`
  capabilities to match the new directory names.

## Decisions

### 1. Follow the persons split exactly, asymmetry included

```
src/
├── refs-migration/                 migrate-refs.js        MARIADB_* + PG_*
└── pbot-refs-migrations/           migrate-pbot-refs.js   PG_* only
```

Inherited wholesale from the persons slice, which pre-committed this pair by name. The same justification
applies without modification: the two scripts write the same `refs` table but have genuinely different
environment requirements, and sibling directories with different `../lib/` imports keep that visible.

The singular/plural asymmetry (`refs-migration` vs. `pbot-refs-migrations`) is deliberate and mirrors
`persons-migration` / `pbot-persons-migrations`. It is now a convention rather than a one-off quirk, and the
layout spec's existing "Deliberate name asymmetry preserved" requirement already covers it — that
requirement is written about directory names generally, not about the persons pair specifically, so it needs
no amendment.

### 2. The citation-form rule, made explicit

Ten mentions of the two filenames exist outside the archive. Only two are stale. The rule separating them
was applied by the persons slice but never stated, and the evidence for it is unusually clean — that slice
updated one citation and left another **in the same sentence** untouched:

```
authorities-migration/spec.md:259

  … the `src/persons-migration/migrate-persons.js` migration inserted persons
      ▲ QUALIFIED — points at a file as the source of a guarantee
    with `id = person_no` … Same fallback as `migrate-refs.js`.
                                              ▲ LEFT BARE — comparative aside
```

So: **qualify a citation with a path when it directs the reader to a file as the source of a guarantee;
leave a bare filename alone when it is a comparative or stylistic aside.** A bare filename does not become
false when a file moves — the file is still named that — so treating every mention as stale would mean
touching six specs to relocate two scripts, and would churn spec text on every future slice.

Applying it here yields two edits, both in-place and neither a spec:

| Location | Form | Verdict |
|---|---|---|
| `.claude/settings.local.json:15` | `Bash(node migrate-refs.js:*)` | **stale** — an executable path |
| `docs/…-mapping.md:661` | `` `migrate-refs.js:300` `` | **stale** — a path plus line number |
| `authorities-migration:259, 275, 311` | "Same fallback / Same pattern / Logging style matches" | aside → leave |
| `permid-uuidv7:12, 16` | bare names in a five-script list | leave (see below) |
| `pbot-person-migration:157` | "same PG connection configuration as" | aside → leave |
| `migrate-authorities.js:153, 194` | "Same pattern as" / "mirrors" | aside → leave |

The docs citation carries a line number, which survives the move: only import lines change, so no line is
added or removed and `migrate-refs.js:300` (`id: ref.reference_no`) stays at 300. Only the path prefix needs
updating.

`permid-uuidv7` deserves its own note because it is the one borderline case. Its two scenarios name five
scripts as normative actors, not as asides — a stronger form than the others. But three of those five remain
at root. Qualifying two would produce a list where two entries carry `src/` paths and three carry bare
names, actively implying the bare three live somewhere else. The list is coherent as all-bare or as
all-qualified, and it can only become all-qualified once the last slice lands. Leaving it is the option that
keeps it honest in the meantime.

### 3. Run order is deferred to a run script, not written into a spec

`migrate-refs.js` must run before `migrate-pbot-refs.js`. The dependency is structural, and the failure mode
is silent:

```
CORRECT ORDER                          REVERSED ORDER (fresh database)
migrate-refs.js                        migrate-pbot-refs.js
  INSERT id = reference_no  (93,705)     ids 1…174 from the identity sequence
  setval(seq, MAX(id)) → 93,903        migrate-refs.js
migrate-pbot-refs.js                     INSERT … ON CONFLICT (id) DO UPDATE
  ids 93,904 … 94,077 ✓ contiguous       ⇒ overwrites all 174 PBot rows
                                         ⇒ exit 0; row-count check still passes
```

Verified against localhost: PBot refs occupy ids 93,904–94,077, contiguously above MariaDB's
`MAX(reference_no)` of 93,903. That contiguity is the artifact of correct ordering, not a coincidence.
`migrate-pbot-refs.js` additionally depends on `migrate-pbot-persons.js`, since it resolves enterers via
`person->'legacyIDs'->>'pbotID'` and skips any reference whose enterer is unresolved — a soft failure that
would quietly drop references rather than corrupt them.

The persons slice put its ordering into `migration-script-layout`. This change does **not** follow that
precedent, by explicit direction: ordering across all migrations will be encoded in an overall run script
under `src/` in a later change. That is the better home — an executable order cannot drift from the prose
describing it, and the dependency chain is global rather than pairwise:

```
persons → pbot-persons → refs → pbot-refs → authorities → …
```

Writing the refs half into a capability spec now would create text that the runner change has to then
remove. The finding is recorded in this change's proposal so the runner change inherits it. The persons
ordering already sitting in `migration-script-layout` is left in place for that change to consolidate rather
than being stripped out here.

### 4. "Use `src/lib`" stays narrow — reaffirmed against a sharper temptation

Only the four import lines change. This reaffirms the persons slice's decision 4, and is worth restating
because refs presents a materially stronger case for extraction than persons did:

```
migrate-refs.js  mapPersonIds()        src/lib/identity.js  resolvePersons()
  authorizer_no || 0 ───────────────────  identical
  0-sentinel fallback to the other ─────  identical
  both 0 → person_no = 1 ───────────────  identical
  + console.warn per branch               (silent)
```

These are behavioral twins apart from the warnings, and `resolvePersons` already lives in `src/lib/`. A
weaker second candidate: `buildPages()` in `migrate-refs.js` versus the inline page-parsing block at
`migrate-pbot-refs.js:140-152`.

Collapsing either one is still rejected. Adopting `resolvePersons` means choosing between losing
`migrate-refs.js`'s per-branch warnings — which are observable output the refs-migration spec's logging
requirement covers — and widening `src/lib/identity.js`'s contract to carry a logger. Both are behavioral
changes, and either would end the property that makes this change cheap to verify: that the diff is
self-evidently behavior-preserving. Extraction remains available once more scripts are under `src/` and the
shared surface is observed rather than guessed.

### 5. One delta spec

Only `migration-script-layout` changes, and only its inventory requirement. Everything else in that spec
already covers the refs pair as written: the one-directory-per-migration rule, the name-asymmetry rule, the
`src/lib/` rule, and the run-artifact rule (vacuous — neither script writes artifacts).

`db-connection-config` needs no delta either. Its rule — *scripts under `src/` import connection modules
from `src/lib/` where a counterpart exists* — already governs both scripts, and all three modules they need
(`db.js`, `pg-pool.js`, `uuidv7.js`) have counterparts. The specialty-pool gap that slice 1 left as an open
question (`pg-classic-pool.js`, `pg-migrated-pool.js`, `pg-play-pool.js` have no `src/lib/` counterparts) is
untouched here, because neither refs script needs one. It stays open for whichever slice hits it first.

### 6. The `MIGRATION_TEST_MODE` loss is a stronger no-op than it was for persons

`migrate-refs.js` moves from root `db.js` to `src/lib/db.js` and loses the test shim branch. For persons
this was argued as "never exercised." For refs the argument is structural: `db-test-shim.js` intercepts
queries matching `/ORDER BY opinion_no ASC/` against the legacy `opinions` table, answering them from
`pg_classic`. `migrate-refs.js` queries `refs`, `ref_authors`, and `ref_editors` with no such clause. The
shim could not serve it — under `MIGRATION_TEST_MODE=1` the script would fail, not silently misbehave. The
capability being dropped never existed for this script.

## Risks / Trade-offs

- **[Risk] A repointed import fails to resolve.** → Fails at module load, before any query, with a standard
  Node resolution error. Both scripts are idempotent, so a failed or partial run is recoverable by re-running
  after the fix. Caught immediately by the verification re-run.

- **[Risk] The `migrate-refs.js` re-run churns permids across 93,705 rows.** → It does not:
  `ON CONFLICT (id) DO UPDATE SET` deliberately omits `permid`, so existing rows keep theirs. The run does
  mint ~93.7K throwaway UUIDv7s that are then discarded by the conflict path — wasteful but harmless, and
  pre-existing behavior this change does not touch. Verification should still confirm permids are unchanged
  rather than assume it.

- **[Risk] Verification is confounded by a live upstream source.** → `migrate-pbot-refs.js` reads PBot's
  GraphQL API, which may have gained references since the last run. Idempotency is therefore proved by a
  **second consecutive run** inserting zero, not by the first inserting none — the same rule the persons
  slice applied. The PBDB side is the stable check: rows carrying `legacyIDs.oldpbdbID` must still equal the
  MariaDB `refs` count of 93,705 exactly.

- **[Risk] Deferring the run order leaves a live footgun undocumented.** → Accepted, and narrowed. The
  hazard only bites on a from-scratch rebuild in the wrong order; the existing localhost and dev databases
  are already correctly ordered, and this change does not re-run anything from scratch. The finding is
  recorded in the proposal rather than lost. The residual exposure is the window between this change and the
  runner change.

- **[Trade-off] The citation-form rule leaves eight bare filename mentions in place.** → A reader grepping
  for `migrate-refs.js` will find mentions that do not state where the file lives. Accepted: they are
  comparative asides where the path is not the point, and the alternative — touching six specs per
  relocation slice — churns far more text than it clarifies. The `migration-script-layout` inventory is the
  single authoritative answer to "where does this script live," which is precisely what it exists for.

- **[Trade-off] `migrate-pbot-refs.js` keeps its guarded DDL.** → The script issues
  `ALTER TABLE refs ADD CONSTRAINT references_permid_key UNIQUE (permid)` inside an existence check. Out of
  scope to remove, but it means this change's "no schema changes" claim describes the change, not the
  script.

- **[Risk] Slice 2 hardens a precedent that breaks at slice 3+.** → The four remaining scripts are the hard
  cases: `migrate-authorities.js` must resolve the `src/lib/authorities-builders.js` duplication, and
  `migrate-collections.js` may be the one that needs a specialty pool. Nothing decided here forecloses
  either — the citation-form rule and the narrow `src/lib` reading both reduce, rather than increase, what a
  later slice has to unwind.

## Migration Plan

1. Create `src/refs-migration/` and `src/pbot-refs-migrations/` (note the trailing `s` on the second).
2. `git mv` each script into place, preserving history and rename detection.
3. Repoint two import lines in each script. Change nothing else.
4. Update the two stale path references: the `.claude/settings.local.json` permission entry and the
   `docs/taxa-opinions-migration-mapping.md:661` citation.
5. Verify against localhost: re-run both scripts in order and confirm the baselines below hold.
6. Confirm no *path* reference to the old locations survives outside `openspec/changes/archive/`.

Baselines captured before the move:

| Measure | Value |
|---|---|
| `refs` total | 93,879 |
| carrying `legacyIDs.oldpbdbID` | 93,705 (= MariaDB `refs` count) |
| carrying `legacyIDs.pbotID` | 174, ids 93,904–94,077 |
| MariaDB `MAX(reference_no)` | 93,903 |

**Rollback:** `git revert`. Both scripts are idempotent and neither performs a destructive operation, so a
revert after a run leaves the database consistent; no data restoration is needed.

## Open Questions

- **What happens when a slice needs a specialty pool?** Carried forward unresolved from slice 1. Neither
  refs script needs `pg-classic-pool.js`, `pg-migrated-pool.js`, or `pg-play-pool.js`, so this slice adds no
  evidence either way. `migrate-collections.js` is the likeliest script to force the answer.

- **Does `migrate-authorities.js`'s move collapse the `src/lib/authorities-builders.js` duplication?** Still
  that slice's decision. Unchanged by this one.

- **Should the runner script own the whole chain or only the ordering?** The deferred run script could be a
  thin ordered driver, or could also own shared concerns the individual scripts currently duplicate — the
  nine divergent `setval(pg_get_serial_sequence(...))` call sites being the obvious candidate. Out of scope
  here; noted because this change is what defers the ordering to it.
