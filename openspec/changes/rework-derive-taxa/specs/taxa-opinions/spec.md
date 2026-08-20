## ADDED Requirements

### Requirement: An opinion can assert the negation of a lineage or concept relationship

`name_opinions` SHALL carry a `negates boolean NOT NULL DEFAULT false` column, independent of
`reason_id`, marking that a `lineage`- or `concept`-class row asserts the **absence** of the
relationship it names rather than its presence. A negating row SHALL have the same shape as any other
row of its `edge_class` — a required `target_permid` naming the specific relationship being denied,
`evidence`, and `reference_id` — and SHALL cite an ordinary, existing reason: the reason names *what
kind* of relationship is being denied (e.g. `misspelling`, `junior synonym`), and `negates` supplies the
polarity. No dictionary changes and no new reason tokens are required. `edge_class = 'root'` rows SHALL
always have `negates = false` (identity minting is never negated). Negation SHALL be scoped per
`edge_class`: a `lineage`-class negating row competes only among a subject's `lineage`-class opinions,
and a `concept`-class negating row competes only among a lineage's `concept`-class opinions.

#### Scenario: A negating row has the same required shape as any other lineage/concept edge

- **WHEN** a `name_opinions` row is inserted with `edge_class = 'lineage'` (or `'concept'`),
  `negates = true`, and a non-NULL `target_permid`
- **THEN** the insert succeeds under the unchanged minting-shape CHECK

#### Scenario: A negating row reuses an existing reason with reversed polarity

- **WHEN** a `name_opinions` row is inserted with `edge_class = 'lineage'`, `reason_id` referencing the
  existing `misspelling` reason, `negates = true`, and `target_permid` naming the permid the misspelling
  claim was made against
- **THEN** the insert succeeds, no dictionary changes are required, and the row is read as "not a
  misspelling of [target]" rather than "a misspelling of [target]"

#### Scenario: A negating row with no antecedent opinion is well-formed

- **WHEN** a subject permid has no other current `lineage`-class opinion besides a newly inserted
  negating one
- **THEN** the insert succeeds, and `derive_taxa()` treats the subject exactly as if it had no
  `lineage`-class opinion at all

#### Scenario: Lineage-negation and concept-negation are independent

- **WHEN** a subject's top-ranked `lineage`-class opinion is negating, and its lineage separately has
  a winning, non-negating `concept`-class opinion
- **THEN** `derive_taxa()` excludes the subject from any `lineage` union while still grouping its
  lineage into the concept the winning `concept`-class opinion names

### Requirement: An exhausted lineage or concept emits no rows for its permids

When every permid in a lineage is excluded from `accepted_spelling_permid` eligibility (per the never-accepted, nomen-nudum, and negation exclusions), `derive_taxa()` SHALL NOT select an `accepted_spelling_permid` for that lineage and SHALL NOT emit a row for any permid belonging to it — consistent with ICZN Article 23.1, under which priority and valid-name status are defined only among available names, so an exhausted lineage has nothing valid to materialize as its accepted spelling. This SHALL hold even when the lineage's concept survives via a different, still-eligible sibling lineage. If every lineage in a concept is simultaneously exhausted, the whole concept SHALL emit no rows for any of its permids — a genuine terminal state, not an error to raise.

#### Scenario: A concept survives when only one of its lineages is exhausted

- **WHEN** a concept has two lineages, one where every candidate is excluded (all `never_accepted` or nomen-nudum-barred) and one with an eligible candidate
- **THEN** `derive_taxa()` emits no rows for the exhausted lineage's permids, while the concept's other members still receive rows with `concept_permid` equal to the eligible lineage's accepted spelling

#### Scenario: A fully exhausted concept emits no rows at all

- **WHEN** every lineage in a concept has zero eligible `accepted_spelling_permid` candidates
- **THEN** `derive_taxa()` emits no rows for any permid in that concept, and `taxa.accepted_spelling_permid`/`concept_permid` stay `NOT NULL` because no row is ever materialized rather than one with a null triad

## MODIFIED Requirements

### Requirement: name_opinions models typed edges with a minting shape

`name_opinions` SHALL represent typed edges between name-as-spelled permids: `subject_permid` defers to
`target_permid` in the manner given by `reason_id`, whose `edge_class` (`'root'` | `'lineage'` |
`'concept'`) selects the derivation grouping. Identity (`new_name`, `rank_id`) is an immutable attribute
of a permid, minted once on its `root` row; edges assert relationships between permids whose identities
already live on their own root rows. A same-row CHECK SHALL enforce the minting shape so that
`new_name` and `rank_id` are populated **iff** `edge_class = 'root'`: `'root'` rows carry no target but
do carry `new_name` and `rank_id`, and always have `negates = false`; `'lineage'` rows carry a target
and carry neither `new_name` nor `rank_id`; `'concept'` rows carry a target and carry neither `new_name`
nor `rank_id`. A row SHALL NOT have `subject_permid` equal to `target_permid`.

#### Scenario: A valid root (minting) opinion is accepted

- **WHEN** a `name_opinions` row is inserted with `edge_class = 'root'`, `target_permid IS NULL`, and
  `new_name` and `rank_id` populated
- **THEN** the insert succeeds

#### Scenario: A root opinion carrying a target is rejected

- **WHEN** a `name_opinions` row is inserted with `edge_class = 'root'` and a non-NULL `target_permid`
- **THEN** the minting-shape CHECK rejects the insert

#### Scenario: A valid lineage edge with no identity is accepted

- **WHEN** a `name_opinions` row is inserted with `edge_class = 'lineage'`, a non-NULL `target_permid`,
  and `new_name IS NULL` and `rank_id IS NULL`
- **THEN** the insert succeeds

#### Scenario: A lineage edge carrying an identity is rejected

- **WHEN** a `name_opinions` row is inserted with `edge_class = 'lineage'` and a non-NULL `new_name` or
  `rank_id`
- **THEN** the minting-shape CHECK rejects the insert

#### Scenario: A concept edge carrying an identity is rejected

- **WHEN** a `name_opinions` row is inserted with `edge_class = 'concept'` and a non-NULL `new_name` or
  `rank_id`
- **THEN** the minting-shape CHECK rejects the insert

#### Scenario: A self-referential edge is rejected

- **WHEN** a `name_opinions` row is inserted with `subject_permid = target_permid`
- **THEN** the `name_opinion_not_self` CHECK rejects the insert

#### Scenario: A root opinion cannot negate

- **WHEN** a `name_opinions` row is inserted with `edge_class = 'root'` and `negates = true`
- **THEN** the minting-shape CHECK rejects the insert

### Requirement: Lineage grouping collapses spellings of one name

For each subject permid, `derive_taxa()` SHALL select its single top-ranked current `lineage`-class opinion (`ORDER BY evidence DESC, COALESCE(pubyr, ref.pubyr) DESC, id DESC`). If that winner is non-negating, its edge (subject → target) feeds the lineage union-find; if the winner is negating (`negates = true`), the subject contributes no lineage edge this round. `derive_taxa()` SHALL union the resulting edges into name-lineages and assign every permid in a lineage the same `original_permid`. `original_permid` SHALL be the lineage's topological sink — the permid that is the target of one of these winning lineage edges but is never itself the subject of one. When a lineage has more than one such sink, or none, `derive_taxa()` SHALL fall back to the canonical `ORDER BY` over the candidate set (the tied sinks, when there is more than one; every lineage member, when there is none), consistent with the seniority tiebreak defined elsewhere in this spec.

#### Scenario: A correction and its root share an original_permid

- **WHEN** permid B is introduced by a `lineage`-class name edge targeting root permid A
- **THEN** `derive_taxa()` reports `original_permid = A` for both A and B, and A is the lineage's unique topological sink

#### Scenario: A two-way tie between candidate originals resolves deterministically

- **WHEN** a lineage has two permids that are each never the subject of a lineage edge (two candidate sinks) and no lineage edge distinguishes them
- **THEN** `derive_taxa()` picks exactly one as `original_permid` via the canonical-order/pubyr/permid fallback, and repeated calls return the same choice

#### Scenario: A lineage-level cycle has no sink and still resolves deterministically

- **WHEN** every permid in a lineage is the subject of some live lineage edge (a cycle, with no permid ever left unreferenced as a subject)
- **THEN** `derive_taxa()` selects one `original_permid` for the lineage via the fallback over all lineage members, and repeated calls return the same choice

#### Scenario: A later, higher-ranked opinion redirects a subject's lineage

- **WHEN** subject B has two current `lineage`-class opinions targeting different permids, and the higher-ranked one (by `evidence`/`pubyr`/`id`) targets C
- **THEN** `derive_taxa()` unions B into C's lineage, not the lower-ranked opinion's target's lineage

#### Scenario: A winning negation removes a subject from its claimed lineage

- **WHEN** subject B's current `lineage`-class opinions are a lower-ranked one (reason `misspelling`, `negates = false`, target A) asserting B is a misspelling of A, and a higher-ranked one citing the same `misspelling` reason with `negates = true` and the same target A, rejecting that claim
- **THEN** `derive_taxa()` reports `original_permid = B` for B — B forms its own lineage, not A's

### Requirement: Concept grouping collapses synonyms

For each lineage, `derive_taxa()` SHALL select the single top-ranked current `concept`-class opinion among all opinions filed under any of that lineage's member permids (`ORDER BY evidence DESC, COALESCE(pubyr, ref.pubyr) DESC, id DESC`). If that winner is non-negating, its edge (lineage → target lineage) feeds the concept union-find; if the winner is negating (`negates = true`), the lineage contributes no concept edge this round and forms a concept of its own unless some other current opinion pulls it elsewhere. `derive_taxa()` SHALL union the resulting edges into concepts and assign every permid in a concept the same `concept_permid` — the accepted spelling of the concept's **senior** lineage.

#### Scenario: A junior synonym shares the concept's accepted name

- **WHEN** lineage J is a `junior synonym` (concept edge) of senior lineage S
- **THEN** `derive_taxa()` reports the same `concept_permid` for members of J and S, equal to S's accepted spelling

#### Scenario: A later, higher-ranked opinion redirects a lineage's concept

- **WHEN** lineage L has two current `concept`-class opinions (filed under any of its member permids) targeting different lineages, and the higher-ranked one targets lineage S
- **THEN** `derive_taxa()` unions L into S's concept, not the lower-ranked opinion's target's concept

#### Scenario: A winning negation returns a lineage to its own concept

- **WHEN** lineage L's current `concept`-class opinions are a lower-ranked one (reason `junior synonym`, `negates = false`, target S) asserting L is a junior synonym of senior lineage S, and a higher-ranked one citing the same `junior synonym` reason with `negates = true` and the same target S, rejecting that claim
- **THEN** `derive_taxa()` reports `concept_permid` for L's members equal to L's own accepted spelling, not S's

### Requirement: Accepted spelling is the top-ranked opinion of the senior lineage

Per lineage, `derive_taxa()` SHALL choose `accepted_spelling_permid` as the permid, among those eligible, whose own canonical introducing `name_opinions` edge (the top-ranked edge naming it as subject, by `evidence DESC, COALESCE(pubyr, ref.pubyr) DESC, id DESC`) ranks highest by that same order. A permid SHALL be excluded from eligibility if its own canonical introducing edge's reason is `never_accepted` (misspellings), if that same edge has `negates = true` (it asserts the absence of a relationship, not a spelling), or if its own winning `validity_opinions` row bars candidacy (`nomen nudum`). All three exclusions SHALL be evaluated per permid, using that permid's own canonical introducing edge — not any other edge that happens to name it as subject — so a permid is not made eligible merely because it also carries a `root` mint that is not itself excluded. The accepted rank rides along (the accepted spelling's `rank_id`). Grouping SHALL be resolved before spelling selection, and the concept's accepted name SHALL be scoped to the **senior** lineage only.

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

#### Scenario: A negating opinion is never the accepted spelling

- **WHEN** a permid's own canonical introducing edge has `negates = true`
- **THEN** `derive_taxa()` excludes it from `accepted_spelling_permid` eligibility, and does not read that edge's `evidence`/`pubyr` as spelling evidence; the accepted spelling is the top-ranked eligible candidate instead

### Requirement: Seniority tiebreak is total and deterministic

When `concept`-class edges yield no unique senior sink (e.g. equal-rank, equal-priority mutual synonymy), `derive_taxa()` SHALL select the senior lineage by, in order: (a) a lineage with no currently-active, winning, non-negating `concept`-class opinion naming it junior to anything is preferred over one that has such an opinion; (b) the canonical `ORDER BY` on each lineage's accepted opinion; (c) oldest `original` `pubyr`; (d) lowest `permid`. Criterion (a) SHALL be computed from each lineage's current winning `concept`-class opinion only — a lineage is never deprioritized by a `concept`-class opinion that is outranked or negated, even if one exists in its history.

#### Scenario: Mutual synonymy resolves to one deterministic senior

- **WHEN** "A synonym-of B" and "B synonym-of A" exist at equal rank and priority
- **THEN** `derive_taxa()` picks exactly one of A/B as senior per the tiebreak, and repeated calls return the same choice

#### Scenario: An outranked or negated concept claim does not deprioritize a lineage's seniority

- **WHEN** lineage L's only `concept`-class opinion (asserting L is a junior synonym of some lineage) is either outranked by a later non-negating opinion targeting a different lineage, or itself negated by a higher-ranked negating opinion, and L is tied with another lineage M (which has no `concept`-class opinion at all) on criterion (b)/(c)/(d)
- **THEN** `derive_taxa()` treats L the same as M under criterion (a) — L is not deprioritized for a claim that is no longer active

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
