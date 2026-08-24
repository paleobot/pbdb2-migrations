## Why

`taxa-opinions`'s `derive_taxa()` deliberately excludes `unranked`/`unranked clade` lineages from Linnaean
concept-grouping and containment pooling, so that `taxa` stays a clean, acyclic Linnaean hierarchy (see
the concept-grouping and classification-pooling requirements in `openspec/specs/taxa-opinions/spec.md`).
The exclusion is total: it applies whenever *either* side of a candidate edge is unranked/unranked clade,
so unranked lineages don't just fail to attach to Linnaean concepts — they never merge with **each other**
via synonymy either, and never contain **each other**. Today, every unranked-clade lineage lands in `taxa`
as its own isolated singleton concept with `containing_concept_permid = NULL`: there is no derived clade
hierarchy at all, Linnaean or otherwise, and no derived cross-boundary attachment between the two. Yet the
opinions asserting both already exist: clade-to-clade synonymy and containment opinions are common in the
data, and **~23,100 of 927,497 live `assignment_opinions` rows (~2.5%) name an unranked/unranked-clade
concept as container for a ranked subject, with ~6,254 more naming a ranked concept as container for an
unranked/unranked subject.** All of this is currently thrown away by `_dt_con_winner`/`_dt_assign` rather
than resolved.

## What Changes

- Introduce `derive_taxa_clades()`, a parallel derivation that builds the clade-to-clade hierarchy
  `derive_taxa()` deliberately excludes. It reuses `taxa`'s existing lineage-level identity
  (`original_permid`, `accepted_spelling_permid`, `winning_validity_opinion_id`) for lineages accepted at
  rank `unranked`/`unranked clade` — that part is rank-agnostic and already correct — and adds its own
  concept-grouping and classification-pooling passes, scoped to candidate edges where **both** sides
  resolve to unranked/unranked-clade lineages, using the same evidence/pubyr/id winner-selection machinery
  as `derive_taxa()`. Cross-boundary edges (one side ranked, one side unranked) are excluded here exactly
  as they are in `derive_taxa()` today — synonymy across that boundary stays nonsensical either way; only
  cross-boundary *containment* is meaningful, and that's handled by the next pass.
- Introduce `derive_clade_attachments()`, a pass that runs **after** both `derive_taxa()` (`taxa`) and
  `derive_taxa_clades()` (`taxa_clades`) have produced their concept-level winners, and resolves exactly
  the cross-boundary `assignment_opinions` candidates both of those exclude.
  - **Candidate pool**: `assignment_opinions` rows where the subject's lineage resolves to one side of the
    ranked/unranked-clade line and the containing lineage resolves to the other, in either direction —
    mapped through each side's already-resolved concept identity (`taxa.concept_permid` or
    `taxa_clades.concept_permid`), not raw permids, the same way `_dt_linmeta` collapses synonyms today.
  - **Winner selection** reuses the canonical `ORDER BY evidence DESC, COALESCE(pubyr, ref.pubyr) DESC, id
    DESC`, scoped per **(subject concept, target concept) pair** rather than per subject: repeated or
    superseded opinions about the same specific attachment collapse to one accepted edge, but a subject
    concept with independently-supported attachments to multiple, non-conflicting targets keeps all of
    them. Cardinality is many-to-many by design — unlike `containing_concept_permid`, this is not a
    single-parent relationship.
  - **Output**: a new ledger (name TBD in design — e.g. `clade_attachments`) with one row per accepted
    cross-boundary edge: subject concept, direction, target concept, and the winning
    `assignment_opinions` id.
  - Same self-reference guard as `_dt_assign` (a candidate whose container resolves to the same concept as
    the subject is excluded from the ranking contest, never just defaulted to null after winning it).
- **No changes** to `derive_taxa()`, the `taxa` ledger, or the existing unranked exclusions in
  `_dt_con_winner`/`_dt_assign` — both new passes are strictly additive, consuming only the opinion rows
  those exclusions already discard. This does not change which rows land in `taxa` or how.

## Capabilities

### New Capabilities
- `taxa-clades`: derives a clade-to-clade concept and containment hierarchy for `unranked`/`unranked
  clade` lineages, from the concept-class and assignment opinions `derive_taxa()` excludes from the
  Linnaean hierarchy for having either side unranked.
- `clade-attachments`: derives many-to-many cross-boundary containment edges between Linnaean concepts
  (`taxa`) and unranked-clade concepts (`taxa_clades`), from the `assignment_opinions` rows both of those
  ledgers' derivations exclude for having exactly one side unranked.

### Modified Capabilities
_(none — `taxa-opinions`'s requirements, exclusions, and output are unchanged by both new passes)_

## Impact

- `postgresql/create_new.sql` — two new derivation functions and two new output tables, alongside the
  existing `derive_taxa()` and `taxa` ledger. No edits to `_dt_con_winner` or `_dt_assign`.
- **Sequencing**: `derive_taxa_clades()` must run (and `taxa_clades` be populated) before
  `derive_clade_attachments()`, since the latter reads the former's concept-level output. Both are in
  scope for this change; `tasks.md` should order them accordingly.
- `pg_play` — validation target, consistent with prior `derive_taxa()`-adjacent changes
  (`fix-dt-assign-containment-cycle`, `fix-eukarya-eumetazoa-containment-cycle`): redeploy and verify
  clade-hierarchy shape and attachment-edge counts/cardinality against the ~23K/~6K raw candidate counts
  above.
