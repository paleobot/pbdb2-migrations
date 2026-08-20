# Taxa/Opinions Migration Mapping (B4) — Working Draft

**Status:** DRAFT — all open questions DECIDED (2026-08-06): Q1, Q2 (+ sub-decision), Q4. Per-table
column maps filled (**§9**, 2026-08-07). Ledger model + root-only identity DECIDED (§3.2,
2026-08-17). **Nomen-family / validity routing revised (§5.2, 2026-08-18):** `invalid subgroup of`
and targeted `nomen oblitum` move to `name_opinions` as concept-class folds; `nomen dubium`,
`nomen vanum`, `nomen nudum`, and untargeted `nomen oblitum` stay in `validity_opinions`, with
`nomen nudum` alone able to bar its own subject's accepted-spelling candidacy. **Rootless `belongs
to` is migrated, not dropped (§9.6, 2026-08-19):** `assignment_opinions.containing_permid` is now
nullable; the 332 `parent_spelling_no = 0` rows are inserted with `containing_permid = NULL`
instead of being skipped — supersedes the exclusion in §9.3 and the disposition in §9.5. **Concept-axis
synonymy reversals FLAGGED for B4 (§10, 2026-08-20):** ~6,170 taxa currently resolve as valid/independent
in Classic despite an unretracted concept-class opinion in their history; migration will not
auto-synthesize a negation for them — see §10 for the live counts and the deferred worklist. Next is
starting B4 (§8).
**Scope:** the legacy→new *opinion* migration (OpenSpec change **B4 = `migrate-taxa-opinions`**,
not yet started). This is the detailed, laid-out successor to the flat
`payloadSchemas/mappings/collections.txt`, needed because the opinion migration is a
*decomposition*, not a column-for-column copy.

Companion design doc: `docs/classic-taxa-opinions.md` (§9.8 the identity inversion, §9.8.4.1–.2 the
derive() deltas including the §5.2 decisions below, §10.5 the "migrating data with no opinions"
probe, §10.6 the D-register). This doc does **not** restate the model; it records the migration
mapping and the calls that must be made before B4 can be written.

Source of truth for all counts below: live MariaDB `pbdb_archive` (MariaDB 10.11), queried
2026-08-03, except where marked **(2026-08-18)** — those were re-probed live against the
Postgres-ported mirror (`pg-classic-pool.js`, `PG_CLASSIC_*`) during this round of decisions.
Target schema: `postgresql/create_new.sql` (taxa/opinions block ~L4701–5018; exact offsets have
shifted since 2026-08-07 as the dictionaries grew).

> **MIGRATION vs. DERIVATION — read this before any other section.** Migration writes every
> qualifying legacy opinion as its own ledger row, unconditionally. It NEVER compares `evidence` /
> `pubyr` / `id` across candidate opinions to pick a "winner," and it never needs to know which
> opinion currently governs a permid's accepted spelling, classification, or validity. That
> ranking — `evidence DESC, COALESCE(pubyr, ref.pubyr) DESC, id DESC` — belongs exclusively to
> `derive_taxa()` (`docs/classic-taxa-opinions.md` §9.8.4), which runs later, standalone, against
> the complete ledger to materialize `taxa`. **If you are designing migration logic and find
> yourself ranking or selecting among multiple candidate opinions, stop — that logic belongs in
> `derive_taxa()`, not here.** This document is a decision log: later dated sections can supersede
> earlier ones (see "Supersedes" notes), but superseded sections are not rewritten, only annotated
> in place — always prefer the most recently dated decision on a given topic. Two sections below
> predate the §3.2 ledger-model decision and describe migration-time ranking that is no longer
> correct; each is marked accordingly where it appears (§4 Q2 sub-decision, §9.1).

---

## 1. Why this can't be a flat mapping

Legacy has **one** `opinions` table (998,565 rows) plus `authorities` (517,287 rows). The new model
has **two source tables** feeding **three** opinion tables, and the derived `taxa` ledger is *not*
migrated at all (it is recomputed by `derive_taxa()`):

```
 LEGACY                                  NEW
 authorities (517,287) ───────────┐      name_opinions       (root/lineage minting + concept edges,
                                  ├────▶                      incl. invalid subgroup of / nomen oblitum)
 opinions    (998,565) ───────────┘      assignment_opinions (containment)
                                         validity_opinions   (residual nomen dubium/nudum/vanum/oblitum)
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

**Sub-decision — the canonical winner *(DECIDED, 2026-08-06 — ⚠ SUPERSEDED, 2026-08-17, §3.2)*.**
This sub-decision predates the ledger model and describes a **migration-time** ranking. Under §3.2
there is no single "minting row" for a derived spelling to be won — every qualifying opinion
(any row with `child_spelling_no ≠ child_no`) is migrated as its own `lineage` ledger row,
unconditionally, with no ranking or comparison across candidates. The `evidence`/`pubyr`/`id`
ranking described below is real and still used — but only by `derive_taxa()`, later, reading the
full ledger this migration produced, never by migration code itself. Kept here for history; do
not implement this as written.
<br><br>
Original text, for reference only: when a derived spelling appears as
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

**DECISION (⚠ SUPERSEDED, 2026-08-17, §3.2 — see the note above; NOT a migration-side rule despite
the closing line below, kept verbatim for history): canonical winner.** The introducing opinion is
the top-ranked one by `derive_taxa()`'s own
ordering — `evidence DESC, COALESCE(pubyr, ref.pubyr) DESC, id DESC` — and its `spelling_reason` +
`child_no` set the minting row. No new machinery (it reuses the ranking `derive_taxa()` applies
everywhere), deterministic and total (strict order → exactly one winner), and correct on the stakes:
for the 586 misspelling-vs-legitimate cases, whichever opinion is best-evidence/most-recent decides
whether the spelling is minted `never_accepted` or accepted-eligible — the literature adjudicates,
exactly as it does for classification. ~~A migration-side rule only; settles all 624 without a bespoke
branch.~~ **This last sentence is the error this note exists to flag: under the ledger model (§3.2)
this ranking runs only inside `derive_taxa()`, never in migration. Migration writes all 624
conflicting rows as separate ledger rows and lets `derive_taxa()` resolve them at read time.**

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

| legacy `status` | legacy `spelling_reason` / target | → name_opinions | → assignment_opinions | → validity_opinions |
|---|---|---|---|---|
| belongs to | original spelling | root (mint) | ✅ containment | — |
| belongs to | recombination / reassignment / correction / rank change | lineage (mint), target → permid(child_no) [Q1(a)] | ✅ containment | — |
| subjective / objective synonym of | any | concept — `'junior synonym'`, `objective` bool | — | — |
| replaced by | any | concept — `'replaced by'` | — | — |
| misspelling of | (misspelling) | lineage — `'misspelling'` (never_accepted) | — | — |
| **invalid subgroup of** | any (always has `parent_no`) | **concept — `'invalid subgroup'`** [§5.2] | — | — |
| **nomen oblitum** | **`parent_no ≠ 0`** (59/76 legacy) | **concept — `'nomen oblitum'`** [§5.2] | — | — |
| nomen oblitum | `parent_no = 0` (17/76 legacy) | — | — | ✅ testimony only, no target [§5.2] |
| nomen dubium / nomen vanum | any (target dropped regardless) | — | — | ✅ testimony only, no target [§5.2] |
| nomen nudum | any (target dropped regardless) | — | — | ✅ candidacy bar [§5.2] |

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

### 5.2 The nomen family, re-routed per token *(DECIDED, 2026-08-18)*

**The trigger.** `derive()`'s accepted-spelling contest (§9.8.4 step 3) excludes a candidate for exactly
one reason — `never_accepted` on a lineage edge (misspellings). It never consulted `validity_opinions` at
all, so a `nomen nudum` spelling was fully eligible to win its lineage's accepted name. Chasing the fix
required checking, status by status, how Classic's own resolution code (`classic/lib/PBDB/{Opinion,
TaxonInfo,Classification}.pm`) actually treats each of the five nomenclatural-status tokens — the answer
differs per token, and pbdb2 deliberately diverges from Classic for two of them. Full design rationale and
Classic citations: `docs/classic-taxa-opinions.md` §9.8.4.2. This section records only the resulting
routing and the live-data counts behind it.

**Per-token decisions:**

| token | disposition | why |
|---|---|---|
| `invalid subgroup of` | `name_opinions` concept-class fold (`reason = 'invalid subgroup'`) | Classic's `getSeniorSynonym`/`getJuniorSynonyms` fold it into the senior-synonym chase by explicit comment — *"technically not a synonym, but treated computationally the same"* as `subjective/objective synonym of`/`replaced by`. Needs no new `derive()` logic: it's ordinary input to the existing concept union-find. |
| `nomen oblitum`, targeted | `name_opinions` concept-class fold (`reason = 'nomen oblitum'`) | Same mechanism. The priority *reversal* (chronologically senior name treated as junior) needs no special code — seniority here was never decided by comparing dates, only by which way a concept edge points; folding the oblitum name (subject) into the protected name (target) *is* the reversal. |
| `nomen oblitum`, untargeted | `validity_opinions`, no derive() effect | No recorded protectum to fold into; treated as testimony, same as `dubium`/`vanum` below. |
| `nomen dubium` | `validity_opinions`, no derive() effect, target dropped | Doubt about a name's quality/diagnosability is not an act of invalidation. A deliberate pbdb2 departure from Classic, which cannot make this distinction (both compete in the same reliability-ranked pool in `getMostRecentClassification`). |
| `nomen vanum` | `validity_opinions`, no derive() effect, target dropped | Same reasoning as `nomen dubium` — a criticism of a name's quality, not an invalidating act. |
| `nomen nudum` | `validity_opinions`, **candidacy bar**, target dropped | An explicit rejection of the name's availability. `derive()` computes the winning validity opinion per `subject_permid` (`evidence DESC, COALESCE(pubyr, ref.pubyr) DESC, id DESC`, the same discipline as every other contest) and excludes that permid from its own lineage's accepted-spelling contest when the winner is `nomen nudum` — reversible by a later, better opinion of a non-barring status on the same permid. |

**Live counts (re-probed 2026-08-18, Postgres-ported `pbdb_archive` mirror):**

| status | total | targeted (`parent_no ≠ 0`) | untargeted | self-edges (`child_spelling_no = parent_spelling_no`) |
|---|---|---|---|---|
| `invalid subgroup of` | 1,420 | 1,420 | 0 | 1 |
| `nomen dubium` | 8,208 | 7,245 (88.3%) | 963 | 0 |
| `nomen nudum` | 2,533 | 2,430 (95.9%) | 103 | 0 |
| `nomen oblitum` | 76 | 59 (77.6%) | 17 | 0 |
| `nomen vanum` | 569 | 469 (82.4%) | 100 | 0 |

No unresolvable `parent_spelling_no` among any of the targeted nomen-family rows either (0 found) — clean
data across the board. The single `invalid subgroup of` self-edge joins the existing skip register (§9.5).

**Why dropping ~90% of the nomen family's targets is not a data-quality problem.** The naive read of these
numbers is "most of this data is corrupted or incomplete." It isn't. Three independent parts of the
Classic codebase treat the parent field on these statuses as optional best-effort, not a required
relationship:

- `public/tips/taxonomy_FAQ.html:697-700` (the user-facing FAQ) frames it as "enter the most specific
  thing *possible*" — phrasing that assumes the common case is often not being able to offer anything.
- `guest_templates/opinion_form.html:259-266` doesn't render a parent field at all on the nomen-family
  branch of the guest submission form.
- `classic/lib/PBDB/Opinion.pm:595-611` (the main editor form) uses one shared, always-optional parent
  field regardless of which status is selected from the dropdown — nothing marks it required for any
  particular status.

An untargeted `nomen dubium`/`nomen vanum`/`nomen nudum`/`nomen oblitum` row is the expected product of
"the material is too poor to place even approximately" (per the FAQ's own definitions — e.g. `nomen
vanum`: *"the type is so poor that it is certainly indeterminate at the species level"*), not lost data.
Dropping the target for `dubium`/`vanum`/`nudum` (even the ~90% that have one) is therefore a deliberate,
accepted design choice, not a workaround for a data gap — same category as the `revalidated` drop already
accepted for `status_old` (§4 Q4).

---

## 6. Settled enum crosswalks

### 6.1 `spelling_reason` / `status` → `name_opinions.reason` (`namechange_reasons`)

| legacy source | new `reason` | edge_class | legacy count |
|---|---|---|---|
| `spelling_reason`: original spelling | `original` | root | — |
| `spelling_reason`: recombination | `recombination` | lineage | — |
| `spelling_reason`: reassignment | `assignment` | lineage | — |
| `spelling_reason`: correction | `correction` | lineage | — |
| `spelling_reason`: rank change | `reranked` | lineage | — |
| `spelling_reason`: misspelling (any status other than `misspelling of`) | `misspelling` (never_accepted) | lineage | — |
| `status`: misspelling of | `historical misspelling` (never_accepted) | lineage | 875 [see below] |
| `status`: subjective/objective synonym of | `junior synonym` (`objective` bool) | concept | 52,106 / 1,246 |
| `status`: replaced by | `replaced by` | concept | 4,020 |
| `status`: invalid subgroup of | `invalid subgroup` | concept | 1,420 [§5.2] |
| `status`: nomen oblitum, targeted only | `nomen oblitum` | concept | 59 [§5.2] |

`objective`/`subjective synonym of` both map to `junior synonym` with the `objective` boolean (D7).
Dropped legacy-invention token `code` has no source (D7). `invalid subgroup` and `nomen oblitum` carry
`objective = NULL` — the boolean is the sole carrier of the subjective/objective split and doesn't apply
to either (§5.2).

**`misspelling` vs. `historical misspelling` (added 2026-08-19, `migration_exploration` pair-24
discussion).** Classic distinguishes two provenances for a misspelling claim that this crosswalk
originally collapsed into one token: `spelling_reason = 'misspelling'` is the *curatorial* case — a data
enterer notices, while entering an opinion about something else, that the current reference happened to
render the name incorrectly — while `status = 'misspelling of'` is the *dedicated* case — the entire
opinion, with its own reference and evidence, is a formally published claim that a name is a misspelling
(the PBDB user guide's own term for this is "historical misspelling"). `evidence` does not reliably
separate the two (live-probed 2026-08-19: 43.9% of `misspelling of` rows are `stated with evidence` vs.
28.9% of `spelling_reason='misspelling'` rows — a skew, not a clean split), so the distinction needed its
own dictionary token rather than being inferable from an existing column. Both are `lineage`-class and
`never_accepted`; for `misspelling of` rows, live data shows `child_no` and `parent_no` both anchor to the
correct name (equal in effectively every row) while `child_spelling_no` is the distinct misspelling, so
it resolves under the same subject/target convention as every other lineage pair
(`subject = child_spelling_no`, `target = child_no`) with no special-cased fields needed.

### 6.2 `status` (residual nomen family) → `validity_opinions.status` (`nomenclatural_statuses`)

*(Revised 2026-08-18, §5.2 — `invalid subgroup of` and targeted `nomen oblitum` moved to §6.1 above;
`targeted`/`target_permid` dropped from `validity_opinions` entirely, so there is no "targeted" column
left to map to.)*

| legacy `status` | new `status` | `bars_candidacy` | legacy count |
|---|---|---|---|
| nomen dubium | `nomen dubium` | false | 8,208 |
| nomen nudum | `nomen nudum` | **true** | 2,533 |
| nomen vanum | `nomen vanum` | false | 569 |
| nomen oblitum, untargeted only | `nomen oblitum` | false | 76 total, 17 untargeted |

Total residual: 11,327 rows (8,208 + 2,533 + 569 + 17) that would be silently dropped without
`validity_opinions` — down from the original 12,806 headline now that `invalid subgroup of` and 59 of the
76 `nomen oblitum` rows have a concept-class home instead (§10.5, §5.2).

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
| nomen-family + invalid-subgroup-of opinions (original headline) | 12,806 |
| — of those, now routed to `name_opinions` concept-class (§5.2, 2026-08-18) | 1,479 |
| — of those, remaining in `validity_opinions` (§5.2, 2026-08-18) | 11,327 |

Design-doc §10.5 probes (kept for cross-reference): distinct `orig_no`→permids 403,640; orig rows w/o
original-spelling opinion 13,607; clusters with no opinions at all 10,245; rootless clusters (no
`belongs to`) 17,062; authorities rows no opinion references 6,361; clusters where rank varies across
spellings 11,704.

See §5.2 for the full per-token targeted/untargeted breakdown behind the 1,479 / 11,327 split
(re-probed live 2026-08-18 against the Postgres-ported `pbdb_archive` mirror).

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
- [x] **Nomen-family / `invalid subgroup of` routing** DECIDED per-token — **§5.2** (2026-08-18):
      `invalid subgroup of` and targeted `nomen oblitum` become `name_opinions` concept-class folds;
      `nomen dubium`/`nomen vanum`/`nomen nudum`/untargeted `nomen oblitum` stay in `validity_opinions`
      as untargeted rows (`target_permid` dropped from the table entirely); `nomen nudum` alone bars its
      subject's accepted-spelling candidacy in `derive()`. Schema (`create_new.sql`) and spec already
      updated to match; `derive_taxa()` itself still needs the ledger-model rewrite tracked in
      `docs/classic-taxa-opinions.md` §9.8.4.1–.2 before B4 can rely on it.
- [ ] Then start B4 (`/opsx:new migrate-taxa-opinions`).
- **Parallel exploratory validation (2026-08-19, not B4 itself):** `migration_exploration/` prototypes the
  full `opinions` → `name_opinions`/`assignment_opinions`/`validity_opinions` translation as 48 individual
  `(status, spelling_reason)` handlers, each validated against live `pg_classic` data — see its own
  `DESIGN.md`. It's a parallel rewrite, not a start on B4 proper; nothing above is superseded by it, but
  several of its live-probed findings (dictionary-token gaps, the `containing_permid` nullability decision,
  new anomaly classes) are folded into this doc above as they were confirmed.

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
 2. name concept: iterate opinions status ∈ {subj/obj synonym of, replaced by,
                  invalid subgroup of, nomen oblitum WHERE parent_no≠0}         → ~58,851 rows (§9.2)
 3. assignment: iterate opinions status = 'belongs to'                          → ~927,178 rows (§9.3)
 4. validity:   iterate opinions status ∈ {nomen dubium, nomen nudum, nomen
                  vanum, nomen oblitum WHERE parent_no=0}                       →   11,327 rows (§9.4)
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

> ⚠ **SUPERSEDED framing, 2026-08-17, §3.2.** The next paragraph and the "LINEAGE" half of the table
> below describe a **pre-ledger** design where this single pass decides ROOT-vs-LINEAGE **shape** by
> ranking candidate opinions and mints exactly one row per `authorities.taxon_no` either way. That is
> no longer correct. Under the ledger model:
> - This pass (now `migrate-name-opinions.js`) mints **ROOT rows only**, unconditionally, one per
>   `authorities.taxon_no`, with no ranking and no dependency on any `opinions` row at all.
> - **LINEAGE** rows are NOT minted here. Every opinion satisfying `child_spelling_no ≠ child_no` is
>   migrated as its own separate `lineage` row by whichever per-slice migration owns that opinion —
>   unconditionally, with no ranking or "winning opinion" selection at migration time (see the notice
>   at the top of this document). `derive_taxa()` ranks among them later, at read time.
> - The LINEAGE column's per-row *derivations* below (how to populate a lineage row from a single
>   introducing opinion `w`) are still substantively correct and reusable — read `w` as "the opinion
>   this particular ledger row comes from," not "the winning opinion out of several."

One row per `authorities.taxon_no`. ~~**Shape** is decided by the **top-ranked introducing opinion** —
`opinions WHERE child_spelling_no = taxon_no AND child_no <> taxon_no`, ranked by derive_taxa()'s own
`evidence DESC, COALESCE(pubyr, ref.pubyr) DESC, id DESC` (the Q2 sub-decision canonical winner). None
⇒ **root**; one ⇒ **lineage**.~~ `orig_no` is never read (§2, §9.8.1).

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

### 9.2 `name_opinions` — concept pass (iterate `opinions` synonymy + folds, ~58,851 rows)

Source: `status ∈ {'subjective synonym of' 52,106, 'objective synonym of' 1,246, 'replaced by' 4,020,
'invalid subgroup of' 1,420, 'nomen oblitum' WHERE parent_no≠0 59}` = 58,851, **minus 111 self-edges**
skipped (110 from the original synonymy set + 1 from `invalid subgroup of`; §9.5). Non-minting: identity
columns stay `NULL`. `invalid subgroup of` and targeted `nomen oblitum` join this pass 2026-08-18 (§5.2)
— routed identically to the original three statuses; Classic treats all five as the same kind of fold.

| target column | source |
|---|---|
| `subject_permid` | `permid(child_spelling_no)` |
| `target_permid` | `permid(parent_spelling_no)` — always present for these statuses (0 rows with `parent_spelling_no=0`; confirmed live for `invalid subgroup of`/targeted `nomen oblitum` too, 2026-08-18) |
| `reason_id` | `'junior synonym'` for subjective/objective synonym; `'replaced by'` for replaced by; `'invalid subgroup'` for invalid subgroup of; `'nomen oblitum'` for nomen oblitum WHERE `parent_no≠0` (§6.1) |
| `edge_class` | `'concept'` |
| `objective` | `true` for `objective synonym of`; `false` for `subjective synonym of`; **`NULL`** for `replaced by`, `invalid subgroup of`, and `nomen oblitum` (D7; sole carrier of the split, applies to none of the fold-only reasons) |
| `new_name`, `rank_id`, `authority_id`, `pages`, `figures` | `NULL` (non-minting concept edge) |
| `reference_id`, `pubyr`/`attribution`, `evidence` | from the `opinions` row (shared §9.0) |

### 9.3 `assignment_opinions` (iterate `opinions` `belongs to`, ~927,178 rows)

*(⚠ The 332-row exclusion below is SUPERSEDED, 2026-08-19, §9.6 — those rows are now migrated with
`containing_permid = NULL`, not dropped. Left as-is per this doc's decision-log convention; read §9.6
before relying on the counts in this section.)*

Source: `status = 'belongs to'` = 927,512, **minus 332** with `parent_spelling_no = 0` (no containing
taxon → rootless in the tree; derive_taxa treats absent containment as a tree root — emit **no** row)
and **minus 2** self-edges (§9.5). No other status asserts containment (routing §5).

| target column | source |
|---|---|
| `subject_permid` | `permid(child_spelling_no)` |
| `containing_permid` | `permid(parent_spelling_no)` (NOT NULL; the 332 zero-parent rows are the ones dropped) |
| `questioned` | **`false`** — no legacy source column for incertae sedis on `opinions` (§9.7 note; not flagged, default is correct for the mass) |
| `reference_id`, `pubyr`/`attribution`, `evidence` | shared §9.0 |

### 9.4 `validity_opinions` (iterate `opinions` residual nomen family, 11,327 rows)

*(Revised 2026-08-18, §5.2 — the table is no longer target-bearing at all; the single-shape table below
replaces the old untargeted/targeted split now that `invalid subgroup of` and targeted `nomen oblitum`
have moved to §9.2.)*

Source: `status ∈ {'nomen dubium' 8,208, 'nomen nudum' 2,533, 'nomen vanum' 569}` plus `'nomen oblitum'
WHERE parent_no=0` (17) = 11,327. `nomenclatural_status_id` is a plain FK to
`dictionaries.nomenclatural_statuses` (no composite/targeted FK — create_new.sql `validity_opinions`).
`parent_no`/`parent_spelling_no` are read for none of these rows — the legacy target, when one exists
(7,245 / 2,430 / 469 / 0 of the four respectively; §5.2), is a deliberate, logged drop, not a column on
this table.

| target column | source |
|---|---|
| `subject_permid` | `permid(child_spelling_no)` |
| `nomenclatural_status_id` | `map(status)` via §6.2 |
| `reference_id`, `pubyr`/`attribution`, `evidence` | shared §9.0 |

No other column varies by status — `bars_candidacy` lives on the dictionary row (`nomen nudum` only),
not on the opinion, so `derive()` reads it via the FK rather than the migration needing to stamp
anything status-specific onto the row itself.

### 9.5 Skip / repair register (edge cases, all counts live 2026-08-07)

Small integrity residues found by probing legacy pointers. Each is **logged and skipped**, never
silently dropped:

| case | count | pass | disposition |
|---|---|---|---|
| `child_spelling_no ∉ authorities` (subject unresolvable) | **2** | 2–4 | skip the row (no permid to be subject) |
| `parent_spelling_no ∉ authorities` (target/containing unresolvable) | **8** | 2–4 | skip the edge (untargeted validity is unaffected) |
| `child_no ∉ authorities` (lineage target unresolvable) | **1** | 1 | disqualify as introducing opinion → spelling falls to next-ranked, else root |
| concept self-edge `child_spelling_no = parent_spelling_no` (synonymy family) | **110** | 2 | skip (would violate `name_opinion_not_self`; self-synonymy is meaningless) |
| concept self-edge `child_spelling_no = parent_spelling_no` (`invalid subgroup of`) | **1** | 2 | skip, same reason (probed 2026-08-18, §5.2) |
| assignment self-edge `child_spelling_no = parent_spelling_no` | **2** | 3 | skip (would violate `assignment_not_self`) |
| `belongs to` with `parent_spelling_no = 0` (rootless) | 332 | 3 | ⚠ SUPERSEDED, 2026-08-19, §9.6 — now emitted with `containing_permid = NULL`, not skipped |

**`parent_spelling_no ∉ authorities`/`child_spelling_no ∉ authorities` — root cause confirmed, 2026-08-19.**
Live-probed against `pg_classic`: every one of these orphaned `taxon_no` values (and `319671`, a `parent_no`
concept anchor behind two of them) is **entirely absent from Classic's own `authorities` table**, not
merely excluded by this project's separate authorities-migration pass. Each sits as a single-id gap inside
an otherwise dense, taxonomically coherent id neighborhood (e.g. `100716`, referenced by 5 `belongs to`
opinions, sits directly between real neighbors `100715 Eschrichtidae`/`100717 Grampidae`) — the signature
of an `authorities` row that existed and was later deleted without Classic cascading the delete into
`opinions`. Genuine Classic-side data defect, not a migration gap; the skip disposition above is correct
and no fix applies on this side. Full detail (affected opinion_no list) in
`migration_exploration/DESIGN.md` §3.

`child_spelling_no = 0`: **0 rows** — every opinion has a resolvable subject candidate.

**Targeted nomen family (probed 2026-08-18, §5.2): clean.** Across all 10,203 targeted rows of `nomen
dubium`/`nomen nudum`/`nomen vanum`/`nomen oblitum` (routing to §9.2 or dropped per §5.2 as applicable),
**0** self-edges and **0** unresolvable `parent_spelling_no` — no skip-register entries needed for this
slice.

### 9.6 Rootless `belongs to` is migrated, not skipped *(DECIDED, 2026-08-19)*

**Supersedes** the 332-row exclusion in §9.3 and the "emit no assignment row" disposition in §9.5.
`parent_spelling_no = 0` is Classic's own assertion that the opinion's subject has no containing
taxon — a real, qualifying opinion under the ledger model (§3.2's boundary: migration writes every
qualifying opinion unconditionally, never deciding one doesn't matter), not unresolvable data like
`parent_spelling_no ∉ authorities` (§9.5, still skipped).

`assignment_opinions.containing_permid` (`postgresql/create_new.sql`) is now **nullable**. All six
`belongs to` migration handlers insert these 332 rows with `containing_permid = NULL` instead of
skipping them. This matters beyond completeness: `assignment_opinions` rows are pooled per concept and
ranked by `derive_taxa()`'s usual `evidence DESC, pubyr DESC, id DESC` contest (§9.3's per-table note).
Dropping a rootless opinion outright meant `derive_taxa()` could never let it win that contest against
an older, worse-evidenced real assignment — silently keeping a taxon under a parent a better-evidenced
opinion says it doesn't have. Migrating the row lets the ranking decide, same as everywhere else.

`derive_taxa()` (`postgresql/create_new.sql` LAYER 2) needed **no code change**: its containment joins
(`_dt_assign`, `_dt_node`) are already `LEFT JOIN`s keyed on `containing_permid`, so a NULL value simply
fails to match and produces `containing_concept_permid = NULL` — the same shape `taxa` already uses for
"no assignment opinion at all" (`-- NULL = root`, `create_new.sql` ~L4913). The one difference is
`winning_assignment_opinion_id` is now populated instead of NULL for these permids, which is strictly
more informative: it distinguishes "explicitly asserted rootless, by this opinion" from "no opinion on
containment exists at all," a distinction the pre-change behavior erased.

**Invariant, load-bearing:** `containing_permid IS NULL` means "Classic asserted no parent," never "we
couldn't resolve the parent." An unresolvable/orphaned `parent_spelling_no` (§9.5's 8-row
`parent_spelling_orphan` case) is always skipped and logged, never written as NULL. If a future change
ever makes an unresolvable parent migrate as NULL too, this invariant breaks and the two populations
become indistinguishable by inspecting the table alone.

**Two more anomaly classes surfaced during the exploratory pair-based validation (2026-08-19), not
previously catalogued anywhere in this doc — full write-ups in `migration_exploration/DESIGN.md` §3, not
duplicated here:**
- **"Convergent correction"** (`replaced-by`/`correction`, 9 rows): a correction's `child_spelling_no`
  coincides with the `replaced by` target's identity — confirmed benign, every case a genuine
  unavailable/replacement-name event (e.g. *Tianchiasaurus* → *Tianchisaurus*). The concept edge is
  correctly skipped as a self-loop while the independent lineage edge still emits the same fact; no data
  is lost and no fix applies.
- **Lineage self-reference** (224 rows: `child_spelling_no = child_no` despite a non-`'original spelling'`
  `spelling_reason`): root cause genuinely unclear. Sibling-opinion evidence suggests Classic curators
  sometimes populate `spelling_reason` from a taxon's general nomenclatural history rather than strictly
  this row's own values; for `misspelling of` specifically, the deviation shows up on `parent_spelling_no`
  (a field this pair's handler never reads) rather than `child_spelling_no`, likely a vestigial data-entry
  artifact. Doesn't change migration behavior — the existing no-lineage-edge skip is correct regardless of
  why — but worth raising with Classic's curatorial team for their own documentation.

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

---

## 10. Concept-axis synonymy "reversals" — FLAGGED for B4 (2026-08-20)

**The trigger.** Design work on the OpenSpec change
`openspec/changes/contest-lineage-concept-edges/` (giving `derive_taxa()` a per-subject ranked contest
over lineage/concept edges, plus an explicit, targeted `negates` opinion so a later opinion can contest
an earlier one — see that change's `design.md` D1/D2) surfaced a structural mismatch this doc needs to
carry forward into B4. Classic ranks **every** opinion about a taxon — `belongs to` and the
synonymy/spelling family alike — in one pool (`getMostRecentClassification`, `docs/classic-taxa-opinions.md`
§4.2); whichever wins defines the taxon's current disposition regardless of type. pbdb2 deliberately
splits classification (`assignment_opinions`) from synonymy (`name_opinions` concept-class) into
independent per-subject contests (§8/§9.1 of the companion doc — motivated by clean edge-following for
the tree query and per-edge-type rank rules, not by a considered ranking philosophy). One consequence
of that split: a `belongs to` opinion can never contest a concept-class claim in the new model, even
though in Classic it routinely does exactly that — reclassifying a taxon as a valid, independently
allocated name is how Classic's engine (implicitly) un-synonymizes it, simply because it's the most
recent, reliable word on that taxon of *any* type.

**Live counts** (probed 2026-08-20 against the Postgres-ported `pbdb_archive` mirror via
`pg-classic-pool.js`, concept-class opinions only — `subjective synonym of`, `objective synonym of`,
`replaced by`, `invalid subgroup of`, and targeted `nomen oblitum`; `misspelling of` is lineage-class
and excluded here, ~875 rows total, small enough to size separately if wanted):

| population | count |
|---|---|
| taxa with both a concept-class opinion and a `belongs to` opinion on file | 36,312 |
| …of those, currently resolved by Classic's own `taxa_tree_cache` (`synonym_no = taxon_no`) as their own senior, not a junior synonym | 6,170 |

The first row is mostly unremarkable — routine junior-synonym classification-borrowing (spec
requirement "Classification is pooled across the whole concept") produces real `assignment_opinions`
history for taxa that are stably, uncontestedly synonyms; that's expected, not a gap. The second row is
the actionable population: for these 6,170 taxa, a naive migration plus the fixed `derive_taxa()` would
resolve them as synonymous (per their raw, unretracted concept-class opinion), while Classic's live
engine currently treats them as independent.

**Decision: migration does NOT synthesize a `negates` opinion for any of the 6,170, in B4 or otherwise.**
Two independent reasons, not one:

1. Deciding *which* `belongs to` opinion "counts" as a reversal of *which* concept-class opinion
   requires exactly the evidence/pubyr/id ranking this doc's header rule reserves for `derive_taxa()`
   alone — migration writing every qualifying legacy opinion unconditionally, never comparing candidates
   to pick a winner, is the entire point of the migration/derivation split.
2. Even Classic's own resolution can't distinguish a genuine scientific rebuttal from an unrelated,
   later classification opinion that simply happens to be more reliable — the two are indistinguishable
   in the data shape (subject, evidence, reference; nothing records whether the classifying author ever
   engaged with the synonymy question at all). An auto-synthesized negation, attributed to that opinion's
   own reference, risks putting words in an author's mouth they never said. This is a case where pbdb2's
   split model is *more* precise than Classic's, not less (see `contest-lineage-concept-edges/design.md`
   for the fuller discussion) — but that precision means the ambiguity in Classic's historical data can't
   be losslessly resolved after the fact.

**Disposition.** `belongs to` → `assignment_opinions` and the concept-class family → `name_opinions`
concept-class rows migrate exactly as §9.2/§9.3 already specify — unconditionally, no inference layered
on top. The 6,170 taxa will resolve as synonymous immediately post-migration, contra Classic's current
live state, until a curator reviews and re-enters a real opinion.

**Follow-up (a B4 deliverable, not a schema or `derive_taxa()` change):** produce a dated curatorial
worklist — the 6,170 `child_no` values, each joined to its currently-asserted senior/synonym target and
its competing `belongs to` opinion(s) — as a read-only review report, not a ledger write. A curator
judges each case and, where warranted, enters a genuine, self-attributed `negates` opinion via the
mechanism `contest-lineage-concept-edges` adds. Same treatment as this project's existing anomaly-log
ledger pattern for other migration edge cases: a quantified, actionable list handed to a human, not a
silent gap and not an automated guess.
