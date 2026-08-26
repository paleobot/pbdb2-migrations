## Context

`docs/taxonomy-user-guide.html` establishes the visual system (fonts/tokens/components) and the narrative
voice (plain-language, curator-facing, no code) this guide reuses verbatim. It also establishes a
precedent this design leans on directly: its own worked examples and "What's actually different from
Classic" section are grounded in real Classic behavior, not hypothetical narration (Cases 1 & 3 are cited
to the Classic PBDB User Guide; the comparison table cites specific Classic mechanisms — the daemon, the
write-back-on-read, the four-step evidence enum — each traceable to real code, not paraphrase).

This guide's subject (containment/hierarchy across `taxa`, `taxa_clades`, `clade_attachments`) has a
Classic analogue that is genuinely comparable, and — per the user's direction — the design now grounds its
worked examples in a real, verified comparison against it rather than an invented one. `pbdb_archive`
(a Postgres-ported copy of Classic, reachable via `pg-classic-pool.js` per this contributor's local setup)
retains Classic's live `authorities`/`opinions`/`taxa_tree_cache` tables. `pg_play` (via `pg-play-pool.js`)
holds the current derived output of `derive_taxa()`, `derive_taxa_clades()`, and `derive_clade_attachments()`
from the `derive-clade-attachments` change (implemented, validated, pending archive). Both were queried
directly while drafting this design — see Decisions below for what turned up.

The three tables and their derivations are already fully specified in `openspec/specs/taxa-opinions/spec.md`
(classification pooling, containment-cycle handling) and `openspec/changes/derive-clade-attachments/specs/
{taxa-clades,clade-attachments}/spec.md`. This design does not re-derive that behavior; it only decides how
to *present* it.

## Goals / Non-Goals

**Goals:**
- Decide the guide's section structure and how it maps onto the three tables/derivations, following
  `docs/taxonomy-user-guide.html`'s existing shape (hero → big idea → mechanism → tie-breaking → case files
  → what's different from Classic → footer).
- Pin down the specific worked examples, each backed by a live query against `pg_play` and/or
  `pbdb_archive` performed during this design pass, with the actual returned values recorded here so the
  writer of the HTML doesn't have to re-derive or guess at them.
- Decide how deep the Classic comparison goes for this topic, given that Classic's containment story is
  structurally thinner than pbdb2's (see Decisions).

**Non-Goals:**
- No new query, script, or tooling deliverable — the verification queries in this design are throwaway
  (run once against `pg_play`/`pbdb_archive` to source example data), not a durable artifact.
- No coverage of naming/identity (lineages, concepts, spellings, misspellings) — that's
  `docs/taxonomy-user-guide.html`'s territory; this guide assumes the reader either already knows it or is
  pointed there.
- No coverage of `occurrences` or any other consumer of the classification — scope is strictly the three
  tables and how they relate taxa/concepts to each other.

## Decisions

### Structure mirrors the existing guide's five-part shape, adapted to three tables instead of one

1. **Hero** — same tone, framed as a companion piece ("this page assumes you've read the identity half;
   here's the relationship half").
2. **The big idea** — two hierarchies, not one: Linnaean classification (`taxa`) and clade-to-clade
   containment (`taxa_clades`) are kept structurally separate rather than merged into one mixed tree, with
   `clade_attachments` as the explicit, many-to-many bridge between them. A single diagram (three boxes:
   Linnaean tree / clade tree / attachments, styled like the existing guide's recompute diagram) carries
   this.
3. **The mechanism** — classification pooling (junior-synonym borrowing, equal-rank-only, species
   excluded), the rank-cardinality exclusion (Linnaean side only), and why an unranked lineage is
   structurally barred from either containing or being contained by a Linnaean concept via the normal path.
4. **Breaking ties / cycles** — reuse the existing guide's evidence→year→entry-order ranking strip
   verbatim (same rule, same order — this is the one piece of mechanism that's genuinely identical across
   `taxa`/`taxa_clades`/`clade_attachments`), then a dedicated sub-section on the one place the two
   hierarchies diverge: `derive_taxa()` raises on a genuine Linnaean containment cycle; `derive_taxa_clades()`
   resolves a clade cycle automatically by cutting its weakest edge, because clades have no rank ordering to
   serve as a structural cycle-preventer the way Linnaean ranks do.
5. **Case files** — three worked examples below, presented in the existing guide's case-tab/case-body
   format: a disclosed risk (Case 1), a genuine trade-off (Case 2), and an unambiguous, verified win for
   pbdb2's design over Classic's (Case 3) — a deliberately mixed picture, not three variations on the same
   point. See the Risks/Trade-offs section for why this mix, not uniform positivity or uniform caution, is
   the honest one.
6. **What's different from Classic** — see the dedicated decision below; framed differently from the
   existing guide's term-swap table, because Classic's containment story doesn't map onto pbdb2's
   term-for-term.
7. **Footer** — same "where this stands today" status note, updated to reflect that `taxa_clades`/
   `clade_attachments` are implemented and validated but the parent OpenSpec change is still pending
   archive.

**Alternative considered**: a from-scratch structure organized by table (one section per `taxa`/
`taxa_clades`/`clade_attachments`). Rejected — it would read as three separate reference entries rather
than one story, and would lose the "why are these different tables at all" framing that's the actual point
of the guide.

### Worked example 1 (flagship): the Ornithopoda / Clypeodonta cycle, verified against both databases

This is the guide's centerpiece precisely because it's a real, disclosed risk
(`derive-clade-attachments/design.md`'s Risks section) made concrete by a live comparison, not a
hypothetical. Verified during this design pass:

- **In `pbdb_archive` (Classic)**: all three opinions on record for this pair agree on one direction —
  *Clypeodonta belongs to Ornithopoda* (opinion_no 566356, 807521, 825844; the last "stated with
  evidence"). Classic's own materialized `taxa_tree_cache` reflects exactly that (Clypeodonta's cached
  `opinion_no` 807521 has parent = Ornithopoda), and separately places Ornithopoda under Cerapoda — an
  uncontested placement matching standard ornithischian phylogeny (Cerapoda = Ornithopoda + Marginocephalia).
  There is no genuine disagreement in the source opinions about this pair's direction.
- **In `pg_play` (pbdb2, current)**: `derive_taxa_clades()`'s cycle-resolution has it backwards. Ornithopoda's
  concept (`containing_concept_permid`) now resolves to Clypeodonta, and Clypeodonta itself sits under
  Neornithischia — not under Ornithopoda at all.
- **The point for the guide**: this is exactly the "occasional backwards placement on ties" caveat
  `derive-clade-attachments/design.md` disclosed in the abstract, now shown to have actually happened, on a
  pair where literally every entered opinion (including the one with stated evidence) points the other way.
  It's a strong, honest example of the trade-off pbdb2 made deliberately (see that design's Decisions: no
  rank-cardinality firewall exists for clades, so automatic resolution beats blocking the whole derivation,
  but it isn't free) — and it's more persuasive **because** it's real, not constructed for the guide.

The guide should present this plainly: Classic got this one right by accident (no pooling machinery to go
wrong), pbdb2's automatic cycle-resolution got it wrong on this specific pair, and that's disclosed rather
than hidden — consistent with `[feedback] No historical-fix narrative in docs`: state current behavior
plainly, don't narrate it as an unresolved bug being chased, since it's a known, accepted trade-off with an
inspectable audit trail (`_dtc_excluded_opinions`), not an open defect.

**Alternative considered**: soften this to a hypothetical ("suppose two clades formed a cycle..."), matching
`docs/taxonomy-user-guide.html`'s Case 2/4 pattern (marked `hypo` where real citations weren't available).
Rejected — unlike those cases, real, already-verified data exists for this exact scenario (`derive-clade-
attachments/tasks.md` task 2.4 already flagged it), so presenting it as hypothetical would be a step
backward from material already on hand.

### Worked example 2 (everyday case, honest trade-off): Bredocaris — two containers, not one

The original draft of this example used four Pancrustacea-attaching genera as an uncomplicated "everyday
case." Re-verifying one of them (`Bredocaris`) against both databases surfaced something more interesting
and more honest than "pbdb2 handles this cleanly, Classic doesn't": a genuine trade-off, not a one-sided
improvement. This is now the second case file, replacing the four-genus list.

- **In `pbdb_archive` (Classic)**: exactly two opinions exist for `Bredocaris` — "belongs to Orstenocarida"
  (order; no stated basis; filed under reference 6930, which Classic's own `reliability_index` expression
  pins to the lowest tier regardless of its nominal `basis`) and "belongs to Pancrustacea" (unranked clade;
  "stated with evidence"). Classic's single evidence-ranked pool (`getMostRecentClassification`, `ORDER BY
  reliability_index DESC, pubyr DESC, opinion_no DESC`) picks the better-evidenced opinion regardless of
  rank category: `taxa_tree_cache` shows Bredocaris's one true classification as Pancrustacea. The weaker
  Orstenocarida opinion is never deleted, but it becomes invisible in the derived classification — nothing
  in Classic's read path surfaces it once it loses the ranking.
- **In `pg_play` (pbdb2, current)**: `taxa.containing_concept_permid` for Bredocaris resolves to
  Orstenocarida — the *weaker*-evidenced opinion — because `_dt_assign`'s pool only ever contains
  same-side (ranked) candidates; the better-evidenced Pancrustacea opinion is excluded from that pool by
  design (it's cross-boundary) and is only visible in `clade_attachments`, a separate table.
- **The point for the guide**: this is a genuine trade-off, not a strict improvement, and the guide should
  say so plainly. **Gain**: nothing is silently discarded — Classic's single-winner ranking makes the
  losing opinion vanish from the derived classification entirely, while pbdb2 keeps both facts as explicit,
  queryable rows. **Cost**: pbdb2 currently has no single answer to "what's Bredocaris's best-evidenced
  classification, full stop" — `taxa` alone can surface a *weaker*-evidenced opinion than the one sitting
  right next to it in `clade_attachments`, because the two pools never compete against each other directly.
  A reader who only queries `taxa` gets a less-supported answer than Classic gave for the exact same
  question. This matches `derive-clade-attachments/proposal.md`'s own Non-Goals: presenting a single
  combined ranked+clade view is explicitly future work, not something either table does today.

**Alternative considered**: keep the original four-genus list (`Waptiida`, `Skara`, `Bredocaris`,
`Pentapalaeopycnon`), all attaching cleanly into `Pancrustacea` with no competing Linnaean claim, as an
uncomplicated "this is what the ordinary case looks like" example. Rejected once Bredocaris's own `taxa`
row turned out to hold a *second*, independently-sourced containment (`Orstenocarida`) — the clean,
single-relationship framing wasn't actually representative of what's in the data, and presenting it that
way would have been a milder version of exactly the overclaiming problem this correction is fixing.
**Alternative considered**: use `Cryptoclidus`→`Plesiosauria` or `Austrosaurus`→`Titanosauria` (from
`derive-clade-attachments/tasks.md`'s own spot-checks) instead of Bredocaris. Not pursued for this
example — `Plesiosauria` alone appears as order/suborder/unranked clade/subclass across four different
Classic `taxon_no` rows, a real but *different* phenomenon (spelling-rank inconsistency, already the
naming guide's territory) that would muddy this specific point.

### Worked example 3 (unambiguous win): Wiwaxia's coexisting hypotheses, preserved rather than overwritten

Asked directly whether any example lands unambiguously in pbdb2's favor (not just "different, with a
cost"), the answer — verified, not assumed — is yes: `Wiwaxia`, a famous taxonomically "problematic"
Cambrian fossil whose biological affinities have been genuinely, repeatedly re-argued in the literature.

- **In `pbdb_archive` (Classic)**: six opinions exist across Wiwaxia's history, in entry order — *Sachitida*
  (order; no stated basis; filed under reference 6930, which Classic's reliability expression pins to the
  lowest tier), *Halwaxida* (unranked clade; "stated with evidence"; opinion_no 166663 — **Classic's
  current cached classification**), *Annelida* (phylum; "stated without evidence"), *Metazoa* (subkingdom;
  "second hand"), and *Wiwaxidae* (family) twice — first "stated without evidence," then, in the most
  recent opinion on record, "stated with evidence" (opinion_no 595291). Because Classic's `taxa_tree_cache`
  holds exactly one `parent_no` per taxon, every opinion that isn't the current cached winner — including
  the historically significant Sachitida and Annelida hypotheses, and arguably the more-current Wiwaxidae
  opinion — is invisible in the derived classification. A curator browsing Wiwaxia's Classic page sees only
  "Halwaxida," with no indication any other hypothesis was ever seriously entertained short of digging into
  raw `opinions`.
- **In `pg_play` (pbdb2, current)**: `taxa.containing_concept_permid` for Wiwaxia resolves to **Wiwaxidae**
  — matching Classic's newest, best-evidenced opinion, so the primary answer is itself correct here (unlike
  Case 2, there's no cost on this side). *Separately*, `clade_attachments` retains **two more**,
  independently visible facts about Wiwaxia: a `ranked-in-clade` attachment to **Sachitida** (winning
  opinion id 119213, evidence = true) and another to **Annelida** (winning opinion id 174800, evidence =
  false). Both coexist as real, queryable rows — not superseded, not merged away, not silently dropped for
  losing a ranking contest against each other, because they're not actually competing (each is a distinct
  `(subject concept, target concept)` pair, per the clade-attachments spec's pair-scoped winner selection).
- **The point for the guide**: this is not a trade-off — the primary classification is correct *and* real,
  additional, independently-sourced information survives that Classic's single-parent architecture cannot
  represent at all, for any taxon, by construction. Every one of Wiwaxia's superseded Classic opinions still
  exists in raw `opinions` too, of course, on both sides — the difference is that pbdb2's derived layer
  gives some of that history (specifically, the non-conflicting cross-boundary claims) a permanent, visible
  home instead of only the SQL rank-and-discard fate everything but the single winner gets in Classic.

**Alternative considered**: generalize this into a claim about `clade_attachments`' many-to-many
cardinality broadly (`derive-clade-attachments/tasks.md` already found 3,364 subjects with >1 accepted
target). Rejected as the lead framing — a bare cardinality statistic doesn't land the way a specific,
recognizable, genuinely contested taxon does; Wiwaxia's own tangled history *is* the argument, not just an
instance of it. The first candidate multi-target concept found while searching for this example (a large
cluster of sauropod genera — Diplodocus, Apatosaurus, Camarasaurus, Brontosaurus, and others — all sharing
one concept and an identical 18-target attachment set) was passed over for this reason: it's real data, not
an error, but it reads as a wall of names rather than a legible point, and untangling *why* they're all one
concept would be a distraction this guide doesn't need.

### The "what's different from Classic" section is reframed, not a term-swap table

`docs/taxonomy-user-guide.html`'s closing section is a direct old-term → new-term comparison, because
naming/identity concepts have a clean one-to-one Classic analogue (`taxon_no`, `orig_no`, `synonym_no`,
etc.). Containment doesn't, for one specific reason worth stating plainly in the guide: **Classic has no
separate concept of a clade hierarchy or a cross-boundary attachment at all.** An unranked clade in Classic
is just another row in `taxa_tree_cache`, classified by the exact same `getMostRecentClassification` ranking
as anything else, with its rank-order sanity check simply switched off (per `Opinion.pm`) rather than
routed anywhere different. So the comparison this guide draws is not "old term → new term" but "one
undifferentiated tree, ranked by evidence regardless of category, one answer per taxon → three explicit
ledgers, each ranked independently within its own category, multiple coexisting answers where the evidence
genuinely supports more than one." That split cuts both ways, and the three case files carry all of it
concretely, not just the flattering half: Case 1 shows a place the split's isolation misfires (a clade
cycle resolved backwards, with no rank ordering left to catch it); Case 2 shows the same isolation's real
recurring cost (evidence no longer competes across the boundary, so the "primary" `taxa` table can hold a
weaker-evidenced answer than the one sitting in `clade_attachments` right next to it); Case 3 shows the
same structural separation paying off cleanly (a taxon whose genuinely contested history Classic's
single-parent design can only ever reduce to one visible answer, while pbdb2 keeps the real alternatives on
record). The closing section should state all three honestly, not lead with or dwell on only one, and point
back to the case files rather than presenting a table with mostly empty "Classic" cells.

**Alternative considered**: keep the term-swap table format but leave most "Classic" cells blank or marked
"n/a." Rejected — an empty-looking table reads as an oversight, not a deliberate point; prose stating the
absence directly is clearer than a table implying a comparison that doesn't exist.

### Verification queries used for this design are not retained as a script

The queries run against `pg_play`/`pbdb_archive` to source the three worked examples above were all
one-off, run from scratch files outside the repo, not committed anywhere. This mirrors how prior
`derive_taxa()`-adjacent spot-checks (`show-hyriidae-hyriinae-assignments.js`, task 2.4's manual review) are
sometimes throwaway and sometimes promoted to a committed script — the difference being whether the check
is expected to be re-run later. These aren't: the guide will state the verified facts as prose/figures, not
as live-queried numbers that need to stay in sync with a changing database. If `taxa`/`taxa_clades`/
`clade_attachments` data changes before the guide is written (e.g. a future fix to the cycle-resolution
algorithm, or a re-derivation that changes Wiwaxia's winning opinions), all three examples should be
re-verified against `pg_play` at that time rather than assumed still accurate.

**Alternative considered**: commit a small `migration_exploration/testing/classic-comparison-examples.js`
script that reproduces these lookups, for future re-verification. Deferred, not rejected outright — this
guide is a one-time documentation artifact, not an ongoing regression check; add such a script later only
if the guide needs to be kept in sync with further schema changes as a matter of course.

## Risks / Trade-offs

- **[Risk]** The flagship example depends on `pg_play`'s current derived state, which could change if
  `derive_taxa_clades()`'s cycle-resolution algorithm is ever revised (e.g. a future rank-cardinality-style
  fix for clades, were one ever found). → **Mitigation**: the guide states the example as "as currently
  derived" rather than implying permanence, consistent with the footer's existing "where this stands today"
  framing; re-verify before any future edit to this guide if `derive_taxa_clades()` changes.
- **[Risk]** Naming a specific backwards placement (Ornithopoda under Clypeodonta) in a public-facing guide
  could read as calling out a "bug" rather than a disclosed, accepted trade-off, if the surrounding prose
  doesn't make the distinction clearly. → **Mitigation**: explicitly frame it using the same language as
  `derive-clade-attachments/design.md`'s own Risks section (a known, disclosed caveat with an inspectable
  audit trail), not as an open defect — see the worked-example decision above and
  `[[feedback_no-historical-fix-narrative-in-docs]]`.
- **[Risk]** A reader could come away from Case 2 alone thinking pbdb2's classification is simply *worse*
  than Classic's, missing the "nothing is silently discarded" gain; conversely, reading Case 3 alone could
  read as pbdb2-triumphalist and undercut Case 1's and Case 2's honesty. → **Mitigation**: this is precisely
  why all three case files ship together rather than any one standing alone — a risk, a trade-off, and a
  clean win, in that order, mirrors the actual mix found by verifying against real data rather than
  presenting a curated, one-sided sample. Don't let the "what's different from Classic" closing section
  lean on only one of the three.
- **[Trade-off]** Finding Case 3 took materially more querying than Cases 1/2 (several candidate multi-
  target concepts inspected before Wiwaxia's history made a legible point — see that Decision's Alternative
  considered). A future editor extending this guide with more examples should expect the same: an
  unambiguous, legible win is real but not the common case in this data: `[[project_clade-hierarchy-user-
  guide-status]]` should be updated if further examples are added later, rather than assuming they're as
  easy to find as Cases 1/2 were.
- **[Trade-off]** Case 2's finding (a naive `taxa`-only query can surface a weaker-evidenced answer than
  `clade_attachments` holds) is a real, current limitation of the schema, not just a documentation nuance —
  arguably worth a follow-up change (a combined ranked+clade view) rather than only being disclosed in a
  user guide. Out of scope for this change to fix; flagged here so the maintainer can decide whether it
  warrants its own OpenSpec change. See `derive-clade-attachments/proposal.md`'s Non-Goals, which already
  named this as future work.
