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
- [x] 2.5 Write the tie-breaking section: reuse the evidence→year→entry-order ranking strip from the
      existing guide verbatim, then add the cycle-handling divergence sub-section (`derive_taxa()` raises;
      `derive_taxa_clades()` resolves by cutting the weakest edge, because clades have no rank ordering).
- [x] 2.6 Write Case File 1 (flagship): the Ornithopoda/Clypeodonta cycle, using the verified Classic vs.
      pbdb2 comparison from design.md's Decisions — Classic's unanimous opinions and cached classification
      vs. pbdb2's current (backwards) derived containment. Frame it as a disclosed, accepted trade-off, not
      an unresolved defect (design.md Risks; `[[feedback_no-historical-fix-narrative-in-docs]]`).
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
- [x] 2.9 Write the "what's different from Classic" closing section per design.md's reframing decision:
      prose stating Classic has no separate clade-hierarchy or attachment concept at all, and stating the
      full mix from all three case files (a disclosed risk, a genuine trade-off, and a real win) rather than
      leaning on only one — pointing back to all three case files, rather than a term-swap table with mostly
      empty Classic cells.
- [x] 2.10 Write the footer status note, reflecting that `taxa_clades`/`clade_attachments` are implemented
      and validated in `pg_play` but the `derive-clade-attachments` OpenSpec change is still pending
      archive, plus a colophon citing the source files (mirroring the existing guide's colophon).

## 3. Review and polish

- [x] 3.1 Open the page in a browser (or the Browser tool) and check it renders correctly in both light
      and dark mode, matching the existing guide's visual fidelity.
- [x] 3.2 Proofread for reading level and tone consistency with `docs/taxonomy-user-guide.html` — no code,
      no SQL, curator-facing plain language throughout.
- [x] 3.3 Double-check every concrete claim (opinion numbers, taxon names, containment direction) in all
      three case files against the numbers recorded in design.md's Decisions section.

## 4. Close out

- [ ] 4.1 Archive this OpenSpec change once the maintainer confirms the guide is accurate and complete.
