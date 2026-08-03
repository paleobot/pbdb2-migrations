# Taxa/Opinions Migration Mapping (B4) — Working Draft

**Status:** DRAFT — awaiting offline feedback on the open questions in §4.
**Scope:** the legacy→new *opinion* migration (OpenSpec change **B4 = `migrate-taxa-opinions`**,
not yet started). This is the detailed, laid-out successor to the flat
`payloadSchemas/mappings/collections.txt`, needed because the opinion migration is a
*decomposition*, not a column-for-column copy.

Companion design doc: `docs/classic-taxa-opinions.md` (§9.8 the identity inversion, §10.5 the
"migrating data with no opinions" probe, §10.6 the D-register). This doc does **not** restate the
model; it records the migration mapping and the calls that must be made before B4 can be written.

Source of truth for all counts below: live MariaDB `pbdb_archive` (MariaDB 10.11), queried
2026-08-03. Target schema: `postgresql/create_new.sql` (taxa/opinions block ~L4578–4985).

---

## 1. Why this can't be a flat mapping

Legacy has **one** `opinions` table (998,565 rows) plus `authorities` (517,287 rows). The new model
has **two source tables** feeding **three** opinion tables, and the derived `taxa` ledger is *not*
migrated at all (it is recomputed by `derive_taxa()`):

```
 LEGACY                                  NEW
 authorities (517,287) ───────────┐      name_opinions       (root/lineage minting + concept edges)
                                  ├────▶ assignment_opinions (containment)
 opinions    (998,565) ───────────┘      validity_opinions   (nomen* / invalid subgroup)
                                         taxa  ← DERIVED by derive_taxa(), NOT migrated
```

Two facts make it a **decomposition matrix**, not a field map:

1. One legacy `opinions` row fans out to **0–2** target rows across **different** tables, decided by
   the crossing of two legacy enums, `status` × `spelling_reason`.
2. The **minting** `name_opinions` rows come mostly from `authorities`, not `opinions` (§3).

---

## 2. Identity resolution (SETTLED)

There are **two independent legacy→new lookups**. Conflating them was an early error; keeping them
separate is load-bearing.

| Purpose | Legacy key | Resolves to | Mechanism |
|---|---|---|---|
| **Taxon identity** — every `child_no`, `child_spelling_no`, `parent_no`, `parent_spelling_no`, and every `authorities.taxon_no` | `taxon_no` | **new minted taxon `permid`** (1:1) | B4 builds a `taxon_no → permid` map, minting one uuidv7 per legacy `taxon_no` |
| **Authority provenance** — only `name_opinions.authority_id` on the minting row | `taxon_no` | shared `authorities.id` (N:1) | `authorities.authority->'legacyIDs'->'oldpbdbIDs' ? 'N'`, head version (GIN index per `create_new.sql:4596`) |

**Why two.** The completed authorities migration merged legacy rows on
`[reference_id, citation, year, descriptors]` — *bibliographic naming-act* identity, **not** name
identity — collapsing 517,287 `taxon_no` into 161,768 `authorities` survivors (~139K by an approximate
SQL probe). It deliberately separated "who/where this was published" (authority) from "the name
itself" (taxon). So `authorities.permid` is an **authority** id, never a name-as-spelled id; taxon
permids are minted fresh in B4, **1:1 with `taxon_no`** (which is a unique PK — no collapse, ever).

Consequence: `subject_permid` / `target_permid` / `containing_permid` all resolve through the fresh
taxon-permid map; the `authorities` lookup only fills `authority_id` provenance on minting rows.

`taxon_no == orig_no` (both taxon-identity keys) cleanly decides root-vs-lineage minting (§3).

---

## 3. The minting model (§9.8 reframe)

Every name-as-spelled must get **exactly one** minting `name_opinions` row — the tripwire that makes
`derive_taxa()` total (§10.6 D11: `taxa.rank_id NOT NULL` fails loudly on a permid with no minting
row). Under the §9.8 reframe, **the minting row is sourced from the `authorities` record itself**
(name, rank, authorship provenance, `evidence = false`), so it is *never truly missing* — `authorities`
is the universe of names. "Synthesize" = "translate the authorities row into its minting opinion."

The **reason + target** of that minting row are *refined* by the *introducing opinion* (the legacy
`opinions` row about that spelling: `spelling_reason → reason`, `child_no → target`). That refinement
is what can be absent — see Q2.

```
 517,287 names-as-spelled
 ├─ 403,559  ORIGINAL (taxon_no == orig_no)  → mint 'root'  (reason='original', target=NULL)
 │            └─ 9,042 lack an 'original spelling' opinion → still fine (root from authority)
 └─ 113,728  DERIVED  (taxon_no != orig_no)  → mint 'lineage' (needs reason + target)
              ├─ 113,058  has introducing opinion → reason=map(spelling_reason), target=permid(child_no)
              └─    670   NO introducing opinion  → genuine orphan (Q2); all 670 have resolvable orig_no
```

---

## 4. Open questions (need a human call — awaiting offline feedback)

### Q1 — Lineage-edge target: direct-to-original vs. chained  *(OPEN, not yet data-probed)*

For a derived spelling with an introducing opinion, the lineage edge's `target_permid` can be either:

- **(a) direct to the original** — `target = permid(child_no)` (the opinion's own `child_no`). Simple;
  fully connects the lineage union-find; loses the order in which spellings were introduced.
- **(b) chained** — target the immediately-preceding spelling, preserving provenance of which spelling
  begat which; requires ordering the legacy spellings of a lineage.

`derive_taxa()`'s lineage union-find only needs *connectivity*, so (a) suffices for correctness.
**Current lean: (a).** Losing chain order is a deliberate, acceptable loss unless provenance of
spelling succession is independently wanted.

- **Not yet probed:** how often a lineage has ≥3 spellings (where (a) vs (b) actually differ), and
  whether any consumer needs spelling-succession order.
- **DECISION: _pending_**

### Q2 — Orphan derived spellings: the 670  *(OPEN — fully analyzed)*

**The problem.** A derived spelling (`taxon_no != orig_no`) needs `reason_id` + `target_permid` on its
minting `name_opinions` row, but both come only from an *introducing opinion*. **670** derived
spellings have no such opinion. We still know they are derived and we know their `orig_no` (all 670
resolve to a real `authorities` row), but we do **not** know *why* the spelling changed
(no `spelling_reason`).

This is the entire genuine minting-orphan surface: **670 rows, 0.13% of names.** It is much smaller
than the doc's "~13.6K" headline, which conflates it with unrelated cases (see the note below).

**Options:**

- **(a) Doc's current step-2 text** (`docs/classic-taxa-opinions.md:1362`, *"orig_no is IGNORED …
  fallback to 'original'"*): mint the 670 as **roots**. Simple; treats opinions as the sole truth. But
  it severs 670 known-derived spellings into false lineage origins, discarding the `orig_no` link
  Classic recorded → 670 spurious extra name-lineages.
- **(b) Use `orig_no` as the target** with a synthesized default reason (a generic bucket such as
  `'assignment'`, or a new dedicated `'reason unknown'` token in `namechange_reasons`). Preserves the
  lineage; cost is trusting Classic's *derived* `orig_no` for this 0.13% residue.

**Current lean: (b)** — all 670 resolve, and severing them is a worse correctness outcome than trusting
`orig_no` for a tiny residue. If (b): decide whether to reuse `'assignment'` or add a dedicated
`'reason unknown'` token (the latter keeps the synthesized rows auditable/queryable).

- **DECISION: _pending_**

**Sub-decision (within the clean 113,058).** When a derived spelling appears as `child_spelling_no` in
*several* opinions carrying *different* `spelling_reason`s, which one "introduces" it (earliest?
spelling-event reasons only? the canonical winner)? A refinement, not a blocker. Frequency not yet
probed.
- **DECISION: _pending_**

**Why the doc says 13.6K (and why it's a different problem).** §10.5's probe bundles several unrelated
"orphan" counts under one headline. Separated:

| §10.5 probe | What it actually is | Real home |
|---|---|---|
| 13,607 orig rows w/o original-spelling opinion | *original* spellings → mint as **root** anyway (authority suffices) | not a minting problem |
| 6,361 authorities rows no opinion references | subset of the above | not a minting problem |
| **670 derived w/o introducing opinion** | **the real minting orphan** | `name_opinions` (this question) |
| 17,062 clusters with no `belongs to` | **rootless in the *tree*** — no classification | `assignment_opinions`; `derive_taxa` already treats NULL containment as a tree root (separate, not a Q here) |

### Q3 — Merge-collapsed self-edges  *(RESOLVED — struck)*

Earlier worry: authorities dedup merged multiple `taxon_no` into one permid, so legacy edges might
collapse to self-edges the `name_opinion_not_self` CHECK forbids. **Not a real issue.** The merge was
at the **authority** (bibliographic) level, never the taxon level (§2). Taxon permids are 1:1 with
`taxon_no`, so no edge can self-collapse from merging. No action.

### Q4 — `status` vs `status_old`  *(OPEN, not yet data-probed)*

Legacy `opinions` keeps two status columns:

- **`status`** (10 values): `belongs to`, `subjective synonym of`, `objective synonym of`,
  `invalid subgroup of`, `misspelling of`, `replaced by`, `nomen dubium`, `nomen nudum`,
  `nomen oblitum`, `nomen vanum`.
- **`status_old`** (13 values, richer): adds `recombined as`, `homonym of`, `corrected as`,
  `rank changed as`, `revalidated`; lacks `invalid subgroup of`, `misspelling of`.

Question: is current `status` authoritative (with `spelling_reason` carrying spelling nuance), or does
`status_old` disambiguate cases `status` flattened (e.g. `homonym of`, `revalidated`)?

- **Not yet probed:** the `status × status_old` cross-distribution, and how many rows have a
  `status_old` value with no clean `status` equivalent (`homonym of`, `revalidated`).
- **Current lean:** use `status` as authoritative for routing; mine `status_old` only where it carries
  signal `status` dropped (candidate: `homonym of` → the `homonyms` table; `revalidated` → a
  `validity_opinions` "valid" assertion?). Needs the cross-distribution to confirm.
- **DECISION: _pending_**

---

## 5. Routing matrix (§1 preview — depends on Q1/Q2/Q4)

First-cut decomposition of a legacy `opinions` row into target rows. Cells marked ⚠ depend on an open
question above; treat this as provisional.

| legacy `status` | legacy `spelling_reason` | → name_opinions | → assignment_opinions | → validity_opinions |
|---|---|---|---|---|
| belongs to | original spelling | root (mint) | ✅ containment | — |
| belongs to | recombination / reassignment / correction / rank change | lineage (mint) ⚠Q1 | ✅ containment | — |
| subjective / objective synonym of | any | concept — `'junior synonym'`, `objective` bool | — | — |
| replaced by | any | concept — `'replaced by'` | — | — |
| misspelling of | (misspelling) | lineage — `'misspelling'` (never_accepted) | — | — |
| nomen dubium / nudum / vanum / oblitum | any | — | — | ✅ untargeted |
| invalid subgroup of | any | — | — | ✅ targeted → parent |

Minting rows for names **not** carried by any such opinion are sourced from `authorities` (§3), with
the 670 orphans decided by Q2.

---

## 6. Settled enum crosswalks

### 6.1 `spelling_reason` → `name_opinions.reason` (`namechange_reasons`)

| legacy `spelling_reason` | new `reason` | edge_class |
|---|---|---|
| original spelling | `original` | root |
| recombination | `recombination` | lineage |
| reassignment | `assignment` | lineage |
| correction | `correction` | lineage |
| rank change | `reranked` | lineage |
| misspelling | `misspelling` (never_accepted) | lineage |

The synonymy reasons (`junior synonym`, `replaced by`; both `concept`) come from `status`, not
`spelling_reason` (§5). `objective`/`subjective synonym of` both map to `junior synonym` with the
`objective` boolean (D7). Dropped legacy-invention token `code` has no source (D7).

### 6.2 `status` (nomen family) → `validity_opinions.status` (`nomenclatural_statuses`)

| legacy `status` | new `status` | targeted | legacy count |
|---|---|---|---|
| nomen dubium | `nomen dubium` | false | 8,208 |
| nomen nudum | `nomen nudum` | false | 2,533 |
| nomen vanum | `nomen vanum` | false | 569 |
| nomen oblitum | `nomen oblitum` | false | 76 |
| invalid subgroup of | `invalid subgroup of` | true (→ parent) | 1,420 |

Total nomen family: 12,806 rows that would be silently dropped without `validity_opinions` (§10.5).

### 6.3 `basis` → `evidence` (all three tables; §10.5 constraint 1)

| legacy `opinions.basis` | `evidence` |
|---|---|
| stated with evidence | true |
| stated without evidence / implied / second hand | false |
| NULL → resolve to the legacy *reference's* basis, then as above | true / false |
| authorities-sourced minting row (no legacy opinion) | false |

298,470 of 998,565 opinions (~30%) have `basis IS NULL` and are resolved **at migration time** (the
new `refs` table has no basis field to fall back to at read time). Freezes the fallback: a later
correction to a reference's basis will not retroactively change inheriting opinions (accepted).

---

## 7. Reference — probe counts (legacy `pbdb_archive`, 2026-08-03)

| Probe | Count |
|---|---|
| `opinions` rows | 998,565 |
| `authorities` rows = distinct `taxon_no` | 517,287 |
| approx distinct authority groups (SQL) / actual survivors | ~139,481 / 161,768 |
| original spellings (`taxon_no == orig_no`) | 403,559 |
| — of those, no 'original spelling' opinion | 9,042 |
| derived spellings (`taxon_no != orig_no`, `orig_no != 0`) | 113,728 |
| — with an introducing opinion | 113,058 |
| — **no introducing opinion (Q2 orphans; all orig_no resolvable)** | **670** |
| `orig_no = 0` | 0 |
| opinions with `basis IS NULL` | 298,470 |
| nomen-family opinions (validity) | 12,806 |

Design-doc §10.5 probes (kept for cross-reference): distinct `orig_no`→permids 403,640; orig rows w/o
original-spelling opinion 13,607; clusters with no opinions at all 10,245; rootless clusters (no
`belongs to`) 17,062; authorities rows no opinion references 6,361; clusters where rank varies across
spellings 11,704.

---

## 8. Next steps

- [ ] Offline feedback on **Q1**, **Q2** (+ its sub-decision), **Q4**.
- [ ] Probe Q1 (lineages with ≥3 spellings) and Q4 (`status × status_old` cross-distribution) to
      ground those calls.
- [ ] Fill the routing matrix (§5) and per-table column maps once Q1/Q2/Q4 are decided.
- [ ] Then start B4 (`/opsx:new migrate-taxa-opinions`).
