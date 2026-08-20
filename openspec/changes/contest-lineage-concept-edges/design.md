## Context

See `proposal.md` - Why. `derive_taxa()`'s `lin_undir`/`con_undir` CTEs (`postgresql/create_new.sql`
~L5094-5157) union every current, non-removed `lineage`- or `concept`-class `name_opinions` edge
unconditionally — there is no per-subject ranking the way `assignment_opinions` already has. Multiple
current lineage-class (or concept-class) opinions about the same subject are already normal and expected
under root-only identity (`rework-derive-taxa`'s own Context section makes this point), but today they
don't compete — every one of them is honored as a graph edge.

This document reflects decisions settled so far in review; more edge cases are still being worked
through and may add to (not currently expected to overturn) the decisions below.

## Goals / Non-Goals

**Goals:**
- A per-subject ranked contest for lineage-class and concept-class `name_opinions`, mirroring the
  existing `evidence DESC, pubyr DESC, id DESC` canonical order already used elsewhere in `derive_taxa()`.
- A way for a winning opinion to assert that **no** lineage/concept relationship holds for its subject,
  expressed as an ordinary *targeted* opinion (same shape as any other lineage/concept row) rather than
  a free-floating, targetless claim.
- No relaxation of the existing `name_opinion_shape` CHECK — lineage/concept rows keep their
  required-target shape unchanged.

**Non-Goals:**
- Revisiting the union-find CTEs' construction beyond adding the ranking step ahead of them — the
  concept/lineage scoping split, junior-synonym borrowing, and containment-cycle guard are untouched.
- `original_permid`'s topological-sink tie-break *within a lineage* — `rework-derive-taxa`'s Decision 4,
  a different CTE (`_dt_linmeta`'s `roots`) than anything touched below. (Corrected from an earlier draft
  of this Non-Goals list, which lumped this in with `concept_permid`'s senior-lineage selection — that
  one *is* touched here, in D5, because `con_sources` is exactly what D1/D2 make stale.)
- Retraction semantics — unchanged; still reserved for transcription errors, not scientific disagreement.
- Opinion-to-opinion dispute references (an opinion pointing at another opinion's id rather than at a
  permid) — considered and rejected; see D2.
- `dependency_closure` / the incremental trigger — separate, untouched (per proposal.md).

## Decisions

### D1 — Per-subject ranked contest feeds the union-find

Before building `lin_undir`, compute each subject permid's single top-ranked current `lineage`-class
opinion (by `evidence DESC, pubyr DESC, id DESC`); only that row contributes an edge. A subject with
only one current opinion trivially "wins" with that opinion, same as today.

**Implementation note:** `_dt_mint`'s `SELECT` (`create_new.sql` L5081-5084) does not currently include
`negates` at all — it has to, since this ranking (and D4 below) both need to read it. This is plumbing,
not a spec-level fact on its own, but it's a real, easy-to-miss line-item: without it, the ranking has
nothing to check.

`con_undir` is ranked at a different granularity: **per lineage, not per permid.** The existing
`con_edge` construction already pools `concept`-class opinions up to the lineage level
(`ls.lin_rep`/`lt.lin_rep`) before the union-find runs, because concept membership is a property of a
whole lineage (a name and all its spelling variants share one synonymy fate — they are not split
concept-wise by which specific spelling happened to carry the opinion). So the ranked contest for
`concept`-class opinions pools every current opinion filed under *any* member permid of a lineage, and
picks the single top-ranked one to feed `con_undir` for that lineage. This is a direct consequence of
scoping the contest to match what the union-find already operates over — it does not introduce a new
granularity, just ranks within the one the code already uses.

**Rationale:** mirrors the pattern `assignment_opinions` already uses for its own per-subject contest.
Requires no schema change — nothing today constrains a subject to at most one live lineage/concept row
(confirmed by inspection of `create_new.sql`), and `rework-derive-taxa`'s own analysis already treats
multiple such opinions per subject as the normal case, not an anomaly.

**Alternatives considered:** none seriously entertained — this is the direct generalization of a pattern
already proven elsewhere in the same function.

### D2 — Negation is targeted, not a targetless "independence" flag — and is NOT pinned to the dictionary

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

In `derive_taxa()`: when a subject's D1 winner has `negates = true`, that subject contributes **no**
edge to the union-find for that edge_class this round. The winner's named target is not used
computationally — it is retained purely for provenance ("the specific relationship this opinion
rejects, with its own citation and evidence").

**Rationale:** the actual scientific claims this needs to express are targeted — "Myliobatus is *not a
misspelling of Myliobatis*" — not a generic "Myliobatus has no relationship to anything." Requiring a
target keeps every row self-describing and auditable, and, critically, means a negating opinion entered
with **no prior opinion on that specific relationship** is not a special case or an inconsistency: it
becomes the sole, trivially-winning candidate in that subject's D1 contest, exactly like any subject's
first opinion of any kind already is. Nothing distinguishes "negation with no antecedent" from "any
opinion with no antecedent."

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
- *NULL-target / free-floating negation* (the shape this change originally proposed) — rejected: it
  documents nothing about what is being rejected, and needs a `name_opinion_shape` relaxation for no
  corresponding benefit once the target is understood to be provenance-only rather than load-bearing.
- *Sentinel or self-referential target* — rejected: reintroduces the raw-value-switching pattern the
  schema's "Way 2" `edge_class` pinning was specifically designed to avoid, and overloads the existing
  self-referential-edge-forbidden invariant with a second, unrelated meaning.
- *Pinning `negates` to the dictionary, mirroring `edge_class` (Way 2)* — this change's own first draft;
  corrected above. Superseded because polarity isn't an intrinsic property of a reason the way class is,
  and the pin's only actual effect was to require new vocabulary that a free column makes unnecessary.
- *Opinion-to-opinion dispute references* — rejected as more machinery than needed. D1's per-subject
  ranked contest already lets a negating opinion compete against, and beat or lose to, any other opinion
  about the same subject without needing to name which specific prior opinion (if any) it disputes.

### D3 — Negation is scoped per edge_class, not one "fully independent" flag

Lineage-negation and concept-negation remain independent — a row's `negates` only ever competes within
the union-find for its own `edge_class`. This now falls out for free from `edge_class` already living on
every row (D2), rather than needing two separate dictionary tokens to keep them apart.

**Rationale:** lineage grouping (spelling variants) and concept grouping (synonymy) are already
orthogonal axes in this model. A name can be "not a misspelling" of something while still being a
synonym of the same concept under a different valid name — collapsing the two would lose a real
distinction taxonomists make.

**Generalizes beyond misspelling.** `derive_taxa()`'s union-find only inspects `edge_class`, never the
underlying reason token — `lineage` covers `correction`, `reranked`, `recombination`, and `misspelling`
alike; `concept` covers `junior synonym`, `replaced by`, `invalid subgroup`, and `nomen oblitum` alike.
D1's per-subject contest therefore already ranks a subject's current opinions *within an edge_class*
regardless of which reason each one carries, and D2's negation competes in that same contest at the same
granularity. A later opinion can unseat any lineage or concept reason this way, not just misspelling —
notably synonymy reversals ("A, long treated as a junior synonym of B, is here shown to be a valid,
distinct genus"), which are at least as common in practice as spelling disputes. This is also why
negation needs **no new reason tokens at all** (D2, corrected): the graph never reads the specific
reason, only `edge_class` and `negates`, so an existing reason paired with `negates = true` already
covers every case within that class — and keeps the record of *which specific claim* ("misspelling,"
"junior synonym," ...) was disputed, which a generic per-class token would have thrown away. The
original, now-outranked opinion stays on the ledger unretracted with its own specific reason, so the
record of *what* was disputed is never lost either way.

### D4 — The accepted-spelling candidate pool excludes negating rows, same as `never_accepted`

The `spelling` CTE (`create_new.sql` L5120-5127) selects `accepted_spelling_permid` by ranking every
`_dt_mint` row for a lineage's members, already excluding `never_accepted` (misspelling) rows via
`WHERE m.never_accepted = false`. That exclusion list gains `AND m.negates = false`.

**Rationale:** a negating row is a real `lineage`-class row with its own `evidence`/`pubyr` — nothing
stops it from being read as a "candidate spelling" today, and after D1/D2 it still isn't one: it asserts
the *absence* of a relationship, not a spelling. Left unexcluded, a negating opinion's evidence/year
would flow into `acc_ev`/`acc_yr`/`acc_id` (L5124), which the senior-lineage tie-break (D5, L5172) reads
as if it were evidence *for* that permid's accepted spelling — a category error, not just noise. This
mirrors the existing `never_accepted` exclusion exactly, so it's additive to an already-spec'd mechanism,
not a new one.

**Note on overlap with `rework-derive-taxa`:** that change's own delta also modifies this same
requirement (adding `nomen nudum` eligibility, via its "canonical introducing edge per permid" concept).
The two exclusions are independent — never_accepted/negates are properties of a specific edge, `nomen
nudum` is a property of a permid's winning `validity_opinions` row — but whoever archives both changes
will be looking at two deltas against the same requirement text and needs to fold this exclusion in
alongside theirs, not choose one over the other. Flagged in both changes' coordination notes.

### D5 — `con_sources` reflects currently-active concept edges, not raw existence

`con_sources` (`create_new.sql` L5162-5166) currently checks whether *any* `concept`-class opinion
exists in `name_opinions` for a lineage's members — win, lose, or now-negated, it doesn't matter. It
feeds the senior-lineage tie-break as the first sort key (`(cs.jr IS NULL) DESC`, L5171: prefer, as
senior, a lineage that was never proposed as anyone's junior). Redefine it as `SELECT DISTINCT jr FROM
con_edge` — i.e., a lineage counts as "a source" only if its current D1 winner is a non-negating concept
edge that's actually active in this round's union-find. This is simpler than the existing query, not
just more correct.

**Rationale:** before D1/D2, "has a concept-class opinion" and "has an *active* one" were the same fact —
every current concept opinion was unconditionally unioned. D1/D2 are exactly what makes them diverge:
a lineage whose only concept-class opinion was outranked, or successfully negated (confirmed *not* a
junior synonym), still gets flagged "a source" by the raw check and unfairly deprioritized in a future
tie, even though it currently has no outgoing concept edge at all. That's not a pre-existing bug this
change inherits unchanged — it's a direct, new consequence of introducing rankable/negatable concept
opinions, so it belongs in this change's scope.

**Scope note:** the main spec's "Seniority tiebreak is total and deterministic" requirement doesn't
document the "non-source first" criterion at all today — it's undocumented behavior that predates this
change. Fixing `con_sources`'s *definition* doesn't require documenting the criterion's existence, but
since this change is already touching it and it's genuinely testable, deterministic, user-facing
behavior, the delta spec formalizes it as part of the tie-break requirement rather than leaving it an
undocumented implementation detail a step further out of sync with the code.

## Risks / Trade-offs

- **A negating row's target could be misread as computationally binding, when it is provenance-only** →
  document explicitly, in both the spec and the `name_opinions` comments, that D1's ranking considers
  all of a subject's current lineage/concept opinions regardless of target, and a negating winner's
  target is never read by `derive_taxa()`'s graph construction.
- **A reader could assume `reason = 'misspelling', negates = true` still means "misspelling"** →
  document plainly (spec + column comment) that `negates` flips the polarity of whatever `reason`
  names; the pair is read together, not `reason` alone.
- **Merge coordination with `rework-derive-taxa`** → both changes touch the same `derive_taxa()` body
  region (the union-find CTEs and their immediate surroundings), and both independently modify the
  "Accepted spelling is the top-ranked opinion of the senior lineage" requirement (D4 above vs. their
  `nomen nudum`/eligibility work) — whoever archives second must fold both deltas together by hand, not
  pick one. Sequence the merges and re-run `rework-derive-taxa`'s fixtures after this change lands (or
  vice versa). Both changes' own docs carry a pointer to this note.
- **D4 and D5 both touch code `rework-derive-taxa` also reasons about, without changing the same lines**
  → D4 extends the `spelling` CTE's exclusion list (additive, not a rewrite of their eligibility logic);
  D5 only touches `con_sources`, which neither this change nor `rework-derive-taxa` touched before now.
  Low collision risk, but worth a second look at implementation time given how much of this function
  both changes are now touching.

## Resolved since first draft

- **Reason-token wording** (was an Open Question): moot — superseded by the D2 correction above.
  `negates` no longer has its own reason tokens to name; it pairs with whichever existing reason the
  negating opinion cites.
