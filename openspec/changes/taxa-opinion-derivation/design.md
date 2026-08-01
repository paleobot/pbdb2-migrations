## Context

`derive_taxa()` is Layer 2 — the single canonical definition of truth (§9.5.2, §9.8.4). Unlike B3 (a transcription fold), this change has real algorithmic content: two graph groupings, an ordered ranking, and two opposite pooling scopes, all of which must be total, deterministic, and cycle-safe. The design of *what* `derive_taxa()` computes is settled in `docs/classic-taxa-opinions.md`:

- **§9.8.4** — the algorithm: two union-finds (lineage, concept), the ordered accepted-spelling ranking, and the two scopes (senior-lineage-only for the name, whole-concept for the placement).
- **§9.5.2** — the winner `ORDER BY` and the three-layer contract; **§9.5.5** — the `derive_taxa(all) ≡ heads` invariant; **§9.5.6** — the totality/determinism/cycle obligations.

This document records *how* to realize that in PostgreSQL — the function shape, the SQL techniques, and the sub-decisions the prose leaves to the implementer — and flags the genuinely subtle points for the specs/tests to pin. It does not restate the model.

The storage it reads/writes exists as of change `taxa-opinions-schema`: the three opinion tables (head-only indexed), the dictionaries with `edge_class`/`height`/`targeted`, and the `taxa` ledger with the derived-column shape `derive_taxa()` must produce.

## Goals / Non-Goals

**Goals:**

- A pure `derive_taxa(permids)` that, given a set of permids (or all), returns one row per permid matching the `taxa` ledger's derived columns, reading **only** Layer 1 (+ `refs` for `pubyr`).
- A `rebuild_taxa()` cold path that calls `derive_taxa(all)`, then diffs/loads the `taxa` ledger (append new versions only where output differs from the current head).
- A callable `derive_taxa(all) ≡ heads` invariant check for CI / post-import.
- Correctness proven by fixtures covering the load-bearing subtleties (concept grouping, senior-lineage spelling scope, junior-synonym borrowing, cycles).

**Non-Goals:**

- `dependency_closure` and the `AFTER STATEMENT` hot-path trigger (B2). Here the ledger is refreshed only by `rebuild_taxa()`.
- The legacy→new data migration (B4). `derive_taxa()` is exercised by SQL fixtures, not a real load.
- **Performance tuning** of `derive_taxa(all)` at full scale (~517K permids / ~1M opinions). This change targets *correctness and runnability*; the burst/closure performance work is §9.7 / B2. Gross inefficiencies will be noted, not optimized away.

## Decisions

1. **`derive_taxa()` is a pure set-returning function; a separate writer applies it.** `derive_taxa(permids uuid[])` returns `SETOF` a composite row type mirroring the ledger's derived columns; it performs no writes and never reads `taxa`. The diff-and-append to the ledger lives in `rebuild_taxa()` (and later B2's trigger), so the same `derive_taxa()` backs both the hot and cold paths (§9.5.3). *Alternative rejected:* have `derive_taxa()` write the ledger directly — it would couple truth to materialization and break the invariant's "output vs. stored" comparison.

2. **The two union-finds are connected-components recursive CTEs, not an imperative loop.** Lineage components form over `lineage`-class name edges; concept components over `concept`-class edges. Use `UNION` (dedupes, guarantees termination) walking both edge directions to gather each component. This is the idiomatic Postgres form and makes cycle handling fall out of set-dedup rather than explicit bookkeeping. *Alternative rejected:* a PL/pgSQL union-find with a parent array — faster asymptotically but opaque, harder to prove total/deterministic, and premature (perf is out of scope).

3. **One `DISTINCT ON (…) … ORDER BY` per dimension is the winner.** The accepted-spelling ranking is exactly `ORDER BY evidence DESC, COALESCE(pubyr, ref.pubyr) DESC, id DESC` over head opinions, excluding `never_accepted` reasons — one place, replacing Classic's scattered `getMostRecentClassification`. Classification uses the same ordering over pooled assignment opinions. (§9.5.2, §9.8.4)

4. **Grouping (step 2) strictly precedes spelling selection (step 3), with opposite scopes.** Seniority is decided first; the accepted spelling is then ranked **within the senior lineage only**, while classification is pooled across the **whole concept** (junior-synonym borrowing, *equal rank only, species excluded*). Getting the scopes backwards is the classic bug (a just-invalidated junior name winning the concept's name), so the specs test both directions explicitly. (§9.8.4 subtleties)

5. **Seniority within a concept is resolved by the concept edges, not by recomputing priority.** A `concept`-class edge asserts `subject` is junior to `target`; the senior lineage is the sink the winning edges point to. Where a lineage has several concept opinions, the canonical `ORDER BY` picks the winning edge; chains (A→B→C) resolve to the ultimate sink. This mirrors Classic's `getSeniorSynonym` (§4.4). **Ambiguous-sink tiebreak (settled 2026-07-31):** when the winning edges yield no unique sink (e.g. equal-rank, equal-priority "A synonym-of B" and "B synonym-of A"), pick the senior lineage by, in order: (a) the canonical `ORDER BY` (`evidence DESC, COALESCE(pubyr, ref.pubyr) DESC, id DESC`) on each lineage's accepted opinion; (b) oldest `original` `pubyr` (nomenclatural priority); (c) lowest `permid` as the final total tiebreak. Deterministic and auditable; specced as a scenario.

6. **`derive_taxa(subset)` internally closes over full components.** Correctness requires that `derive_taxa(permids)` return, for each requested permid, exactly what `derive_taxa(all)` would — but a permid's grouping depends on its whole lineage/concept, which may include permids outside the argument. So `derive_taxa()` first expands its input to the full connected components (lineage ∪ concept ∪ downstream needed for `classification_path`) before computing. The `permids` argument is thus a *seed*, not a hard filter; it returns rows for at least the seeds and computes correctly regardless of where component boundaries fall. (This is what lets B2's `dependency_closure` hand `derive_taxa()` a modest seed set safely.)

7. **Totality via the minting-opinion tripwire.** Every permid that has a minting `name_opinion` (reason `root`/`lineage`) yields exactly one row; `rank_id`/`name` come from that minting row (never NULL — the D9 shape CHECK guarantees it, and `taxa.rank_id NOT NULL` is the tripwire if a dangling permid ever reaches materialization, §10.6 D11). Determinism: every `ORDER BY` ends in `id DESC`, and component representatives are chosen by an explicit, total rule.

8. **`classification_path` built from the resolved adjacency.** After `containing_concept_permid` is known per concept, the `ltree` path is assembled root→node (recursive CTE over the concept adjacency). Adjacency is primary; the path is a derived materialization (§9.7.4), so it is computed last and can be recomputed independently.

9. **No dedicated schema; functions live in `public` with descriptive names (settled 2026-07-31).** The design doc writes `taxonomy.derive(...)` (§9.5.2), but that is notational, not a codebase convention: `create_new.sql` has only `dictionaries` and `lookup` schemas, and every infrastructure function (`swing_fks_to_new_version`, `install_version_triggers`, …) lives in `public` with a descriptive name. So `derive_taxa()` / `rebuild_taxa()` / `assert_taxa_invariant()` go in `public` too. The descriptive names — not a schema — are what keep the generic verbs `derive`/`rebuild` collision-safe, exactly as the versioning functions do. A `taxonomy` schema would also be odd here because the tables it operates on (`taxa`, the opinion tables) are themselves in `public`. *This supersedes the doc's `taxonomy.` prefix; do not reintroduce the schema without moving the tables too.*

## Risks / Trade-offs

- **Cycle termination** (A synonym-of B, B synonym-of A; or an accidental classification loop) → Connected-components `UNION` CTEs terminate by construction; the classification-path CTE must additionally guard against a containment cycle (defensive depth cap + a raised error), since a genuine parent cycle is a data error `derive_taxa()` should surface, not loop on. Tested with a deliberate cycle fixture.
- **Ambiguous seniority** (a concept whose winning edges have no single sink) → Resolve by the canonical tiebreak (Decision 4 / Open Questions) so the result is deterministic; a fixture locks the chosen behavior. The risk is choosing a defensible-but-wrong policy silently — hence it is an explicit spec scenario, not an implementation detail.
- **`derive_taxa(all)` cost at scale** → Accepted for this change (Non-Goal). Recursive-CTE components over ~1M edges will be slow; correctness first. Flagged for §9.7/B2, not solved here.
- **Subset/component correctness** (Decision 5) → The subtle failure is a subset call that under-expands and returns a stale grouping. Test: `derive_taxa(single junior-synonym permid)` must equal that permid's row from `derive_taxa(all)`.
- **Schema feedback into B3** → If `derive_taxa()` needs an index or column B3 didn't provide, that is expected and cheap (edit the same `create_new.sql` block; A is unarchived precisely for this). Not a risk to guard against so much as the reason for the sequencing.

## Migration Plan

Target-schema functions, not a data migration.

1. Add the `derive_taxa()` / `rebuild_taxa()` / `assert_taxa_invariant()` functions to `create_new.sql` (in `public`, no dedicated schema — matching the versioning-function convention), after the taxa/opinions tables.
2. Build fixtures (small opinion sets exercising each subtlety) and assert `derive_taxa()`'s output row-by-row; assert the `derive_taxa(all) ≡ heads` invariant after a `rebuild_taxa()`.
3. Run against a from-empty build on localhost PG16 (as B3 was verified).

**Rollback:** revert the `create_new.sql` additions. No deployed data depends on them (the ledger is empty until B4).

## Open Questions

- **Senior-lineage tiebreak — RESOLVED (2026-07-31):** canonical `ORDER BY` → oldest `original` pubyr → lowest `permid` (Decision 5). Encoded as a spec scenario.
- **Composite return type vs. writing to a temp/unlogged table** — deferred to implementation (apply). A named composite `SETOF` is cleanest for the invariant comparison; if PL/pgSQL ergonomics push toward a staging table, that is an implementation choice that must not change observable output. Not a behavior decision, so it does not block specs.
- **How `removed`/superseded opinions are excluded** is settled (`WHERE removed IS NOT TRUE AND succeeded_by_id IS NULL`, §9.5.2.1) — noted only so the implementation does not re-litigate it.
