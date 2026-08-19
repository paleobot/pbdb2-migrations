# Opinions Migration — Pair-Based Decomposition

**Status:** All 48 `(status, spelling_reason)` pairs implemented (`opinions/`), syntax-checked. Not yet
execution-tested against live data (see §7).
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

**The `belongs-to`/`original-spelling` anomaly.** 50 of the 743,712 rows in this pair are labeled
`original spelling` but have `child_spelling_no ≠ child_no` — a real lineage claim hiding under a
mistrusted label. Each gets its own lineage row regardless, with the reason taken from the pre-computed
`mistagged-original-spelling.csv` worklist:

| inferred reason | rows | `namechange_reasons` token |
|---|---:|---|
| reranked | 16 | `reranked` |
| recombination | 10 | `recombination` |
| correction | 1 | `correction` |
| duplicate-or-homonym | 22 | `assignment` |

The 22 "duplicate-or-homonym" rows (identical name + rank, different `taxon_no` — e.g. a name re-anchored
to a newer authority, common in botanical nomenclature) are not special-cased; none of the more specific
tokens describe "same name, same rank, new authority," so they use the generic `assignment` token.

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
child_no`), except for the 50-row anomaly noted in §3.

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
  opinions/
    belongs-to/                      6 files (one per spelling_reason)
    subjective-synonym-of/           6 files
    objective-synonym-of/            5 files
    invalid-subgroup-of/             6 files
    misspelling-of/                  1 file
    replaced-by/                     5 files
    nomen-dubium/                    5 files
    nomen-nudum/                     5 files
    nomen-oblitum/                   4 files (each branches internally on parent_no, §3)
    nomen-vanum/                     5 files
  run.js                            not yet written — global orchestrator (§7)
```

Each pair handler: states its exact `(status, spelling_reason)` source filter and row count in a header
comment; delegates identity/reference/person/attribution/evidence resolution to `lib/`; performs its own
skip-and-log bookkeeping and reconciliation invariant (`inserted + skipped == source rows`, per emission
type where a pair has more than one).

## 6. Status: complete

All 48 pairs are implemented and pass `node --check`. Every pair falls into exactly one of four shapes
(strict partition, sums to 48):

| shape | pairs | example |
|---|---:|---|
| single-output, `original spelling`, no lineage — one per status except `nomen oblitum` (its own row below) | 8 | `belongs-to/original-spelling.js` (also carries the 50-row anomaly backfill, §3) |
| dual-output: primary disposition + lineage edge, for every other `spelling_reason` across those same 8 statuses | 35 | `subjective-synonym-of/recombination.js` |
| single-output, lineage only (`misspelling of`'s one spelling_reason) | 1 | `misspelling-of/misspelling.js` |
| per-row targeted/untargeted branch, `nomen oblitum` (all 4 spelling_reason variants; 3 of the 4 also carry a lineage edge, §3) | 4 | `nomen-oblitum/recombination.js` |

## 7. Remaining work

- **Validation.** Pairs 1–10 and 24 were each individually confirmed against live query results and
  spot-checked opinion_nos during development. The remaining 37 pairs were implemented against the rules in
  §3–§4 but have not each been individually probed the same way — worth a validation pass before treating
  this as production-ready.
- **`run.js`.** The global orchestrator — run all 48 handlers, aggregate one final reconciliation
  (inserted + skipped == 998,565 across every pair) — has not been written.
- **Execution testing.** Nothing in this exploration has been run end-to-end. This sandbox's `.env` only
  has `PG_CLASSIC_*` credentials (the Postgres-ported classic mirror, used for live probing); the actual
  migration scripts need `MARIADB_*` (source) and `PG_*` (target) credentials this environment doesn't
  have. Every handler is structurally and syntactically validated, not execution-tested.
