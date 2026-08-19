## MODIFIED Requirements

### Requirement: Lineage grouping collapses spellings of one name

`derive_taxa()` SHALL union the `lineage`-class `name_opinions` edges into name-lineages and assign every permid in a lineage the same `original_permid`. `original_permid` SHALL be the lineage's topological sink — the permid that is the target of a lineage edge but is never itself the subject of one. When a lineage has more than one such sink, or none, `derive_taxa()` SHALL fall back to the canonical `ORDER BY` (`evidence DESC, COALESCE(pubyr, ref.pubyr) DESC, id DESC`) over the candidate set (the tied sinks, when there is more than one; every lineage member, when there is none), consistent with the seniority tiebreak defined elsewhere in this spec.

#### Scenario: A correction and its root share an original_permid

- **WHEN** permid B is introduced by a `lineage`-class name edge targeting root permid A
- **THEN** `derive_taxa()` reports `original_permid = A` for both A and B, and A is the lineage's unique topological sink

#### Scenario: A two-way tie between candidate originals resolves deterministically

- **WHEN** a lineage has two permids that are each never the subject of a lineage edge (two candidate sinks) and no lineage edge distinguishes them
- **THEN** `derive_taxa()` picks exactly one as `original_permid` via the canonical-order/pubyr/permid fallback, and repeated calls return the same choice

#### Scenario: A lineage-level cycle has no sink and still resolves deterministically

- **WHEN** every permid in a lineage is the subject of some live lineage edge (a cycle, with no permid ever left unreferenced as a subject)
- **THEN** `derive_taxa()` selects one `original_permid` for the lineage via the fallback over all lineage members, and repeated calls return the same choice

### Requirement: Accepted spelling is the top-ranked opinion of the senior lineage

Per lineage, `derive_taxa()` SHALL choose `accepted_spelling_permid` as the permid, among those eligible, whose own canonical introducing `name_opinions` edge (the top-ranked edge naming it as subject, by `evidence DESC, COALESCE(pubyr, ref.pubyr) DESC, id DESC`) ranks highest by that same order. A permid SHALL be excluded from eligibility if its own canonical introducing edge's reason is `never_accepted` (misspellings), or if its own winning `validity_opinions` row bars candidacy (`nomen nudum`). Both exclusions SHALL be evaluated per permid, using that permid's own canonical introducing edge — not any other edge that happens to name it as subject — so a permid is not made eligible merely because it also carries a `root` mint that is not itself excluded. The accepted rank rides along (the accepted spelling's `rank_id`). Grouping SHALL be resolved before spelling selection, and the concept's accepted name SHALL be scoped to the **senior** lineage only.

#### Scenario: A more-recent, higher-evidence spelling wins within a lineage

- **WHEN** a lineage has two spellings, one asserted with evidence in a later year
- **THEN** `derive_taxa()` selects that spelling as `accepted_spelling_permid`

#### Scenario: A misspelling is never the accepted spelling

- **WHEN** the newest opinion in a lineage introduces a `misspelling` (`never_accepted`) spelling
- **THEN** `derive_taxa()` does not select it; the accepted spelling is the top-ranked eligible non-misspelling

#### Scenario: A junior synonym's newest spelling does not win the concept's name

- **WHEN** a junior synonym lineage has the most recent spelling opinion in the whole concept
- **THEN** the concept's accepted name still comes from the **senior** lineage, not the junior one

#### Scenario: A permid is not made eligible by an unexcluded root mint alone

- **WHEN** a permid's only introducing claim as subject is a `never_accepted` lineage edge, and that permid also has its own `root` mint (which is not itself `never_accepted`)
- **THEN** `derive_taxa()` still excludes the permid from `accepted_spelling_permid` eligibility, because its own canonical introducing edge is the `never_accepted` one

#### Scenario: A permid barred by a winning nomen nudum ruling is excluded

- **WHEN** a permid's winning `validity_opinions` row has status `nomen nudum` (`bars_candidacy = true`)
- **THEN** `derive_taxa()` excludes that permid from its lineage's `accepted_spelling_permid` contest, and a later, better-evidenced non-barring validity opinion on the same permid reverses the exclusion

### Requirement: derive_taxa() is total over minted permids

`derive_taxa()` SHALL return exactly one row for every permid that has a minting `name_opinions` row (`edge_class = 'root'`), with `name`, `rank_id`, and `authority_id` taken from that root row — never from a `lineage`-class edge, which carries no identity. It SHALL NOT emit a row for a permid with no root row. A permid belonging to a lineage with no eligible `accepted_spelling_permid` candidate, or to a concept where every lineage is simultaneously exhausted, SHALL NOT receive a row (see the exhausted-lineage/-concept requirement) — this is the sole exception to one-row-per-minted-permid. `derive_taxa()` SHALL raise an error, rather than emit any row for the permid, if more than one live root row exists for the same permid (an identity-integrity violation, not a ranking contest).

#### Scenario: Every minted permid gets exactly one row

- **WHEN** `derive_taxa(all)` runs over a fixture of N minted permids, none of them exhausted
- **THEN** it returns exactly N rows, each with non-NULL `name`, `rank_id`, and `authority_id` sourced from that permid's own root row

#### Scenario: A permid with competing lineage claims still gets exactly one row

- **WHEN** a permid has its own root mint plus two competing `lineage`-class edges naming it as subject (e.g. two different opinions each claiming a different form-of relationship for it)
- **THEN** `derive_taxa()` returns exactly one row for that permid, not one per competing edge

#### Scenario: A permid with duplicate root mints raises

- **WHEN** two live `name_opinions` rows both have `edge_class = 'root'` for the same `subject_permid`
- **THEN** `derive_taxa()` raises an error identifying the permid, rather than emitting one row per root row or picking one silently

## ADDED Requirements

### Requirement: An exhausted lineage or concept emits no rows for its permids

When every permid in a lineage is excluded from `accepted_spelling_permid` eligibility (per the never-accepted and nomen-nudum exclusions), `derive_taxa()` SHALL NOT select an `accepted_spelling_permid` for that lineage and SHALL NOT emit a row for any permid belonging to it — consistent with ICZN Article 23.1, under which priority and valid-name status are defined only among available names, so an exhausted lineage has nothing valid to materialize as its accepted spelling. This SHALL hold even when the lineage's concept survives via a different, still-eligible sibling lineage. If every lineage in a concept is simultaneously exhausted, the whole concept SHALL emit no rows for any of its permids — a genuine terminal state, not an error to raise.

#### Scenario: A concept survives when only one of its lineages is exhausted

- **WHEN** a concept has two lineages, one where every candidate is excluded (all `never_accepted` or nomen-nudum-barred) and one with an eligible candidate
- **THEN** `derive_taxa()` emits no rows for the exhausted lineage's permids, while the concept's other members still receive rows with `concept_permid` equal to the eligible lineage's accepted spelling

#### Scenario: A fully exhausted concept emits no rows at all

- **WHEN** every lineage in a concept has zero eligible `accepted_spelling_permid` candidates
- **THEN** `derive_taxa()` emits no rows for any permid in that concept, and `taxa.accepted_spelling_permid`/`concept_permid` stay `NOT NULL` because no row is ever materialized rather than one with a null triad
