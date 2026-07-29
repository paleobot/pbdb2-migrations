# How PBDB Classic Handles Taxa & Opinions

*A reconstruction from `~/repos/classic` (Perl/MySQL codebase), written to inform the
pbdb2 real-time redesign. Line references are to `lib/PBDB/*.pm` unless noted.*

---

## 1. The core idea

Classic separates **what people asserted** from **what the database currently believes**.

- **Assertions** live in two hand-entered tables: `authorities` (a name, as spelled, with an
  author/year) and `opinions` (one published statement relating one name to another).
- **Beliefs** — "what is the currently accepted name, parent, and synonym of taxon X?" — are
  *derived* by ranking the opinions and picking a winner, then **materialized** into two cache
  tables (`taxa_tree_cache`, `taxa_list_cache`).

Everything hard about the system is in that derivation and in keeping the cache honest. The
source tables are simple; the machinery that turns a pile of conflicting opinions into a single
coherent tree is where the complexity — and the fragility — lives.

---

## 2. The source-of-truth tables

### 2.1 `authorities` — one row per *name-as-spelled*

The unit is not "a taxon" but "a spelling of a taxon." *Canis lupus*, *Canis lupis* (a
misspelling), and a later recombination *Lupus lupus* are **three separate rows**, each with its
own `taxon_no`. Key columns the code leans on:

- `taxon_no` (PK), `taxon_name`, `taxon_rank`
- `ref_is_authority` ('YES'/''), plus author/year fields (`author1last`, `pubyr`, …) — the name's
  *original* authorship, used when the naming reference itself carries the authority
- `type_taxon_no`, `extant`, `common_name`, and assorted biology fields

There is **no parent pointer and no "valid name" pointer in `authorities`**. A name row knows
nothing about where it sits in the tree or whether it is current. All of that is opinion-derived.

### 2.2 `opinions` — one row per *published statement*

This is the heart of the model. Each opinion says "reference R states that child C relates to
parent P in manner S." The columns that matter:

| Column | Meaning |
|---|---|
| `child_no` | the **original combination** taxon_no the opinion is *about* |
| `child_spelling_no` | the spelling of the child *used in this opinion* |
| `parent_no` | the original combination of the parent/allocation target |
| `parent_spelling_no` | the spelling of the parent used in this opinion |
| `status` | the nature of the assertion (see vocab below) |
| `spelling_reason` | why child_spelling differs from child_no (original / recombination / correction / rank change / reassignment / misspelling) |
| `basis` | evidentiary strength enum ('stated with evidence' > 'stated without evidence'/'implied' > 'second hand') |
| `ref_has_opinion`, `reference_no`, `pubyr`, author fields | provenance, and the year used for recency |
| `max_interval_no` / `min_interval_no` | optional stratigraphic range stated by the opinion |

**All four id columns are foreign keys into `authorities.taxon_no`.** There is no separate
"spelling" table — `child_no`, `child_spelling_no`, `parent_no`, and `parent_spelling_no` are every
one of them an authority row. The `*_no` vs `*_spelling_no` distinction is not a different table but
a different *role*:

- `*_no` → the authority row that is the **original combination** (canonical identity)
- `*_spelling_no` → the authority row for the **spelling actually used** in that opinion

They are frequently equal; they diverge only when a recombination, correction, rank change, or
misspelling is involved.

The `child_no` vs `child_spelling_no` split is the single most important modeling decision in the
whole system: **an opinion is always filed under the original combination (`child_no`), but records
the spelling that reference actually used (`child_spelling_no`).** That is what lets the system
gather "all opinions about this taxon, no matter how it was spelled" with a single indexed lookup.

### 2.2a `parent_no` is a polymorphic pointer, not always "the higher taxon"

A crucial subtlety: **`parent_no` is the target the opinion points the child at, and what that
target *means* depends on `status`.** It is the containing higher taxon *only* for `belongs to`
opinions. The `opinions` table overloads one column to encode two structurally different kinds of
edge:

| `status` | What `parent_no` is | Rank relationship (enforced in `Opinion.pm`) |
|---|---|---|
| `belongs to` | the **containing higher taxon** (e.g. child = genus, parent = family) | parent rank **strictly higher** (`:1163`); a species must point at a genus/subgenus (`:1182`) |
| `subjective/objective synonym of`, `replaced by`, `misspelling of`, `homonym of` | the **senior synonym / replacement / correct spelling** — a *lateral* pointer, not a container | parent rank must be the **same** (`:1170`) |
| `invalid subgroup of` | the taxon it is an invalid subgroup of | **any** rank |
| `nomen dubium/nudum/oblitum/vanum` | whatever it is being sunk under | any (just not species-level identity) |

So a single `parent_no` column carries both **vertical** edges (classification / containment, for
`belongs to`) and **horizontal** edges (this-name-equals-that-name, for the synonymy/spelling
family). The resolver must read `status` to know which kind of relationship a row asserts. Building
the *tree* means following only the `belongs to` edges — but you first have to collapse all the
horizontal edges (synonyms, spellings) to know which node each `belongs to` edge actually connects.
That overloading is a large part of why the derivation code is as convoluted as it is, and it is an
open modeling decision for pbdb2: keep one polymorphic opinion edge, or split
classification-opinions from synonymy/spelling-opinions into distinct relations.

### 2.3 Controlled vocabularies

**`status`** (`Opinion.pm:309`) partitions into three families:

- `belongs to` — a classification (allocates child to a parent). The backbone of the tree.
- **Synonymy / spelling family**: `subjective synonym of`, `objective synonym of`, `replaced by`,
  `misspelling of`, `invalid subgroup of`.
- **Nomen family** (species/genus only): `nomen dubium`, `nomen nudum`, `nomen oblitum`, `nomen vanum`.

**`spelling_reason`** (`Opinion.pm:70-99`): `original spelling`, `correction`, `rank change`,
`reassignment`, `recombination`, `misspelling`. This is how the system distinguishes "*Canis lupis*
is a typo for *Canis lupus*" from "*Lupus lupus* is a legitimate recombination" — both change the
name string, but only one is a real nomenclatural act.

### 2.4 How occurrences attach

Occurrences (and `reidentifications`) store **denormalized name strings** (`genus_name`,
`species_name`, `genus_reso`, …) *plus* a resolved `taxon_no` pointer into `authorities`
(`Reclassify.pm:74`). The text is what the collector wrote; the `taxon_no` is the database's best
match, assigned/repaired by the reclassification tools. So the taxon graph is one layer, and
occurrence→taxon binding is a separate concern layered on top.

---

## 3. The derived layer: two cache tables

### 3.1 `taxa_tree_cache` — a nested set + resolution summary

One row per `taxon_no`, with (`TaxaCache.pm:1` header comment):

- `lft`, `rgt` — **modified preorder (nested-set) coordinates**. A taxon's descendants are exactly
  the rows with `lft` between the taxon's `lft` and `rgt`. This makes "give me the entire subtree"
  a single range scan, and "give me all ancestors" a single self-join (`t.lft <= base.lft AND
  t.rgt >= base.rgt`).
- `spelling_no` — the taxon_no of the **currently accepted spelling** of this name.
- `synonym_no` — the taxon_no of the accepted spelling of the **most senior synonym** (equals
  `spelling_no` unless the taxon is a junior synonym).
- `opinion_no` — the **winning classification opinion** for this taxon (the one that decided its
  parent). Cached so the resolver doesn't have to recompute the ranking on every read.

All spellings/synonyms that resolve to the same node share the same `lft`, so a single UPDATE
keyed on `lft` fixes the whole cluster.

### 3.2 `taxa_list_cache` — an ancestor/descendant adjacency list

Every (ancestor, descendant) pair, materialized. Conceptually redundant with the nested set, it
existed so parent lookups could be a single join. **Notably, the live code has largely abandoned
it**: `getParents`/`getParent` (`TaxaCache.pm:1010+`) now self-join `taxa_tree_cache` on the
`lft/rgt` range, and the old `taxa_list_cache` queries sit commented-out right above the
replacements. `rebuildListCache`/`cleanListCache` are commented out entirely (`TaxaCache.pm:326-354`).
So by the end of Classic's life this second table was vestigial — a maintenance liability that no
longer paid for itself.

---

## 4. The resolution algorithm (the actual "opinion engine")

Four intertwined questions, all answered in `TaxonInfo.pm`:

### 4.1 Original combination — `getOriginalCombination` (`TaxonInfo.pm:2043`)

Given any spelling, find the `child_no` everything files under. It tries, in order: is this
spelling a `child_spelling_no` of some opinion? a `child_no`? a `parent_spelling_no`? a
`parent_no`? a misspelling target? — falling back to the taxon itself. When bad data yields **two**
candidate originals, it breaks the tie by **oldest pubyr, then lowest opinion_no** and treats the
loser as a misspelling. This function is called *constantly*; every other routine funnels through
it to normalize a spelling to its canonical id.

### 4.2 Most recent classification — `getMostRecentClassification` (`TaxonInfo.pm:2107`)

The ranking function. It gathers every relevant opinion and orders them by:

```
ORDER BY reliability_index DESC, pubyr DESC, opinion_no DESC
```

`reliability_index` is a `CASE` expression (`TaxonInfo.pm:~2124`) mapping the `basis` enum to
integers (stated-with-evidence = 3 down to second-hand = 1), falling back to the *reference's*
basis when the opinion has none, with a special-cased reference (6930) pinned to 0. So the winner
is: **most authoritative basis, then most recent year, then latest data entry.** The top row's
`parent_no`/`status` become the taxon's classification.

> **pbdb2 does not carry this enum forward.** `basis` collapses to a single boolean `evidence`
> (`stated with evidence` → true, everything else → false), which is what `create_new.sql` always
> specified. The graded ordering described here is Classic's, not the target design — see §9.5.2
> step 2 for the pbdb2 ranking and §10.5 for the migration mapping.

Subtleties baked in:

- **Junior-synonym borrowing** (`use_synonyms`): a `belongs to` opinion on a junior synonym of
  equal rank is allowed to classify the senior name, because it may be more reliable/recent than
  anything filed directly on the senior name. Species combinations are excluded from this because a
  species must be directly allocated to its current genus.
- **De-duplication in Perl**: one publication can produce two opinions on taxa now considered
  synonyms; the SQL can't dedupe that, so it's stripped in a post-pass keyed on author+year
  (`TaxonInfo.pm:~2210`).
- **Winning-spelling computation**: after picking the winning opinion it re-derives the correct
  `spelling_no`/`synonym_no`, skipping misspellings and rank-mismatched spellings.

### 4.3 The write-back side effect (important!)

`getMostRecentClassification` **is not a pure read.** When called in the default mode it ends with:

```sql
UPDATE taxa_tree_cache SET spelling_no=…, synonym_no=…, opinion_no=… WHERE taxon_no IN (…spellings…)
```

(`TaxonInfo.pm:~2255`). So the *read path lazily repairs the cache.* If `opinion_no` was already
stored, an early branch returns it without recomputing (`TaxonInfo.pm:~2155`); otherwise it
recomputes and persists. The cache is thus maintained by a mix of a background daemon **and**
opportunistic writes triggered by ordinary reads. Powerful, but it means a `SELECT`-shaped call can
mutate the database and race with other writers.

### 4.4 Senior synonym / spelling — `getSeniorSynonym`, `getMostRecentSpelling` (`TaxonInfo.pm:4844`, `:2287`)

Walk synonym opinions to the most senior valid name; pick the accepted spelling. Both are careful
to resolve loops (A synonym-of B while B synonym-of A) rather than recurse forever.

---

## 5. Keeping the cache in sync

### 5.1 The daemon, not a nightly cron — `scripts/old/taxa_cached.pl`

Contrary to "nightly," the real mechanism is a **long-running daemon polling every 2 seconds**. Each
tick it asks: which taxa have opinions (or opinion-referenced refs) `modified` since the last sync
time?

```sql
SELECT DISTINCT o.child_no, o.modified FROM opinions o WHERE o.modified > '<sync_time>'
```

and calls `TaxaCache::updateCache($dbt, $child_no)` for each, oldest-first, then advances the sync
timestamp. It also rebuilds on `HUP`/`USR1`/`USR2` signals. So it is *near*-real-time (a few-second
lag) via change polling — not a full rebuild, and not truly event-driven.

`rebuildCache` (`TaxaCache.pm:rebuildCache`) is the full from-scratch rebuild — run on corruption,
after bulk uploads, or "weekly to be safe." Its own comments admit opinions entered *during* the
rebuild "might be left out."

### 5.2 Incremental update — `updateCache` (`TaxaCache.pm:454`)

For one taxon, it:

1. Normalizes to the original combination.
2. **Takes a table-level mutex** via a `tc_mutex` table (insert a row = lock; the daemon busy-waits
   if a <2-min-old lock exists). This is a hand-rolled serialization lock because nested-set updates
   are not safe to interleave.
3. Recomputes the winning opinion (`recompute => 'yes'`).
4. Folds every alternate spelling into the same nested-set node (same `lft`), moving any stray
   children with `moveChildren`.
5. Updates `spelling_no`, `synonym_no`, strat range on the whole `lft` cluster.
6. If the winning **parent changed**, calls `moveChildren` to splice the taxon's whole subtree to a
   new location in the nested set — the expensive operation.

### 5.3 `moveChildren` — the nested-set surgery

Moving a subtree means: open a gap of size `1+rgt-lft` at the destination, shift the moving block's
coordinates into it, close the old gap — all as raw arithmetic `UPDATE`s across the entire table
(`TaxaCache.pm:~640+`). It contains explicit **loop-breaking** logic: if the new parent is inside
the moving subtree (a cycle), it first exiles the parent to position 0, moves the child, then pokes
the parent's opinion `modified` date to force a re-placement on a later tick. The comments record a
"horrible bug … sporadic table corruptions when opinions were being entered rapidly" (28.11.07),
partially mitigated in 2013 by simplifying the mutex handling. That history tells you everything
about how robust nested-set-in-SQL-under-concurrency actually is.

---

## 6. The read path

Consumers never re-run the ranking; they hit the cache:

- **Subtree / children** — `getChildren` (`TaxaCache.pm:836`): resolve to senior synonym, then a
  single `lft BETWEEN` range scan.
- **Ancestors / classification** — `getParents`/`getParent` (`TaxaCache.pm:1010`): self-join on the
  `lft/rgt` containment range, filtered to `taxon_no = synonym_no` (valid names only).
- `Classification.pm`, `PrintHierarchy.pm`, `DownloadTaxonomy.pm`, and `TaxonInfo`'s display code
  all build on these two primitives.

So: **writes are expensive and serialized; reads are cheap range/containment queries.** That's the
whole performance bargain of the nested-set design.

---

## 7. Critique

### What is genuinely good and worth preserving

1. **The assertion/belief separation is correct and should survive the rewrite.** Opinions as
   immutable-ish published statements, with the accepted tree *derived* from them, is the right
   ontology for a database whose job is to track evolving scientific consensus. Don't flatten it.
2. **`child_no` vs `child_spelling_no` (original combination + spelling-used) is the key insight.**
   It cleanly separates *nomenclatural identity* from *nomenclatural act*, and it's what makes
   "gather all opinions about this taxon" tractable. Keep this distinction explicit in pbdb2.
3. **A transparent, reproducible ranking** (`basis` → `pubyr` → entry order) means the accepted tree
   is a pure function of the opinions. Anyone can audit *why* a name is classified where it is. That
   auditability is a feature, not incidental.
4. **Nested set for reads** is a legitimately good fit for a read-heavy taxonomic hierarchy:
   O(1)-ish subtree and ancestor queries.

### What is fragile, and why

1. **Derivation logic is scattered and duplicated across SQL + Perl.** The ranking lives in a
   hand-built `CASE`/`ORDER BY` string; dedup and spelling-selection live in Perl post-passes;
   original-combination resolution is a four-fallback cascade. The same concepts (recency,
   reliability, synonym-borrowing) are re-implemented in `getMostRecentClassification`,
   `getMostRecentSpelling`, `getSeniorSynonym`, and `rebuildCache`. There is **no single canonical
   definition** of "the winning opinion." This is the deepest problem: the business rule is smeared
   across a 5,283-line module and its callers.

2. **Reads mutate the cache.** `getMostRecentClassification` issuing `UPDATE`s is clever but toxic:
   it couples query latency to write contention, makes read replicas impossible, and creates
   read/write races that the `tc_mutex` only partially contains. A "belief" layer should be
   rebuildable *without* being touched by reads.

3. **The cache is maintained by three mechanisms that can disagree** — the 2 s polling daemon, the
   lazy read-path write-back, and the periodic full `rebuildCache`. `rebuildCache`'s own comments
   admit it can miss concurrent edits; the daemon can lag; the lazy path fires unpredictably. There
   is no transactional guarantee that `taxa_tree_cache` reflects `opinions` at any given instant —
   hence the recurring "run `update_opinion.pl all` to clean corruption" folklore.

4. **Nested sets are hostile to concurrent writes.** Every reparent rewrites `lft/rgt` across large
   swaths of the table under a coarse table-level mutex (a `tc_mutex` row, respected only if <2 min
   old). The commit history literally documents corruption bugs from rapid opinion entry. Nested
   sets optimize the read side at a serialization cost that fights the stated pbdb2 goal of
   *real-time* updates.

5. **Change detection keys on `modified` timestamps** (`WHERE o.modified > sync_time`, comparing an
   opinion's and its reference's timestamps). Timestamp-based polling is racy at second resolution,
   misses clock skew, and forces the daemon architecture. It is a substitute for real change
   events / triggers.

6. **`taxa_list_cache` is dead weight.** Superseded by nested-set self-joins, its rebuild routines
   commented out, yet the table still exists to be kept (in)consistent. A textbook example of a
   derived structure outliving its usefulness and becoming pure risk.

7. **Two-original-combination "bad data" branches** and misspelling-vs-original tie-breaks show the
   model *permits* states it then has to heuristically repair at read time. The schema doesn't
   prevent the corruption; the code cleans up after it, per request, forever.

### Net assessment

The **conceptual model (opinions → derived accepted tree, with original-combination identity) is
sound and should be carried forward essentially intact.** The **implementation** — nested sets
mutated in place, a coarse mutex, a polling daemon, read-path write-back, a vestigial second cache,
and ranking logic scattered across SQL and Perl — is where Classic accumulated its fragility. It
works, but it is maintained by ritual (periodic rebuilds, cleanup scripts) rather than by
construction.

---

## 8. Implications for the pbdb2 real-time redesign

Framing the target, not prescribing it:

- **Keep** the assertion tables (authorities/opinions) and the original-combination + spelling
  distinction. This is the durable part.
- **Make "the winning opinion" one canonical, declarative definition** — ideally a single SQL
  view/function (e.g. a `DISTINCT ON (child_no) … ORDER BY reliability, pubyr, opinion_no` in
  Postgres) — instead of duplicated ranking logic. The accepted tree becomes a materialized view of
  that, refreshable deterministically.
- **Prefer an ancestor/path representation friendlier to writes than nested sets** — a recursive-CTE
  adjacency model, `ltree`, or closure table. Postgres recursive CTEs make "cheap reads" no longer
  require the write-hostile `lft/rgt` rewrite. (Note: the archived `auto-lineage-placement` and
  `entity-versioning-triggers` changes suggest pbdb2 already leans this way.)
- **Drive updates from real change events (triggers/versioning), not `modified`-timestamp polling.**
  This is the concrete path to "real-time without the nightly/daemon rebuild."
- **Never let reads write.** Derivation must be idempotent and rebuildable from the opinions alone,
  so read replicas and transactional consistency become possible.
- **Let the schema forbid the states Classic repairs at read time** (duplicate originals, orphan
  spellings) with constraints, rather than shipping heuristic cleanup.
- **Decide whether to keep `parent_no` polymorphic or split the edge types.** Classic's one
  `parent_no` column means both "is classified under" (vertical, `belongs to`) and "is the same name
  as / is replaced by" (horizontal, synonymy/spelling). Splitting classification opinions from
  synonymy/spelling opinions into distinct relations would let the tree query follow one clean edge
  set and let the schema enforce the rank rules per edge type, instead of the resolver branching on
  `status` everywhere.

---

## 9. The proposed pbdb2 redesign (issues #16 / #30) and how it meshes

*Refs: `paleobot/pbdb2-dev` issue #16 (real-time vs nightly rebuild) and #30 (the "Solution"
comment — the **Opinion Inheritance Trigger System**), plus the follow-up analysis and aazaff's
ranking of alternatives.*

### 9.1 What the Solution proposes

- **Split Classic's one polymorphic `opinions` table into three typed opinion tables:**
  `name_opinions` (spelling/misspelling/synonymy), `assignment_opinions` (parent taxon), and
  `rank_opinions` (rank). Each is a plain append-only assertion log.
- **Make `taxa` an append-only *ledger*.** The current belief for a taxon is its latest row,
  identified by an invariant `permid` and chained with `preceded_by` / `succeeded_by`. `accepted`
  flags whether a row is the currently valid name.
- **An "inheritance trigger" reconciles at write time.** Inserting an opinion that supersedes the
  current state (per the reliability/pubyr ranking) appends a new `taxa` row. Marking a name
  unaccepted (e.g. *Myliobatus* ruled a misspelling of *Myliobatis*) fires a trigger that clones the
  relevant assignment onto the senior name (a new `taxa` row), and reversing that opinion walks the
  `preceded_by` chain back to the last clean state and appends the reverted row.

Crucially, **pbdb2 already has most of this machinery**: the `entity-versioning-triggers` spec
implements `permid` + `preceded_by_id`/`succeeded_by_id`, automatic lineage placement on insert, and
generic FK-swinging via `pg_constraint`. So the Solution is largely *applying the existing versioning
ledger to taxa* and adding one taxonomy-specific inheritance trigger on top. `permid` replaces
Classic's `orig_no` / original-combination pointer.

### 9.2 Where it aligns with the §8 recommendations (strong agreement)

| §8 recommendation | Solution |
|---|---|
| Split the polymorphic `parent_no` edge | **Done** — `name_` / `assignment_` / `rank_opinions`. The tree query follows only `assignment_opinions`. |
| Drive updates from change events, not `modified` polling | **Done** — triggers on opinion insert; no 2 s daemon. |
| Never let reads write | **Done** — the current belief is just the latest row (`succeeded_by IS NULL`); no read-path UPDATE, no `tc_mutex`. |
| Prefer a write-friendly hierarchy over nested sets | **Done differently** — materializes state per row instead of `lft/rgt` rewrites *or* live recursive CTEs. |
| Replace `orig_no` with an invariant identity | **Done** — the versioning `permid`. |

It also adds full provenance (append-only → reconstruct the tree at any past instant), which
Classic's cache never had.

### 9.3 Where it diverges — and the concern

§8 argued for **one canonical, declarative definition of "the winning opinion," with the derived
tree idempotent and rebuildable from the opinions alone.** The Solution instead makes the `taxa`
ledger **primary, imperatively materialized state**, reconciled by triggers at write time.

The concern is that this can **reintroduce Classic's "correct-by-ritual" fragility, relocated from a
nightly rebuild into trigger-land**:

- If an inheritance trigger has a bug, or opinions arrive out of timeline order, the ledger can
  diverge with **no simple "SELECT that defines truth" to rebuild from.** Classic drifted and needed
  periodic `rebuildCache` + cleanup scripts; the ledger risks the same failure mode at write time.
- The self-analysis in #30 flags **diamond inheritance, infinite loops, and write-amplification blast
  radius** — the *same class of problems* Classic's `moveChildren` + mutex faced. They are moved, not
  dissolved.
- **Winner-selection still has to live somewhere.** The trigger must implement the
  `reliability(basis) → pubyr → recency` ranking to decide "does this opinion supersede?" — i.e.
  Classic's `getMostRecentClassification`, now in PL/pgSQL, still needing one canonical definition.
- **The "inheritance" is Classic's junior-synonym borrowing made explicit.** The *Myliobatus →
  Myliobatis* inheritance is exactly Classic's `use_synonyms` behavior ("a `belongs to` opinion on a
  junior synonym may classify the senior name"), done eagerly at write time by cloning a row instead
  of lazily at read time. The hard cases are therefore *already known* from Classic, not hypothetical.
- **Mixing asserted and derived rows in one table is a smell.** An inherited row corresponds to *no
  opinion anyone entered about that taxon*. Classic kept `opinions` (asserted) physically separate
  from `taxa_tree_cache` (derived). Recommend an explicit `derived_from_opinion_id` / asserted-vs-
  inherited marker so "what did someone actually say" stays separable from "what did the system
  infer."

### 9.4 Proposed synthesis

The ledger and a canonical declarative derivation are **complementary, not either/or**:

> Define winner-selection as **one canonical function per opinion type** (name / assignment / rank),
> and have the trigger *call that function* to decide what to materialize. Keep a
> **recompute-from-opinions** path — even if it is not the hot path — as a rebuild tool, a test
> oracle, and a divergence check.

This preserves the ledger's real-time + provenance wins **without** its biggest risk (unrebuildable
drift). It also lines up with aazaff's own read of the alternatives:

- **Option 4 (materialized path), "on top of or parallel to" the ledger** — the nested-set
  replacement: store each taxon's classification path for O(1) ancestor reads, computed eagerly in
  the same trigger ("without the deferred aspect").
- **Option 5 (bi-temporal) — the genuinely unsolved case:** *retroactive opinions*. Entering an old,
  high-priority reference today means entry order ≠ publication-priority order, so the trigger cannot
  process linearly — it must walk back and re-materialize. A canonical recompute function turns that
  into a re-derivation rather than bespoke ledger surgery, which is exactly where linear walk-back
  gets fragile (diamond inheritance). aazaff's doubt — "not sure opinions can be grouped into
  temporal intervals of validity" — is the crux to resolve here.

**Net:** the Solution is well-aligned with §8 and stronger than the §8 sketch on opinion-splitting
and infrastructure reuse. The one substantive push: don't treat the ledger as the *sole* source of
truth — back it with a single canonical, rebuildable derivation so real-time materialization is an
optimization over defined truth, not a replacement for it. Otherwise the trigger system inherits
Classic's deepest failure mode (silent drift needing periodic repair), merely at write time instead
of nightly.

### 9.5 Making the ledger rebuildable: truth vs. materialization

The synthesis in §9.4 — "back the ledger with a single canonical, rebuildable derivation" — deserves
a concrete shape. The core move is a hard line between **truth** and **materialization**:

- **Truth** is a pure function of the opinion tables. Given the full set of opinions, there is
  exactly one correct answer to "what is the accepted name, parent, and rank of concept *P*?" That
  function reads **only** the opinion tables (+ `refs` for pubyr). It never reads the `taxa`
  ledger.
- **Materialization** is the `taxa` ledger — a *stored copy* of that function's output so reads are
  O(1).

The #30 Solution collapses the two (the ledger *is* the truth, patched incrementally). This synthesis
keeps them separate and has the incremental path and the rebuild path **call the same function**.

#### 9.5.1 Two levels of identity (read this first)

> **Superseded by §9.8 (the identity inversion).** This subsection sets `permid` = the *name-lineage*
> (original combination). The committed model instead sets `permid` = a *name-as-spelled* and derives
> the name-lineage. Read this for the reasoning about the two identity levels; read §9.8 for what is
> actually built.

The word "concept" is the slipperiest thing in the whole problem, so nail down the two distinct
identities before anything else:

| Identity | What it is | Stored? | Classic analog |
|---|---|---|---|
| **Name-lineage** = `permid` | one original name across all its spellings/corrections/rank-changes; what opinions attach to | **stored, stable** | `child_no` (original combination); accepted spelling within it ≈ `spelling_no` |
| **Concept** = `concept_permid` | the set of name-lineages currently considered the same taxon (senior name + junior synonyms + their misspellings) | **derived, unstable** — recomputed every `derive()` | `synonym_no` (accepted spelling of the senior synonym) |

`concept_permid` is **not** an asserted (Layer-1) column and **not** human-assigned — it is
materialized in the `taxa` ledger (Layer 3) as derived output. Its value is a **pointer, not an SQL
foreign key**: it holds the `permid` of the senior-most name, dereferenced to that succession's head
(`succeeded_by_id IS NULL`). There is deliberately **no permid registry table** to FK against —
validity is guaranteed by construction (the trigger writes only permids the opinions reference) and
re-checked by the `derive(all)` invariant (§9.5.5), consistent with the truth-vs-materialization
split. As an *equivalence-class label* it is produced by the union-find over the winning synonymy &
misspelling opinions, using the permid of the senior-most name. It changes whenever a synonymy opinion
changes (rule *Myliobatus* a synonym of *Myliobatis* and two permids collapse into one concept;
reverse it and they split). This keeps us consistent with the #30 decision to reject an Explicit
Bridge Table: concepts are **emergent from data lineage**, not a persistent curated namespace.
`permid` is truth-*input*; `concept_permid` is truth-*output*.

#### 9.5.2 Three layers

> **Revised by §9.8.** The three-layer split (assertions → derive() → ledger) stands unchanged and is
> the heart of the design. Two specifics below are superseded: `rank_opinions` no longer exists (rank
> rides the minting `name_opinions` row), and the winner `ORDER BY` in step 2 drops its `synthesized`
> first key. `permid` throughout should be read as the name-as-spelled, with the name-lineage derived.

- **Layer 1 — Assertions (append-only):** `name_opinions`, `assignment_opinions`,
  `rank_opinions`. Each row *references* name-lineage `permid`s (`subject_permid` and its targets)
  and also carries **its own** `permid` identifying the opinion across transcription corrections —
  versioned, but without the version triggers, see §9.5.2.1. A retraction or a disagreement is a
  later *opinion*; only a mistyped record becomes a new *version*.
- **Layer 2 — The derivation (one canonical function):**
  ```
  taxonomy.derive(permids := all) → rows of
    (permid, accepted_name_id, accepted_name, rank,
     concept_permid, containing_concept_permid, classification_path,
     winning_name_opinion_id, winning_assignment_opinion_id, winning_rank_opinion_id)
  ```
  Pure over Layer 1, a small fixpoint:
  1. **Concept grouping** — union-find/connected components over the *winning* synonymy & misspelling
     `name_opinions`; pick the senior representative as `concept_permid`. (This does the job Classic's
     `orig_no` and the ledger's `permid` do for *validity*, but computed, not stored.)
  2. **Winner per dimension** — one winning opinion per group via `DISTINCT ON`, e.g.
     ```sql
     SELECT DISTINCT ON (subject_permid) subject_permid, containing_permid, opinion_id
     FROM assignment_opinions a JOIN refs r USING (reference_id)
     ORDER BY subject_permid,
              a.synthesized ASC,                 -- real opinions outrank synthesized ones
              a.evidence DESC,                   -- stated with evidence, true before false
              COALESCE(a.pubyr, r.pubyr) DESC,
              opinion_id DESC;
     ```
     That single ORDER BY *is* Classic's `getMostRecentClassification`, in one place instead of
     smeared across SQL + Perl.

     **`evidence` is a boolean, not a graded enum.** This is a deliberate pbdb2 simplification of
     Classic's 5-value `basis` (§4.2), and it is what `create_new.sql` always specified
     (`evidence boolean NOT NULL`): **`stated with evidence` → `true`, everything else — `stated
     without evidence`, `implied`, `second hand`, and `NULL` — → `false`.** Three consequences
     worth stating once, here, since they propagate:

     - **No `reliability_rank()` mapping and no evidence dictionary table.** The first sort key is
       the column itself. Classic's special-cased reference 6930 (pinned to reliability 0) simply
       becomes `false` and needs no home.
     - **No read-time fallback to the reference.** Classic falls back to `refs.basis` when an
       opinion's basis is NULL; pbdb2's `refs` has **no basis field at all**, so there is nothing
       to fall back to. The fallback is resolved once, at migration time, into a `NOT NULL`
       boolean (§10.5). This also removes evidence from the list of reasons `derive()` must join
       `refs`.
     - **`synthesized` becomes the first sort key.** A boolean leaves no room *below* `false` for
       the migration floor, so the floor moves to its own column rather than being smuggled in as
       a reliability level — which is the better factoring regardless: "is this a real published
       statement?" and "how good is its evidence?" are independent questions (§10.5, constraint 1).

     The cost is real and accepted: the `implied` / `second hand` / `stated without evidence`
     distinction is **not recoverable** in pbdb2. With three of the four levels collapsed, `pubyr`
     does correspondingly more of the ranking work.

  3. **Junior-synonym borrowing** — resolve each concept's assignment by gathering `belongs to`
     opinions across *all permids in the concept*, not just the senior one. This is #30's "inheritance"
     (Time Step 4) expressed as a `WHERE permid IN (concept members)`, not a row-cloning trigger.
  4. **Containing → concept resolution**, plus optional **materialized classification path** (Option 4)
     as an `ltree`/array so ancestor reads never recurse.
- **Layer 3 — The ledger (materialized output):** `taxa`, versioned by the existing
  `permid` + `preceded_by_id`/`succeeded_by_id` machinery. Append a new version **only when
  `derive()`'s output for a permid differs from the current head.** Store which opinions won
  (provenance) and an explicit `derived` / `asserted_opinion_id` marker so inherited state stays
  distinguishable from directly-entered state.

#### 9.5.2.1 Layer 1 is versioned — but without the version triggers

*Revised 2026-07-27. This section previously argued that Layer 1 should **not** be versioned, and
handed data-entry corrections to `modifier_person_id` / `modified_at` audit columns. Those columns
were Classic artifacts and have been removed, which took the old answer with them. The revised
position: the opinion tables **do** carry `permid` + `preceded_by_id`/`succeeded_by_id`, and
deliberately **do not** call `install_version_triggers()`.*

**What the succession chain means here.** Not changes of belief — corrections of transcription. The
distinction is real and the schema now expresses it, where before it was only a convention:

| The curator... | Records it as | Because |
|---|---|---|
| mistyped `pubyr` as 1890 for 1990 | a **new version of the same opinion** (same `permid`) | the record was wrong; Smith 1990 never said 1890 |
| disagrees with what an opinion concludes | a **new opinion** (new `permid`) | the literature moved; `derive()`'s ranking settles it |

That distinction is why versioning does not "encode supersession twice." Supersession between
*rival* opinions is `derive()`'s ranking job and stays there. The succession chain never competes
with it, because a superseded version is not visible to `derive()` at all — it filters
`WHERE removed IS NOT TRUE AND succeeded_by_id IS NULL`.

**Why no triggers — the load-bearing part.** `install_version_triggers()` would be actively harmful
on these six tables, for one specific reason. `handle_new_version()`
(`postgresql/create_new.sql:4318`) swings inbound foreign keys to the new version, and **every**
inbound FK to an opinion row is one of `taxa.winning_*_opinion_id`. Those are not assertions — they
are *derived provenance*, part of `derive()`'s output, and must be whatever `derive()` computed.
Swinging them would do two bad things:

1. **Write to the ledger outside `derive()`** — an in-place `UPDATE` of a `taxa` head, rather than
   the diff-and-append the whole Layer 2/3 split exists to protect.
2. **Falsify history** — every past `taxa` version would suddenly cite the *corrected* opinion, as
   though the system had always held the right data. Not swinging is the truthful behaviour: an old
   ledger version keeps pointing at the opinion row **as it then read**, which is precisely the
   provenance claim it is making.

So FK swinging is not a rule with an exception here; it is a rule about *asserted* references being
misapplied to a *derived* one. Suppressing it in the trigger machinery would work, but not calling
the machinery at all is simpler and needs no change to shared code: the write path sets
`preceded_by_id`/`succeeded_by_id` directly.

**What this buys, beyond corrections.** A correction is an `INSERT` of a new version, so it flows
through the *existing* `AFTER STATEMENT` trigger — `dependency_closure` → `derive()` → append —
exactly like a brand-new opinion. There is no separate correction code path to write or test. And
bulk migration inserts skip `place_in_lineage()` entirely, since every migrated opinion is version 1
with both pointers `NULL`, avoiding the per-row head lookup that stalled the collections migration.

**The temporal objection, and why it does not bite.** The earlier draft argued that versioning
Layer 1 adds a third time axis on top of valid-time (`pubyr`) and transaction-time (ledger order),
degrading the §9.5.5 invariant from `derive(all) ≡ {heads}` to `derive(all, as_of) ≡ heads(as_of)`.
That was overstated. Because `derive()` reads **only opinion heads**, the invariant stays two-state:

```
derive(opinion heads)  ≡  { current ledger heads }
```

A third axis would only materialize if something required *cross-layer time travel* — reconstructing
what `derive()` would have produced from the opinion set as it read last Tuesday. Nothing does: the
`taxa` ledger already records what was believed and when. The cost that is real is narrower — a
`succeeded_by_id IS NULL` predicate on Layer 1 reads in `derive()` and `dependency_closure`, backed
by the partial head indexes.

**One consequence for the index discipline.** Because these tables skip
`install_version_triggers()`, they do not get its automatic `permid` head index. The draft DDL
hand-creates all five (post-inversion: `name` / `assignment` / `validity` / `type` / `trait`; there is
no `rank_opinions` — §9.8). This is the one place in the schema where hand-creating that index is correct
rather than a mistake, and it is not optional — it is the same lookup whose absence degraded the
collections migration to O(n²).

**Summary of where versioning does and does not go:**

| Table | Versioned? | Triggers? | Why |
|---|---|---|---|
| Layer 1 opinion tables | **yes** | **no** | chain records transcription corrections; FK swinging would corrupt derived provenance |
| `taxa` (Layer 3 ledger) | **yes** | yes | this *is* the provenance story — reconstruct the tree at any past instant (§9.2) |
| curatorial annotation (common name, comments, discussion) | **yes** | yes | authored prose; an edit is a genuine change of content |
| homonym records | no | — | a lookup of a data-level fact, not an assertion |

#### 9.5.3 Two sync paths, one function

```
opinion INSERT
  └─ AFTER STATEMENT trigger
       └─ affected := dependency_closure(inserted opinions)
       └─ derive(affected)            ← the canonical function
       └─ append taxa versions where output ≠ current head      (hot path)

rebuild() / migration / recovery
       └─ derive(all)                 ← the SAME function
       └─ reload or diff the ledger                             (cold path)
```

The trigger shrinks to *"compute affected permids → call `derive` → diff → append."* The bespoke
logic in #30 — the Time Step 6 walk-back, the reversal, diamond handling — **lives nowhere**, because
you never *undo* a row: you recompute the concept from the full opinion set and append the result.

#### 9.5.4 Why the hard cases dissolve

**Reversal** (#30 Time Step 5/6 — a new opinion says *Myliobatus* is *not* a misspelling of
*Myliobatis*):

- *#30's ledger:* set `accepted = TRUE` on a new *Myliobatus* row, then a second trigger walks
  `preceded_by` back through *Myliobatis*'s history to find "the last entry not associated with
  opinions on *Myliobatus*" and appends the reverted row. Bespoke, and it breaks under diamond
  inheritance.
- *Recompute model:* insert the new `name_opinion`; call `derive(Myliobatis, Myliobatus)`. Concept
  grouping no longer merges the two; each concept's winner is recomputed; *Myliobatis* loses the
  borrowed *Aetobatidae* assignment because the borrowing rule no longer sees *Myliobatus* as a
  synonym. A new head is appended. **No walk-back, no diamond special-case** — re-derivation produces
  the reverted state as a side effect of being correct.

**Retroactive opinions** (aazaff's bi-temporal worry) fall out the same way. Entering an old,
high-priority reference today: `derive()` ranks by `basis/pubyr`, *not* entry order, so it wins or
loses on merit and the ledger gets the right new head. No "group opinions into intervals of validity"
is needed — you don't group, you rank, and re-rank on every recompute. That is the clean bi-temporal
split: **valid-time** = publication priority (drives `derive`), **transaction-time** = ledger insert
order (pure audit).

#### 9.5.5 The invariant that makes it robust

Because one function defines truth *and* drives the hot path:

```
derive(all)  ≡  { current ledger heads }
```

Run it in CI, post-import, or nightly. If the incremental trigger ever drifts (bug, race, odd import
order), the check catches it and `rebuild()` repairs it. This is what Classic never had: its rebuild
*was* its definition, and it disagreed with the daemon and the lazy read-writes, so drift was silent
and permanent. Here there is **one definition, three ways to apply it, provably equal.**

#### 9.5.6 Honest caveats

- **`dependency_closure` scoping** affects performance, not correctness — a synonymy edge can merge
  concepts and re-parent children, so the affected set ripples. Over-scoping is *correctness*-harmless
  (the diff step discards unchanged permids) and `derive(all)` is always available as the ultimate
  fallback — but **"correctness-harmless" is not "compute-harmless."** For a heavily-used system the
  cost of a loose closure and per-opinion re-derivation is real; treat `derive(all)` as a recovery/CI
  safety net, not a steady-state path, and see **§9.7** for the cost drivers and burst-handling
  strategy. (Contrast #30, where a trigger scoping bug = wrong *data*, not just wasted time.)
- **`derive()` must be total and deterministic** — define tie-breaks explicitly and handle cycles
  (A synonym-of B, B synonym-of A) in this one place. One cycle handler instead of Classic's
  loop-breaking scattered through `moveChildren`/`getSeniorSynonym`.
- **Write amplification is reduced, not eliminated** — a high-level revision still touches many
  descendants, but you append only where the derived output *changes*; no-op opinion edits produce no
  rows, killing much of Classic's churn.

**One-line version:** keep #30's ledger and triggers for the read/audit story, but make the trigger
body a thin wrapper that calls `derive()` and appends the diff — where `derive()`, a pure function of
the opinions, is the single definition of truth shared by both the hot path and the rebuild path.

### 9.6 Design walkthrough: the API contract, column vocabulary, and `dependency_closure`

*This section records the concrete design discussion behind §9.5 — the read/write API surface, the
column names, and the one piece §9.5 left as a sketch (`dependency_closure`). The DDL here is a
**strawman** to make the shapes discussable, not a finalized schema.*

#### 9.6.1 Column vocabulary — three relationships kept apart

> **Extended by §9.8.** The three-relationship vocabulary (succession / concept / classification)
> stands. Under the inversion, `senior_permid` generalizes to `target_permid` (concept target for
> synonymy edges, form-of target for lineage edges), `subject_permid` denotes a spelling rather than a
> lineage, and a fourth *derived* grouping — the name-lineage (`original_permid`) — joins the concept.

The model has three structurally different relationships, and Classic overloaded "parent" / "lineage"
across all of them. pbdb2 names each for what it *is*:

| Relationship | Connects | Direction | Column(s) | Classic's overloaded term |
|---|---|---|---|---|
| **Succession** | versions/spellings of one name | temporal | `preceded_by_id` / `succeeded_by_id` | `preceded_by` |
| **Concept** (synonymy) | permids judged the same taxon | lateral | `concept_permid`; `senior_permid` in `name_opinions` | `synonym_no` |
| **Classification** (containment) | a taxon and its containing higher taxon | vertical | `containing_permid` (opinions) → `containing_concept_permid` (ledger); ancestry in `classification_path` | `parent_no` / `belongs to` |

Deliberate choices:

- **`subject_permid`** ("the taxon this opinion is *about*") replaces Classic's `child_no`, dropping the
  child/parent framing that the split into typed opinion tables makes unnecessary.
- **`containing_*`** (not "parent") for the classification edge — rank containment is **not**
  evolutionary ancestry; a family *contains* a genus, it is not its ancestor. "Parent" quietly implies
  descent, which this edge does not assert.
- **`senior_permid`** — the standard nomenclatural term for a synonymy/misspelling target, clearer than
  "parent" for a *lateral* edge.
- **`classification_path`** (not `lineage_path`) — "lineage" is already spoken for by *name-lineage*
  (`permid` across spellings); this column is the ancestry path *in the classification tree*, a
  different thing.
- Opinions point at bare **permids** (`containing_permid`, `senior_permid`); the ledger points at
  **concepts** (`containing_concept_permid`). Concept resolution is `derive()`'s job, not the asserter's
  — an intentional asymmetry between Layer 1 and Layer 3.

#### 9.6.2 Assumed table shapes (strawman)

```sql
-- Layer 1: append-only assertions. Targets are permids (name-lineages), not concepts.
assignment_opinions(opinion_id, subject_permid, containing_permid, evidence, pubyr, reference_id)
name_opinions      (opinion_id, subject_permid, senior_permid, kind, evidence, pubyr, reference_id)
                   -- kind ∈ synonym / misspelling / replacement …
rank_opinions      (opinion_id, subject_permid, rank, evidence, pubyr, reference_id)

-- Layer 3: the ledger. One row per (permid, version); head = succeeded_by_id IS NULL.
-- concept_permid / containing_concept_permid / classification_path are concept-level, so all
-- members of a concept carry equal values. Each is a pointer to a succession head, not an SQL FK.
taxa(permid,
     concept_permid,               -- senior rep of this permid's concept (self, if senior)
     containing_concept_permid,    -- senior rep of the containing (higher) concept
     classification_path,          -- ltree of concept_permids, root → node
     preceded_by_id, succeeded_by_id, …)
```

#### 9.6.3 The API contract: what writes, what reads

- **POST an opinion** → the write touches **only** the relevant Layer-1 table
  (`assignment_opinions` / `name_opinions` / `rank_opinions`). Nothing writes `taxa` directly; even a
  retraction is a later opinion appended, never an update/delete.
- **The insert fires an `AFTER STATEMENT` trigger** → `dependency_closure` computes the affected
  permids → `derive()` recomputes them → the trigger appends a new `taxa` version **only where
  `derive()`'s output differs from the current head.**
- **GET a taxon** → reads the current `taxa` **head** (`succeeded_by_id IS NULL`). O(1), no ranking
  recomputation, no read-path writes, no `tc_mutex`. Reads never touch the opinion tables.

```
POST /opinions ─▶ INSERT into *_opinions            (assertions; the only direct write)
                    └─ AFTER STATEMENT trigger
                         └─ affected := dependency_closure(new rows)
                         └─ derive(affected)         ← canonical pure function (§9.5.2)
                         └─ append taxa heads where output ≠ current head

GET /taxa/:id  ─▶ SELECT … FROM taxa WHERE permid = :id AND succeeded_by_id IS NULL
```

#### 9.6.4 `dependency_closure` — the one piece §9.5 left as a sketch

**Contract:** return a **superset** of the permids whose `derive()` output could change. Under-scoping
= silently stale heads (not allowed); over-scoping = wasted CPU (harmless — the diff step discards
unchanged permids). The maximal safe answer is always `derive(all)`; the closure just makes the hot
path cheaper when it can prove the rest is untouched.

**Shape of the ripple** — asymmetric: **lateral** (across a concept) and **downward** (to descendants),
never **upward**. A containing taxon's derived output doesn't depend on what it contains, so an opinion
never dirties an ancestor. Starting from the permids the opinion names, expand along:

1. **Concept-lateral** — add every permid in the same concept as each seed. Winner selection *pools
   opinions across all members of a concept* (junior-synonym borrowing, §9.5.2 step 3), so an opinion
   on one member can change the concept's winner.
2. **Downward (tree)** — add all descendant concepts, transitively. If the concept's containing edge
   changes, every descendant's `classification_path` changes.
3. **Merge/split (`name_opinions` only)** — a synonymy opinion links `subject_permid` to
   `senior_permid`, merging (or, reversed, splitting) two concepts. Seed **both** whole concepts, then
   their descendants.
4. **The superseded version, when the insert is a correction** (added 2026-07-27, with Layer 1
   versioning — §9.5.2.1). A correction arrives as a new *version*, so the closure seeds from the
   permids the **new** row names. But if the correction changed which permids the opinion names — a
   curator filed it under the wrong taxon and fixed `subject_permid` from A to B — then B *gains* an
   opinion and is seeded, while **A silently loses one and is not**. A is left with a stale head,
   which the closure contract forbids. So when `preceded_by_id IS NOT NULL`, seed the superseded
   row's permids as well as the new one's. This costs nothing in the common case, where the two sets
   are identical and the union collapses.

**Chicken-and-egg:** concept grouping and the tree are themselves `derive()` *outputs*, but the closure
needs them as *inputs*. Resolve by scoping against the **pre-insert** ledger heads — the state the new
opinion perturbs. Any imprecision only over-includes, which the contract permits.

Because `classification_path` is materialized (Option 4), "all descendants" is a single `ltree` prefix
predicate, not a recursive walk:

```sql
WITH
-- head-only view of the ledger (current beliefs)
head AS (
  SELECT permid, concept_permid, classification_path
  FROM taxa
  WHERE succeeded_by_id IS NULL
),

-- every permid named by the inserted opinions (both sides of each edge)
seed AS (
  SELECT subject_permid   AS permid FROM new_assignment_opinions
  UNION SELECT containing_permid    FROM new_assignment_opinions
  UNION SELECT subject_permid       FROM new_name_opinions
  UNION SELECT senior_permid        FROM new_name_opinions   -- both sides = the merge/split case
  UNION SELECT subject_permid       FROM new_rank_opinions
  -- ...plus the same columns from the rows the inserts SUPERSEDE, joined via
  -- new_*.preceded_by_id, so a correction that moved subject_permid off some
  -- taxon still re-derives the taxon it was moved off. See ripple rule 4.
),

-- 1. LATERAL: map each seed to its current concept (pre-insert grouping)
seed_concepts AS (
  SELECT DISTINCT h.concept_permid, h.classification_path
  FROM head h
  JOIN seed s ON s.permid = h.permid
),

-- 2. concept members: every permid in an affected concept (winner is pooled per concept)
concept_members AS (
  SELECT h.permid
  FROM head h
  JOIN seed_concepts sc ON h.concept_permid = sc.concept_permid
),

-- 3. DOWNWARD: every permid whose classification path passes through an affected concept.
--    ltree: (a <@ b) ⇔ a is a descendant of b. Non-recursive because the path is materialized.
descendants AS (
  SELECT h.permid
  FROM head h
  JOIN seed_concepts sc ON h.classification_path <@ sc.classification_path
)

SELECT permid FROM seed            -- singleton fallback: brand-new permids not yet in `taxa`
UNION
SELECT permid FROM concept_members
UNION
SELECT permid FROM descendants;
```

Drop the materialized path and step 3 becomes a `WITH RECURSIVE` walk down `containing_concept_permid`
— which is exactly why Option 4 exists.

#### 9.6.5 Worked example — the *Myliobatus* case

Insert a `name_opinion`: *Myliobatus* is a misspelling / junior synonym of *Myliobatis*
(`subject_permid = Myliobatus`, `senior_permid = Myliobatis`).

1. **Seed** = `{Myliobatus, Myliobatis}` (both sides of the edge).
2. **Concept-lateral** — pull in each one's current concept: *Myliobatis* + its existing
   synonyms/misspellings, and *Myliobatus* + any of its own.
3. **Merge** — both concepts, since they are about to fuse.
4. **Downward** — every concept currently classified under either, because if the merged *Myliobatis*
   concept borrows *Myliobatus*'s `containing = Aetobatidae` assignment, the whole subtree's
   `classification_path` shifts.

`derive()` runs on just that set, appends new `taxa` heads where output changed, and leaves the rest
untouched. **Reversal** (a later opinion says *Myliobatus* is *not* a misspelling) needs no walk-back:
re-run `derive(Myliobatis, Myliobatus)`, concept grouping no longer merges them, and the reverted state
falls out as a side effect of being correct (§9.5.4).

#### 9.6.6 Status

This is a strawman for discussion, **not committed schema.** Open dependencies before it becomes real:
the `taxa` ledger DDL (`concept_permid` / `containing_concept_permid` / `classification_path` + the
`preceded_by_id`/`succeeded_by_id` versioning columns) and confirming the strictly downward+lateral
propagation invariant that lets `dependency_closure` avoid chasing ancestors. (The third item listed
here originally — a `reliability_rank(evidence)` mapping — is moot: `evidence` is a boolean, so the
first sort key is the column itself. See §9.5.2 step 2.)

**Superseded in part.** The table shapes sketched in §9.6.2 are replaced by
`postgresql/taxa-opinions-draft.sql` (see §10), which resolves those open dependencies and adds the
tables this section did not anticipate — `validity_opinions`, `type_opinions`, `trait_opinions`. The
§9.6.1 column vocabulary and the §9.6.4 `dependency_closure` treatment stand unchanged.

### 9.7 Performance under bursty load

*Prompted by aazaff's concern: "I am worried Claude is being too blasé about the compute consequences
of over-inclusion. This will be a much more heavily used system than others we have made in the past.
It won't be unusual, for example, to see 20 opinions updated in rapid succession that synonymize 20
different species together." The concern is fair, and this section is the correction.*

#### 9.7.1 The framing error to avoid

Earlier drafts said over-inclusion "only costs time." That conflates two different claims:

- **Correctness-harmless** (true): a looser `dependency_closure` never produces wrong data — the diff
  step discards permids whose `derive()` output didn't change.
- **Compute-harmless** (false): a loose closure and per-opinion re-derivation cost real CPU, writes,
  and lock time. Under heavy, bursty use that cost is the binding constraint.

So `derive(all)` is a **recovery/CI safety net, not an acceptable steady-state path**, and closure
tightness is a performance parameter to engineer, not a detail to wave off.

#### 9.7.2 Where the cost actually lives (it is not uniform)

| # | Cost driver | Notes |
|---|---|---|
| 1 | **Per-opinion trigger repetition** | 20 related opinions in 20 statements → 20 closures + 20 `derive()` calls over heavily-overlapping sets. The biggest *avoidable* waste. |
| 2 | **O(n²) on incremental merges** | If 20 species collapse into one concept, opinion *k* re-derives a *k*-member concept → O(n²). At n=20 it's ~200 member-evals (trivial, sub-ms); the point is the **pattern**, which at a genus revision (hundreds of species), fired repeatedly and concurrently, is where it bites. |
| 3 | **Descendant blast radius — rank-dependent, partly irreducible** | Species synonymy is cheap (leaves, ~no descendants). *High-rank* reassignment rewrites every descendant's `classification_path` — real cost **even with a minimal closure**. Cost is not per-opinion-uniform; scheduling should be rank-aware. |
| 4 | **Path-materialization writes** | Stored `classification_path` means a high-node reparent rewrites O(subtree) rows — Classic's `moveChildren` shape, minus the global `lft/rgt` renumber. The lever: materialize the path, or keep adjacency-only and compute ancestors on read (recursive CTE)? A read/write-ratio decision. |
| 5 | **Lock contention** | "Rapid succession" + concurrency is Classic's `tc_mutex` failure mode. Granularity is everything: per-concept / per-subtree locks, **never** a global one. |

aazaff's 20-species example is cheap in absolute terms but is the correct *illustration of a pattern*
that scales badly at high rank / high concurrency. That is the real point, and it stands.

#### 9.7.3 Mitigations, in order of leverage

- **A. Coalesce bursts (the direct answer).** Don't fire a full `derive()` per opinion. Stage opinions
  in a dirty-set/queue and let a short-debounced worker process the backlog with **one** `derive()`
  over the *union* of affected permids. Collapses 20 triggers → 1, and O(n²) → O(n). **This is safe in
  a way it never was in Classic**: because truth is a pure function and reads always serve the last
  committed head, deferring/coalescing materialization cannot corrupt anything — worst case a read is a
  second stale. This is Classic's daemon-style batching *without* the read-path writes or
  correctness-by-ritual. The pure-function/ledger split is what *enables* it.
- **B. Tight closures as the default**, over-inclusion only when tightness can't be proven; `derive(all)`
  reserved for recovery/CI.
- **C. Rank-aware scheduling** — cheap leaf ops inline; high-blast-radius (high-rank) ops batched /
  backgrounded / rate-limited.
- **D. Revisit path materialization vs. adjacency+recursive-CTE** once the read/write ratio is known.
- **E. Fine-grained locking** on the concept/subtree, plus append-with-retry on conflict. (Or sidestep
  it entirely at first with a single-writer worker — see §9.7.4.)

#### 9.7.4 What to settle now vs. defer

The key architectural test is reversible-vs-irreversible: **a mitigation is safe to defer only if
adding it later is a localized change, not a rewrite.** By that test almost every mitigation is
"later" — *provided* a few "now" invariants keep the seams in the right place. We do not need to
*solve* burst performance now; we need to not *preclude* solving it.

**Defer until real behavior is known:**

| Mitigation | Why it defers cleanly |
|---|---|
| Burst coalescing / batching | A scheduling swap over `derive()`: replace "sync per-statement" with "enqueue + debounced worker". Touches the trigger + a queue table; nothing in truth. |
| Tightening the closure | Start generous (even `derive(all)` at low volume), tighten as hot paths appear. Superset contract holds throughout. |
| Rank-aware throttling | Pure policy on top of the queue. |
| Parallel workers / fine locking | Start single-writer (one worker draining the queue → no concurrent `derive`, no fine locks). Add parallelism only if the single writer can't keep up. |

**Settle now — the load-bearing invariants that *purchase* the deferability above:**

1. **`derive()` is pure and parameterizable over an arbitrary permid subset** — never baked into
   imperative trigger logic, never only `derive(all)`. This is what makes closures tightenable and
   batching insertable. If derivation lives *inside* the trigger (#30 style), every mitigation becomes
   a core rewrite.
2. **Truth/materialization separation is real** — the trigger is a thin wrapper; `taxa` is materialized
   *output*. This seam lets materialization slide sync → async → batched without touching correctness.
3. **The read-consistency contract permits bounded staleness** — the *only* externally-visible
   now-decision, because it is a promise to API consumers and expensive to walk back. Even if the first
   implementation is synchronous, **document reads as allowed-to-lag** so nobody builds on synchronous
   assumptions. The weak promise costs nothing now and preserves the most freedom; the strong promise
   ("a GET always reflects the just-committed opinion") is the choice that would later *forbid* batching.
4. **Adjacency (`containing_concept_permid`) is primary; `classification_path` is an explicitly
   *derived* materialization**, not primary state. Keep that discipline and the path can be added,
   reshaped, or dropped later as a cache change. Make it primary/load-bearing and reversing it becomes a
   migration over every row and every read query (the nested-set trap again).

**Net for aazaff:** build the simplest correct thing first — quite possibly synchronous per-statement
`derive()` — measure it against the real workload, and add coalescing/throttling when the numbers
justify. That is not blasé; it defers the *tuning* while committing now only to the four seams that
keep the tuning cheap. The genuine risk is not "we didn't optimize early" — it is "we let derivation
leak into the trigger, or made the path primary, and now the optimization is a rewrite." So the
now-work is small but not zero: **guard invariants 1, 2, and 4 with discipline, and choose the weak
consistency promise in 3.**

#### 9.7.5 Numbers needed to size this

The right operating point depends on data we don't yet have: typical and p99 **burst size**, the
**read/write ratio**, **write concurrency** (curators editing at once), and the **latency SLA** — how
soon must a GET reflect a just-entered opinion? If "a few seconds late" is acceptable, coalescing (A)
is trivially the answer and most of the concern dissolves; if reads must be synchronously consistent
with writes, the tradeoffs sharpen. Worth getting these figures from aazaff before tuning.

---

## 9.8 The identity inversion — `permid` = name-as-spelled (the committed model)

*Decided in session, 2026-07-29. §9.5.1 chose `permid` = the **original combination** (a name-lineage
spanning all its spellings), with rank split into its own `rank_opinions` contest. That choice made
rank and spelling two independent rankings that could disagree, and — because every spelling of a
lineage inherits the same naming year — gave the rank contest nothing to rank on. This section
**inverts** the identity to dissolve that problem, and supersedes the parts of §9.5.1, §9.5.2, and
§9.6 that assume `permid` = lineage. It is the current target design; the earlier sections are kept
for the reasoning that led here.*

### 9.8.1 One stored identity, two derived groupings

`permid` now means a **name-as-spelled** — Classic's `taxon_no`, one per legacy `authorities` row
(~517K). The migration **ignores `orig_no` entirely**; the name-lineage and the concept are both
*derived*.

| Level | Meaning | Classic | Stored? |
|---|---|---|---|
| **name-as-spelled** = `permid` | one spelling, one rank | `taxon_no` | **stored, stable** |
| **name-lineage** | spellings/rank-forms of one name | `orig_no` | **derived** (union-find over `lineage`-class edges); root = `original_permid` |
| **concept** | names judged the same taxon | `synonym_no` | **derived** (union-find over `concept`-class edges) |

The load-bearing consequence: **`name` and `rank` are immutable attributes of a `permid`.**
*Acervoschwagerina* is genus forever; *Paraschwagerina (Acervoschwagerina)* is subgenus forever. A
respelling or rank change does not mutate a permid — it introduces a **different** permid. Re-derivation
never touches name/rank; it only moves the *pointers* (accepted spelling, concept, containment).

### 9.8.2 `name_opinions` are typed edges; rank rides the permid

A `name_opinions` row is an **edge** `subject_permid → target_permid` with a `reason_id` whose
`edge_class` selects the union-find it feeds:

- **`lineage`** (`correction`, `reranked`, `recombination`, `assignment`/reassignment, `misspelling`) —
  subject is a spelling/rank *form of* target; groups the name-lineage.
- **`concept`** (`subjective synonym`, `objective synonym`, `replaced by`, `junior synonym`) — subject's
  name is the same *taxon* as target's; groups the concept.
- **`original`** is the root: it mints a permid, has no target, `edge_class` NULL.

A permid is **minted** by the row that first introduces it as subject (`original`, or a `lineage`
reason for a spelling introduced as a form of an earlier one). That minting row carries the permid's
immutable identity — `new_name`, **`rank_id`**, and the naming-act provenance (`authority_id`, `pages`,
`figures`). This is exactly where correction 1 lands: `authorities.taxon_rank` is the definitive rank of
*that* name, inherited with the row's `reference_id` / `attribution` / `pubyr`.

Two things therefore **leave the design**:

- **`rank_opinions` and the ~998K rank fan-out (old open call B): gone.** Rank is not a contest; it is
  an attribute. The accepted rank is the rank of the accepted spelling — precisely how Classic reads it
  off the winning spelling's `authorities` row.
- **`synthesized`: gone** from every table (correction 2). An authorities-sourced opinion is a *real*
  opinion carrying the row's real reference/pubyr and `evidence = false`, so it sits near the bottom of
  the ranking by construction and wins only when nothing else exists — which is the whole job of a
  genesis assertion. The floor flag was solving a problem that only existed while these opinions were
  imagined as fakes.

### 9.8.3 The ledger: one row per permid, the identity triad

`taxa` is one row per permid, so it is **1:1 with `taxa_tree_cache`** (also keyed per `taxon_no`) and the
§10.5 step-5 validation becomes a row-for-row diff. Each row carries the derived triad, every member of
a grouping sharing equal values:

| Ledger column | Meaning | self-equality test | Classic |
|---|---|---|---|
| `original_permid` | stable name-lineage root | `= permid` ⇔ this is the original spelling | `orig_no` |
| `accepted_spelling_permid` | accepted spelling of this lineage | `= permid` ⇔ this is the accepted spelling | `spelling_no` |
| `concept_permid` | accepted spelling of the senior synonym | `= permid` ⇔ this is the concept's accepted name | `synonym_no` |

Those three equalities do the whole job of the old `accepted` boolean (§10.4) with no extra column.
`name`/`rank_id` are denormalized from the minting opinion for read convenience and never change.

**Why version a materialized table, and what swings.** The current heads are a rebuildable cache (the
§9.5.5 invariant `derive(all) ≡ {heads}`); the version *chain* is not — it is the append-only,
transaction-time record of what was believed, when, and which opinions won. That is what keeps
`derive()` a present-tense function (no cross-layer "re-derive as-of" time travel, §9.5.2.1) and is the
concrete mechanism behind §9.2's "reconstruct the tree at any past instant"; a from-scratch `rebuild()`
reproduces only the current heads, so the chain is genuine operational history, not derived redundancy.
Appending a version **swings no keys**: every cross-reference in the subsystem is a `permid` pointer
resolved to the current head, *not* an FK to `taxa.id` — the only FKs to `taxa.id` are `taxa`'s own
succession pointers, which are extended, not swung. So `handle_new_version()`'s FK-swing is inert here,
which is exactly the payoff of pointing at `permid` rather than row `id` (contrast the superseded
`taxon_id`-FK block, which would have had to repoint every opinion on every belief change). Full
rationale is in the DDL comment at `install_version_triggers('taxa')`.

### 9.8.4 `derive()` — two union-finds, ordered, two scopes

```
derive(permids):
  1. LINEAGE union-find  over lineage-class name edges → lineages; root = original_permid
  2. CONCEPT  union-find over concept-class name edges → concepts; pick SENIOR lineage per concept
  3. ACCEPTED SPELLING per lineage = subject of the lineage's top-ranked opinion
        (excluding never_accepted misspellings), by
           ORDER BY evidence DESC, COALESCE(pubyr, ref.pubyr) DESC, id DESC
     → accepted rank rides along (= that permid's rank_id)          ← no rank contest
  4. concept_permid := accepted_spelling_permid of the concept's SENIOR lineage
  5. CLASSIFICATION: winning assignment, pooled across the WHOLE concept → containing_concept_permid;
     then classification_path
```

Two subtleties are load-bearing and easy to get wrong in a single-pass implementation:

- **Ordering (step 2 before step 3).** The accepted name of a concept must be a spelling of the
  **senior** lineage, so seniority is decided first and step 3's ranking is **scoped to the senior
  lineage**. Ranking *all* spellings in a concept together would let a junior synonym's spelling win the
  name whenever its opinions happened to be newest — which is exactly the name that was just ruled
  invalid. (This is Classic's `getSeniorSynonym` then `getMostRecentSpelling`, §4.4.)
- **Opposite scopes for name vs. placement.** The accepted-spelling pass pools within the **senior
  lineage only**; the classification pass pools across the **whole concept** — junior-synonym borrowing
  (§9.5.2 step 3): a `belongs to` opinion filed under the junior name may set the concept's parent when
  it is the most recent reliable placement. Carry Classic's `use_synonyms` constraints: **equal rank
  only, species excluded** (a species must be allocated to its current genus directly, §4.2). "Pool the
  concept" is right for *where does it sit*, wrong for *what is its name*.

### 9.8.5 Occurrence synergy (why `original_permid` is materialized)

An occurrence is identified to a *spelling*, so it binds to a `permid` 1:1 (Classic `taxon_no`, a direct
migration map — no cache round-trip). The two derived grouping pointers then answer the queries that
matter:

- "all occurrences of this **name**, whichever spelling the identifier used" → `GROUP BY original_permid`
- "all occurrences of this **taxon**, synonyms included" → `GROUP BY concept_permid`

`original_permid` is a `derive()` output like the others (in the clean case just the `original` root, so
it effectively never moves; in the two-competing-originals case it is ranked, not a constraint
violation). Materializing it is nearly free and gives occurrences a stable *as-identified → name →
taxon* ladder.

### 9.8.6 Migration deltas

- **One permid per legacy `authorities` row** (~517K); mint a `name_opinions` row carrying its
  `new_name` + `rank_id` + naming-act provenance, with the row's real `reference_id` / `attribution` /
  `pubyr` and `evidence = false`. The minting reason comes from the `spelling_reason` of the opinion
  that introduced the spelling (or `original`); the lineage edge's `target_permid` is that opinion's
  `child_no`.
- **`belongs to` opinions → `assignment_opinions`**, `subject_permid` = the `child_spelling_no`'s permid,
  `containing_permid` = the `parent_spelling_no`'s permid.
- **Synonymy `status` → `concept`-class `name_opinions`**; the nomen family → `validity_opinions`.
- **No `orig_no` clustering pass.** The lineage is rebuilt from the edges, which **heals** the 81 bad
  `orig_no` rows and turns the FK orphans / "two candidate originals" into ordinary competing opinions
  rather than data-integrity errors.
- `type` / `trait` opinions and `taxon_annotations` as in §10.3, minus `synthesized`.

### 9.8.7 What this supersedes

- **§9.5.1** — `permid` is no longer the name-lineage; it is the name-as-spelled. `concept_permid` is
  unchanged (still derived); the name-lineage joins it as a second derived grouping (`original_permid`).
- **§9.5.2 step 2** — the winner `ORDER BY` loses its `synthesized` first key; rank is no longer one of
  the ranked dimensions.
- **§9.6.1 / §9.6.2** — `senior_permid` generalizes to `target_permid` (it is the concept target for
  synonymy edges and the form-of target for lineage edges); `subject_permid` now denotes a spelling, not
  a lineage. The three-relationship vocabulary (succession / concept / classification) stands, with
  name-lineage added as a fourth, derived, grouping.

---

## 10. From legacy `authorities` to the new tables

*§9 designs the target. This section does the inventory: which legacy columns land where, what the
resulting DDL looks like, and how to migrate data that has no opinions behind it. Concrete DDL lives
in `postgresql/taxa-opinions-draft.sql`; the §9.6.2 strawman is superseded by it, though the §9.6.1
column vocabulary stands unchanged.*

### 10.1 The forcing function

The authorities migration (complete, 2026-06-02) took only the citation half of Classic's
`authorities` table: `taxon_no`, `ref_is_authority`, the author fields, `pubyr`, `reference_no`, and
the person columns. Roughly forty taxon-related columns were deliberately left behind. The question
is where they go.

The answer is dictated by one property: **`taxa` is derived, so every column in it must be
reconstructible from Layer 1.** In Classic all of these were plain hand-entered columns on
`authorities`, which was fine because `authorities` was itself the source of truth. Once `taxa`
becomes `derive()` output, an unreconstructible column is a landmine: `rebuild()` would blank it, and
the §9.5.5 invariant would be unverifiable.

So each leftover field falls into exactly one of three categories:

| Category | Character | Destination |
|---|---|---|
| **A. Derived** | varies by publication; publications can disagree; needs ranking | an opinion table (Layer 1) |
| **B. Asserted at the naming act** | invariant, but still published and datable | the `original` name opinion |
| **C. Not derived at all** | curatorial; no publication behind it | outside the stack (`taxon_annotations`) |

The test for whether something needs its *own* opinion table:

1. Does it belong in `taxa` at all? If no → side table, done.
2. Can two publications **disagree** about it? If yes → it needs ranking → opinion table.
3. Does resolving it change **other** taxa? If yes → tree-affecting, `dependency_closure` must chase
   it. If no → purely local winner-selection, and the closure ignores it.

### 10.2 Category B: the missing naming act

Category B deserves its own note because it is the one genuine *hole* the authorities split opened.

Classic's `authorities` was the birth certificate: it asserted "reference R erected name N at rank K,
on page P, with type T." We stripped `authorities` down to pure citation, so **nothing in the new
schema asserts that a name exists.** `taxa.name` had no source, and neither did rank.

The fix needs no new table: make the naming act a `name_opinions` row with
`reason = 'original'`, carrying `authority_id`, `pages`, and `figures`. This mirrors Classic's own
`spelling_reason = 'original spelling'` convention, and it has a useful side effect — competing
claims about what the original combination was become an ordinary ranking contest rather than a
constraint violation. Classic needed a bad-data branch in `getOriginalCombination` (§4.1) precisely
because it had no way to represent two candidate originals.

A permid is therefore **minted by a `name_opinions` row** — `reason = 'original'` for a lineage's root
spelling, or (under the inversion, §9.8) a `lineage`-class reason for a later spelling introduced as a
form of an earlier one, e.g. *Acervoschwagerina* minted by a `reranked` edge onto
*Paraschwagerina (Acervoschwagerina)*. Either way the minting row carries the permid's immutable
`new_name` + `rank_id` + naming provenance, and nothing else creates a taxon.

### 10.3 Disposition of the leftover columns

| Legacy column(s) | Cat. | Destination |
|---|---|---|
| `taxon_no` | — | becomes `permid` (name-as-spelled identity — the inversion, §9.8) |
| `orig_no` | — | **ignored** by the migration; the name-lineage is derived and surfaced as `taxa.original_permid` (§9.8) |
| `taxon_name` | B/A | `name_opinions.new_name` on the minting row (`original`, then later spelling reasons) |
| `taxon_rank` | B | `name_opinions.rank_id` on the **minting** row — an immutable attribute of the permid, not a `rank_opinions` contest (§9.8). No `rank_opinions` table. |
| `pages`, `figures` | B | `name_opinions` on the `original` row |
| `type_taxon_no`, `type_specimen`, `museum`, `catalog_number`, `type_body_part`, `part_details`, `type_locality` | A | `type_opinions` |
| `extant`, `preservation`, `form_taxon` | A | `trait_opinions` (placeholder — see §10.6) |
| `common_name`, `comments`, `discussion`, `discussed_by` | C | `taxon_annotations` |
| `first_occurrence`, `last_occurrence` | — | drop: free-text summary, derivable from occurrences |
| `subgenus_index` | — | drop: search helper derived from the name |
| `refauth` | — | drop: redundant with `ref_is_authority` |
| `extant_old`, `preservation_old`, `preservation_less_old` | — | deprecated — but `extant_old` holds **108K values** the anomaly report flags as unverified against `extant`. Check before dropping. |
| `author1init`, `author2init` | — | already lost: the authorities migration kept family names only, in `descriptors` |
| `modifier_no`, `updater_no`, `created`, `modified`, `updated`, `upload`, `upload_id` | — | drop: versioning triggers and audit columns cover this |

### 10.4 What `accepted` was doing, and why it is gone

The pre-§9 draft DDL had `taxa.accepted boolean`. Removing it is worth recording, because the column
was quietly doing **two unrelated jobs**:

| Meaning | Replacement |
|---|---|
| "this is the valid name of its concept" (not a junior synonym or misspelling) | **free**: `concept_permid = permid`. No column needed. |
| "this name is nomenclaturally invalid" (nomen dubium/nudum/vanum/oblitum, invalid subgroup) | `nomenclatural_status_id` — an enum, and one that does *not* imply synonymy |

A nomen dubium is its own concept head *and* invalid; a junior synonym is valid-but-not-head. One
boolean cannot express both, which is exactly why Classic needed `synonym_no`, `spelling_no`, and
`status`-branching throughout the resolver to reconstruct the same information.

One other column from that draft also goes: `has_homonym`, which would make a derived table depend on
the non-opinion `homonyms` table — use a read-path `LEFT JOIN` instead.

The opinion tables' `permid` / succession columns were also dropped at one point, and have since been
**restored** — they record transcription corrections, and the tables run without the version triggers
(§9.5.2.1). What did go, as Classic artifacts, are `modifier_person_id` and `modified_at`: the
succession chain now carries that history, and carries it better.

### 10.5 Migrating data that has no opinions

> **Reframed by §9.8 (correction 2).** The premise below — that assertions must be *synthesized* for
> data with no opinions behind it — is retired. An `authorities` record **is** an opinion: each legacy
> row becomes a real minting `name_opinions` row carrying the row's own `reference_id` / `attribution` /
> `pubyr` and `evidence = false`. Nothing is fabricated and nothing is floored; there is no
> `synthesized` column. The probe counts below still hold and still frame the work; "synthesize" now
> reads "translate the `authorities` row into its minting opinion." Constraint 1 is deleted (see below);
> the rank fan-out is superseded by rank riding the permid (§9.8).

Classic's taxon data has no corresponding `opinions` rows for what were treated as *basal* taxa —
names that later opinions build on. To migrate into a paradigm where `taxa` is derived, those
assertions must be **constructed** so `derive()` has something to work from.

Probed against the legacy database:

| Probe | Count |
|---|---|
| `authorities` rows (name-as-spelled) | 517,287 |
| distinct `orig_no` → **permids** | 403,640 |
| `orig_no = 0` | **0** — clean |
| orig rows with **no** original-spelling opinion | **13,607** |
| clusters with **no opinions at all** (true basal) | 10,245 |
| clusters with no `belongs to` (rootless in the tree) | 17,062 |
| authorities rows no opinion ever references | 6,361 |
| clusters where rank varies across spellings | 11,704 |

This reframes the job favourably. 807,951 legacy opinions already carry
`spelling_reason = 'original spelling'` with `child_no = child_spelling_no`, so Classic *did* record
most naming acts as opinions. For those we are **relocating an assertion that always existed**, not
fabricating one. Only ~13.6K names need genuine synthesis.

**Rank is no longer a fan-out question — it rides the permid (§9.8).** Under the inversion each legacy
`authorities` row *is* a name-as-spelled, so its `taxon_rank` becomes the immutable `rank_id` on that
permid's minting `name_opinions` row. There is no `rank_opinions` table and no ~998K fan-out (old open
call B): the accepted rank is simply the rank of the accepted spelling, which is exactly how Classic
reads it off the winning spelling's `authorities` row. The recency that decides *which* rank is current
lives entirely in the spelling contest (which spelling wins), not in a rank ranking — so the failure
mode the old fan-out guarded against (a 1990 rank change beating a 2010 re-use of an older spelling)
cannot arise: the 2010 opinion picks the older spelling, and that spelling's rank comes with it.

**Two constraints the translation must respect:**

1. **The 30% with `basis IS NULL` are resolved at migration time.** 298,470 of 998,565 legacy
   opinions have no basis of their own and fall back to the reference's. pbdb2 cannot defer that
   fallback the way Classic does: the new `refs` table has **no basis field**, so there is nothing
   to fall back *to* at read time. The migration therefore resolves it once — take the opinion's
   `basis` if present, else the legacy reference's — and writes the result as
   `evidence = (resolved basis = 'stated with evidence')`, `NOT NULL`. NULL resolves to `false`.

   The tradeoff this freezes: a later correction to a legacy reference's basis will not retroactively
   change the opinions that inherited it. That is a consequence of collapsing to a boolean and is
   accepted; the graded distinction it would have propagated does not exist in pbdb2 anyway.

   **Mapping table (all five opinion tables):**

   | Legacy `opinions.basis` | pbdb2 `evidence` |
   |---|---|
   | `stated with evidence` | `true` |
   | `stated without evidence`, `implied`, `second hand` | `false` |
   | `NULL` → legacy reference's basis, then as above | `true` / `false` |
   | authorities-sourced (minting opinion, no legacy `opinions` row) | `false` (authorities has no basis) |
2. **The nomen family needs somewhere to go.** 12,806 opinions (`nomen dubium` 8,208, `nomen nudum`
   2,533, `invalid subgroup of` 1,420, `nomen vanum` 569, `nomen oblitum` 76) are neither assignments
   nor name changes, and would be silently dropped without `validity_opinions`.

**Migration order.** Because opinions carry bare permids rather than pointing at `taxa` rows, there
is no bootstrap problem — the derived table simply comes last:

```
1. permid := uuidv7() per authorities row (name-as-spelled)     (~517,287)
2. mint one name_opinions row per authorities row: new_name + rank_id + naming
   provenance; reason + target_permid from the introducing opinion's spelling_reason
   (or 'original'). orig_no is IGNORED.
3. translate legacy opinions → assignment / concept-class name edges / validity
4. derive(all) → materialize taxa                    ← the first rebuild()
5. verify: derive(all) ≡ heads, and diff against taxa_tree_cache (now 1:1, per taxon_no)
```

Step 5 is the payoff. The migration *is* the cold path, so it exercises `rebuild()` on day one, and
Classic's own cache becomes a free independent oracle: every disagreement is either a `derive()` bug
or a documented Classic pathology.

Two cleanups en route: **81 `orig_no` values** point at a taxon_no that is not its own original, and
the anomaly report lists a handful of FK orphans (1 `child_no`, 5 `parent_no`, 8
`parent_spelling_no`, 10 `reference_no`).

### 10.6 Status and the open-items register

`postgresql/taxa-opinions-draft.sql` is a **draft for discussion, not committed schema** — nothing in
it has been run. This register is the current inventory of what is left (updated 2026-07-29): open
decisions, then unbuilt implementation, then cleanup, then the decided items kept for the record. The
two biggest real risks are **B1** (`derive()` is the whole ballgame and is unwritten) and **B2** (the
closure rewrite); everything in A/C is a small decision or a tidy-up.

#### A. Open design decisions (need a human call)

- **A1 — Where the non-`CHECK` invariants are enforced.** Several cross-column rules can't be plain
  `CHECK`s because they need a dictionary lookup: the `name_opinions` minting shape (minting rows carry
  `new_name`/`rank_id`/authority provenance, concept-class edges leave them NULL; `original` ⇒
  `target_permid` NULL, else NOT NULL) and `validity_opinions.target_permid` required iff the status is
  `targeted`. Decide once, together: write-path + a `derive(all)` assertion, or a generated
  `is_minting` column. (DDL open q7.)
- **A2 — Is `misspelling` a `lineage` or `concept` edge?** The draft classifies it `lineage` +
  `never_accepted` (a bad spelling of the same name); Classic files `misspelling of` in the *synonymy*
  status family. This picks which union-find it feeds — confirm.
- **A3 — `namechange_reasons` dictionary cleanup.** The seed has overlapping tokens (`junior synonym`
  vs `subjective`/`objective synonym`; `assignment` vs `recombination`/reassignment). The draft's
  `edge_class`/`never_accepted` `UPDATE` assumes a specific token set; reconcile the overlaps and square
  them with what `create_new.sql` actually seeds.
- **A4 — `trait_opinions` fate.** A placeholder and the weakest of the new opinion tables, sitting
  exactly where PBOT's description system takes over; its payload is `jsonb` for that reason. May be —
  or be absorbed by — the `descriptions` table `create_new.sql` references but leaves undefined.
- **A5 — `type_opinions` granularity.** One row asserts the whole type block, so a later lectotype
  designation silent about type locality would drop the locality on winning. May need splitting per
  dimension.
- **A6 — Is §9.2's point-in-time reconstruction a real requirement?** It is the sole justification for
  versioning `taxa` (§9.8.3). If PBDB never needs historical belief queries or per-version provenance,
  `taxa` becomes a plain rebuildable cache and the versioning comes out. A product call, not a schema
  one.

#### B. Implementation not yet written (design settled)

- **B1 — `derive()` itself.** Layer 2 has no code. The two union-finds, the ordered ranking, and the
  §9.5.6 obligations — **totality, determinism, and cycle handling** (A synonym-of B, B synonym-of A) —
  all live in this one function and none of it exists yet. The largest remaining piece.
- **B2 — `dependency_closure` rewrite for the inversion.** The §9.6.4 query still uses `senior_permid`
  and has no **lineage-lateral pass**, but under the inversion a name edge merges permids at two levels,
  so the closure must seed the affected *lineage* as well as the concept. §9.6.6's claim that the §9.6.4
  treatment "stands unchanged" is now stale and should be corrected alongside.
- **B3 — Fold the draft into `create_new.sql`.** Supersede the old `taxa`/`*_opinions` block (the one
  with `taxon_id`/`parent_taxon_id → taxa("id")` FKs — the keys that *would* swing, §9.8.3). The
  `taxonomy_ranks`/`namechange_reasons` `ALTER`s assume specific existing seed rows.
- **B4 — Migration-script logic.** Derive each permid's minting `reason` + `target_permid` from the
  legacy opinion that introduced the spelling; handle the ~13.6K names with no original-spelling opinion
  and the rootless clusters. The concrete work behind §10.5 steps 2–3.

#### C. Minor / cleanup

- **C1 — `rank_id` NOT NULL?** On `taxa` and on minting `name_opinions` rows rank is always knowable
  (`unranked` is itself a rank value), so these could tighten from nullable to NOT NULL.
- **C2 — `taxa` could use a trimmed trigger.** The swing half of `handle_new_version()` is inert here
  (§9.8.3), so only `place_in_lineage()` does work — an optional simplification, not a correctness bug.
- **C3 — `homonyms.homonym_group_id`** has no generating sequence/parent defined.

#### D. Decided & closed (kept for the record)

- **D1 — Rank fan-out (old open call B): SUPERSEDED by the inversion (§9.8).** Rank is not migrated as
  opinions at all — it is an immutable attribute of a name-as-spelled, carried by `name_opinions.rank_id`
  on the minting row. No `rank_opinions` table, no fan-out; the accepted rank is the rank of the accepted
  spelling.
- **D2 — `nomen oblitum` (open call A): DECIDED.** A nomenclatural validity/priority status, not a
  name-change reason (the name is unaltered). Removed from `namechange_reasons` in `create_new.sql`;
  lives only in `dictionaries.nomenclatural_statuses`.
- **D3 — `taxonomy_ranks` `'order'` + explicit `height`: resolved in the draft.** `derive()` enforces
  "containing rank strictly higher" (§2.2a), and id order stops being a valid proxy once `unranked
  clade`/`unranked` sit at the end of the list. Applied when folding into `create_new.sql` (B3).

- **D4 — `attribution` and `pubyr` stay: RESOLVED.** (Was: does `attribution` duplicate the shape of
  `authority.schema.js`, and should an opinion point at an `authorities` row instead?)

   **Both `attribution` and `pubyr` stay** (decision, 2026-07-27). `create_new.sql`'s opinion tables
   carry neither, holding only `evidence` and `reference_id`; this draft's addition of both is
   confirmed, and the "`reference_id` is sufficient for citation, drop them" direction is **rejected,
   not deferred**. A reference tells you where PBDB read the statement; for the second-hand case it
   does not tell you whose statement it was or when it was made, and both are needed.

   On the schema question: `authority.schema.js` describes an *authority record* — it carries
   `legacyIDs.oldpbdbIDs` and `publishedInReference`, both meaningless on an opinion, and sets
   `unevaluatedProperties: false`, so it cannot be borrowed without them. `attribution` now has its
   own **authors-only** schema (`payloadSchemas/opinionAttribution.schema.js`), and the duplicated
   `year` field is gone.

   The governing rule, worth stating because it generalizes: **every input to `derive()` is a typed,
   constrained, indexable column; everything else is payload.** `subject_permid`, `reason_id`,
   `evidence`, `pubyr`, and `reference_id` are read by winner selection, so they are
   columns. `attribution`, `pages`, and `figures` are read by nobody, so they can be `jsonb`. Putting
   the year in both places stored one fact twice with nothing enforcing agreement; routing a sort key
   through a `jsonb` path would also have turned the canonical `ORDER BY` (§9.5.2 step 2) into
   `COALESCE((attribution->>'year')::int, r.pubyr)`, degraded the index to an expression index, and
   moved validation outside the database.

   `pubyr` is consequently **`integer`, not `text`** — text ordering matches numeric ordering only
   while every value is exactly 4 digits, which is fragile for a ranking key. Verified safe: all
   128,722 populated legacy values are 4-digit numerics, zero non-conforming.

   **`derive()` ranks on `pubyr`** (decision, 2026-07-27). It is a `derive()` **input**, not payload,
   so a second-hand opinion competes at the year it was *stated* rather than the year it was
   reported — Classic's behaviour, and what §9.5.2 step 2 already encodes. This is also what
   justifies the `integer` retype above: it is a sort key, so it gets a typed column.

   The `COALESCE` in that key is load-bearing rather than incidental. `pubyr` is populated **only**
   for the second-hand case — 869,843 of 998,565 legacy opinions leave it empty — so the sort key is
   `COALESCE(pubyr, reference publication year)`: `pubyr` takes precedence *where present*, and the
   reference's year dates the other 87%. Ranking on `pubyr` alone would leave most opinions undated.

If the surface needs shrinking, `validity_opinions` is the one that must stay — the other two could
both be deferred into the PBOT description work, at the cost of parking `extant` and the type block
until then.

---

### Appendix: file map

| File | Role |
|---|---|
| `TaxaCache.pm` | builds/maintains `taxa_tree_cache` (+ dead `taxa_list_cache`); daemon target |
| `TaxonInfo.pm` | resolution engine: original combination, most-recent classification/spelling, senior synonym; the read-path write-back |
| `Opinion.pm` | opinion CRUD, status/spelling_reason vocab, validation |
| `Taxon.pm` | authority (name) CRUD |
| `Classification.pm` | assembles a classification from resolved opinions |
| `Reclassify.pm` | rebinds occurrences/reids to taxa (`taxon_no` on occurrences) |
| `PrintHierarchy.pm`, `DownloadTaxonomy.pm` | read-side consumers of the caches |
| `scripts/old/taxa_cached.pl` | the 2 s polling daemon |
