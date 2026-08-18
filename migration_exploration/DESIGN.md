# Opinions Migration — Pair-Based Decomposition

**Status:** DRAFT — for discussion before any code is written.
**Scope:** legacy `opinions` → `name_opinions` / `assignment_opinions` / `validity_opinions` only.
**Not in scope:** the legacy `authorities` → `name_opinions` (root minting) migration. `migrate-authorities.js`
and `migrate-name-opinions.js`'s root-minting pass are unchanged and reused as-is from the existing
root-level scripts.
**Relationship to existing scripts:** parallel exploratory rewrite. The root-level `migrate-*-opinions.js`
scripts are untouched and remain the current baseline; nothing here retires them (yet).

---

## 1. The philosophy

The existing opinions scripts are organized by **decomposition slice** — one script per target shape
(`migrate-assignment-opinions.js`, `migrate-synonymy-opinions.js`), each internally filtering on `status`
and, inconsistently, on `spelling_reason`. That grouping has let variation slip through uncounted: e.g.
`migrate-synonymy-opinions.js` only ever read `spelling_reason = 'original spelling'` and silently deferred
every other spelling_reason on a synonym-of opinion to "a later slice" that doesn't exist yet.

**The new rule:** every unique `(status, spelling_reason)` pair gets its own dedicated import module, with
its own explicit mapping rule — even when that rule turns out to be identical to a neighboring pair's. The
legacy `opinions` table crosses exactly two enums to decide a row's fate (mapping doc §1), so the pair *is*
the natural unit of a mapping decision. Organizing code around it means:

- **Nothing routes by default.** A pair with no explicit handler is a visible gap, not a silent fallthrough.
- **"any spelling_reason" claims get checked, not assumed.** Several routing calls in the existing mapping
  doc (§5) say a status routes the same way "any" spelling_reason — invalid subgroup of, replaced by, the
  whole nomen family. Splitting by pair forces us to actually look at each variant's rows before agreeing.
- **Duplication is fine.** Where five pairs under one status genuinely share one rule, their five files
  each declare that rule explicitly and call into a shared `lib/` transform — thin, but not merged away.

## 2. Live cross-tab (probed 2026-08-18 against the Postgres-ported classic mirror, `PG_CLASSIC_*`)

48 pairs, 998,565 rows total. Every per-status subtotal below reconciles exactly with the counts already
recorded in `docs/taxa-opinions-migration-mapping.md` — cross-validates both the probe and the existing
design doc's numbers.

| status | spelling_reason | rows | proposed target (per existing §5/§5.2 routing) |
|---|---|---:|---|
| belongs to | original spelling | 743,712 | `assignment_opinions` (containment). **Anomaly:** 50 of these have `child_spelling_no ≠ child_no` (§5.1) — see open question 2. |
| belongs to | recombination | 146,103 | `assignment_opinions` (containment) **+** `name_opinions` lineage-mint candidate, reason `recombination` |
| belongs to | rank change | 20,743 | `assignment_opinions` **+** lineage-mint candidate, reason `reranked` |
| belongs to | correction | 9,659 | `assignment_opinions` **+** lineage-mint candidate, reason `correction` |
| belongs to | misspelling | 6,983 | `assignment_opinions` **+** lineage-mint candidate, reason `misspelling` (never_accepted) |
| belongs to | reassignment | 312 | `assignment_opinions` **+** lineage-mint candidate, reason `assignment` |
| subjective synonym of | original spelling | 47,687 | `name_opinions` concept, `junior synonym` (objective=false) |
| subjective synonym of | recombination | 2,816 | same — **unverified**, see open question 3 |
| subjective synonym of | rank change | 880 | same — unverified |
| subjective synonym of | correction | 399 | same — unverified |
| subjective synonym of | misspelling | 320 | same — unverified |
| subjective synonym of | reassignment | 4 | same — unverified |
| objective synonym of | original spelling | 1,152 | `name_opinions` concept, `junior synonym` (objective=true) |
| objective synonym of | rank change | 37 | same — unverified |
| objective synonym of | recombination | 36 | same — unverified |
| objective synonym of | correction | 15 | same — unverified |
| objective synonym of | misspelling | 6 | same — unverified |
| invalid subgroup of | original spelling | 1,316 | `name_opinions` concept, `invalid subgroup` (§5.2) |
| invalid subgroup of | rank change | 43 | same — unverified |
| invalid subgroup of | recombination | 28 | same — unverified |
| invalid subgroup of | correction | 23 | same — unverified |
| invalid subgroup of | misspelling | 8 | same — unverified |
| invalid subgroup of | reassignment | 2 | same — unverified |
| misspelling of | misspelling | 875 | **not emitted directly** — read only as a lineage-mint candidate (§9.0) |
| replaced by | original spelling | 3,706 | `name_opinions` concept, `replaced by` |
| replaced by | recombination | 160 | same — unverified |
| replaced by | rank change | 96 | same — unverified |
| replaced by | correction | 50 | same — unverified |
| replaced by | misspelling | 8 | same — unverified |
| nomen dubium | original spelling | 7,463 | `validity_opinions`, status `nomen dubium`, no derive() effect |
| nomen dubium | recombination | 573 | same — unverified |
| nomen dubium | misspelling | 91 | same — unverified |
| nomen dubium | correction | 73 | same — unverified |
| nomen dubium | rank change | 8 | same — unverified |
| nomen nudum | original spelling | 2,393 | `validity_opinions`, status `nomen nudum`, bars_candidacy |
| nomen nudum | recombination | 91 | same — unverified |
| nomen nudum | misspelling | 36 | same — unverified |
| nomen nudum | correction | 11 | same — unverified |
| nomen nudum | rank change | 2 | same — unverified |
| nomen oblitum | original spelling | 66 | split by `parent_no≠0`: concept fold vs `validity_opinions` (§5.2) |
| nomen oblitum | recombination | 6 | same split — unverified |
| nomen oblitum | correction | 3 | same split — unverified |
| nomen oblitum | misspelling | 1 | same split — unverified |
| nomen vanum | original spelling | 509 | `validity_opinions`, status `nomen vanum`, no derive() effect |
| nomen vanum | recombination | 49 | same — unverified |
| nomen vanum | misspelling | 6 | same — unverified |
| nomen vanum | correction | 4 | same — unverified |
| nomen vanum | reassignment | 1 | same — unverified |

"unverified" = the existing mapping doc asserts this status routes the same way regardless of
spelling_reason, but no probe has specifically confirmed these rows behave like their `original spelling`
siblings (see open question 3). None of this table's dispositions are new decisions — they carry over the
already-settled §5/§5.2 routing matrix; this doc only re-expresses it at pair granularity.

## 3. Proposed folder structure

```
migration_exploration/
  DESIGN.md                        (this file)
  lib/                             shared transforms, reused by pair handlers, not duplicated:
    identity.js                      name-permid Map, reference Map, person 0-sentinel fallback
    attribution.js                   second-hand rule, opinionAttribution builder, "authority unknown" sentinel
    evidence.js                      basis → evidence boolean
  opinions/
    belongs-to/
      original-spelling.js
      recombination.js
      rank-change.js
      correction.js
      misspelling.js
      reassignment.js
    subjective-synonym-of/           6 files, one per spelling_reason
    objective-synonym-of/            5 files
    invalid-subgroup-of/             6 files
    misspelling-of/
      misspelling.js                 (candidate-only; emits nothing directly)
    replaced-by/                     5 files
    nomen-dubium/                    5 files
    nomen-nudum/                     5 files
    nomen-oblitum/                   4 files (each internally splits targeted/untargeted)
    nomen-vanum/                     5 files
  lineage-mint.js                    cross-pair winner-selection step (open question 1)
  run.js                             orchestrator: runs all handlers, aggregates one global
                                      reconciliation (inserted + skipped == 998,565)
```

Each pair-handler file's contract:
- States its exact `(status, spelling_reason)` source filter and row count as a header comment (self-checking
  against a live re-probe).
- Declares target table(s) and reason/status token.
- Delegates identity/reference/person/attribution/evidence resolution to `lib/`.
- Returns `{sourceRows, inserted, skipped, breakdown}` in a common shape so `run.js` can reconcile across
  all 48 without each file reimplementing the invariant check.

## 4. Process rules established while working these pairs

**No ranking at migration time.** Migration writes every qualifying legacy opinion as its own ledger row,
unconditionally. It never compares `evidence`/`pubyr`/`id` across candidate opinions to pick a "winner" —
that is exclusively `derive_taxa()`'s job, run later against the complete ledger. (This corrects Q1 below,
which wrongly imported that ranking into migration design; see the boundary note now at the top of
`taxa-opinions-migration-mapping.md`.)

**Field direction is not assumed from column names.** Classic's opinion-entry UI does not use
`child_no`/`child_spelling_no`/`parent_no`/`parent_spelling_no` consistently across every status — which
field is "the subject" vs. "the target" can differ by how that status's form phrases the assertion (e.g. a
misspelling entry could be phrased either "X is a misspelling of Y" or "Y is misspelled as X" depending on
the status). Each new pair's subject/target field mapping is confirmed against the live Classic UI before
being implemented — never inferred from the schema or from probed row data alone. Pair 1's direction
(`subject = child_spelling_no`, `containing/target = parent_spelling_no`/`child_no`) is confirmed and
already established by the pre-existing `migrate-assignment-opinions.js` / Q1(a) decision.

**Confirmed empirically, not just theoretically (2026-08-19):** Pair 2 (`belongs to`/`recombination`) uses
`name_opinions` `subject = child_no`, `target = child_spelling_no` — the reverse of Pair 1's direction and
of the mapping doc's general Q1(a) "direct-to-original" framing. Each pair's mapping is taken as given by
the UI check, not reconciled against any other pair's or the mapping doc's general framing.

## 5. Resolved questions

### Q1 (was: lineage-introducing-opinion winner selection) — DISSOLVED, 2026-08-19
This question assumed migration needed to pick a "canonical winner" among candidate introducing opinions
for a spelling, the way `derive_taxa()` does. That premise was wrong (see the process rule above): every
opinion satisfying a lineage edge's structural requirement (`child_spelling_no ≠ child_no`) gets its own
`name_opinions` lineage row, unconditionally — no comparison across candidates, no shared staging pass, no
`lineage-mint.js`. Multiple lineage rows asserting different things about the same `subject_permid` is
normal ledger content; `derive_taxa()` ranks among them later, at read time.

### Q2 — The 50-row `belongs-to`/`original-spelling` anomaly (§5.1) — RESOLVED, 2026-08-19
Implemented in `opinions/belongs-to/original-spelling.js`. Each of the 50 rows gets its own `lineage`
`name_opinions` row (in addition to its normal `assignment_opinions` containment row), reason taken from
the `mistagged-original-spelling.csv` worklist rather than the untrustworthy `original spelling` label:

| inferred reason | rows | `namechange_reasons` token |
|---|---:|---|
| reranked | 16 | `reranked` |
| recombination | 10 | `recombination` |
| correction | 1 | `correction` |
| duplicate-or-homonym | 22 | `assignment` |

The 22 "duplicate-or-homonym" rows (identical name + rank, different `taxon_no`) are **not** special-cased —
confirmed this is a legitimate case (e.g. a botanical name re-anchored to a newer authority with no textual
change) and gets a normal lineage edge like any other. None of the more specific tokens
(`correction`/`reranked`/`recombination`) describe "same name, same rank, new authority," so these use the
generic `assignment` token rather than adding a new dictionary token for a 22-row case. The 50th row
(dangling `child_spelling_no`) needs no special handling — it's already excluded by the standard
`child_spelling_unresolved` skip, which fires before the lineage check ever runs.

Aside, not part of this migration: investigated whether the schema's separate `homonyms` table (non-opinion,
`create_new.sql` line 4991) should be populated as part of resolving this pair. It shouldn't — per the
2.0-native design (distinct from Classic), homonymy is an **emergent** property of the derived `taxa` table
(non-unique `taxon_name`), not a curated/migrated concept. No legacy source table for it exists anyway (the
mapping doc's Q4 claim that "homonymy migrates from the legacy `homonyms` table" points at a table that
isn't in the Postgres-ported classic mirror — confirmed absent, 2026-08-19). The `homonyms` table in
`create_new.sql` and its supporting design notes (`classic-taxa-opinions.md` D10, §9.5.2) look like dead
schema from an earlier design phase; flagged for a separate cleanup, not addressed here.

### Q3 — Are the "unverified" pairs actually uniform? — RESOLVED, 2026-08-19
No — and the general shape of the answer is now settled. A `(status, spelling_reason)` pair where
`spelling_reason ≠ 'original spelling'` on a **non-`belongs-to`** status (synonym-of, invalid subgroup of,
replaced by, the nomen family) is Classic collapsing two distinct 2.0-model assertions into one legacy row:
a **concept**-class claim (from `status`) and a **lineage**-class spelling claim (from `spelling_reason`).
The correct migration is **two `name_opinions` records per matching source row** — one of each class — not
a single row that picks one disposition over the other. This mirrors the §5.1 backfill (pair 1) and the
"every opinion becomes its own ledger row, unconditionally" boundary rule: nothing here is a contest,
each implicit assertion just gets its own row.

This resolves the *shape* of the answer for all 32 "unverified" pairs, but each pair's actual field mapping
(which of `child_no`/`child_spelling_no`/`parent_no`/`parent_spelling_no` plays which role in the lineage
half) still needs the same live UI confirmation as every other pair — Q3 removes the need to re-derive
*whether* a second emission is needed, not the need to confirm *how* to build it.

## 6. Open questions

### Q4 — Granularity of `nomen oblitum`'s targeted/untargeted split
`nomen oblitum` already splits on `parent_no` (not `spelling_reason`) into two totally different target
tables (§5.2). That split is orthogonal to the pair-based split proposed here. Confirm: does each of the 4
`nomen-oblitum/*.js` spelling_reason files internally branch on `parent_no`, or does the folder split
further into `nomen-oblitum/targeted/*.js` + `nomen-oblitum/untargeted/*.js` (8 files total)?

---

## 7. Progress

Working the 48 pairs in table order (§2), one at a time: confirm field direction against the Classic UI
(user-supplied per pair, never inferred) -> resolve any pair-specific data quirks against live probes ->
write the handler -> move on. `run.js` (the global reconciliation orchestrator) comes last, once all
handlers exist.

| # | pair | status |
|---:|---|---|
| 1 | belongs to / original spelling | ✅ done — `opinions/belongs-to/original-spelling.js` |
| 2 | belongs to / recombination | ✅ done — `opinions/belongs-to/recombination.js` (reversed field direction, see §4) |
| 3 | belongs to / rank change | ✅ done — `opinions/belongs-to/rank-change.js` (same direction as pair 2, reason `reranked`) |
| 4 | belongs to / correction | ✅ done — `opinions/belongs-to/correction.js` (same direction as pairs 2–3, reason `correction`) |
| 5 | belongs to / misspelling | ✅ done — `opinions/belongs-to/misspelling.js` (direction reverts to pair 1's, reason `misspelling`) |
| 6 | belongs to / reassignment | ✅ done — `opinions/belongs-to/reassignment.js` (same direction as pair 2, reason `assignment`) — **all 6 `belongs to` variants complete** |
| 7 | subjective synonym of / original spelling | ✅ done — `opinions/subjective-synonym-of/original-spelling.js` (concept edge, no assignment_opinions) |
| 8 | subjective synonym of / recombination | ✅ done — `opinions/subjective-synonym-of/recombination.js` (two `name_opinions` records per row per Q3's resolution: concept + lineage) |
| 9 | subjective synonym of / rank change | ✅ done — `opinions/subjective-synonym-of/rank-change.js` (same mappings as pair 8, lineage reason `reranked`) |
| 10 | subjective synonym of / correction | ✅ done — `opinions/subjective-synonym-of/correction.js` (same mappings as pair 8, lineage reason `correction`) |
| 11–48 | (see §2 table) | pending |

`lib/` shared transforms (`identity.js`, `attribution.js`, `evidence.js`) are scaffolded, ported from the
existing root-level scripts' pure functions unchanged, and used by pairs 1–10.

## 8. Next steps
- [ ] Get pair 11's confirmed subject/target field mapping(s) (`subjective synonym of` / `misspelling` —
      last of the standard four lineage tokens for this status; the remaining `reassignment` variant is pair 12),
      then implement it.
- [ ] Live-probe the 32 "unverified" pairs (Q3) as each is reached, rather than up front.
- [ ] Resolve Q4 (`nomen oblitum` folder granularity) when that status family is reached.
- [ ] `run.js` last, once all 48 handlers exist.
