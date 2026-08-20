## Context

`derive_taxa()` exists in `postgresql/create_new.sql` (~L5050-5298) from the archived
`taxa-opinion-derivation` change (see its `design.md` for the original algorithm rationale — two
union-finds, one canonical `ORDER BY` per contest, senior-lineage-then-accepted-spelling scoping vs.
whole-concept classification pooling — none of that is revisited here). It predates two decisions made
afterward: the append-only ledger model and root-only identity (`docs/classic-taxa-opinions.md` §9.8.4.1),
and the nomen-nudum candidacy bar (§9.8.4.2). Live inspection (this change's proposal) found the function
genuinely violates two requirements the `taxa-opinions` spec already states, and has no implementation at
all for two decided-but-unwritten behaviors, plus one method (`original_permid`'s tie-break) the doc
already flags as using the wrong technique.

The core structural fact driving every fix here: under root-only identity, **a permid can appear as
`subject_permid` on more than one live `name_opinions` row** — its own `root` mint, plus any number of
`lineage`-class rows where opinions claim it's a form of something else (competing recombination/
misspelling/rank-change claims are normal, not anomalous). The current code's `_dt_mint` conflates "one
row per permid" with "one row per introducing-edge candidate," and that conflation is the root cause of
three of the five gaps.

## Goals / Non-Goals

**Goals:**
- `derive_taxa()` satisfies the `taxa-opinions` spec's existing requirements exactly (one row per minted
  permid; never-accepted exclusion scoped to the right permid).
- `derive_taxa()` implements the nomen-nudum candidacy bar and its empty-lineage/-concept cascade
  (§9.8.4.2), consistent with ICZN Article 23.1 (priority/valid-name status applies only among
  *available* names — an unavailable name is outside the contest entirely, not a loser within it).
- `original_permid` uses the topological (lineage-sink) definition, with a defined, deterministic
  fallback for the genuinely degenerate cases.
- All of the above provable by fixtures, matching the original change's testing approach.

**Non-Goals:**
- `dependency_closure` / the incremental trigger (§9.6.4, B2) — untouched, `derive_taxa(seed := NULL)`
  doesn't depend on it.
- Performance tuning at full scale (~517K permids) — correctness first, same non-goal the original change
  already accepted.
- Any change to `rebuild_taxa()`'s diff/append logic or the `assert_taxa_invariant()` shape — they call
  `derive_taxa()` as a black box and need no changes for this rework.
- Revisiting the already-correct parts: the two union-find CTEs' construction, the concept/lineage
  scoping split, junior-synonym borrowing, and the containment cycle guard are all validated by the
  proposal's live inspection and are not touched except where a fix's data flow requires threading a new
  column through them.

## Decisions

### 1. Split "one row per permid" (identity) from "candidate introducing edges" (ranking input)

Replace the single `_dt_mint` with two temp tables:

- **`_dt_identity`** — exactly one row per permid, built `WHERE edge_class = 'root'` only:
  `(permid, opinion_id, new_name, rank_id, authority_id)`. This becomes the sole source of identity in
  the final assembly and the sole definition of "which permids exist" (a permid with no root row isn't
  minted and gets no output row — consistent with root-only identity's own invariant that migration mints
  a root row for every legacy `authorities` row).
- **`_dt_edge_cand`** — one row per (permid, introducing opinion) pair, `WHERE edge_class IN
  ('root','lineage')` (unchanged filter from the old `_dt_mint`), still carrying `evidence`/`yr`/
  `never_accepted` for ranking.

From `_dt_edge_cand`, compute **`_dt_permid_edge`** — one row per permid, the permid's own canonical
introducing edge: `row_number() OVER (PARTITION BY permid ORDER BY evidence DESC, yr DESC NULLS LAST,
opinion_id DESC) = 1`. This row supplies, per permid: `winning_name_opinion_id` (matching
`classic-taxa-opinions.md` §9.8.4.1's "canonical-winner introducing edge, or the root if the permid has
no lineage edge"), and the `never_accepted` flag used by Decision 2.

*Alternative rejected:* keep one `_dt_mint` and add a `DISTINCT ON (permid)` at the final assembly only.
Rejected because the never-accepted fix (Decision 2) and the accepted-spelling ranking both need the
per-permid canonical edge as an intermediate value in their own right, not just as a final dedup step —
computing it once in `_dt_permid_edge` and reusing it in both places avoids two different, potentially
inconsistent, definitions of "this permid's winning claim."

**Defensive check, new:** if `_dt_identity` ever has more than one live `root` row for the same permid
(identity re-minted — should never happen under the migration invariant, but nothing in the schema
enforces it), `derive_taxa()` `RAISE EXCEPTION`, mirroring the existing containment-cycle guard's
treatment of "this is a data integrity violation, not a ranking contest." Root minting is defined as a
one-time act (§9.8.1: "name and rank are immutable attributes of a permid"), not a contest — so unlike
every other ranking in this function, there is no principled way to pick a winner among competing root
rows, and silently picking one would hide real data corruption.

### 2. `never_accepted` and the nomen-nudum bar are both permid-scoped, evaluated together, before lineage ranking

The `spelling` CTE (inside `_dt_linmeta`) currently ranks `_dt_mint` rows directly and filters
`WHERE m.never_accepted = false`. Replace its input with **`_dt_candidacy`** — one row per permid,
joining `_dt_permid_edge` (for the canonical edge's `never_accepted` and evidence/yr/id) with `_dt_valid`
(for the winning validity opinion's `bars_candidacy`, sourced from `dictionaries.nomenclatural_statuses`
— `_dt_valid` needs `bars_candidacy` added to its `SELECT`, not just `status_id`):

```sql
eligible AS (
    SELECT pe.permid, pe.evidence, pe.yr, pe.opinion_id
    FROM _dt_permid_edge pe
    LEFT JOIN _dt_valid dv ON dv.permid = pe.permid
    WHERE pe.never_accepted = false
      AND COALESCE(dv.bars_candidacy, false) = false
)
```

`_dt_valid` must therefore be computed **before** `_dt_linmeta` in the function body (it currently runs
near the end, after `_dt_assign`/`_dt_node`) — a real reordering, not just an addition.

The `spelling` CTE then ranks `_dt_lin JOIN eligible` instead of `_dt_lin JOIN _dt_mint WHERE
never_accepted=false`. This single change fixes both Decision 2's exclusion scoping *and* implements the
nomen-nudum bar in one place, since both are "is this permid itself eligible to represent its lineage,"
just sourced from two different disqualifying facts (a never-accepted introducing edge, or a
`bars_candidacy` validity ruling).

*Alternative considered:* keep `never_accepted` filtering separate from the nomen-nudum bar (two filter
passes). Rejected — they're the same kind of fact ("is this permid eligible"), and a single `eligible` CTE
keeps the empty-lineage cascade (Decision 3) working through one exclusion point instead of two.

### 3. The empty-lineage/-concept cascade requires no new code — it falls out of the existing INNER JOIN chain, once Decision 2's `eligible` set is correct

This was the most important thing to verify, not assume. `_dt_linmeta` already emits **zero rows** for a
`lin_rep` with no eligible candidate (the `spelling` CTE simply produces no `rn = 1` row for it). Every
downstream join to `_dt_linmeta` — in `_dt_conmeta`'s `ranked` CTE (`_dt_con c JOIN _dt_linmeta lm ON
lm.lin_rep = c.lin_rep`) and in the final `RETURN QUERY` (`_dt_lin l JOIN _dt_linmeta lm ON lm.lin_rep =
l.lin_rep`) — is already a plain `JOIN` (inner), not a `LEFT JOIN`. So:

- A lineage with zero eligible candidates drops out of `_dt_linmeta` → drops out of `_dt_conmeta`'s
  `ranked` CTE for its concept → the concept's seniority ranking naturally considers only eligible
  sibling lineages, promoting the next-most-senior one with no code change.
- A concept where *every* lineage is exhausted has *no* row survive into `ranked` for that `con_rep` at
  all → `_dt_conmeta` has no row for it → `_dt_node`/`_dt_path` have no row for it → the final
  `RETURN QUERY`'s join to `_dt_conmeta` drops every permid in that concept from the output.

**Decided (2026-08-19, after checking ICZN Article 23.1 against the alternative): permids belonging to an
exhausted lineage get no output row, even when their concept survives via a different lineage** — the
same "no row for no eligible representative" principle already decided for the concept-level terminal
case, now applied consistently one level down. Priority (and "valid name" status) is defined by the Code
only among *available* names (Art. 23.1); an exhausted lineage has no available candidate, so there is
nothing valid to materialize as `accepted_spelling_permid` for its members, and forcing a technically-
barred name to "win by default" would misrepresent an unavailable name as having nomenclatural standing —
worse than omitting the row. The underlying `name_opinions`/`validity_opinions` assertions are never
deleted and remain fully queryable — Layer 1 satisfies the Code's citation/recording expectation for
unavailable names (Rec. 51F) without Layer 3 needing to materialize a "current belief" that doesn't exist.

This changes the `taxa-opinions` spec's "total over minted permids" requirement: it currently has no
eligibility carve-out and needs one, stated in terms of lineage/concept exhaustion, not just "has a
minting opinion."

*Alternative rejected:* relax the bar within an otherwise-fully-excluded lineage so every minted permid
always gets a row. Rejected per the ICZN check above — it satisfies the letter of the current spec
requirement but produces a value (`accepted_spelling_permid` pointing at an unavailable name) that
misrepresents nomenclatural status, and requires new fallback logic where the "do nothing extra" option
already falls out of the existing joins.

### 4. `original_permid`: topological sink, with an explicit, deterministic fallback

Replace the `roots` CTE's earliest-year-root method with:

```sql
-- a permid is a lineage-sink iff no live lineage edge has it as subject
sinks AS (
    SELECT l.lin_rep, l.permid
    FROM _dt_lin l
    WHERE NOT EXISTS (
        SELECT 1 FROM name_opinions n
        WHERE n.removed IS NOT TRUE AND n.succeeded_by_id IS NULL
          AND n.edge_class = 'lineage' AND n.subject_permid = l.permid
    )
),
sink_counts AS (
    SELECT lin_rep, count(*) AS n FROM sinks GROUP BY lin_rep
),
roots AS (
    -- unique sink: that's original_permid, no ranking needed
    SELECT sc.lin_rep, s.permid AS original_permid
    FROM sink_counts sc JOIN sinks s ON s.lin_rep = sc.lin_rep
    WHERE sc.n = 1
    UNION ALL
    -- 0 or 2+ sinks (degenerate: a lineage cycle, or a genuine tie): fall back to the
    -- canonical tiebreak, over the candidate set for that case (all lineage members for
    -- 0 sinks, since there is no "sink" to prefer; the sinks themselves for 2+, since
    -- they are the only legitimate candidates)
    SELECT sc.lin_rep,
           (array_agg(cand.permid ORDER BY cand.evidence DESC, cand.yr DESC NULLS LAST,
                      cand.opinion_id DESC, cand.yr NULLS LAST, cand.permid))[1]
    FROM sink_counts sc
    JOIN LATERAL (
        SELECT pe.permid, pe.evidence, pe.yr, pe.opinion_id
        FROM (SELECT permid FROM sinks WHERE lin_rep = sc.lin_rep
              UNION ALL
              SELECT l.permid FROM _dt_lin l WHERE l.lin_rep = sc.lin_rep AND sc.n = 0) c
        JOIN _dt_permid_edge pe ON pe.permid = c.permid
    ) cand ON true
    WHERE sc.n != 1
    GROUP BY sc.lin_rep
)
```

The fallback reuses the same tiebreak philosophy the spec already codifies for concept-level seniority
ties ("Seniority tiebreak is total and deterministic": canonical `ORDER BY` → oldest `original` pubyr →
lowest permid) rather than inventing a new one — for the 2+-sink case this ranks the tied sinks by their
own canonical introducing edge; the exact secondary tiebreak ordering (oldest-pubyr-of-the-`original`-row
vs. this row's own `yr`) is a detail to pin with a fixture at implementation time, not a design-level fork
— unlike Decision 3, getting the *order* of tiebreak keys slightly different doesn't change which
permids get output or what the spec requires, only which one wins an already-rare tie.

*Alternative rejected:* keep ranking by year across all root rows in the lineage unconditionally (today's
method). Rejected because it's the exact method `classic-taxa-opinions.md` §9.8.4.1 point 4 identifies as
wrong post-inversion, and confirmed live: every permid now has its own root row, so "earliest-year root
in the lineage" no longer identifies anything meaningful about topological position — it would pick
whichever spelling happened to have the earliest authorities citation, unrelated to which one the lineage
edges actually point at as their common target.

## Risks / Trade-offs

- **[Risk] The `_dt_valid` reordering (Decision 2) could change unrelated output** if anything downstream
  of its old position implicitly depended on computation order → **Mitigation:** `_dt_valid` is a pure
  `SELECT` with no side effects and no dependency on any table besides `validity_opinions`/`refs`; moving
  its `CREATE TEMP TABLE` earlier changes nothing about its contents. Verified by inspection, not just
  assumed.
- **[Risk] Decision 3's "no output row" behavior is a real, user-visible information loss** for the rare
  fully-exhausted-lineage case → **Mitigation:** the loss is at Layer 3 only; Layer 1 assertions remain
  fully queryable (this is the same trade-off already accepted for the concept-exhaustion case, just
  applied one level down, not a new kind of loss). Fixture-tested so the behavior is pinned, not
  accidental.
- **[Risk] The topological-sink computation (Decision 4) adds a `NOT EXISTS` correlated subquery per
  lineage member** → **Mitigation:** bounded by lineage size (typically small — spelling variants of one
  name), and performance tuning at full scale is an explicit non-goal here, matching the original change's
  stance.
- **[Risk] Raising on duplicate root rows (Decision 1) is new, stricter behavior than today** — if any
  existing fixture or (eventually) real data has this defect, `derive_taxa()` now fails loudly where it
  previously silently produced a fanned-out result → **Mitigation:** this is the intended change (fail
  loudly on a real integrity violation instead of silently corrupting output), and no real data has been
  migrated yet (B4 hasn't started) — nothing running today is exposed to this newly-strict check.
- **[Risk] Coordination with a second, concurrently-drafted change** — `openspec/changes/
  contest-lineage-concept-edges/` (drafted 2026-08-20, after this change) gives the lineage/concept
  union-finds a per-subject ranked contest and an explicit negation mechanism, and separately revises
  the `spelling` CTE's exclusion list and the senior-lineage tie-break's `con_sources` input — all in
  this same function body, some in the exact CTEs Decisions 1-4 above touch. Concretely: **both changes
  independently modify the "Accepted spelling is the top-ranked opinion of the senior lineage"
  requirement** — this change adds `nomen nudum`/eligibility exclusions via the "canonical introducing
  edge per permid" concept (Decisions 1-2 above); that change adds a `negates`-based exclusion to the
  same `spelling` CTE's `WHERE` clause. The two are additive and don't touch the same clause, but →
  **Mitigation:** whichever change lands first, re-run the other's fixtures before merging, and whoever
  archives second folds both deltas into the main spec together rather than picking one; check that
  change's own design.md for current status before assuming this function's shape.

## Migration Plan

Target-schema function only, same shape as the original change:

1. Rewrite `derive_taxa()` in `postgresql/create_new.sql` per Decisions 1-4, in dependency order
   (Decision 1 first — everything else assumes deduplicated, per-permid identity and edge-candidate
   tables; Decisions 2 and 4 are independent of each other; Decision 3 requires no new code once Decision
   2 is correct).
2. Extend the existing fixture suite (from the archived change) with cases for: a permid with multiple
   competing lineage-introducing edges (exercises Decision 1's dedup and Decision 2's canonical-edge
   selection), a nomen-nudum-barred permid whose lineage still has an eligible sibling (Decision 2/3), a
   fully-exhausted lineage inside a surviving concept (Decision 3's carve-out), a fully-exhausted concept
   (already-decided terminal case, now actually exercised), and a lineage with 0 and with 2+ topological
   sinks (Decision 4's fallback).
3. Re-run the `derive_taxa(all) ≡ heads` invariant check via `rebuild_taxa()` against the extended
   fixtures; re-verify `derive_taxa(subset) ≡ derive_taxa(all)` for a permid inside each new fixture case.
4. Run against a from-empty build on localhost PG16, same verification bar as the original change.

**Rollback:** revert the `create_new.sql` function body to its pre-rework state. No deployed data depends
on it — the ledger is empty until B4, unchanged from the original change's rollback note.

## Open Questions

None — the one fork with real design consequences (the empty-lineage cascade, Decision 3) was resolved
with the user rather than deferred, since it changes both the spec text and the implementation approach.
The topological tie-break's exact secondary ordering (end of Decision 4) is a genuinely deferrable
implementation detail: it only affects which permid wins an already-rare degenerate tie, not the spec, the
chosen approach, or the task breakdown.
