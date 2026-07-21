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
