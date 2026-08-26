## 1. Confirm source material

- [x] 1.1 Re-read `openspec/specs/taxa-opinions/spec.md`'s classification-pooling and containment-cycle
      requirements and `openspec/changes/derive-clade-attachments/{proposal,design}.md` plus its two
      `specs/*/spec.md` files in full, immediately before drafting, in case either has changed since this
      change's design.md was written. **Result**: unchanged; content used as-is.
- [x] 1.2 Re-verify all three worked examples' numbers against current `pg_play`/`pbdb_archive` state
      (design.md's Decisions): the Ornithopoda/Clypeodonta Classic opinions and current `taxa_clades`
      containment, the Bredocaris `taxa`/`clade_attachments` split, and Wiwaxia's `taxa` classification plus
      its two `clade_attachments` rows. Confirm they still match what design.md recorded; if any has
      drifted, update design.md's Decisions before proceeding. **Result**: re-ran the Ornithopoda/Clypeodonta
      and Wiwaxia queries immediately before drafting — exact parity with design.md's recorded numbers, no
      drift.
- [x] 1.3 **Added after merge of `1c9363e`** ("Break clade cycle-cut ties toward pooled candidates, not
      opinion id"): re-verify Case 1 specifically, since that commit's own message says it changes exactly
      this pair. **Result**: confirmed fixed — Ornithopoda/Clypeodonta now matches Classic
      (Clypeodonta → Ornithopoda → Cerapoda). Also checked the other 4 known clade cycles for a possible
      replacement disclosed-risk example (`Tapiromorpha`/`Ceratomorpha` turned out to be the Case 2/3 pattern,
      not a new risk — see design.md's reworked Worked example 1 Decision) and re-confirmed Cases 2/3
      (`Bredocaris`, `Wiwaxia`) unchanged by this patch. design.md's Decisions and Risks updated accordingly.

## 2. Draft the HTML guide

- [x] 2.1 Create `docs/clade-hierarchy-user-guide.html`, copying `docs/taxonomy-user-guide.html`'s
      `<style>` block, font imports, and component classes (`.hero`, `.block`, `.classic-note`,
      `figure.diagram`, `.case`/`.case-tab`/`.case-body`, `.compare`, `footer .status`) verbatim, so the
      two pages are visually and structurally identical.
- [x] 2.2 Write the hero section: title, eyebrow, dek, and lede framing this page as the relationship-half
      companion to the identity-half guide (design.md, Decisions §1).
- [x] 2.3 Write "The big idea" section: two structurally separate hierarchies (`taxa` Linnaean
      classification, `taxa_clades` clade-to-clade) plus `clade_attachments` as the explicit bridge, with
      one diagram figure (three boxes, styled like the existing guide's recompute diagram).
- [x] 2.4 Write the mechanism section: classification pooling (junior-synonym borrowing, equal-rank-only,
      species excluded), the rank-cardinality exclusion, and why unranked lineages are structurally barred
      from ordinary Linnaean containment in either direction.
- [x] 2.5 **Reopened after 1.3**: update the tie-breaking section to state the `is_senior` tiebreak as
      current mechanism (pooled-vs-direct evidence/pubyr ties), immediately followed by its stated limit (a
      tie between two equally-senior candidates still falls to arbitrary `id`; no rank-cardinality-style
      firewall exists on the clade side regardless) — per design.md's reworked Structure decision. **Result**:
      added as a new paragraph directly after the existing cycle-resolution paragraph.
- [x] 2.6 **Reworked after 1.3**: rewrite Case File 1 as a correctly-broken tie, not a disclosed risk — the
      Ornithopoda/Clypeodonta pair, now matching Classic, illustrating the `is_senior` tiebreak cutting the
      pooled Iguanodontia candidate instead of Clypeodonta's own direct opinion. Do not narrate this as "a
      bug was found and fixed" — state the current mechanism and this pair's current, correct outcome
      (design.md's reworked Worked example 1 Decision; `[[feedback_no-historical-fix-narrative-in-docs]]`).
      **Result**: rewrote title kind, body, and takeaway; kept the Iguanodontia/pooling mechanism explicit
      without narrating a bug-fix history.
- [x] 2.7 Write Case File 2 (honest trade-off): `Bredocaris`'s two independently-sourced containers —
      Classic's single evidence-ranked pool correctly surfaces the better-evidenced Pancrustacea opinion as
      its one classification; pbdb2's separate pools leave the weaker Orstenocarida opinion as `taxa`'s
      answer while the stronger one sits in `clade_attachments`. State both the gain (nothing silently
      discarded) and the cost (no single best-evidenced answer across the boundary) explicitly, per
      design.md's Decisions and Risks/Trade-offs.
- [x] 2.8 Write Case File 3 (unambiguous win): `Wiwaxia`'s six-opinion Classic history vs. pbdb2's current
      state — Classic's single `taxa_tree_cache` slot shows only its current winner (`Halwaxida`), hiding
      every superseded and alternative hypothesis (including the historically significant Sachitida and
      Annelida placements); pbdb2's `taxa` table gets the correct current answer (`Wiwaxidae`, matching
      Classic's newest best-evidenced opinion) *and* `clade_attachments` separately preserves the Sachitida
      and Annelida attachments as visible, coexisting facts. Frame this as a genuine, uncomplicated win —
      don't hedge it the way Cases 1 and 2 are hedged, per design.md's Decisions and Risks/Trade-offs.
- [x] 2.9 **Reopened after 1.3**: update the "what's different from Classic" closing section and its
      compare-recap row for Case 1 — no longer "automatic cycle-resolution lands backwards," now "the
      tie-break mechanism correctly distinguishes pooled from direct evidence, with a stated residual limit."
      Keep pointing back to all three case files, per design.md's reworked reframing decision. **Result**:
      updated the prose paragraph and the Case 1 compare-row.
- [x] 2.10 Write the footer status note, reflecting that `taxa_clades`/`clade_attachments` are implemented
      and validated in `pg_play` but the `derive-clade-attachments` OpenSpec change is still pending
      archive, plus a colophon citing the source files (mirroring the existing guide's colophon).

## 3. Review and polish

- [x] 3.1 **Reopened after 1.3**: re-check the page renders correctly (light and dark) after the Case 1 /
      tie-breaking / closing-section rewrites. **Result**: verified in the browser tool — tie-breaking
      section, Case 1, and the compare table all render correctly.
- [x] 3.2 **Reopened after 1.3**: proofread the rewritten sections specifically for tone — Case 1 should
      read as "here's the mechanism, correctly illustrated," not as a relieved "false alarm, it's fixed now."
      **Result**: no "fixed"/"bug"/historical-narrative language in the shipped text.
- [x] 3.3 **Reopened after 1.3**: double-check the rewritten Case 1 and the "what's different from Classic"
      section's claims against design.md's reworked Decisions; re-confirm Cases 2/3 text still matches (no
      text changes needed there, but verify nothing referencing Case 1 elsewhere in the page went stale).
      **Result**: swept the file for "backwards"/"Case 1"/"disclosed risk" — all remaining references are
      consistent with the new framing; Cases 2/3 text unchanged and their underlying data re-verified
      unaffected by the patch (1.3).

## 4. Close out

- [ ] 4.1 Archive this OpenSpec change once the maintainer confirms the guide is accurate and complete.
