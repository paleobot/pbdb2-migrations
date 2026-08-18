# Taxa/Opinions Migration Mapping (B4) — Working Draft

**Status:** DRAFT — all open questions DECIDED (2026-08-06): Q1, Q2 (+ sub-decision), Q4. Per-table
column maps now filled (**§9**, 2026-08-07); two tiny residual calls flagged there (§9.7 i, iii).
Next is starting B4 (§8).
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

The **presence of a spelling-change opinion** — *not* the `taxon_no == orig_no` match — decides
root-vs-lineage minting (§3). `orig_no` is never consulted; trusting it (it was unstable and could be
improperly rewritten in Classic) is precisely the misdesign B4 sidesteps, per §9.8.1's "the migration
ignores `orig_no` entirely."

---

## 3. The minting model (§9.8 reframe, Option 1)

Every name-as-spelled must get **exactly one** minting `name_opinions` row — the tripwire that makes
`derive_taxa()` total (§10.6 D11: `taxa.rank_id NOT NULL` fails loudly on a permid with no minting
row). Under the §9.8 reframe, **the minting row is sourced from the `authorities` record itself**
(name, rank, authorship provenance, `evidence = false`), so it is *never truly missing* — `authorities`
is the universe of names. "Synthesize" = "translate the authorities row into its minting opinion."

The **reason + target** of that minting row are *refined* by the **introducing opinion** — the legacy
`opinions` row that renders this spelling as a *change* (`child_spelling_no = this taxon_no`,
`child_no ≠ this taxon_no`): `spelling_reason → reason`, `child_no → target`. **The presence of that
opinion — never `taxon_no == orig_no` — is the whole discriminator; `orig_no` is not consulted.** A
spelling with no such opinion mints as a `root` (`reason = 'original'`, `target = NULL`), whether it
is an original spelling or a derived orphan.

```
 517,287 names-as-spelled — each mints exactly ONE name_opinions row, sourced from authorities
                            (new_name, rank_id, authority provenance, evidence=false).
 │  reason + target REFINED by the introducing opinion (child_spelling_no = this, child_no ≠ this).
 │  orig_no is never consulted; taxon_no==orig_no below is descriptive, not the decision input.
 │
 ├─ 113,058  HAS a spelling-change opinion → mint 'lineage'
 │             reason  = map(spelling_reason)   [misspelling ⇒ never_accepted — see §3.1]
 │             target  = permid(child_no)       [Q1(a): direct to original]
 │
 └─ 404,229  NO spelling-change opinion → mint 'root'  (reason='original', target=NULL)
               ├─ 403,559 original spellings (taxon_no == orig_no) — root by nature
               └─    670  derived orphans (taxon_no ≠ orig_no, no opinion) — Q2(a): severed, root anyway
```

**Why the reason must come from the opinion, not a blanket `'original'` (Option 1 vs. a rejected
uniform rule).** A tempting simplification is "*every* `authorities` row mints `reason = 'original'`,
1:1, and lineage edges are separate opinions." It breaks on **misspellings**: a misspelling has its
own `authorities` row, so a blanket `'original'` minter would be `never_accepted = false` —
accepted-spelling-*eligible* — while its `misspelling` edge is `never_accepted = true`. `derive_taxa()`
step 3 (§9.8.4) could then rank the typo as a concept's accepted name. Sourcing the minting reason
from the introducing opinion means a misspelling mints **once**, as `misspelling`/`never_accepted`, and
is never eligible. The §3.1 *Amphymenium* example is exactly this collision on real data.

### 3.1 Two worked examples (live Classic `pbdb_archive`, 2026-08-06)

**(1) Recombination + orphan severance — the island fox.** `orig_no = 52684` groups three
names-as-spelled; the species was shuffled across three genera. None is a misspelling, so none is
`never_accepted`:

| taxon_no | orig_no | name | introducing opinion(s) | mints |
|---|---|---|---|---|
| 52684 | 52684 | *Vulpes littoralis* | 2 × `belongs to` / **original spelling** | `root` `'original'` |
| 52595 | 52684 | *Urocyon littoralis* | 6 × `belongs to` / **recombination** → *Urocyon* | `lineage` `recombination`, target → permid(52684) |
| **44859** | 52684 | ***Canis littoralis*** | **none — 0 opinions in any role** | `root` `'original'` — **severed** |

*Canis littoralis* is a derived spelling (`taxon_no ≠ orig_no`) with no opinion — a textbook Q2 orphan.
Because `orig_no` is not consulted, it mints as its own `root` and becomes an **independent
name-lineage**: an occurrence identified as "Canis littoralis" would `GROUP BY original_permid`
separately from *Urocyon/Vulpes littoralis* (§9.8.5). That severance is the accepted cost of Q2(a).
The other two resolve correctly — `derive_taxa()` still elects *Urocyon littoralis* the accepted
spelling from its `stated with evidence` recombination opinions.

**(2) Misspelling collision — *Amphymenium* vs *Amphimenium*.** The case the minting rule must get
right:

| taxon_no | orig_no | name | rank | ref (year) | introducing opinion |
|---|---|---|---|---|---|
| 15 | 15 | *Amphymenium* (valid) | genus | 75356 (Haeckel **1882**) | opinion 143159, `belongs to` / original spelling |
| 469718 | 15 | ***Amphimenium*** (typo) | genus | 75356 (Haeckel **1882**) | opinion 14, `belongs to` / **misspelling**, basis `second hand`, ref 6930 |

Under **Option 1**: *Amphimenium* mints **once**, `reason = 'misspelling'`, `never_accepted = true`,
target → permid(15). `derive_taxa()` step 3 excludes it → accepted spelling = *Amphymenium*. **Correct.**

Under the rejected blanket-`'original'` rule: *Amphimenium* mints a `root` `'original'`
(`never_accepted = false`) **plus** its `misspelling` edge. A per-row exclusion keeps the eligible
`'original'` row, so the typo is a live candidate — and here **both** rows cite reference 75356, so the
minters tie on `evidence` (both `false`) *and* on `COALESCE(pubyr, ref.pubyr)` (both **1882**),
leaving only `id DESC` to break the tie. The genus's accepted spelling would be decided by opinion-row
insertion order, and the typo can win. `never_accepted` is the one signal that should settle it, and
the blanket rule is exactly what strips it off. (Aside: opinion 14's `basis = 'second hand'` from the
special-cased ref 6930, §4.2, maps to `evidence = false` — §6.3.)

### 3.2 Identity columns are root-only (ledger model) *(DECIDED, 2026-08-17)*

**Decision.** In `name_opinions`, `new_name` and `rank_id` are populated **only** on `root` rows.
Every non-root row — `lineage` and `concept` alike — carries `new_name = NULL` and `rank_id = NULL`.
The `name_opinion_shape` CHECK is tightened to the single invariant:

```
new_name IS NOT NULL AND rank_id IS NOT NULL   ⇔   edge_class = 'root'
```

**Why.** `new_name`/`rank_id` are immutable attributes of a *permid*, not of an opinion (§9.8.1).
Under the **ledger model** — the opinions tables (`name_opinions`, `assignment_opinions`,
`validity_opinions`) are append-only records of *every* opinion ever entered, and all collapse
(canonical-winner, accepted-spelling, misspelling exclusion) happens only when `taxa` is derived — every
name-as-spelled gets its identity **once**, on the `root` row minted from its `authorities` row. A
`lineage` or `concept` edge is a pure relationship between two permids whose identities already live on
their own root rows; restating identity on the edge can only duplicate the subject's root row (redundant)
or contradict it (a bug — e.g. the belongs-to/misspelling mapping that copied the *target's* name onto
the edge). Concept edges already encode this (identity `NULL`, commit a64c85f); this decision recognizes
that lineage edges are the same kind of thing.

**Guarding invariant.** Every retained non-root edge's `subject_permid` resolves to a root row (its
authorities-minted identity). The skip-and-log framework already drops any edge whose subject is
unresolvable (`child_spelling_unresolved`), so every retained lineage/concept row satisfies this by
construction.

**Supersedes.** This reverses the Option-1 rule in §9.1 (which minted `lineage` rows *within the
authorities pass*, drawing identity from `authorities`) and the §9.8.2 language "that minting row carries
the permid's immutable identity" — which now holds for `root` only. Under the ledger decomposition the
authorities pass mints **roots only** (already implemented in `migrate-name-opinions.js`); `lineage`
edges are written by the per-slice opinion migrations and carry no identity. §9.1's root-vs-lineage
split (shape decided by the top-ranked introducing opinion) does not apply to the ledger migration.

---

## 4. Open questions (need a human call — awaiting offline feedback)

### Q1 — Lineage-edge target: direct-to-original vs. chained  *(DECIDED — (a), 2026-08-06)*

For a derived spelling with an introducing opinion, the lineage edge's `target_permid` can be either:

- **(a) direct to the original** — `target = permid(child_no)` (the opinion's own `child_no`). Simple;
  fully connects the lineage union-find; loses the order in which spellings were introduced.
- **(b) chained** — target the immediately-preceding spelling, preserving provenance of which spelling
  begat which; requires ordering the legacy spellings of a lineage.

`derive_taxa()`'s lineage union-find only needs *connectivity*, so (a) suffices for correctness.
**DECISION: (a).** It also falls out of the Option-1 minting rule for free: the introducing opinion's
`child_no` *is* the original combination (Classic files every opinion under it), so a direct-to-original
target needs no spelling-succession ordering. Losing chain order is a deliberate, acceptable loss;
resurrect (b) only if provenance of spelling succession is independently wanted (no consumer needs it
today, so the ≥3-spelling frequency probe is moot).

### Q2 — Orphan derived spellings: the 670  *(DECIDED — (a), 2026-08-06)*

**The problem.** A derived spelling (`taxon_no != orig_no`) needs `reason_id` + `target_permid` on its
minting `name_opinions` row, but both come only from an *introducing opinion*. **670** derived
spellings have no such opinion. We still know they are derived and we know their `orig_no` (all 670
resolve to a real `authorities` row), but we do **not** know *why* the spelling changed
(no `spelling_reason`).

This is the entire genuine minting-orphan surface: **670 rows, 0.13% of names.** It is much smaller
than the doc's "~13.6K" headline, which conflates it with unrelated cases (see the note below).

**Opinion-graph visibility of the 670 (probed 2026-08-06).** "No introducing opinion" means no opinion
files this spelling as `child_spelling_no`. Split the 670 by whether they appear *anywhere else* in the
opinion graph (the other three roles):

- **529 (79%) — opinion-invisible:** referenced in *none* of `child_no` / `parent_no` /
  `child_spelling_no` / `parent_spelling_no`. Under Option 1 they mint as pure `root`/`'original'` rows
  and appear in no edge at all.
- **141 (21%) — pointed-at but never introduced:** referenced in ≥1 of the other three roles. Partitioned:

  | referencing role(s) | rows |
  |---|---|
  | `parent_spelling_no` only | 122 |
  | `child_no` only | 5 |
  | `child_no + parent_no` | 6 |
  | `child_no + parent_no + parent_spelling_no` | 5 |
  | `parent_no + parent_spelling_no` | 2 |
  | `child_no + parent_spelling_no` | 1 |
  | **total** | **141** |

  Dominated by `parent_spelling_no` (130 of 141): some opinion uses the spelling as a *parent's* spelling
  in a classification/synonymy edge without any opinion introducing it as a child. This is **not** a new
  problem — the 141 still mint as roots exactly like the 529, and because their permids exist, the edges
  that point at them (mostly as `containing_permid` targets) resolve cleanly. The truly opinion-invisible
  residue is the **529**. Full row list with an `in_529` flag: `taxa-orphans-670.csv`.

**Options:**

- **(a)** mint the 670 as **roots** (`reason = 'original'`, no target). Simple; treats opinions as the
  sole truth. Severs 670 known-derived spellings into independent name-lineages, discarding the
  `orig_no` link Classic recorded → 670 spurious extra name-lineages.
- **(b) Use `orig_no` as the target** with a synthesized default reason (a generic bucket such as
  `'assignment'`, or a new dedicated `'reason unknown'` token in `namechange_reasons`). Preserves the
  lineage; cost is trusting Classic's *derived* `orig_no` for this 0.13% residue.

**DECISION: (a).** This is not a standalone weigh-off any more — it is *entailed* by the Option-1
minting rule (§3) and the "ignore `orig_no` entirely" principle (§9.8.1). The minting reason/target
come only from an introducing opinion; the 670 have none, so they fall through to the `'original'`
default and mint as roots. Reaching for `orig_no` here (option b) would re-introduce exactly the
unstable, improperly-rewritten pointer B4 exists to avoid — for 0.13% of names, and only for the ones
Classic itself failed to document. The severance is real (see §3.1 example 1, *Canis littoralis*) and
accepted. The earlier lean to (b) is **reversed.**

**Sub-decision — the canonical winner *(DECIDED, 2026-08-06)*.** When a derived spelling appears as
`child_spelling_no` in *several* introducing (spelling-*change*) opinions carrying *different*
`spelling_reason`s, which one sets the minting row's `reason` + `target`?

*Frequency (probed 2026-08-06).* Of **112,634** derived spellings with a genuine introducing opinion
(`child_spelling_no = taxon_no`, `child_no ≠ child_spelling_no`):

| | spellings | share |
|---|---|---|
| reason **unanimous** (1 distinct `spelling_reason`) | 112,010 | 99.45% |
| reason **conflict** (2 distinct) | **624** | **0.55%** |
| 3+ distinct reasons | 0 | — |
| **target** (`child_no`) conflict | **1** | 0.0009% |

The target is effectively never ambiguous (Q1(a) unaffected), so only the *reason* is ever chosen. Of
the 624 conflicts, **586 are "misspelling vs. a legitimate change"** (correction+misspelling 460,
recombination+misspelling 109, rank change+misspelling 14, +3 tiny) — the only conflicts with stakes,
since `misspelling` is `never_accepted` while `correction`/`recombination`/`rank change` are
accepted-spelling-eligible. The other 38 are conflicts among legitimate reasons (cosmetic — they change
the token, not eligibility).

**DECISION: canonical winner.** The introducing opinion is the top-ranked one by `derive_taxa()`'s own
ordering — `evidence DESC, COALESCE(pubyr, ref.pubyr) DESC, id DESC` — and its `spelling_reason` +
`child_no` set the minting row. No new machinery (it reuses the ranking `derive_taxa()` applies
everywhere), deterministic and total (strict order → exactly one winner), and correct on the stakes:
for the 586 misspelling-vs-legitimate cases, whichever opinion is best-evidence/most-recent decides
whether the spelling is minted `never_accepted` or accepted-eligible — the literature adjudicates,
exactly as it does for classification. A migration-side rule only; settles all 624 without a bespoke
branch.

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

### Q4 — `status` vs `status_old`  *(DECIDED — ignore `status_old`, 2026-08-06)*

Legacy `opinions` keeps two status columns:

- **`status`** (10 values): `belongs to`, `subjective synonym of`, `objective synonym of`,
  `invalid subgroup of`, `misspelling of`, `replaced by`, `nomen dubium`, `nomen nudum`,
  `nomen oblitum`, `nomen vanum`.
- **`status_old`** (13 values): adds `recombined as`, `homonym of`, `corrected as`,
  `rank changed as`, `revalidated`; lacks `invalid subgroup of`, `misspelling of`.

**DECISION: `status_old` is an abandoned column and is completely ignored.** `status` is the sole
routing authority, with `spelling_reason` carrying the spelling nuance (§6.1). `status` is fully
populated — **0 of 998,565 rows are NULL or blank** (probed 2026-08-06), so routing never needs a
fallback.

Consequences, recorded with eyes open:

- Four of the five `status_old`-only values are **already recovered** through `status` + `spelling_reason`:
  `recombined as` = `belongs to` + `recombination`, `corrected as` = `correction`,
  `rank changed as` = `rank change`. No loss.
- `homonym of` is **not** lost by ignoring `status_old` — homonymy migrates from the legacy `homonyms`
  table (a data-level lookup), not from an opinion's `status_old` (§10.4, D10).
- `revalidated` is the **one genuine drop.** It would have become a `validity_opinions` "valid"
  assertion; from an abandoned column, it is deliberately not migrated. Accepted loss (quantify from
  `status_old` only if a consumer ever needs revalidation history).

---

## 5. Routing matrix (§1 preview — Q1/Q2/Q4 all decided)

First-cut decomposition of a legacy `opinions` row into target rows. Q1, Q2, and Q4 are all DECIDED
(§4); the only refinement still open is the Q2 sub-decision (which opinion "introduces" a spelling when
several disagree), which does not change this matrix.

| legacy `status` | legacy `spelling_reason` | → name_opinions | → assignment_opinions | → validity_opinions |
|---|---|---|---|---|
| belongs to | original spelling | root (mint) | ✅ containment | — |
| belongs to | recombination / reassignment / correction / rank change | lineage (mint), target → permid(child_no) [Q1(a)] | ✅ containment | — |
| subjective / objective synonym of | any | concept — `'junior synonym'`, `objective` bool | — | — |
| replaced by | any | concept — `'replaced by'` | — | — |
| misspelling of | (misspelling) | lineage — `'misspelling'` (never_accepted) | — | — |
| nomen dubium / nudum / vanum / oblitum | any | — | — | ✅ untargeted |
| invalid subgroup of | any | — | — | ✅ targeted → parent |

Minting rows for names **not** carried by a spelling-change opinion are sourced from `authorities`
(§3) and mint as `root` (`reason = 'original'`) — the 403,559 original spellings and the 670 orphans
alike (Q2(a)).

### 5.1 Lineage-edge discriminator is `child_spelling_no ≠ child_no`, not `spelling_reason` *(2026-08-17)*

Under the **ledger model** each opinion slice writes rows for the opinions it owns, and slices key off
`spelling_reason` (the misspelling slice does `WHERE spelling_reason = 'misspelling'`; the future
recombination slice will do `= 'recombination'`; etc.). That is unsafe as the test for "does this
`belongs to` opinion introduce a lineage edge?" — because the legacy `spelling_reason` label is
**wrong on ~50 rows**. The reliable discriminator is the one §3 already names: an opinion mints/asserts a
lineage edge **iff `child_spelling_no ≠ child_no`**, regardless of the label. `spelling_reason` supplies
the reason *token* only when it is trustworthy.

**The anomaly.** `SELECT count(*) FROM opinions WHERE status='belongs to' AND spelling_reason='original
spelling' AND child_spelling_no <> child_no` = **50** (live `pbdb_archive`, 2026-08-17). These are
`belongs to`/`original spelling` opinions whose spelling genuinely differs from `child_no`. As currently
routed (original spelling → `assignment_opinions` only, no `name_opinions` edge), each gets a containment
row but **no lineage edge** — silently severing `child_spelling` from `child_no`. The assignment slice
has already run and taken these as `assignment_opinions`, so the missing lineage edges are a **backfill**
owed by whichever slice ends up owning them (most naturally the recombination slice).

**Their reason is inferred from the name relationship, not the label** (49 rows resolve to an
`authorities` row; the 50th has a dangling `child_spelling_no` and is itself a skip case):

| inferred reason | rows | rule | example |
|---|---|---|---|
| `reranked` | 16 | `taxon_rank` differs | *Cetacea* order → superorder (36652→147596) |
| `recombination` | 10 | genus (first word) differs | *Atrypa transversa* → *Pterotheca transversa* (72526→75879) |
| `correction` | 1 | same genus/rank, spelling differs | *Perrisonota* → *Perissonota* (61690→61684) |
| `duplicate-or-homonym` | 22 | name **and** rank identical, different `taxon_no` | *Sirenia*/*Sirenia* — no spelling change; a lineage edge would merge duplicate records (or is a homonym/merge decision, possibly no edge) |

The full worklist — `opinion_no`, both names/ranks, parent, and `inferred_reason` per row — is in
`mistagged-original-spelling.csv`. Only the 10 `recombination` rows answer to `recombination`; the label
must never be trusted to set the reason here.

> Not to be confused with the *reversion* case (a `belongs to`/`original spelling` opinion where
> `child_spelling_no = child_no`, re-preferring the original combination after a recombination). That one
> has no second endpoint and is **not** a lineage edge — see §9.8.4.1's "accepted divergence."

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
| —— of the 670, opinion-invisible (no ref in any of 4 roles) | 529 |
| —— of the 670, pointed-at only (≥1 of child_no/parent_no/parent_spelling_no; 130 via parent_spelling_no) | 141 |
| `orig_no = 0` | 0 |
| opinions with `basis IS NULL` | 298,470 |
| nomen-family opinions (validity) | 12,806 |

Design-doc §10.5 probes (kept for cross-reference): distinct `orig_no`→permids 403,640; orig rows w/o
original-spelling opinion 13,607; clusters with no opinions at all 10,245; rootless clusters (no
`belongs to`) 17,062; authorities rows no opinion references 6,361; clusters where rank varies across
spellings 11,704.

---

## 8. Next steps

- [x] **Q1** DECIDED — (a) direct-to-original (2026-08-06). Probe moot (no consumer needs chain order).
- [x] **Q2** DECIDED — (a) orphans mint as roots (2026-08-06); entailed by Option-1 minting.
- [x] **Q4** DECIDED — ignore `status_old` as abandoned; `status` is sole authority, fully populated
      (2026-08-06). Only genuine loss: `revalidated`.
- [x] **Q2 sub-decision** DECIDED — canonical winner (top-ranked introducing opinion by
      `evidence DESC, COALESCE(pubyr, ref.pubyr) DESC, id DESC`); conflict rate 0.55% (2026-08-06).
- [x] Fill the per-table column maps — **§9** (drafted 2026-08-07; legacy columns + all counts
      re-probed live against `pbdb_archive`). Residual soft calls made inline (§9.7); two flagged
      for confirmation.
- [ ] Then start B4 (`/opsx:new migrate-taxa-opinions`).

---

## 9. Per-table column maps

Legacy source columns re-pulled live (`information_schema` on `pbdb_archive`, 2026-08-07); every count
below re-probed the same day. Target columns from `postgresql/create_new.sql` (name_opinions L4666,
assignment_opinions L4729, validity_opinions L4757). This section is the mechanical successor the
routing matrix (§5) and crosswalks (§6) were building toward; it does not re-open any §4 decision.

### 9.0 Migration algorithm & shared column derivations

**Four passes over two legacy tables.** The taxon-permid map is built first; then one pass per target
shape. Note the asymmetry (§1): `name_opinions` **minting** rows are driven by `authorities` (one per
row), while every other emitted opinion row is driven by an `opinions` row.

```
 0. mint map:   taxon_no → uuidv7 permid, 1:1 over all 517,287 authorities rows (§2). Never collapses.
 1. name mint:  iterate authorities  → 517,287 name_opinions rows (root or lineage; §9.1)
 2. name concept: iterate opinions status ∈ {subj/obj synonym of, replaced by} → ~57,262 rows (§9.2)
 3. assignment: iterate opinions status = 'belongs to'                          → ~927,178 rows (§9.3)
 4. validity:   iterate opinions status ∈ {nomen *, invalid subgroup of}        →   12,806 rows (§9.4)
```

`opinions` status `'misspelling of'` (875) and every spelling-change `'belongs to'` are **not** emitted
row-for-row into `name_opinions`; they are *read* by pass 1 as candidate **introducing opinions** that
refine the one minting row of their `child_spelling_no` (§3). Their containment (`belongs to` only) is
emitted separately by pass 3. This is why `spelling_reason`, not `status`, drives the minting reason.

**Shared derivations** (identical mechanism in every pass unless a pass overrides):

| target column | source | mechanism |
|---|---|---|
| `id` | — | `GENERATED` identity |
| `permid` | — | fresh **uuidv7 minted per emitted row** — the opinion's identity across future transcription corrections (§ schema L4668). One legacy version ⇒ one permid, no succession. |
| `authorizer_person_id` | `authorizer_no` | **direct** — `persons.id == legacy person_no` by construction (`migrate-authorities.js:143`). 0-fallback → `person_no=1` when both auth/ent are 0. |
| `enterer_person_id` | `enterer_no` | direct, same as above. |
| `reference_id` | `reference_no` | **direct** — `refs.id == legacy reference_no` by construction (`migrate-refs.js:300`). |
| `evidence` | `basis` | §6.3 crosswalk. `NULL` (298,470 opinions) resolved **at migration time** to the reference's basis, then mapped; **root** minting rows (no opinion) → `false`. |
| `pubyr` + `attribution` | `ref_has_opinion` / author fields | **second-hand rule** (below). |
| `created_at` | `created` | preserve the legacy authoring timestamp (do not default `NOW()`). |
| `removed` | — | `NULL` (nothing migrates pre-removed). |
| `preceded_by_id` / `succeeded_by_id` | — | `NULL` — every migrated row is a head version. |

**Second-hand rule (`pubyr` + `attribution`).** When the row's authorship is the reference's own, both
stay `NULL` (read through the ref at query time); when the row carries a *distinct* attributed author/
year, populate them:

| pass | "reference carries it" flag | value = flag truthy | value = flag NULL/false |
|---|---|---|---|
| opinions (2,3,4) & lineage minting (1) | `opinions.ref_has_opinion` (`'YES'` 869,586 / `NULL` 128,979) | `pubyr=NULL, attribution=NULL` | `pubyr = opinions.pubyr`, `attribution` = authors from `author1init/last`, `author2init/last`, `otherauthors` per `payloadSchemas/opinionAttribution.schema.js` |
| root minting (1) | `authorities.ref_is_authority` (`'YES'` 258,972 / `''` 258,315; `refauth` mirrors it) | `pubyr=NULL, attribution=NULL` | from `authorities.pubyr` + `authorities.author*` fields |

All `*_permid` columns resolve their legacy `*_no` through the pass-0 map. `pages` / `figures` are plain
text carries from whichever source row the pass names.

### 9.1 `name_opinions` — minting pass (iterate `authorities`, 517,287 rows)

One row per `authorities.taxon_no`. **Shape** is decided by the **top-ranked introducing opinion** —
`opinions WHERE child_spelling_no = taxon_no AND child_no <> taxon_no`, ranked by derive_taxa()'s own
`evidence DESC, COALESCE(pubyr, ref.pubyr) DESC, id DESC` (the Q2 sub-decision canonical winner). None
⇒ **root**; one ⇒ **lineage**. `orig_no` is never read (§2, §9.8.1).

| target column | ROOT (404,229: 403,559 originals + 670 orphans) | LINEAGE (113,058, refined by winning intro opinion `w`) |
|---|---|---|
| `subject_permid` | `permid(taxon_no)` | `permid(taxon_no)` (= `w.child_spelling_no`) |
| `target_permid` | `NULL` | `permid(w.child_no)` — direct-to-original, Q1(a) |
| `reason_id` | `'original'` | `map(w.spelling_reason)` via §6.1 (`recombination`/`assignment`/`correction`/`reranked`/`misspelling`) |
| `edge_class` | `'root'` | `'lineage'` (pinned; FK-composite with `reason_id`) |
| `objective` | `NULL` | `NULL` (only concept junior-synonym rows carry it) |
| `new_name` | `authorities.taxon_name` | `authorities.taxon_name` |
| `rank_id` | `map(authorities.taxon_rank)` — §9.7(iii) | same |
| `authority_id` | GIN lookup `authority->'legacyIDs'->'oldpbdbIDs' ? taxon_no`, head (create_new.sql:4596) | same — **§9.7(i) flagged** |
| `pages` / `figures` | `authorities.pages` / `.figures` | **`w.pages` / `w.figures`** (the naming-act opinion) |
| `reference_id` | `authorities.reference_no` | **`w.reference_no`** |
| `pubyr` / `attribution` | second-hand via `authorities.ref_is_authority` | second-hand via `w.ref_has_opinion` |
| `evidence` | **`false`** (§6.3, no opinion) | **`map(w.basis)`** (§6.3) — §9.7(ii) |

The lineage row draws its **provenance** (`reference`, `pubyr`/`attribution`, `evidence`, `pages`,
`figures`) from the winning introducing opinion `w`, but its **identity** (`new_name`, `rank_id`,
`authority_id`) from `authorities`. See §9.7(ii) for why `evidence` must be `map(w.basis)` and not the
`false` that a literal reading of §3 would give.

### 9.2 `name_opinions` — concept pass (iterate `opinions` synonymy, ~57,262 rows)

Source: `status ∈ {'subjective synonym of' 52,106, 'objective synonym of' 1,246, 'replaced by' 4,020}`
= 57,372, **minus 110 self-edges** skipped (§9.5). Non-minting: identity columns stay `NULL`.

| target column | source |
|---|---|
| `subject_permid` | `permid(child_spelling_no)` |
| `target_permid` | `permid(parent_spelling_no)` — always present for these statuses (0 rows with `parent_spelling_no=0`) |
| `reason_id` | `'junior synonym'` for subjective/objective synonym; `'replaced by'` for replaced by (§6.1) |
| `edge_class` | `'concept'` |
| `objective` | `true` for `objective synonym of`; `false` for `subjective synonym of`; **`NULL`** for `replaced by` (D7; sole carrier of the split) |
| `new_name`, `rank_id`, `authority_id`, `pages`, `figures` | `NULL` (non-minting concept edge) |
| `reference_id`, `pubyr`/`attribution`, `evidence` | from the `opinions` row (shared §9.0) |

### 9.3 `assignment_opinions` (iterate `opinions` `belongs to`, ~927,178 rows)

Source: `status = 'belongs to'` = 927,512, **minus 332** with `parent_spelling_no = 0` (no containing
taxon → rootless in the tree; derive_taxa treats absent containment as a tree root — emit **no** row)
and **minus 2** self-edges (§9.5). No other status asserts containment (routing §5).

| target column | source |
|---|---|
| `subject_permid` | `permid(child_spelling_no)` |
| `containing_permid` | `permid(parent_spelling_no)` (NOT NULL; the 332 zero-parent rows are the ones dropped) |
| `questioned` | **`false`** — no legacy source column for incertae sedis on `opinions` (§9.7 note; not flagged, default is correct for the mass) |
| `reference_id`, `pubyr`/`attribution`, `evidence` | shared §9.0 |

### 9.4 `validity_opinions` (iterate `opinions` nomen family, 12,806 rows)

Source: the five statuses of §6.2. `status_id` + `targeted` FK-composite pinned (create_new.sql:4780).

| target column | untargeted (nomen dubium 8,208 / nudum 2,533 / vanum 569 / oblitum 76) | targeted (`invalid subgroup of` 1,420) |
|---|---|---|
| `subject_permid` | `permid(child_spelling_no)` | `permid(child_spelling_no)` |
| `status_id` | `map(status)` via §6.2 | `'invalid subgroup of'` |
| `targeted` | `false` | `true` |
| `target_permid` | `NULL` (CHECK: `targeted = (target IS NOT NULL)`) | `permid(parent_spelling_no)` — all 1,420 have `parent_spelling_no ≠ 0` |
| `reference_id`, `pubyr`/`attribution`, `evidence` | shared §9.0 |

### 9.5 Skip / repair register (edge cases, all counts live 2026-08-07)

Small integrity residues found by probing legacy pointers. Each is **logged and skipped**, never
silently dropped:

| case | count | pass | disposition |
|---|---|---|---|
| `child_spelling_no ∉ authorities` (subject unresolvable) | **2** | 2–4 | skip the row (no permid to be subject) |
| `parent_spelling_no ∉ authorities` (target/containing unresolvable) | **8** | 2–4 | skip the edge (untargeted validity is unaffected) |
| `child_no ∉ authorities` (lineage target unresolvable) | **1** | 1 | disqualify as introducing opinion → spelling falls to next-ranked, else root |
| concept self-edge `child_spelling_no = parent_spelling_no` | **110** | 2 | skip (would violate `name_opinion_not_self`; self-synonymy is meaningless) |
| assignment self-edge `child_spelling_no = parent_spelling_no` | **2** | 3 | skip (would violate `assignment_not_self`) |
| `belongs to` with `parent_spelling_no = 0` (rootless) | 332 | 3 | emit no assignment row (already in §9.3 count) |

`child_spelling_no = 0`: **0 rows** — every opinion has a resolvable subject candidate.

### 9.7 Residual column calls (made inline; two flagged for confirmation)

**(i) `authority_id` on lineage minting rows — FLAG.** The schema comment (L4687) scopes `authority_id`
to "the 'original' minting row." A lineage spelling nonetheless *has* an `authorities` row (every
`taxon_no` does), so `resolve(taxon_no)` is available. **Call: set it on both root and lineage minting
rows** (uniform identity provenance; `authority_id` = the deduped authority record, an orthogonal facet
from `reference_id` = where this act was published). No `derive_taxa()` consequence either way. Reverse
to root-only if the schema comment is meant as a hard rule.

**(ii) Lineage minting `evidence` = `map(w.basis)`, not `false` — resolved, recorded.** §3 says the
minting row is "sourced from authorities … evidence = false"; taken literally that would set every
lineage minting row `evidence = false`. That is wrong and would break ranking: the accepted-spelling
contest (derive_taxa step 3) and the Q2 canonical-winner selection **both** rank by `evidence DESC` —
we pick `w` *by* its evidence, so stamping `false` afterward is incoherent (and would re-break the §3.1
*Amphymenium* tie the whole minting rule exists to settle). §3's `evidence = false` clause and §6.3's
last row (`authorities-sourced minting row (no legacy opinion) → false`) both apply to **root** rows
only. Lineage rows carry `map(w.basis)`. Not a flag — the design already entails it.

**(iii) `taxon_rank` mapping — FLAG (tiny).** All legacy rank tokens map 1:1 to
`dictionaries.taxonomy_ranks` **except `'informal'` (18 rows)**, which has no dictionary entry. **Call:
map `'informal'` → `'unranked'`.** No `''`/NULL ranks exist in the data (rank is effectively total), so
`rank_id NOT NULL` (§10.6 D11) is always satisfiable. Confirm the `'informal'` → `'unranked'` collapse
is acceptable (alternative: add an `'informal'` rank token).

**(iv) NULL-`basis` resolution mechanism — to nail in B4 code.** §6.3 fixes the *rule* (NULL → the
reference's basis, frozen at migration time) but not the *computation*. The new `refs` table has no
basis field, so "the reference's basis" must be derived from the legacy side during the migration run —
candidate: the modal non-NULL `basis` among all `opinions`/`authorities` sharing that `reference_no`,
falling back to `false` when the reference has no basis anywhere. 298,470 opinions (~30%) depend on it.
Not a design reopen; an implementation detail B4 must specify and log.
