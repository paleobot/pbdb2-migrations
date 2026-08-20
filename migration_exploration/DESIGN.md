# Opinions Migration — Pair-Based Decomposition

**Status:** All 48 `(status, spelling_reason)` pairs implemented (`opinions/`), syntax-checked, and now
individually validated against live `pg_classic` data (see §7). Not yet execution-tested end-to-end.
**Scope:** legacy `opinions` → `name_opinions` / `assignment_opinions` / `validity_opinions` only.
**Not in scope:** legacy `authorities` → `name_opinions` (root minting). `migrate-authorities.js` and
`migrate-name-opinions.js`'s root-minting pass are unchanged, reused as-is from the existing root-level
scripts.
**Relationship to existing scripts:** parallel exploratory rewrite. The root-level `migrate-*-opinions.js`
scripts are untouched and remain the current baseline; nothing here retires them (yet).

---

## 1. The philosophy

Legacy `opinions` rows are organized by **decomposition slice** in the existing root-level scripts — one
script per target shape, each filtering on `status` and, inconsistently, on `spelling_reason`. That let
variation slip through uncounted (e.g. the existing `migrate-synonymy-opinions.js` only ever read
`spelling_reason = 'original spelling'`, silently deferring every other spelling_reason on a synonym-of
opinion).

**The rule here:** every unique `(status, spelling_reason)` pair gets its own dedicated import module, with
its own explicit mapping — even where the rule is identical to a neighboring pair's. The legacy `opinions`
table crosses exactly two enums to decide a row's fate, so the pair is the natural unit of a mapping
decision:

- **Nothing routes by default.** A pair with no explicit handler is a visible gap, not a silent fallthrough.
- **Duplication is fine.** Where several pairs under one status share one rule, each file still declares
  it explicitly and calls into a shared `lib/` transform — thin, but not merged away.

## 2. The migration / derivation boundary

Migration writes every qualifying legacy opinion as its own ledger row, **unconditionally**. It never
compares `evidence`/`pubyr`/`id` across candidate opinions to pick a "winner," and never needs to know
which opinion currently governs a permid's accepted spelling, classification, or validity — that ranking
is exclusively `derive_taxa()`'s job, run later, standalone, against the complete ledger
(`docs/classic-taxa-opinions.md` §9.8.4; see the boundary note at the top of
`docs/taxa-opinions-migration-mapping.md`). Multiple ledger rows asserting different (or the same) things
about one subject_permid is normal and expected; nothing here is a contest.

## 3. Field mapping rules

**Subject is always `child_spelling_no`.** Every emitted row — `assignment_opinions`, `name_opinions`
concept edges, `name_opinions` lineage edges, `validity_opinions` — uses
`subject_permid = permid(child_spelling_no)`. Confirmed against the live Classic UI, not assumed from the
schema or from probed row data.

**The "other end" depends on the row's role:**

| row type | field | source |
|---|---|---|
| `assignment_opinions` | `containing_permid` | `permid(parent_spelling_no)` |
| `name_opinions` concept edge | `target_permid` | `permid(parent_spelling_no)` |
| `name_opinions` lineage edge | `target_permid` | `permid(child_no)` |
| `validity_opinions` | *(no target column)* | — |

**Dual emission.** Whenever a row's `spelling_reason ≠ 'original spelling'`, it carries a **second**,
independent claim in addition to its status's primary disposition: a `name_opinions` lineage edge
(`subject = child_spelling_no`, `target = child_no`, reason per §4's crosswalk). This holds for every
status, not just `belongs to` — a `subjective synonym of`/`recombination` row, for instance, emits both its
synonymy concept edge and a separate lineage edge. The two emissions are resolved and skipped
independently; a failure in one does not block the other.

**Misspelling has two distinct provenances, and two distinct reason tokens.** Classic distinguishes a
formally published misspelling claim from an incidental one, and the schema now carries that distinction:
- `reason = 'misspelling'` — curatorial: a data enterer notices, while entering an opinion about something
  else (any status, `spelling_reason = 'misspelling'`), that the current reference rendered the name
  incorrectly. No reference independently argues the point.
- `reason = 'historical misspelling'` — dedicated: legacy `status = 'misspelling of'`, where the entire
  opinion (its own reference, its own evidence) is a formally published claim that a name is a misspelling.
  Named after the PBDB user guide's own term for this case.

`evidence`/`basis` does not reliably separate the two (live-probed: 43.9% of `misspelling of` rows are
`stated with evidence` vs. 28.9% of `spelling_reason='misspelling'` rows — a skew, not a clean split),
which is why this needed its own dictionary token rather than being inferable from an existing column. Both
tokens are `lineage`-class and `never_accepted`.

**`nomen oblitum`'s targeted/untargeted split is a per-row branch, not a folder split.** `parent_no ≠ 0`
(targeted) → `name_opinions` concept fold (`reason='nomen oblitum'`); `parent_no = 0` (untargeted) →
`validity_opinions` testimony. This branch is decided per row inside each `nomen-oblitum/*.js` file,
orthogonal to whether that file also emits a lineage edge (which depends on `spelling_reason`, not
`parent_no`).

**Same-taxon self-reference (`child_no == parent_no`, 113 concept/assignment-edge rows across most
synonymy/replacement/assignment statuses — heaviest in `belongs-to`, absent in `nomen-oblitum`/
`nomen-vanum`; 9 of the 113 are the "convergent correction" exception below).** An opinion asserting a
taxon is a synonym/replaced-by/subgroup/assignment of itself is nonsensical on its face — already treated
in the pre-existing skip/repair register (`docs/taxa-opinions-migration-mapping.md` §9.5) as "self-synonymy
is meaningless." **Verdict: bucket 2 (bad data)** — no ambiguity here, unlike the lineage-only
self-reference case below. Always correctly skipped by the existing `self_reference` checks; no action
needed beyond the skip already in place.

**The mistagged `original spelling` anomaly.** Not exclusive to one pair: any `spelling_reason =
'original spelling'` row can, in principle, have `child_spelling_no ≠ child_no` — a real lineage claim
hiding under a mistrusted label. Each gets its own lineage row regardless, resolved per-pair:

- **`belongs-to`/`original-spelling`** (50 of 743,712 rows): reason taken from the pre-computed
  `mistagged-original-spelling.csv` worklist:

  | inferred reason | rows | `namechange_reasons` token |
  |---|---:|---|
  | reranked | 16 | `reranked` |
  | recombination | 10 | `recombination` |
  | correction | 1 | `correction` |
  | duplicate-or-homonym | 22 | `assignment` |

  The 22 "duplicate-or-homonym" rows (identical name + rank, different `taxon_no` — e.g. a name
  re-anchored to a newer authority, common in botanical nomenclature) are not special-cased; none of
  the more specific tokens describe "same name, same rank, new authority," so they use the generic
  `assignment` token.

- **`replaced-by`/`original-spelling`** (1 of 3,706 rows — opinion_no 955925, found live during the
  validation pass, 2026-08-19): another duplicate-or-homonym case (`child_no` and `child_spelling_no`
  both resolve to "Metatheria", subclass, under different `taxon_no`) → `assignment` token. Hardcoded
  in the handler (`MISTAGGED_LINEAGE_REASON`) rather than CSV-driven, since it's a single confirmed
  instance rather than a worklist-sized anomaly.

- **`subjective-synonym-of`/`original-spelling`** (2 of 47,687 rows, found live during the validation
  pass, 2026-08-19) — the first pair where this backfill had to be added as genuinely new logic (no
  prior assignment/lineage split existed in this single-output concept-only handler):
  - opinion_no 71324: `child_no`="Dromomeryx (Subdromomeryx)" (subgenus) vs `child_spelling_no`=
    "Subdromomeryx" (genus) — a rank-change claim → `reranked` token.
  - opinion_no 912640: `child_no`/`child_spelling_no` both "Ericales" (order), different `taxon_no` →
    duplicate-or-homonym, `assignment` token. This row's concept edge is *also* independently skipped
    as a same-taxon self-reference (`child_no == parent_no`) — the backfill still fires regardless,
    since it's gated only on the true shared prerequisites (`child_spelling_no` and reference
    resolving), not on the concept edge's own outcome. This is the first confirmed case where a row
    hits two independent anomalies at once, and it validates the "resolved and skipped independently"
    principle from §3's dual-emission rule for a case where the two paths' skip conditions actually
    overlap.

Every other pair checked during validation (§7) came back clean of this anomaly — but absence there is
only "none found where checked," not proof none exist in pairs not yet re-probed after a code change.

**Rootless `belongs to` (`parent_spelling_no = 0`, 332 of 927,512 rows across the 6 `belongs-to/*.js`
handlers).** `parent_spelling_no = 0` is Classic's own assertion that the opinion's subject has no
containing taxon, not unresolvable data — it belongs in the ledger like any other qualifying opinion
(§2). `assignment_opinions.containing_permid` (`postgresql/create_new.sql`) is nullable for exactly this
case: every `belongs-to` handler migrates these rows with `containing_permid = NULL`, so the claim can
win or lose `derive_taxa()`'s usual evidence/pubyr/id contest like any other assignment opinion — a
later, better-evidenced real assignment can still supersede it, or vice versa. `derive_taxa()` needs no
special-casing for this: its containment joins are already `LEFT JOIN`s that treat an unmatched/NULL
`containing_permid` as "no containing concept," identical to how a permid with zero assignment opinions
gets `containing_concept_permid = NULL` (`taxa`'s own `-- NULL = root` convention). `NULL` is reserved for
this asserted case only — an unresolvable/orphaned `parent_spelling_no` (`parent_spelling_orphan`) is
always skipped-and-logged, never written as NULL, so `containing_permid IS NULL` in the table
unambiguously means "Classic asserted none," never "we couldn't resolve it." Each handler logs these rows
to `anomalies.csv` as `warning`/`asserted_rootless`, not as a skip.

**`parent_spelling_orphan` / `child_spelling_unresolved` are genuine Classic data defects, not a migration
gap.** Live-probed 2026-08-19 against `pg_classic`: all 6 distinct orphaned `taxon_no` values (247010,
306259, 100716, 319663, 161644, 120387 — plus 319671, the `parent_no` concept anchor behind two of the
`parent_spelling_orphan` rows) are **entirely absent from Classic's own `authorities` table**, not merely
excluded by this project's separate authorities-migration pass (there is nothing there to have excluded).
Each sits as a single-id gap inside an otherwise dense, taxonomically coherent id neighborhood — e.g.
`100716` (referenced by 5 separate `belongs to` opinions) sits directly between real neighbors `100715
Eschrichtidae` and `100717 Grampidae`, next to its own likely-synonymous concept `42976 Eschrichtiidae` —
the signature of an `authorities` row that existed and was later deleted, not one that was never entered.
Classic's schema doesn't cascade such deletes into `opinions`, leaving the referencing rows permanently
dangling. **Verdict: bucket 2 (bad data)** — worth flagging to Classic's maintainers for cleanup (restore
the deleted authority rows, or accept the affected opinions — 431131, 541317, 567425–567429, 568292,
294387, 289111 — as permanently unmigratable). No migration-side fix applies; these rows are correctly
skipped-and-logged already.

**"Convergent correction" (`replaced-by/correction.js`, 9 of the pair's 50 rows) is a real nomenclatural
pattern, not an anomaly — confirmed 2026-08-19, no action needed.** Every one of the 9 rows is a genuine
unavailable/replacement-name event where the corrected spelling of `child_no` and the `replaced by` target
resolve to the exact same identity — e.g. opinion_no 311631: *Tianchiasaurus* corrected to *Tianchisaurus*,
which is exactly what this opinion says it's replaced by; opinion_no 722434 even carries the curator's own
comment ("The name Propithecia proposed by Kay et al. [1998]... is not available"), a textbook
unavailable-name replacement. The handler's concept-edge and lineage-edge self-reference checks are already
independent `if` blocks: the concept edge is correctly skipped as a self-loop (`child_spelling_no ==
parent_spelling_no`, would violate `name_opinion_not_self`), while the lineage edge (`child_no →
child_spelling_no`, reason `'correction'`) fires normally in all 9 cases, since `child_spelling_no !=
child_no` there. The skipped concept edge would only have restated the same identity the lineage edge
already carries — nothing is lost, and no code change applies.

**Lineage self-reference (224 rows: `child_spelling_no == child_no` despite a non-`'original spelling'`
`spelling_reason`) — root cause genuinely unclear; flagged for Classic, no migration-side action.**
Live-sampled 2026-08-19 across all five reason tokens (`correction`/`misspelling`/`rank change`/
`recombination`/`historical misspelling`) with sibling-opinion cross-checks on the same `child_no`. Two
sub-patterns, neither a simple one-off typo:
- **Ordinary statuses:** several samples have *other* opinions on the identical `child_no` independently
  using the *same* reason token against a genuinely different `child_spelling_no` — e.g. opinion_no 9502
  (`rank change`, no deviation on this row) has six sibling opinions all saying `rank change` with
  `child_spelling_no=153934`, a real different spelling. One sampled row's `comments` field literally reads
  `"implicitly"`. This suggests Classic curators sometimes populate `spelling_reason` from the taxon's
  general nomenclatural history as understood at data-entry time, not strictly from this row's own
  `child_no`/`child_spelling_no` pair — a real looseness in field semantics, not just careless mistagging.
- **`misspelling of` specifically:** `misspelling-of/misspelling.js` never reads `parent_spelling_no` (its
  own header comment: `child_no = parent_no` for all 875 rows, live-confirmed) — but in these anomalous
  rows `parent_spelling_no` differs from `parent_no`/`child_no` anyway. Most likely a vestigial data-entry
  artifact (a generic opinion-entry form auto-filling a "current parent spelling" field that's meaningless
  for this status) rather than a real claim, and inert either way since the handler doesn't consult it.

Neither sub-pattern changes migration behavior: a row with no real `child_spelling_no != child_no`
deviation correctly emits no lineage edge regardless of why the label says otherwise — the existing skip is
correct independent of root cause. **Verdict: bucket 3 (needs Classic curatorial/dev explanation)** for the
"why," purely for their own documentation — not a blocker here.

**Homonyms are not modeled in this migration.** Per the 2.0-native design (distinct from Classic),
homonymy is an emergent property of the derived `taxa` table (non-unique `taxon_name`), not a curated or
migrated concept. No legacy source table for it exists in the accessible Postgres-ported classic mirror
either way. `create_new.sql`'s standalone `homonyms` table looks like dead schema from an earlier design
phase — a candidate for separate cleanup, not addressed here.

## 4. Per-status disposition and lineage reason crosswalk

| status | primary disposition | lineage reason by `spelling_reason` |
|---|---|---|
| belongs to | `assignment_opinions` | recombination→`recombination`, rank change→`reranked`, correction→`correction`, misspelling→`misspelling`, reassignment→`assignment` |
| subjective synonym of | concept, `junior synonym`, `objective=false` | same crosswalk as above |
| objective synonym of | concept, `junior synonym`, `objective=true` | same crosswalk |
| invalid subgroup of | concept, `invalid subgroup`, `objective=NULL` | same crosswalk |
| replaced by | concept, `replaced by`, `objective=NULL` | same crosswalk (no `reassignment` variant in the data) |
| misspelling of | *(none — this status IS the lineage claim)* | single reason: `historical misspelling` |
| nomen dubium | `validity_opinions`, `bars_candidacy=false` | same crosswalk (no `reassignment` variant) |
| nomen nudum | `validity_opinions`, `bars_candidacy=true` | same crosswalk (no `reassignment` variant) |
| nomen oblitum | per-row branch (§3) | same crosswalk (no `reassignment`/`rank change` variant) |
| nomen vanum | `validity_opinions`, `bars_candidacy=false` | same crosswalk (recombination/misspelling/correction/reassignment; no `rank change` variant) |

`spelling_reason = 'original spelling'` never emits a lineage edge (by definition `child_spelling_no ==
child_no`), except for the mistagged-anomaly rows noted in §3 (53 rows total, across three pairs).

Live row counts per pair (probed against the Postgres-ported classic mirror, `PG_CLASSIC_*`): 998,565 total
across 48 pairs, reconciling exactly against `docs/taxa-opinions-migration-mapping.md`'s per-status totals.

## 5. Folder structure

```
migration_exploration/
  DESIGN.md
  lib/                             shared transforms, used by every pair handler:
    identity.js                      name-permid Map, reference Map, person 0-sentinel fallback
    attribution.js                   second-hand rule, opinionAttribution builder, "authority unknown" sentinel
    evidence.js                      basis → evidence boolean
    anomaly-log.js                   per-status-folder anomaly ledger (§7): createAnomalyLog(import.meta.url)
                                      .log(opinionNo, targetTable, severity, issue, description), .flush()
                                      rewrites <folder>/anomalies.csv, replacing only that script's own rows
  opinions/
    belongs-to/                      6 files (one per spelling_reason) + anomalies.csv
    subjective-synonym-of/           6 files + anomalies.csv
    objective-synonym-of/            5 files + anomalies.csv
    invalid-subgroup-of/             6 files + anomalies.csv
    misspelling-of/                  1 file + anomalies.csv
    replaced-by/                     5 files + anomalies.csv
    nomen-dubium/                    5 files + anomalies.csv
    nomen-nudum/                     5 files + anomalies.csv
    nomen-oblitum/                   4 files (each branches internally on parent_no, §3) + anomalies.csv
    nomen-vanum/                     5 files + anomalies.csv
  run.js                            not yet written — global orchestrator (§7)
```

Each folder's `anomalies.csv` is a generated artifact (gitignored, not checked in) — it's rebuilt by
running that folder's handlers, which each clean up only their own prior rows via `anomaly-log.js`'s
`.flush()`. If it's missing, that just means no handler in that folder has run since the last clone;
running any handler recreates it for that folder (see §7 for what's currently logged there).

Each pair handler: states its exact `(status, spelling_reason)` source filter and row count in a header
comment; delegates identity/reference/person/attribution/evidence resolution to `lib/`; performs its own
skip-and-log bookkeeping and reconciliation invariant (`inserted + skipped == source rows`, per emission
type where a pair has more than one).

## 6. Status: complete

All 48 pairs are implemented and pass `node --check`. Every pair falls into exactly one of four shapes
(strict partition, sums to 48):

| shape | pairs | example |
|---|---:|---|
| single-output, `original spelling` — one per status except `nomen oblitum` (its own row below); no lineage edge except for the mistagged-anomaly backfill rows carried by 3 of the 8 (`belongs-to`, `replaced-by`, `subjective-synonym-of`; §3) | 8 | `belongs-to/original-spelling.js` |
| dual-output: primary disposition + lineage edge, for every other `spelling_reason` across those same 8 statuses | 35 | `subjective-synonym-of/recombination.js` |
| single-output, lineage only (`misspelling of`'s one spelling_reason) | 1 | `misspelling-of/misspelling.js` |
| per-row targeted/untargeted branch, `nomen oblitum` (all 4 spelling_reason variants; 3 of the 4 also carry a lineage edge, §3) | 4 | `nomen-oblitum/recombination.js` |

## 7. Remaining work

- **Root-level `migrate-assignment-opinions.js` still skips rootless `belongs to` rows.** The pre-existing,
  untouched baseline script (see "Relationship to existing scripts" at the top of this doc) has not been
  updated to match the rootless fix described in §3: it still treats `parent_spelling_no = 0` as a `parent_spelling_zero` skip
  rather than inserting `containing_permid = NULL`. `payloadSchemas/mappings/authorities-opinions.md`
  documents that script's real current behavior accurately, so it is not wrong today — but both need to be
  updated together once the root-level script adopts this handling, so the production baseline and its
  mapping doc stop disagreeing with the rule this rework already applies.
