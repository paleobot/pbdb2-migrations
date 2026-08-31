## RENAMED Requirements

- FROM: `### Requirement: An opinion can assert the negation of a lineage or concept relationship`
- TO: `### Requirement: An opinion can assert the negation of a name or concept relationship`

## MODIFIED Requirements

### Requirement: name_opinions models typed edges with a minting shape

`name_opinions` SHALL represent typed edges between name-as-spelled permids: `subject_permid` defers to
`target_permid` in the manner given by `reason_id`, whose `edge_class` (`'root'` | `'name'` |
`'concept'`) selects the derivation grouping. Identity (`new_name`, `rank_id`) is an immutable attribute
of a permid, minted once on its `root` row; edges assert relationships between permids whose identities
already live on their own root rows. A same-row CHECK SHALL enforce the minting shape so that
`new_name` and `rank_id` are populated **iff** `edge_class = 'root'`: `'root'` rows carry no target but
do carry `new_name` and `rank_id`, and always have `negates = false`; `'name'` rows carry a target
and carry neither `new_name` nor `rank_id`; `'concept'` rows carry a target and carry neither `new_name`
nor `rank_id`. A row SHALL NOT have `subject_permid` equal to `target_permid`.

#### Scenario: A valid root (minting) opinion is accepted

- **WHEN** a `name_opinions` row is inserted with `edge_class = 'root'`, `target_permid IS NULL`, and
  `new_name` and `rank_id` populated
- **THEN** the insert succeeds

#### Scenario: A root opinion carrying a target is rejected

- **WHEN** a `name_opinions` row is inserted with `edge_class = 'root'` and a non-NULL `target_permid`
- **THEN** the minting-shape CHECK rejects the insert

#### Scenario: A valid name edge with no identity is accepted

- **WHEN** a `name_opinions` row is inserted with `edge_class = 'name'`, a non-NULL `target_permid`,
  and `new_name IS NULL` and `rank_id IS NULL`
- **THEN** the insert succeeds

#### Scenario: A name edge carrying an identity is rejected

- **WHEN** a `name_opinions` row is inserted with `edge_class = 'name'` and a non-NULL `new_name` or
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

#### Scenario: The retired 'lineage' token is not accepted

- **WHEN** a `name_opinions` row is inserted with `edge_class = 'lineage'`
- **THEN** the insert is rejected, because no `namechange_reasons` row carries that class and the
  dictionary's own `edge_class` CHECK admits only `'root'`, `'name'`, and `'concept'`

### Requirement: An opinion can assert the negation of a name or concept relationship

`name_opinions` SHALL carry a `negates boolean NOT NULL DEFAULT false` column, independent of
`reason_id`, marking that a `name`- or `concept`-class row asserts the **absence** of the
relationship it names rather than its presence. A negating row SHALL have the same shape as any other
row of its `edge_class` — a required `target_permid` naming the specific relationship being denied,
`evidence`, and `reference_id` — and SHALL cite an ordinary, existing reason: the reason names *what
kind* of relationship is being denied (e.g. `misspelling`, `junior synonym`), and `negates` supplies the
polarity. No dictionary changes and no new reason tokens are required. `edge_class = 'root'` rows SHALL
always have `negates = false` (identity minting is never negated). Negation SHALL be scoped per
`edge_class`: a `name`-class negating row competes only among a subject's `name`-class opinions,
and a `concept`-class negating row competes only among a lineage's `concept`-class opinions.

#### Scenario: A negating row has the same required shape as any other name/concept edge

- **WHEN** a `name_opinions` row is inserted with `edge_class = 'name'` (or `'concept'`),
  `negates = true`, and a non-NULL `target_permid`
- **THEN** the insert succeeds under the unchanged minting-shape CHECK

#### Scenario: A negating row reuses an existing reason with reversed polarity

- **WHEN** a `name_opinions` row is inserted with `edge_class = 'name'`, `reason_id` referencing the
  existing `misspelling` reason, `negates = true`, and `target_permid` naming the permid the misspelling
  claim was made against
- **THEN** the insert succeeds, no dictionary changes are required, and the row is read as "not a
  misspelling of [target]" rather than "a misspelling of [target]"

#### Scenario: A negating row with no antecedent opinion is well-formed

- **WHEN** a subject permid has no other current `name`-class opinion besides a newly inserted
  negating one
- **THEN** the insert succeeds, and `derive_taxa()` treats the subject exactly as if it had no
  `name`-class opinion at all

#### Scenario: Name-negation and concept-negation are independent

- **WHEN** a subject's top-ranked `name`-class opinion is negating, and its lineage separately has
  a winning, non-negating `concept`-class opinion
- **THEN** `derive_taxa()` excludes the subject from any lineage union while still grouping its
  lineage into the concept the winning `concept`-class opinion names

### Requirement: edge_class is provably faithful to the dictionary (Way 2)

Each `name_opinions` row SHALL carry an `edge_class text NOT NULL` copy of its reason's class, pinned to `dictionaries.namechange_reasons` by a composite foreign key `(reason_id, edge_class) → (id, edge_class)`. This SHALL make it impossible to store a row whose `edge_class` disagrees with its `reason_id`, and SHALL block reclassifying a reason in the dictionary while any opinion still references the old pair.

#### Scenario: A mismatched (reason_id, edge_class) pair is rejected

- **WHEN** a `name_opinions` row is inserted with a `reason_id` whose dictionary `edge_class` is `'name'` but the row supplies `edge_class = 'concept'`
- **THEN** the composite FK rejects the insert because no `(id, 'concept')` pair exists for that reason

#### Scenario: Reclassifying a referenced reason is refused

- **WHEN** an `UPDATE` attempts to change `edge_class` of a `namechange_reasons` row that a `name_opinions` row still references
- **THEN** the default `NO ACTION` referential rule refuses the update

### Requirement: Dictionaries are reconciled to the settled vocabularies

`dictionaries.taxonomy_ranks` SHALL gain an explicit `height integer` (NULL for `unranked`/`unranked clade`) and include the previously-missing `order` rank. `dictionaries.namechange_reasons` SHALL carry `edge_class` (`NOT NULL`, `IN ('root','name','concept')`) and `never_accepted`, expose the composite `UNIQUE (id, edge_class)`, and seed exactly the eleven tokens `original`, `misspelling`, `historical misspelling`, `reranked`, `recombination`, `assignment`, `correction`, `junior synonym`, `replaced by`, `invalid subgroup`, `nomen oblitum` — with no `code` token, `invalid subgroup` and `nomen oblitum` both `edge_class = 'concept'`, `original` alone `edge_class = 'root'`, and the remaining six `edge_class = 'name'`. `dictionaries.nomenclatural_statuses` SHALL exist with `(status, bars_candidacy)` seeded for exactly `nomen dubium`, `nomen nudum`, `nomen vanum`, `nomen oblitum` — `invalid subgroup of` is not a member (it lives in `namechange_reasons` instead) — with `bars_candidacy = true` only for `nomen nudum`.

#### Scenario: Rank ordering is explicit and complete

- **WHEN** the `taxonomy_ranks` dictionary is queried
- **THEN** `order` is present, and `height` is populated for all ranked values while `unranked` and `unranked clade` have `height IS NULL`

#### Scenario: namechange_reasons holds exactly the eleven reconciled tokens

- **WHEN** the `namechange_reasons` dictionary is queried
- **THEN** exactly the eleven tokens are present, `code` is absent, `invalid subgroup` and `nomen oblitum` both have `edge_class = 'concept'`, and `misspelling` has `never_accepted = true`

#### Scenario: No dictionary row carries the retired 'lineage' class

- **WHEN** the `namechange_reasons` dictionary is queried for `edge_class`
- **THEN** exactly three distinct values are present — `'root'`, `'name'`, `'concept'` — and `'lineage'` is absent, with the six name-class tokens `correction`, `reranked`, `recombination`, `assignment`, `misspelling`, and `historical misspelling` all carrying `edge_class = 'name'`

#### Scenario: nomenclatural_statuses carries the residual self-referential nomen family

- **WHEN** the `nomenclatural_statuses` dictionary is queried
- **THEN** exactly `nomen dubium`, `nomen nudum`, `nomen vanum`, `nomen oblitum` are present, `invalid subgroup of` is absent, and only `nomen nudum` has `bars_candidacy = true`

### Requirement: Lineage grouping collapses spellings of one name

For each subject permid, `derive_taxa()` SHALL select its single top-ranked current `name`-class opinion (`ORDER BY evidence DESC, COALESCE(pubyr, ref.pubyr) DESC, id DESC`). If that winner is non-negating, its edge (subject → target) feeds the lineage union-find; if the winner is negating (`negates = true`), the subject contributes no edge to the lineage union-find this round. `derive_taxa()` SHALL union the resulting edges into name-lineages and assign every permid in a lineage the same `original_permid`. `original_permid` SHALL be the lineage's topological sink — the permid that is the target of one of these winning name edges but is never itself the subject of one. When a lineage has more than one such sink, or none, `derive_taxa()` SHALL fall back to the canonical `ORDER BY` over the candidate set (the tied sinks, when there is more than one; every lineage member, when there is none), consistent with the seniority tiebreak defined elsewhere in this spec.

#### Scenario: A correction and its root share an original_permid

- **WHEN** permid B is introduced by a `name`-class edge targeting root permid A
- **THEN** `derive_taxa()` reports `original_permid = A` for both A and B, and A is the lineage's unique topological sink

#### Scenario: A two-way tie between candidate originals resolves deterministically

- **WHEN** a lineage has two permids that are each never the subject of a name edge (two candidate sinks) and no name edge distinguishes them
- **THEN** `derive_taxa()` picks exactly one as `original_permid` via the canonical-order/pubyr/permid fallback, and repeated calls return the same choice

  (Note: given each subject contributes at most one winning name edge — see "Lineage grouping
  collapses spellings of one name" — a lineage's reachability graph is a functional graph, which
  cannot have two genuine sinks in one weakly-connected component; this case is not currently
  constructible from live opinions, but the fallback's `ORDER BY` expression is exercised by the
  cycle scenario below, which shares the identical ranking logic over a different candidate set.)

#### Scenario: A lineage-level cycle has no sink and still resolves deterministically

- **WHEN** every permid in a lineage is the subject of some live name edge (a cycle, with no permid ever left unreferenced as a subject)
- **THEN** `derive_taxa()` selects one `original_permid` for the lineage via the fallback over all lineage members, and repeated calls return the same choice

#### Scenario: A later, higher-ranked opinion redirects a subject's lineage

- **WHEN** subject B has two current `name`-class opinions targeting different permids, and the higher-ranked one (by `evidence`/`pubyr`/`id`) targets C
- **THEN** `derive_taxa()` unions B into C's lineage, not the lower-ranked opinion's target's lineage

#### Scenario: A winning negation removes a subject from its claimed lineage

- **WHEN** subject B's current `name`-class opinions are a lower-ranked one (reason `misspelling`, `negates = false`, target A) asserting B is a misspelling of A, and a higher-ranked one citing the same `misspelling` reason with `negates = true` and the same target A, rejecting that claim
- **THEN** `derive_taxa()` reports `original_permid = B` for B — B forms its own lineage, not A's

### Requirement: derive_taxa() is total over minted permids

`derive_taxa()` SHALL return exactly one row for every permid that has a minting `name_opinions` row (`edge_class = 'root'`), with `name`, `rank_id`, and `authority_id` taken from that root row — never from a `name`-class edge, which carries no identity. It SHALL NOT emit a row for a permid with no root row. A permid belonging to a lineage with no eligible `accepted_spelling_permid` candidate, or to a concept where every lineage is simultaneously exhausted, SHALL NOT receive a row (see the exhausted-lineage/-concept requirement) — this is the sole exception to one-row-per-minted-permid. `derive_taxa()` SHALL raise an error, rather than emit any row for the permid, if more than one live root row exists for the same permid (an identity-integrity violation, not a ranking contest).

#### Scenario: Every minted permid gets exactly one row

- **WHEN** `derive_taxa(all)` runs over a fixture of N minted permids, none of them exhausted
- **THEN** it returns exactly N rows, each with non-NULL `name`, `rank_id`, and `authority_id` sourced from that permid's own root row

#### Scenario: A permid with competing lineage claims still gets exactly one row

- **WHEN** a permid has its own root mint plus two competing `name`-class edges naming it as subject (e.g. two different opinions each claiming a different form-of relationship for it)
- **THEN** `derive_taxa()` returns exactly one row for that permid, not one per competing edge

#### Scenario: A permid with duplicate root mints raises

- **WHEN** two live `name_opinions` rows both have `edge_class = 'root'` for the same `subject_permid`
- **THEN** `derive_taxa()` raises an error identifying the permid, rather than emitting one row per root row or picking one silently

### Requirement: Accepted spelling is the top-ranked opinion of the senior lineage

Per lineage, `derive_taxa()` SHALL choose `accepted_spelling_permid` as the permid, among those eligible, whose own canonical introducing `name_opinions` edge (the top-ranked edge naming it as subject, by `evidence DESC, COALESCE(pubyr, ref.pubyr) DESC, id DESC`, considering only edges with `negates = false`) ranks highest by that same order. A negating edge SHALL NOT be eligible to be a permid's canonical introducing edge in the first place — negation rejects a relationship to another permid, it is not an account of this permid's own identity, so it never wins that ranking; since every permid's own `root` row is always a non-negating candidate, this can never by itself leave a permid with no canonical introducing edge. A permid SHALL be excluded from eligibility if its own canonical introducing edge's reason is `never_accepted` (misspellings), or if its own winning `validity_opinions` row bars candidacy (`nomen nudum`). Both exclusions SHALL be evaluated per permid, using that permid's own canonical introducing edge — not any other edge that happens to name it as subject — so a permid is not made eligible merely because it also carries a `root` mint that is not itself excluded. The accepted rank rides along (the accepted spelling's `rank_id`). Grouping SHALL be resolved before spelling selection, and the concept's accepted name SHALL be scoped to the **senior** lineage only.

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

- **WHEN** a permid's only introducing claim as subject is a `never_accepted` name edge, and that permid also has its own `root` mint (which is not itself `never_accepted`)
- **THEN** `derive_taxa()` still excludes the permid from `accepted_spelling_permid` eligibility, because its own canonical introducing edge is the `never_accepted` one

#### Scenario: A permid barred by a winning nomen nudum ruling is excluded

- **WHEN** a permid's winning `validity_opinions` row has status `nomen nudum` (`bars_candidacy = true`)
- **THEN** `derive_taxa()` excludes that permid from its lineage's `accepted_spelling_permid` contest, and a later, better-evidenced non-barring validity opinion on the same permid reverses the exclusion

#### Scenario: A negating opinion never wins canonical-introducing-edge ranking, but its permid stays eligible via its own root row

- **WHEN** a permid's only introducing claim as subject other than its own `root` mint is a `negates = true` name edge with higher `evidence`/`pubyr` than that `root` mint
- **THEN** `derive_taxa()` does not read the negating edge's `evidence`/`pubyr` as spelling evidence; the permid's canonical introducing edge is its own `root` mint instead, so it remains eligible and — if it forms a lineage of one, per the winning negation removing it from any claimed lineage — is its own `accepted_spelling_permid`

## ADDED Requirements

### Requirement: The rename preserves derive_taxa() output exactly

Renaming the `edge_class` value `'lineage'` to `'name'` SHALL NOT change any derived taxonomy
identity. `derive_taxa()` SHALL produce, for every permid, the same `original_permid`,
`accepted_spelling_permid`, and `concept_permid` as it did under the `'lineage'` token, and the
per-`edge_class` row counts in `name_opinions` SHALL be unchanged apart from the class label itself.

#### Scenario: Derived identity is unchanged across the rename

- **WHEN** `derive_taxa(all)` is run on a database migrated after the rename and its output is compared
  against a baseline captured from the same source data before the rename
- **THEN** every permid's `original_permid`, `accepted_spelling_permid`, and `concept_permid` match the
  baseline exactly, with no permid added, dropped, or altered

#### Scenario: Name-class row count carries over from the retired token

- **WHEN** `name_opinions` is grouped by `edge_class` after the rename
- **THEN** the count for `'name'` equals the pre-rename count for `'lineage'`, the `'root'` and
  `'concept'` counts are unchanged, and no row carries `'lineage'`
