## Purpose

Defines the primary, combined taxa hierarchy — one `taxa` table and one `derive_taxa()` function that
resolve Linnaean and clade opinions together into a single classification tree, superseding the
now-secondary `taxa_linnaean`/`taxa_clades`/`taxa_attachments` split as the caller-facing source of truth.

## ADDED Requirements

### Requirement: The taxa ledger exists as combined derived output

The schema SHALL define a `taxa` table with one row per name-as-spelled permid, holding the immutable
denormalized identity (`name`, `rank_id` FK to `dictionaries.taxonomy_ranks`, optional `authority_id`),
the derived identity triad (`original_permid`, `accepted_spelling_permid`, `concept_permid`, all
`NOT NULL`), classification (`containing_concept_permid` nullable, `classification_path ltree`),
`nomenclatural_status_id`, and provenance (`winning_name_opinion_id`, `winning_assignment_opinion_id`,
`winning_validity_opinion_id`). This table is independent storage from `taxa_linnaean` and
`taxa_clades` — it is not a view or a union over them.

#### Scenario: The combined ledger has the same identity shape as the Linnaean ledger

- **WHEN** `create_new.sql` is applied to an empty database
- **THEN** `taxa` exists with the same identity/classification/provenance columns as `taxa_linnaean`,
  and is a distinct table from `taxa_linnaean` and `taxa_clades`

### Requirement: derive_taxa() resolves Linnaean and clade opinions in one pass

`derive_taxa(permids)` SHALL compute the accepted name, rank, groupings, classification, and validity of
taxa reading only the Layer 1 opinion tables (`name_opinions`, `assignment_opinions`,
`validity_opinions`) and `refs`, considering only current, non-removed assertions. Unlike
`derive_linnaean()` and `derive_taxa_clades()`, it SHALL NOT exclude candidate edges on the basis of
rank: lineage-grouping, concept-grouping, and classification-pooling candidates are eligible regardless
of whether either endpoint is Linnaean-ranked, `unranked`, or `unranked clade`. It SHALL NOT read
`taxa`, `taxa_linnaean`, `taxa_clades`, or `taxa_attachments`, and SHALL NOT write to any table.

#### Scenario: A cross-boundary concept edge is not excluded

- **WHEN** a lineage accepted at rank `unranked clade` has a winning `concept`-class opinion naming it
  a junior synonym of a lineage accepted at a Linnaean rank (a case `derive_linnaean()` excludes per its
  own concept-grouping requirement)
- **THEN** `derive_taxa()` unions the two lineages into one concept rather than excluding the edge

#### Scenario: A cross-boundary containment edge is not excluded

- **WHEN** a concept's pooled containment candidates include one where the subject's lineage is
  Linnaean-ranked and the containing lineage is accepted at rank `unranked`/`unranked clade`, or vice
  versa (a case both `derive_linnaean()` and `derive_taxa_clades()` exclude)
- **THEN** `derive_taxa()` allows that candidate to compete in the ranking contest on the same terms as
  any same-domain candidate

#### Scenario: derive_taxa() output does not depend on the ledger

- **WHEN** `derive_taxa()` is called after the `taxa` ledger is truncated
- **THEN** it returns the same rows it returned before the truncation

### Requirement: The combined hierarchy is single-parent; taxa_attachments remains the many-to-many record

`derive_taxa()` SHALL choose at most one `containing_concept_permid` per concept, selected from the same
merged candidate pool as concept-grouping, by the canonical `ORDER BY evidence DESC,
COALESCE(pubyr, ref.pubyr) DESC, id DESC`. Where `derive_clade_attachments()` treats a cross-boundary
containment candidate as one of potentially several accepted attachments for a subject concept,
`derive_taxa()` treats it as one candidate among all of that concept's containment candidates,
competing for the single winning edge. This requirement establishes no consistency obligation between
`taxa.containing_concept_permid` and the edges recorded in `taxa_attachments` — the two are
independently derived, and a concept's `taxa_attachments` rows MAY include edges that lost the
`derive_taxa()` contest.

#### Scenario: A concept keeps exactly one container even with multiple attachment candidates

- **WHEN** a concept has two well-evidenced, non-conflicting cross-boundary containment candidates
  (the shape `derive_clade_attachments()` keeps as two separate `taxa_attachments` rows)
- **THEN** `taxa.containing_concept_permid` for that concept is set to exactly one of them, chosen by
  the canonical `ORDER BY`, not both

### Requirement: derive_taxa() resolves containment cycles by cutting, never raising

Consistent with `derive_linnaean()` and `derive_taxa_clades()` — neither of which raises on a genuine
containment cycle either, only on cycle-breaking-loop non-convergence — `derive_taxa()` SHALL always
resolve containment cycles by cutting edges and SHALL NOT raise an error merely because a cycle was
found. A direct self-reference SHALL be resolved to `containing_concept_permid = NULL` by the pooling
exclusion and SHALL NOT reach the cycle-cutting loop. A genuine cycle spanning two or more distinct
concepts SHALL be broken by iteratively cutting the single weakest winning containment edge among that
round's cycle members — by `evidence ASC, yr ASC NULLS FIRST, is_senior ASC, opinion_id ASC`, the same
order `derive_linnaean()` and `derive_taxa_clades()` already use — repeating until no cycle remains.
`derive_taxa()` SHALL raise an error only if this loop fails to converge after 1000 iterations. Every
cut SHALL be recorded in `cycle_cuts` with `source = 'taxa'`.

#### Scenario: A cross-boundary containment cycle is cut

- **WHEN** assignment opinions imply a containment cycle between a Linnaean-ranked concept and an
  unranked-clade concept — a shape neither `derive_linnaean()` nor `derive_taxa_clades()` can produce
  on its own, since each excludes the other's rank domain
- **THEN** `derive_taxa()` cuts the single weakest edge among the cycle's members and completes without
  raising, and the cut is recorded in `cycle_cuts` with `source = 'taxa'`

#### Scenario: A same-domain cycle is cut the same way derive_linnaean() cuts it

- **WHEN** assignment opinions imply a containment cycle entirely among Linnaean-ranked concepts, with
  no cross-boundary candidate in the cycle
- **THEN** `derive_taxa()` cuts the same weakest edge `derive_linnaean()` would cut for that cycle,
  since the merged candidate pool is a superset that doesn't change the outcome when no cross-boundary
  candidate is involved

### Requirement: derive_taxa(subset) equals derive_taxa(all) for the requested permids

`derive_taxa(permids)` SHALL return, for each requested permid, exactly the row `derive_taxa(all)` would
produce, by internally expanding the seed set to full lineage/concept components before computing.

#### Scenario: Deriving a single permid matches the full derivation

- **WHEN** `derive_taxa(ARRAY[<one permid>])` is called
- **THEN** that permid's row equals its row from `derive_taxa(all)`

### Requirement: derive_taxa() is total over minted permids

`derive_taxa()` SHALL return exactly one row for every permid that has a minting `name_opinions` row
(`edge_class = 'root'`), except permids belonging to a lineage with no eligible
`accepted_spelling_permid` candidate or to a concept where every lineage is simultaneously exhausted
(the same exhausted-lineage/-concept exception `derive_linnaean()` observes). It SHALL raise an error,
rather than emit any row for the permid, if more than one live root row exists for the same permid.

#### Scenario: Every minted permid gets exactly one row

- **WHEN** `derive_taxa(all)` runs over a fixture of N minted permids, none of them exhausted
- **THEN** it returns exactly N rows

### Requirement: classification_path materializes the combined concept adjacency

`derive_taxa()` SHALL produce `classification_path` as an `ltree` of concept permids from root to node,
consistent with `containing_concept_permid`, over the combined Linnaean-and-clade hierarchy.

#### Scenario: The path crosses the rank boundary

- **WHEN** concept C (Linnaean-ranked) is contained by concept B (`unranked clade`) which is contained
  by root concept A (Linnaean-ranked)
- **THEN** C's `classification_path` is the ltree `A.B.C`, spanning both rank domains in one path

### Requirement: rebuild_taxa() materializes the combined ledger and the invariant holds

`rebuild_taxa()` SHALL call `derive_taxa(all)` and load the `taxa` ledger by upserting in place. A
callable check SHALL assert the invariant `derive_taxa(all) ≡ the current taxa rows`.

#### Scenario: After rebuild, derive_taxa(all) equals the ledger heads

- **WHEN** `rebuild_taxa()` runs over a fixture opinion set
- **THEN** the invariant check reports equality between `derive_taxa(all)` and the current `taxa` rows

#### Scenario: A no-op re-derivation appends no versions

- **WHEN** `rebuild_taxa()` runs twice with no intervening opinion changes
- **THEN** the second run updates and inserts no rows
