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

For each subject permid, `derive_taxa()` SHALL select its single top-ranked current `lineage`-class
opinion (`ORDER BY evidence DESC, COALESCE(pubyr, ref.pubyr) DESC, id DESC`). If that winner is
non-negating, its edge (subject → target) feeds the lineage union-find; if the winner is negating
(`negates = true`), the subject contributes no lineage edge this round and forms a lineage of its own
unless some other current opinion pulls it elsewhere. `derive_taxa()` SHALL union the resulting edges
into name-lineages and assign every permid in a lineage the same `original_permid` — the lineage's
`root` (`edge_class = 'root'`, reason `original`), or the permid itself when it forms a lineage of one.

#### Scenario: A correction and its root share an original_permid

- **WHEN** permid B is introduced by a `lineage`-class name edge targeting root permid A
- **THEN** `derive_taxa()` reports `original_permid = A` for both A and B

#### Scenario: A later, higher-ranked opinion redirects a subject's lineage

- **WHEN** subject B has two current `lineage`-class opinions targeting different permids, and the
  higher-ranked one (by `evidence`/`pubyr`/`id`) targets C
- **THEN** `derive_taxa()` unions B into C's lineage, not the lower-ranked opinion's target's lineage

#### Scenario: A winning negation removes a subject from its claimed lineage

- **WHEN** subject B's current `lineage`-class opinions are a lower-ranked one (reason `misspelling`,
  `negates = false`, target A) asserting B is a misspelling of A, and a higher-ranked one citing the
  same `misspelling` reason with `negates = true` and the same target A, rejecting that claim
- **THEN** `derive_taxa()` reports `original_permid = B` for B — B forms its own lineage, not A's

### Requirement: Concept grouping collapses synonyms

For each lineage, `derive_taxa()` SHALL select the single top-ranked current `concept`-class opinion
among all opinions filed under any of that lineage's member permids (`ORDER BY evidence DESC,
COALESCE(pubyr, ref.pubyr) DESC, id DESC`). If that winner is non-negating, its edge (lineage → target
lineage) feeds the concept union-find; if the winner is negating (`negates = true`), the lineage
contributes no concept edge this round and forms a concept of its own unless some other current opinion
pulls it elsewhere. `derive_taxa()` SHALL union the resulting edges into concepts and assign every
permid in a concept the same `concept_permid` — the accepted spelling of the concept's **senior**
lineage.

#### Scenario: A junior synonym shares the concept's accepted name

- **WHEN** lineage J is a `junior synonym` (concept edge) of senior lineage S
- **THEN** `derive_taxa()` reports the same `concept_permid` for members of J and S, equal to S's
  accepted spelling

#### Scenario: A later, higher-ranked opinion redirects a lineage's concept

- **WHEN** lineage L has two current `concept`-class opinions (filed under any of its member permids)
  targeting different lineages, and the higher-ranked one targets lineage S
- **THEN** `derive_taxa()` unions L into S's concept, not the lower-ranked opinion's target's concept

#### Scenario: A winning negation returns a lineage to its own concept

- **WHEN** lineage L's current `concept`-class opinions are a lower-ranked one (reason
  `junior synonym`, `negates = false`, target S) asserting L is a junior synonym of senior lineage S,
  and a higher-ranked one citing the same `junior synonym` reason with `negates = true` and the same
  target S, rejecting that claim
- **THEN** `derive_taxa()` reports `concept_permid` for L's members equal to L's own accepted spelling,
  not S's

### Requirement: Accepted spelling is the top-ranked opinion of the senior lineage

Per lineage, `derive_taxa()` SHALL choose `accepted_spelling_permid` as the subject of the top opinion
by `ORDER BY evidence DESC, COALESCE(pubyr, ref.pubyr) DESC, id DESC`, excluding subjects whose minting
reason is `never_accepted` (misspellings) or whose introducing edge has `negates = true` (it asserts the
absence of a relationship, not a spelling). The accepted rank rides along (the accepted spelling's
`rank_id`). Grouping SHALL be resolved before spelling selection, and the concept's accepted name SHALL
be scoped to the **senior** lineage only.

#### Scenario: A more-recent, higher-evidence spelling wins within a lineage

- **WHEN** a lineage has two spellings, one asserted with evidence in a later year
- **THEN** `derive_taxa()` selects that spelling as `accepted_spelling_permid`

#### Scenario: A misspelling is never the accepted spelling

- **WHEN** the newest opinion in a lineage introduces a `misspelling` (`never_accepted`) spelling
- **THEN** `derive_taxa()` does not select it; the accepted spelling is the top-ranked non-misspelling

#### Scenario: A junior synonym's newest spelling does not win the concept's name

- **WHEN** a junior synonym lineage has the most recent spelling opinion in the whole concept
- **THEN** the concept's accepted name still comes from the **senior** lineage, not the junior one

#### Scenario: A negating opinion is never the accepted spelling

- **WHEN** the newest, highest-evidence current `lineage`-class opinion naming a permid as subject has
  `negates = true`
- **THEN** `derive_taxa()` does not read that opinion's `evidence`/`pubyr` as spelling evidence for
  `accepted_spelling_permid`; the accepted spelling is the top-ranked non-negating candidate

### Requirement: Seniority tiebreak is total and deterministic

When `concept`-class edges yield no unique senior sink (e.g. equal-rank, equal-priority mutual
synonymy), `derive_taxa()` SHALL select the senior lineage by, in order: (a) a lineage with no
currently-active, winning, non-negating `concept`-class opinion naming it junior to anything is
preferred over one that has such an opinion; (b) the canonical `ORDER BY` on each lineage's accepted
opinion; (c) oldest `original` `pubyr`; (d) lowest `permid`. Criterion (a) SHALL be computed from each
lineage's current D1-winning `concept`-class opinion only — a lineage is never deprioritized by a
`concept`-class opinion that is outranked or negated, even if one exists in its history.

#### Scenario: Mutual synonymy resolves to one deterministic senior

- **WHEN** "A synonym-of B" and "B synonym-of A" exist at equal rank and priority
- **THEN** `derive_taxa()` picks exactly one of A/B as senior per the tiebreak, and repeated calls
  return the same choice

#### Scenario: An outranked or negated concept claim does not deprioritize a lineage's seniority

- **WHEN** lineage L's only `concept`-class opinion (asserting L is a junior synonym of some lineage)
  is either outranked by a later non-negating opinion targeting a different lineage, or itself negated
  by a higher-ranked negating opinion, and L is tied with another lineage M (which has no `concept`-class
  opinion at all) on criterion (b)/(c)/(d)
- **THEN** `derive_taxa()` treats L the same as M under criterion (a) — L is not deprioritized for a
  claim that is no longer active
