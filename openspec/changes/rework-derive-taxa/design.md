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

The core structural fact driving the first four decisions below: under root-only identity, **a permid can
appear as `subject_permid` on more than one live `name_opinions` row** — its own `root` mint, plus any
number of `lineage`-class rows where opinions claim it's a form of something else (competing
recombination/misspelling/rank-change claims are normal, not anomalous). The current code's `_dt_mint`
conflates "one row per permid" with "one row per introducing-edge candidate," and that conflation is the
root cause of three of the first four gaps.

A second, related structural fact drives the remaining decisions: `derive_taxa()`'s lineage/concept
union-finds union *every* current, non-removed `lineage`- or `concept`-class edge unconditionally — there
is no per-subject ranking the way `assignment_opinions`/`validity_opinions` already have. So a later,
better-evidenced opinion can never outrank or sever an earlier lineage/concept claim; only retraction can
remove an edge, and retraction is deliberately reserved for correcting transcription errors, not
adjudicating legitimate scientific disagreement (GitHub issue
[paleobot/pbdb2-dev#51](https://github.com/paleobot/pbdb2-dev/issues/51)).

This document originally covered only the first gap, as a separate change from a second one covering the
`#51` gap. They were folded together (2026-08-20) once review found the two touching the same function
closely enough — including two independent edits to the same "Accepted spelling" requirement, and a
ranking primitive (`_dt_permid_edge`, Decision 1) the second gap's fix can reuse rather than duplicate —
that keeping them apart risked one implementation going stale the moment the other landed.

## Goals / Non-Goals

**Goals:**
- `derive_taxa()` satisfies the `taxa-opinions` spec's existing requirements exactly (one row per minted
  permid; never-accepted exclusion scoped to the right permid).
- `derive_taxa()` implements the nomen-nudum candidacy bar and its empty-lineage/-concept cascade
  (§9.8.4.2), consistent with ICZN Article 23.1 (priority/valid-name status applies only among
  *available* names — an unavailable name is outside the contest entirely, not a loser within it).
- `original_permid` uses the topological (lineage-sink) definition, with a defined, deterministic
  fallback for the genuinely degenerate cases.
- A per-subject ranked contest for lineage-class and concept-class `name_opinions`, mirroring the
  existing `evidence DESC, pubyr DESC, id DESC` canonical order already used elsewhere in `derive_taxa()`.
- A way for a winning opinion to assert that **no** lineage/concept relationship holds for its subject,
  expressed as an ordinary *targeted* opinion (same shape as any other lineage/concept row) rather than
  a free-floating, targetless claim.
- All of the above provable by fixtures, matching the original change's testing approach.

**Non-Goals:**
- `dependency_closure` / the incremental trigger (§9.6.4, B2) — untouched, `derive_taxa(seed := NULL)`
  doesn't depend on it.
- Performance tuning at full scale (~517K permids) — correctness first, same non-goal the original change
  already accepted.
- Any change to `rebuild_taxa()`'s diff/append logic or the `assert_taxa_invariant()` shape — they call
  `derive_taxa()` as a black box and need no changes for this rework.
- Revisiting the already-correct parts of the union-find CTEs' construction beyond adding the ranking
  step ahead of them — the concept/lineage scoping split, junior-synonym borrowing, and the containment
  cycle guard are untouched.
- Retraction semantics — unchanged; still reserved for transcription errors, not scientific disagreement.
- Opinion-to-opinion dispute references (an opinion pointing at another opinion's id rather than at a
  permid) — considered and rejected; see Decision 5.
- Relaxing the existing `name_opinion_shape` CHECK — lineage/concept rows keep their required-target
  shape unchanged; negation does not need a targetless form (Decision 5).

## Decisions

### 1. Split "one row per permid" (identity) from "candidate introducing edges" (ranking input)

Replace the single `_dt_mint` with two temp tables:

- **`_dt_identity`** — exactly one row per permid, built `WHERE edge_class = 'root'` only:
  `(permid, opinion_id, new_name, rank_id, authority_id)`. This becomes the sole source of identity in
  the final assembly and the sole definition of "which permids exist" (a permid with no root row isn't
  minted and gets no output row — consistent with root-only identity's own invariant that migration mints
  a root row for every legacy `authorities` row).
- **`_dt_edge_cand`** — one row per (permid, introducing opinion) pair, `WHERE edge_class IN
  ('root','lineage')` (unchanged filter from the old `_dt_mint`), carrying `evidence`/`yr`/
  `never_accepted` for ranking, and now also `negates` (Decision 5 needs to read it here, and Decision 7
  reuses this same table for the lineage side of its union-find ranking rather than re-querying
  `name_opinions` from scratch).

From `_dt_edge_cand`, compute **`_dt_permid_edge`** — one row per permid, the permid's own canonical
introducing edge: `row_number() OVER (PARTITION BY permid ORDER BY evidence DESC, yr DESC NULLS LAST,
opinion_id DESC) = 1`. This row supplies, per permid: `winning_name_opinion_id` (matching
`classic-taxa-opinions.md` §9.8.4.1's "canonical-winner introducing edge, or the root if the permid has
no lineage edge"), and the `never_accepted`/`negates` flags used by Decision 2.

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

### 2. `never_accepted`, the nomen-nudum bar, and negation are all permid-scoped, evaluated together, before lineage ranking

The `spelling` CTE (inside `_dt_linmeta`) currently ranks `_dt_mint` rows directly and filters
`WHERE m.never_accepted = false`. Replace its input with **`eligible`** — one row per permid,
joining `_dt_permid_edge` (for the canonical edge's `never_accepted`, `negates`, and evidence/yr/id) with
`_dt_valid` (for the winning validity opinion's `bars_candidacy`, sourced from
`dictionaries.nomenclatural_statuses` — `_dt_valid` needs `bars_candidacy` added to its `SELECT`, not
just `status_id`):

```sql
eligible AS (
    SELECT pe.permid, pe.evidence, pe.yr, pe.opinion_id
    FROM _dt_permid_edge pe
    LEFT JOIN _dt_valid dv ON dv.permid = pe.permid
    WHERE pe.never_accepted = false
      AND pe.negates = false
      AND COALESCE(dv.bars_candidacy, false) = false
)
```

`_dt_valid` must therefore be computed **before** `_dt_linmeta` in the function body (it currently runs
near the end, after `_dt_assign`/`_dt_node`) — a real reordering, not just an addition.

The `spelling` CTE then ranks `_dt_lin JOIN eligible` instead of `_dt_lin JOIN _dt_mint WHERE
never_accepted=false`. This single change fixes the exclusion scoping, implements the nomen-nudum bar,
and excludes negating opinions from spelling contention, all in one place, since all three are "is this
permid itself eligible to represent its lineage," just sourced from three different disqualifying facts
(a never-accepted introducing edge, a `bars_candidacy` validity ruling, or the introducing edge itself
asserting the *absence* of a relationship rather than a spelling — Decision 5).

**Why negation belongs here, not in a separate patch:** a negating row is a real `lineage`-class row
with its own `evidence`/`pubyr` — nothing else in this function stops it from being read as a "candidate
spelling," and it isn't one. Left unexcluded, a negating opinion's evidence/year would flow into
`acc_ev`/`acc_yr`/`acc_id` (used by the senior-lineage tie-break, Decision 8's `ranked` CTE) as if it were
evidence *for* that permid's accepted spelling — a category error, not just noise.

*Alternative considered:* keep `never_accepted`, the nomen-nudum bar, and negation as three separate
filter passes. Rejected — all three are the same kind of fact ("is this permid eligible"), and a single
`eligible` CTE keeps the empty-lineage cascade (Decision 3) working through one exclusion point instead
of three.

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
A negation-caused exclusion (Decision 2) is a third way into this same cascade, not a new one: a lineage
whose sole permid's only introducing edge is negating is exhausted exactly like one barred by
`never_accepted`/`nomen nudum`, and falls out through the same joins.

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

### 5. Negation is targeted, not a targetless "independence" flag — and is NOT pinned to the dictionary

Add `negates boolean NOT NULL DEFAULT false` directly to `name_opinions`, **unconnected to
`reason_id`** (no dictionary column, no extended composite FK). `name_opinion_shape` is **unchanged**
in the sense that matters: a `negates = true` row has the exact same shape as any other
`lineage`/`concept` edge — `subject_permid`, a required `target_permid`, `evidence`, `reference_id` —
it just asserts the *absence* of the relationship it names rather than its presence. The only new
constraint is structural: `edge_class = 'root'` rows must have `negates = false` (identity minting is
never negated), folded into the existing minting-shape CHECK. No new `namechange_reasons` tokens —
a negating row cites an **ordinary, existing** reason: `reason = 'misspelling', negates = true` reads
as "not a misspelling of [target]"; `reason = 'junior synonym', negates = true` reads as "not a junior
synonym of [target]."

In `derive_taxa()`: when a subject's Decision 7 winner has `negates = true`, that subject contributes
**no** edge to the union-find for that edge_class this round. The winner's named target is not used
computationally — it is retained purely for provenance ("the specific relationship this opinion
rejects, with its own citation and evidence").

**Rationale:** the actual scientific claims this needs to express are targeted — "Myliobatus is *not a
misspelling of Myliobatis*" — not a generic "Myliobatus has no relationship to anything." Requiring a
target keeps every row self-describing and auditable, and, critically, means a negating opinion entered
with **no prior opinion on that specific relationship** is not a special case or an inconsistency: it
becomes the sole, trivially-winning candidate in that subject's Decision 7 contest, exactly like any
subject's first opinion of any kind already is. Nothing distinguishes "negation with no antecedent" from
"any opinion with no antecedent."

**Corrected after review (2026-08-20):** the first draft of this decision pinned `negates` to the
dictionary via the same "Way 2" composite-FK pattern `edge_class` already uses, and consequently had to
invent two new placeholder reason tokens (`not a form of`, `not synonymous with`) just to have something
with `negates = true` to cite. That was a mistake: Way 2 is right for `edge_class` because a reason's
class is a genuine, permanent fact about that reason — `misspelling` is *always* lineage-class, full
stop. Polarity isn't like that. Whether "misspelling" is being asserted or rejected is a fact about a
*specific opinion*, not about the reason category — the same reason token is equally at home on either
side. Pinning `negates` to the dictionary forced every row citing an existing reason into one fixed
polarity, which is exactly the constraint that then required inventing vocabulary to route around.
Making `negates` a free column on the row removes the constraint and the workaround at the same time,
and is strictly more expressive: the negation stays as specific as the claim it rejects (`misspelling`
vs. `junior synonym` vs. `recombination`, etc.) instead of collapsing into one generic bucket per
edge_class.

**Alternatives considered:**
- *NULL-target / free-floating negation* (this decision's own first draft) — rejected: it documents
  nothing about what is being rejected, and needs a `name_opinion_shape` relaxation for no corresponding
  benefit once the target is understood to be provenance-only rather than load-bearing.
- *Sentinel or self-referential target* — rejected: reintroduces the raw-value-switching pattern the
  schema's "Way 2" `edge_class` pinning was specifically designed to avoid, and overloads the existing
  self-referential-edge-forbidden invariant with a second, unrelated meaning.
- *Pinning `negates` to the dictionary, mirroring `edge_class` (Way 2)* — this decision's own first draft;
  corrected above. Superseded because polarity isn't an intrinsic property of a reason the way class is,
  and the pin's only actual effect was to require new vocabulary that a free column makes unnecessary.
- *Opinion-to-opinion dispute references* — rejected as more machinery than needed. Decision 7's
  per-subject ranked contest already lets a negating opinion compete against, and beat or lose to, any
  other opinion about the same subject without needing to name which specific prior opinion (if any) it
  disputes.

### 6. Negation is scoped per edge_class, not one "fully independent" flag

Lineage-negation and concept-negation remain independent — a row's `negates` only ever competes within
the union-find for its own `edge_class`. This falls out for free from `edge_class` already living on
every row (Decision 5), rather than needing two separate dictionary tokens to keep them apart.

**Rationale:** lineage grouping (spelling variants) and concept grouping (synonymy) are already
orthogonal axes in this model. A name can be "not a misspelling" of something while still being a
synonym of the same concept under a different valid name — collapsing the two would lose a real
distinction taxonomists make.

**Generalizes beyond misspelling.** `derive_taxa()`'s union-find only inspects `edge_class`, never the
underlying reason token — `lineage` covers `correction`, `reranked`, `recombination`, and `misspelling`
alike; `concept` covers `junior synonym`, `replaced by`, `invalid subgroup`, and `nomen oblitum` alike.
Decision 7's per-subject contest therefore already ranks a subject's current opinions *within an
edge_class* regardless of which reason each one carries, and negation competes in that same contest at
the same granularity. A later opinion can unseat any lineage or concept reason this way, not just
misspelling — notably synonymy reversals ("A, long treated as a junior synonym of B, is here shown to be
a valid, distinct genus"), which are at least as common in practice as spelling disputes. This is also
why negation needs **no new reason tokens at all** (Decision 5, corrected): the graph never reads the
specific reason, only `edge_class` and `negates`, so an existing reason paired with `negates = true`
already covers every case within that class — and keeps the record of *which specific claim*
("misspelling," "junior synonym," ...) was disputed, which a generic per-class token would have thrown
away. The original, now-outranked opinion stays on the ledger unretracted with its own specific reason,
so the record of *what* was disputed is never lost either way.

### 7. Per-subject/per-lineage ranked contest feeds the union-finds

Before building `lin_undir`, compute each subject permid's single top-ranked current `lineage`-class
opinion (by `evidence DESC, pubyr DESC, id DESC`) — reusing Decision 1's `_dt_edge_cand`, filtered to
`edge_class = 'lineage'` and re-ranked per permid over that narrower set (`_dt_permid_edge` itself is the
wrong source here: its ranking pool includes `root` rows, which is correct for eligibility but wrong for
union-find feeding, since a `root` row has no target and can never contribute an edge). Only the winning
row contributes an edge; if it has `negates = true` (Decision 5), the subject contributes no edge this
round. A subject with only one current lineage-class opinion trivially "wins" with that opinion, same as
today.

`con_undir` is ranked at a different granularity: **per lineage, not per permid.** The existing
`con_edge` construction already pools `concept`-class opinions up to the lineage level
(`ls.lin_rep`/`lt.lin_rep`) before the union-find runs, because concept membership is a property of a
whole lineage (a name and all its spelling variants share one synonymy fate — they are not split
concept-wise by which specific spelling happened to carry the opinion). So the ranked contest for
`concept`-class opinions pools every current opinion filed under *any* member permid of a lineage, and
picks the single top-ranked one to feed `con_undir` for that lineage — again, non-negating winners
contribute an edge, negating winners contribute none. `concept`-class rows aren't in `_dt_edge_cand`
(which is scoped to `root`/`lineage` for Decision 1's purposes), so this ranking is its own new
computation over `name_opinions WHERE edge_class = 'concept'` joined to `_dt_lin`, not a reuse of an
existing table.

**Rationale:** mirrors the pattern `assignment_opinions` already uses for its own per-subject contest.
Requires no schema change to the union-find edges themselves — nothing constrains a subject to at most
one live lineage/concept row (confirmed by inspection of `create_new.sql`), and multiple such opinions
per subject are the normal case under root-only identity (Context, above), not an anomaly.

**Alternatives considered:** none seriously entertained for the ranking mechanism itself — it's the
direct generalization of a pattern already proven elsewhere in the same function. Building it as a
from-scratch computation independent of `_dt_edge_cand`, rather than reusing that table for the lineage
side, was considered and rejected: it would duplicate the exact same "gather root/lineage candidates for
a permid" query Decision 1 already does.

### 8. `con_sources` reflects currently-active concept edges, not raw existence

`con_sources` (inside `_dt_conmeta`) currently checks whether *any* `concept`-class opinion exists in
`name_opinions` for a lineage's members — win, lose, or now-negated, it doesn't matter. It feeds the
senior-lineage tie-break as the first sort key (prefer, as senior, a lineage that was never proposed as
anyone's junior). Redefine it as the lineages appearing as a source in Decision 7's winning `con_edge`
output — i.e., a lineage counts as "a source" only if its current ranked-contest winner is a
non-negating concept edge that's actually active in this round's union-find. This is simpler than the
existing query, not just more correct.

**Rationale:** before Decisions 5-7, "has a concept-class opinion" and "has an *active* one" were the
same fact — every current concept opinion was unconditionally unioned. Decisions 5-7 are exactly what
make them diverge: a lineage whose only concept-class opinion was outranked, or successfully negated
(confirmed *not* a junior synonym), still gets flagged "a source" by the raw check and unfairly
deprioritized in a future tie, even though it currently has no outgoing concept edge at all. That's not
a pre-existing bug this change inherits unchanged — it's a direct, new consequence of introducing
rankable/negatable concept opinions, so it belongs in this change's scope.

**Scope note:** the main spec's "Seniority tiebreak is total and deterministic" requirement doesn't
document the "non-source first" criterion at all today — it's undocumented behavior that predates this
change. Fixing `con_sources`'s *definition* doesn't require documenting the criterion's existence, but
since this change is already touching it and it's genuinely testable, deterministic, user-facing
behavior, the delta spec formalizes it as part of the tie-break requirement rather than leaving it an
undocumented implementation detail a step further out of sync with the code.

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
- **[Risk] A negating row's target could be misread as computationally binding, when it is
  provenance-only** → document explicitly, in both the spec and the `name_opinions` comments, that
  Decision 7's ranking considers all of a subject's current lineage/concept opinions regardless of
  target, and a negating winner's target is never read by `derive_taxa()`'s graph construction.
- **[Risk] A reader could assume `reason = 'misspelling', negates = true` still means "misspelling"** →
  document plainly (spec + column comment) that `negates` flips the polarity of whatever `reason`
  names; the pair is read together, not `reason` alone.
- **[Risk] This change is no longer function-only** — Decision 5 adds a `negates` column and a CHECK
  clause to `name_opinions` itself → **Mitigation:** it's one additive column and one additive CHECK
  clause, not a restructuring; no existing column is dropped, renamed, or retyped, and no other table is
  touched.

## Migration Plan

Same shape as the original change, extended for the merged scope:

1. Add the `negates boolean NOT NULL DEFAULT false` column to `name_opinions` and extend
   `name_opinion_shape` with the root-rows-never-negate clause (Decision 5) — the one schema change,
   applied before the function rewrite.
2. Rewrite `derive_taxa()` in `postgresql/create_new.sql` per Decisions 1-4 and 7-8, in dependency order
   (Decision 1 first — everything else assumes deduplicated, per-permid identity and edge-candidate
   tables, now including `negates`; Decisions 2 and 4 are independent of each other; Decision 3 requires
   no new code once Decision 2 is correct; Decision 7's union-find ranking can be implemented alongside
   Decision 1 since it reuses `_dt_edge_cand`; Decision 8 is independent and can land any time after
   Decision 7's `con_edge` exists).
3. Extend the existing fixture suite (from the archived change) with cases for: a permid with multiple
   competing lineage-introducing edges (exercises Decision 1's dedup and Decision 2's canonical-edge
   selection), a nomen-nudum-barred permid whose lineage still has an eligible sibling (Decision 2/3), a
   fully-exhausted lineage inside a surviving concept (Decision 3's carve-out), a fully-exhausted concept
   (already-decided terminal case, now actually exercised), a lineage with 0 and with 2+ topological
   sinks (Decision 4's fallback), a subject with competing lineage/concept opinions where the
   higher-ranked one redirects the union-find (Decision 7), a winning negation that removes a subject
   from its claimed lineage/concept (Decisions 5-7), and a lineage whose only concept-class opinion is
   outranked or negated no longer being deprioritized in the seniority tie-break (Decision 8).
4. Re-run the `derive_taxa(all) ≡ heads` invariant check via `rebuild_taxa()` against the extended
   fixtures; re-verify `derive_taxa(subset) ≡ derive_taxa(all)` for a permid inside each new fixture case.
5. Run against a from-empty build on localhost PG16, same verification bar as the original change.

**Rollback:** revert the `create_new.sql` function body to its pre-rework state, and drop the `negates`
column/CHECK clause. No deployed data depends on it — the ledger is empty until B4, unchanged from the
original change's rollback note.

## Open Questions

None — the one fork with real design consequences (the empty-lineage cascade, Decision 3) was resolved
with the user rather than deferred, since it changes both the spec text and the implementation approach.
The topological tie-break's exact secondary ordering (end of Decision 4) is a genuinely deferrable
implementation detail: it only affects which permid wins an already-rare degenerate tie, not the spec, the
chosen approach, or the task breakdown.
