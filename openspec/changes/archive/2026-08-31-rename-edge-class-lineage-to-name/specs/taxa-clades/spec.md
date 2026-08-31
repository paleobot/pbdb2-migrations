## MODIFIED Requirements

### Requirement: derive_taxa_clades() is a pure function of taxa's lineage identity and the opinion tables

`derive_taxa_clades()` SHALL compute clade concepts reading only: `taxa`'s existing lineage-level identity
(`original_permid`, `accepted_spelling_permid`, `rank_id`, `winning_validity_opinion_id`) restricted to
lineages whose accepted rank is `unranked` or `unranked clade`; and the Layer 1 opinion tables
(`name_opinions` for concept-class edges, `assignment_opinions` for containment edges) and `refs` (for
`pubyr`), restricted to current, non-removed assertions (`removed IS NOT TRUE AND succeeded_by_id IS
NULL`). It SHALL NOT recompute lineage grouping or accepted-spelling selection — those are rank-agnostic
and already correct in `taxa`. It SHALL NOT read its own output table, and SHALL NOT write to `taxa`.

#### Scenario: Lineage identity is reused, not recomputed

- **WHEN** `derive_taxa_clades()` runs
- **THEN** it reads `original_permid`/`accepted_spelling_permid`/`rank_id` for unranked/unranked-clade
  lineages directly from `taxa`'s own lineage-level output, rather than re-deriving `name_opinions`
  `name`-class edges itself

#### Scenario: Output does not depend on a prior run

- **WHEN** `derive_taxa_clades()` is called after its own output table is truncated
- **THEN** it recomputes the same result from `taxa`'s lineage identity and the opinion tables alone
