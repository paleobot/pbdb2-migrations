## MODIFIED Requirements

### Requirement: Dictionaries are reconciled to the settled vocabularies

`dictionaries.taxonomy_ranks` SHALL gain an explicit `height integer` (NULL for `unranked`/`unranked clade`) and include the previously-missing `order` rank. `dictionaries.namechange_reasons` SHALL carry `edge_class` (`NOT NULL`, `IN ('root','name','concept')`) and `never_accepted`, expose the composite `UNIQUE (id, edge_class)`, and seed exactly the eleven tokens `original`, `misspelling`, `historical misspelling`, `reranked`, `recombination`, `assignment`, `correction`, `junior synonym`, `replaced by`, `invalid subgroup`, `nomen oblitum` — with no `code` token, `invalid subgroup` and `nomen oblitum` both `edge_class = 'concept'`, `original` alone `edge_class = 'root'`, and the remaining six `edge_class = 'name'`. `dictionaries.nomenclatural_statuses` SHALL exist with `(status, invalidates)` seeded for exactly `nomen dubium`, `nomen nudum`, `nomen vanum`, `nomen oblitum` — `invalid subgroup of` is not a member (it lives in `namechange_reasons` instead). `invalidates` SHALL be `true` for `nomen dubium`, `nomen nudum`, and `nomen vanum` alike: the ICZN does not recognize `nomen vanum` as a category distinct from `nomen dubium` (both describe doubt about a name's diagnosability from indeterminate type material, not a formal act of invalidation), and Classic's own curatorial process had no reliable way to guarantee a `nomen nudum` tag was applied strictly per the Code's availability criteria rather than as a looser judgment call — so all three receive identical treatment in `derive_taxa()` (see "Accepted spelling is the top-ranked opinion of the senior lineage" and "Seniority tiebreak is total and deterministic"). `invalidates` SHALL be `false` for `nomen oblitum` (untargeted): it remains recorded testimony with no effect on selection.

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
- **THEN** exactly `nomen dubium`, `nomen nudum`, `nomen vanum`, `nomen oblitum` are present, `invalid subgroup of` is absent, and `invalidates` is `true` for `nomen dubium`, `nomen nudum`, and `nomen vanum` alike, `false` only for `nomen oblitum`

### Requirement: Accepted spelling is the top-ranked opinion of the senior lineage

Per lineage, `derive_taxa()` SHALL choose `accepted_spelling_permid` by the following procedure. First, rank the permids not excluded by the `never_accepted` rule below by each one's own canonical introducing `name_opinions` edge (the top-ranked edge naming it as subject, by `evidence DESC, COALESCE(pubyr, ref.pubyr) DESC, id DESC`, considering only edges with `negates = false`) ranking highest by that same order. A negating edge SHALL NOT be eligible to be a permid's canonical introducing edge in the first place — negation rejects a relationship to another permid, it is not an account of this permid's own identity, so it never wins that ranking; since every permid's own `root` row is always a non-negating candidate, this can never by itself leave a permid with no canonical introducing edge. A permid SHALL be excluded from this ranking entirely if its own canonical introducing edge's reason is `never_accepted` (misspellings) — evaluated using that permid's own canonical introducing edge, not any other edge that happens to name it as subject, so a permid is not made eligible merely because it also carries an unexcluded `root` mint.

Second, take the top-ranked remaining permid as the provisional winner and check it against the validity veto: if its own current winning `validity_opinions` row has a status where `invalidates = true`, compare that opinion's rating (`evidence DESC, yr DESC, id DESC`) against the best rating among (a) the permid's own canonical introducing edge, and (b) any current, non-negating `concept`-class opinion naming the permid's lineage as its **target** (something else deferring to it) — any sign elsewhere in the ledger that this name kept being treated as legitimate after the invalidating ruling. Assignment (classification) opinions are excluded from this comparison: placing a taxon in a hierarchy does not imply an opinion on whether it is dubious. If the invalidating opinion outranks that best counter-signal, the permid is permanently excluded from this lineage's contest and the procedure repeats from the top-ranked remaining permid — except once only one `never_accepted`-eligible permid remains in the lineage, it is not further excluded by this veto regardless of its own validity status. Validity is therefore never a pre-filter — a `nomen dubium`/`nomen nudum`/`nomen vanum` permid competes normally and only loses its win, never its eligibility outright, when the invalidating opinion is not itself outranked.

The accepted rank rides along (the accepted spelling's `rank_id`). Grouping SHALL be resolved before spelling selection, and the concept's accepted name SHALL be scoped to the **senior** lineage only.

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

#### Scenario: A negating opinion never wins canonical-introducing-edge ranking, but its permid stays eligible via its own root row

- **WHEN** a permid's only introducing claim as subject other than its own `root` mint is a `negates = true` name edge with higher `evidence`/`pubyr` than that `root` mint
- **THEN** `derive_taxa()` does not read the negating edge's `evidence`/`pubyr` as spelling evidence; the permid's canonical introducing edge is its own `root` mint instead, so it remains eligible and — if it forms a lineage of one, per the winning negation removing it from any claimed lineage — is its own `accepted_spelling_permid`

#### Scenario: A permid barred by a winning nomen nudum ruling is excluded

- **WHEN** a permid's winning `validity_opinions` row has status `nomen nudum`, and neither its own canonical introducing edge nor any `concept`-class opinion targeting its lineage outranks that ruling
- **THEN** `derive_taxa()` excludes that permid from its lineage's `accepted_spelling_permid` contest, and a later, better-rated validity opinion or `concept`-class opinion targeting its lineage reverses the exclusion

#### Scenario: An invalidated permid with no counter-signal is excluded

- **WHEN** the top-ranked permid's winning `validity_opinions` row has a status where `invalidates = true`, and neither its own canonical introducing edge nor any `concept`-class opinion targeting its lineage outranks that invalidating opinion
- **THEN** `derive_taxa()` excludes that permid from the lineage's `accepted_spelling_permid` contest, and the next-ranked remaining permid is considered instead

#### Scenario: A later reversal signal elsewhere in the ledger overrides an old invalidating opinion

- **WHEN** a permid's winning `validity_opinions` row is an early, unevidenced `nomen dubium`, `nomen nudum`, or `nomen vanum` ruling, and a later, better-rated non-negating `concept`-class opinion names the permid's lineage as its target
- **THEN** `derive_taxa()` does not exclude the permid — the invalidating opinion is outranked by the counter-signal, and the permid wins if it was otherwise top-ranked

#### Scenario: A lineage where every candidate is invalidated still selects one

- **WHEN** every `never_accepted`-eligible permid in a lineage would otherwise be excluded by the validity veto
- **THEN** `derive_taxa()` stops excluding once one permid remains, and selects it as `accepted_spelling_permid` regardless of its own validity status

### Requirement: An exhausted lineage or concept emits no rows for its permids

When every permid in a lineage is excluded from `accepted_spelling_permid` eligibility by the `never_accepted` rule, `derive_taxa()` SHALL NOT select an `accepted_spelling_permid` for that lineage and SHALL NOT emit a row for any permid belonging to it — consistent with ICZN Article 23.1, under which priority and valid-name status are defined only among available names, so an exhausted lineage has nothing valid to materialize as its accepted spelling. The validity veto (see "Accepted spelling is the top-ranked opinion of the senior lineage") never causes exhaustion by itself: it stops excluding once one candidate remains, so a lineage with at least one `never_accepted`-eligible permid always has an `accepted_spelling_permid`. This SHALL hold even when the lineage's concept survives via a different, still-eligible sibling lineage. If every lineage in a concept is simultaneously exhausted by the `never_accepted` rule, the whole concept SHALL emit no rows for any of its permids — a genuine terminal state, not an error to raise.

#### Scenario: A concept survives when only one of its lineages is exhausted

- **WHEN** a concept has two lineages, one where every candidate is `never_accepted` and one with an eligible candidate
- **THEN** `derive_taxa()` emits no rows for the exhausted lineage's permids, while the concept's other members still receive rows with `concept_permid` equal to the eligible lineage's accepted spelling

#### Scenario: A fully exhausted concept emits no rows at all

- **WHEN** every lineage in a concept has zero `never_accepted`-eligible `accepted_spelling_permid` candidates
- **THEN** `derive_taxa()` emits no rows for any permid in that concept, and `taxa.accepted_spelling_permid`/`concept_permid` stay `NOT NULL` because no row is ever materialized rather than one with a null triad

### Requirement: Seniority tiebreak is total and deterministic

`derive_taxa()` SHALL select each concept's senior lineage by the following procedure. First, rank candidate lineages ignoring validity status entirely, in order: (a) a lineage with no currently-active, winning, non-negating `concept`-class opinion naming it junior to anything is preferred over one that has such an opinion; (b) the canonical `ORDER BY` on each lineage's accepted opinion; (c) oldest `original` `pubyr`; (d) lowest `permid`. Criterion (a) SHALL be computed from each lineage's current winning `concept`-class opinion only — a lineage is never deprioritized by a `concept`-class opinion that is outranked or negated, even if one exists in its history.

Second, take the top-ranked remaining lineage as the provisional senior and check it against the validity veto: if its accepted-spelling permid's current winning `validity_opinions` row has a status where `invalidates = true`, compare that opinion's rating (`evidence DESC, yr DESC, id DESC`) against the best rating among (a) the permid's own canonical introducing edge, and (b) any current, non-negating `concept`-class opinion naming this lineage as its **target**. If the invalidating opinion outranks that best counter-signal, the lineage is permanently excluded from this concept's senior contest, and criteria (a)-(d) are reapplied among the remaining lineages — except once only one lineage remains in the concept, it is not further excluded regardless of its own validity status. Once a lineage is excluded by this veto, a current, winning, non-negating `concept`-class opinion naming it as target SHALL NOT be treated as a disqualifying edge under criterion (a) in subsequent rounds — deferring to a lineage that has been excluded from winning is not a genuine deferral.

Third, for a concept where the veto excludes some but not all lineages (its candidate pool is genuinely narrowed, as opposed to a concept with no invalidated candidate or one where every candidate is invalidated), criterion (c) (oldest `original` `pubyr` — priority) SHALL be promoted ahead of criterion (b) (the canonical `ORDER BY` on each lineage's accepted opinion) among the surviving candidates, in place of the normal (b)-before-(c) ordering. Excluding the invalidated candidates alone is not sufficient: the survivors can still tie on criterion (a) and fall through to (b), whose `evidence DESC, yr DESC NULLS LAST, id DESC` shape is recency-biased and reproduces the same root-cause error one level down (a genuinely older, senior candidate loses to a merely more-recently-opined one). Promoting (c) ahead of (b) only for narrowed concepts resolves that recurrence without touching concepts where validity was never a factor. A concept with no invalidated candidate, and a concept fully consumed by the all-invalidated escape hatch, both resolve by criteria (a)-(d) in their normal order, identical to before this change.

#### Scenario: Mutual synonymy resolves to one deterministic senior

- **WHEN** "A synonym-of B" and "B synonym-of A" exist at equal rank and priority
- **THEN** `derive_taxa()` picks exactly one of A/B as senior per the tiebreak, and repeated calls return the same choice

#### Scenario: An outranked or negated concept claim does not deprioritize a lineage's seniority

- **WHEN** lineage L's only `concept`-class opinion (asserting L is a junior synonym of some lineage) is either outranked by a later non-negating opinion targeting a different lineage, or itself negated by a higher-ranked negating opinion, and L is tied with another lineage M (which has no `concept`-class opinion at all) on criteria (b)/(c)/(d)
- **THEN** `derive_taxa()` treats L the same as M under criterion (a) — L is not deprioritized for a claim that is no longer active

#### Scenario: A validity-invalidated senior candidate is evicted and the contest reruns

- **WHEN** the top-ranked candidate lineage (by criteria (a)-(d)) has a winning invalidating `validity_opinions` row that outranks the best counter-signal among its own canonical introducing edge and any `concept`-class opinion targeting it
- **THEN** `derive_taxa()` excludes that lineage from senior candidacy and reapplies criteria (a)-(d) among the remaining lineages, rather than selecting it

#### Scenario: A later reversal signal elsewhere in the ledger overrides an old invalidating opinion

- **WHEN** the top-ranked candidate lineage's winning `validity_opinions` row is an early, unevidenced `nomen dubium`, `nomen nudum`, or `nomen vanum` ruling, and a later, better-rated non-negating `concept`-class opinion names that lineage as its target
- **THEN** `derive_taxa()` does not exclude that lineage — it wins the concept despite carrying an invalidating status

#### Scenario: An edge to an evicted lineage no longer disqualifies its source

- **WHEN** lineage L's only current, winning, non-negating `concept`-class opinion names a lineage B that has already been excluded from senior candidacy by the validity veto
- **THEN** criterion (a) does not treat L as having a disqualifying edge in subsequent rounds — L competes as if it had no such opinion

#### Scenario: A concept where every candidate is invalidated still selects one

- **WHEN** every lineage in a concept would otherwise be excluded by the validity veto
- **THEN** `derive_taxa()` stops excluding once one lineage remains, and selects it as senior regardless of its own validity status

#### Scenario: A concept with no invalidated candidate is unaffected

- **WHEN** no lineage in a concept carries a winning invalidating `validity_opinions` row
- **THEN** `derive_taxa()` selects the senior lineage purely by criteria (a)-(d) in their normal order, identical to before this change

#### Scenario: Priority is promoted ahead of the mechanical tiebreak only for a genuinely narrowed pool

- **WHEN** the validity veto excludes some but not all lineages in a concept, and the surviving lineages tie on criterion (a) and would otherwise be ordered by criterion (b)'s recency-biased `evidence DESC, yr DESC, id DESC` shape
- **THEN** `derive_taxa()` orders the survivors by criterion (c) (oldest `original` `pubyr`) ahead of criterion (b) instead, so a genuinely senior survivor is not passed over for a merely more-recently-opined one — the same failure shape the veto itself was introduced to fix, recurring one level down
