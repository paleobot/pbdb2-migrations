## Why

`docs/taxonomy-user-guide.html` explains how the system decides what a name *is* — cards, lineages,
concepts, accepted spellings — but stops short of how it decides what a name *belongs to*. That second
half of the system now spans three tables (`taxa`, `taxa_clades`, `clade_attachments`) and three
derivation passes (`derive_taxa()`'s classification pooling, `derive_taxa_clades()`,
`derive_clade_attachments()`), all landed and validated against `pg_play` as of the `derive-clade-
attachments` change. There is no plain-language explanation of this half anywhere — a curator or reviewer
today has to read `design.md`/`specs/*/spec.md` prose written for implementers, or the SQL itself, to
understand why an unranked clade never gets a Linnaean container, why a handful of clade-to-clade
containment cycles get silently resolved instead of raised, or what a "cross-boundary attachment" even is.

## What Changes

- Add `docs/clade-hierarchy-user-guide.html`, a new standalone page in the same visual system, tone, and
  reading level as `docs/taxonomy-user-guide.html` (same fonts/tokens/component patterns — hero, case
  files, comparison table, glossary), covering:
  - The two parallel hierarchies: Linnaean classification (`taxa.containing_concept_permid`, pooled
    across a concept's synonyms) and the clade-to-clade hierarchy (`taxa_clades`), and why they're kept
    structurally separate rather than one mixed tree.
  - Why an unranked/unranked-clade lineage can never be a Linnaean concept's container and never borrows
    or is borrowed by one — the same exclusion applies going the other direction — and where that
    relationship *is* captured instead: `clade_attachments`.
  - `clade_attachments` as a many-to-many bridge (not a single-parent pointer like the other two), with
    its `ranked-in-clade` / `clade-in-ranked` directions and why a subject can legitimately have more than
    one accepted attachment.
  - The shared winner-selection rule (evidence, then year, then entry order) that all three derivations
    reuse, and the one place the two hierarchies diverge on ties: `derive_taxa()` raises on a genuine
    Linnaean containment cycle, while `derive_taxa_clades()` resolves a clade-to-clade cycle automatically
    by cutting its weakest edge — because clades have no rank ordering to fall back on as a structural
    cycle-preventer the way Linnaean ranks do.
  - A worked example or two grounded in real, already-validated `pg_play` output (e.g. a synonymy merge
    among clades, and a cross-boundary attachment such as a genus placed within an unranked clade).
  - A "what changed from Classic" or glossary-style closing section, mirroring the existing guide's
    closing pattern, if a meaningful Classic-side comparison exists for clade handling (Classic had no
    equivalent unranked-clade/cross-boundary machinery — this may instead be framed as "new territory"
    rather than a term-swap table).
- No changes to `postgresql/create_new.sql`, any derivation function, or any existing spec — this is a
  documentation-only addition describing already-implemented, already-validated behavior.

## Capabilities

_(none — this is a documentation-only change; no spec-level behavior changes. `skip_specs: true` set in
`.openspec.yaml`.)_

## Impact

- New file: `docs/clade-hierarchy-user-guide.html`.
- No code, schema, or spec changes. Source material: `openspec/specs/taxa-opinions/spec.md`
  (classification-pooling and containment-cycle requirements), `openspec/changes/derive-clade-
  attachments/{proposal,design}.md` and its two `specs/*/spec.md` files (the `taxa-clades` and
  `clade-attachments` capabilities — implemented and validated per that change's `tasks.md`, but still
  pending archive as of this writing), and `docs/taxonomy-user-guide.html` as the style and structure
  reference.
