# taxa-opinions Specification

## Purpose
TBD - created by archiving change taxa-opinions-schema. Update Purpose after archive.

## Requirements

### Requirement: Layer 1 assertion tables exist

The schema SHALL define three append-only assertion tables — `name_opinions`, `assignment_opinions`, and `validity_opinions` — each carrying a `bigint` identity primary key, a `permid uuid`, `authorizer_person_id`/`enterer_person_id` FKs to `persons`, `reference_id` FK to `refs`, an `evidence boolean NOT NULL`, an optional `pubyr integer` and `attribution jsonb`, a `removed boolean`, and `preceded_by_id`/`succeeded_by_id` self-referencing FKs. All `*_permid` columns SHALL be plain `uuid` pointers, NOT SQL foreign keys (there is no permid registry table).

#### Scenario: The three opinion tables are present with their key columns

- **WHEN** `create_new.sql` is applied to an empty database
- **THEN** `name_opinions`, `assignment_opinions`, and `validity_opinions` each exist with the columns above, and no `rank_opinions`, `rename_opinions`, `type_opinions`, or `trait_opinions` table exists

#### Scenario: permid columns are not foreign keys

- **WHEN** an opinion row is inserted whose `subject_permid` (or target) references a uuid that appears in no other row
- **THEN** the insert succeeds — there is no FK or registry table to violate

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

### Requirement: validity_opinions is untargeted, self-referential testimony

`validity_opinions` SHALL carry `nomenclatural_status_id` as a plain FK to `dictionaries.nomenclatural_statuses`, and SHALL NOT carry a `target_permid` or `targeted` column — every row is a self-referential assertion about `subject_permid`'s own naming act, never a relationship to another permid. `dictionaries.nomenclatural_statuses` SHALL carry a `bars_candidacy boolean NOT NULL DEFAULT false` column instead of `targeted`, true only for `nomen nudum`.

#### Scenario: validity_opinions has no target column

- **WHEN** `validity_opinions` is inspected after applying `create_new.sql`
- **THEN** it has no `target_permid` and no `targeted` column, and `nomenclatural_status_id` is a plain (non-composite) FK to `dictionaries.nomenclatural_statuses`

#### Scenario: Only nomen nudum bars candidacy

- **WHEN** the `nomenclatural_statuses` dictionary is queried
- **THEN** `nomen nudum` has `bars_candidacy = true` and `nomen dubium`/`nomen vanum`/`nomen oblitum` have `bars_candidacy = false`

### Requirement: The taxa ledger exists as derived output

The schema SHALL define a `taxa` table with one row per name-as-spelled permid, holding the immutable denormalized identity (`name text NOT NULL`, `rank_id integer NOT NULL` FK to `dictionaries.taxonomy_ranks`, optional `authority_id`), the derived identity triad (`original_permid`, `accepted_spelling_permid`, `concept_permid`, all `NOT NULL`), classification (`containing_concept_permid` nullable, `classification_path ltree`), `nomenclatural_status_id`, and provenance (`winning_name_opinion_id`, `winning_assignment_opinion_id`, `winning_validity_opinion_id` FKs to the three opinion tables). It SHALL NOT carry `authorizer_person_id`/`enterer_person_id` (no row is hand-entered) and SHALL NOT carry a `winning_rank_opinion_id`.

#### Scenario: The taxa ledger has the derived triad and provenance

- **WHEN** `create_new.sql` is applied to an empty database
- **THEN** `taxa` exists with `original_permid`, `accepted_spelling_permid`, `concept_permid` all `NOT NULL`, `classification_path` of type `ltree`, the three `winning_*_opinion_id` FKs, and no `authorizer_person_id`, `enterer_person_id`, or `winning_rank_opinion_id`

#### Scenario: taxa.rank_id is mandatory

- **WHEN** a `taxa` row is inserted with `rank_id IS NULL`
- **THEN** the `NOT NULL` constraint rejects it (a materialized taxon always has a knowable rank)

### Requirement: Versioning regimes are applied correctly per table

`taxon_annotations` SHALL be versioned via `install_version_triggers()` (getting `place_in_lineage()`, `handle_new_version()`, and the automatic `permid` head index). `taxa` SHALL NOT be versioned: it carries no `preceded_by_id`/`succeeded_by_id` and is not passed to `install_version_triggers()` — it SHALL instead enforce `UNIQUE (permid)` (one row per permid, updated in place, not a lineage of historical rows). The three opinion tables SHALL be versioned by carrying `permid` + succession columns but SHALL NOT call `install_version_triggers()`, and SHALL instead hand-create their own head-only `permid` indexes.

#### Scenario: The ledger and annotations get the trigger helper

- **WHEN** the schema is inspected after applying `create_new.sql`
- **THEN** version triggers are installed on `taxon_annotations` but not on `taxa`, and `taxa` has no `preceded_by_id`/`succeeded_by_id` columns and a `UNIQUE (permid)` constraint

#### Scenario: The opinion tables do not get the trigger helper

- **WHEN** the schema is inspected after applying `create_new.sql`
- **THEN** no version triggers exist on `name_opinions`, `assignment_opinions`, or `validity_opinions`, and each has a hand-created partial index on `(permid) WHERE succeeded_by_id IS NULL`

### Requirement: permid columns enforce uuidv7

Every `permid`-bearing column (the opinion tables, `taxa`, `taxon_annotations`) and `homonyms.homonym_group_id` SHALL enforce version 7 via `CHECK ((get_byte(uuid_send(<col>), 6) >> 4) = 7)`, consistent with the `permid-uuidv7` convention already in `create_new.sql`.

#### Scenario: A non-v7 uuid is rejected

- **WHEN** a row is inserted with a `permid` whose UUID version nibble is not 7
- **THEN** the v7 CHECK rejects the insert

### Requirement: Non-derived tables sit outside the stack

The schema SHALL define `taxon_annotations` (versioned curatorial prose: `common_name`, `comments`, `discussion`, `discussed_by_reference_id`) keyed by `subject_permid`, and `homonyms` grouping permids by an app-minted `homonym_group_id uuid` (uuidv7), with `UNIQUE (homonym_group_id, permid)`. Neither SHALL be reconstructable by `derive()`; `taxa` SHALL NOT carry a `has_homonym` flag.

#### Scenario: Annotations and homonyms exist independently of the ledger

- **WHEN** `create_new.sql` is applied to an empty database
- **THEN** `taxon_annotations` and `homonyms` exist, and `taxa` has no `has_homonym` column

#### Scenario: A homonym group spans more than two members

- **WHEN** three permids are inserted into `homonyms` sharing one `homonym_group_id`
- **THEN** all three rows are accepted (grouped representation supports n > 2 homonyms)

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

### Requirement: The obsolete taxa/opinions block is removed and the schema builds clean

The pre-inversion `taxa` / `assignment_opinions` / `rank_opinions` / `rename_opinions` / `homonyms` block SHALL be removed from `create_new.sql`, with no residual FK columns of the form `taxon_id`/`parent_taxon_id → taxa("id")`. `create_new.sql` SHALL apply successfully to an empty database, with the taxa/opinions block placed after its dependencies (`persons`, `refs`, `authorities`, the `dictionaries.*` seeds, and the versioning/permid infrastructure) and after `CREATE EXTENSION IF NOT EXISTS ltree`.

#### Scenario: create_new.sql runs end-to-end on an empty database

- **WHEN** `create_new.sql` is applied to a fresh, empty PostgreSQL database
- **THEN** it completes without error and the `ltree` extension is present

#### Scenario: No pre-inversion swing FKs remain

- **WHEN** `create_new.sql` is searched for `REFERENCES taxa("id")`
- **THEN** the only matches are `taxa`'s own `preceded_by_id`/`succeeded_by_id` succession columns — no `taxon_id` or `parent_taxon_id` FK to `taxa("id")` exists

### Requirement: derive_taxa() is a pure function of the opinions

`derive_taxa(permids)` SHALL compute the accepted name, rank, groupings, classification, and validity of taxa reading **only** the Layer 1 opinion tables (`name_opinions`, `assignment_opinions`, `validity_opinions`) and `refs` (for `pubyr`). It SHALL NOT read the `taxa` ledger, and SHALL NOT write to any table. It SHALL consider only current, non-removed assertions (`removed IS NOT TRUE AND succeeded_by_id IS NULL`).

#### Scenario: derive_taxa() output does not depend on the ledger

- **WHEN** `derive_taxa()` is called after the `taxa` ledger is truncated
- **THEN** it returns the same rows it returned before the truncation (its output is a function of the opinions alone)

#### Scenario: superseded and removed opinions are ignored

- **WHEN** an opinion has a newer version (`succeeded_by_id` set) or `removed = true`
- **THEN** `derive_taxa()` does not use it in any ranking or grouping

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

### Requirement: Concept grouping collapses synonyms

For each lineage, `derive_taxa()` SHALL select the single top-ranked current `concept`-class opinion among all opinions filed under any of that lineage's member permids (`ORDER BY evidence DESC, COALESCE(pubyr, ref.pubyr) DESC, id DESC`). If that winner is non-negating, its edge (lineage → target lineage) feeds the concept union-find; if the winner is negating (`negates = true`), the lineage contributes no concept edge this round and forms a concept of its own unless some other current opinion pulls it elsewhere. `derive_taxa()` SHALL union the resulting edges into concepts and assign every permid in a concept the same `concept_permid` — the accepted spelling of the concept's **senior** lineage. A `concept`-class candidate edge SHALL be excluded from the union-find entirely — on either side — if either lineage's accepted rank (per the lineage-grouping requirement) is `unranked` or `unranked clade`: these are cladistic ranks, not part of the Linnaean containment system, and merging one into a concept alongside a Linnaean-ranked ancestor or descendant is exactly the mechanism that produces spurious containment cycles (a lineage's concept folding back into one of its own containing ancestors). An excluded lineage forms its own concept, exactly as if it had no `concept`-class opinion at all.

#### Scenario: A junior synonym shares the concept's accepted name

- **WHEN** lineage J is a `junior synonym` (concept edge) of senior lineage S
- **THEN** `derive_taxa()` reports the same `concept_permid` for members of J and S, equal to S's accepted spelling

#### Scenario: A later, higher-ranked opinion redirects a lineage's concept

- **WHEN** lineage L has two current `concept`-class opinions (filed under any of its member permids) targeting different lineages, and the higher-ranked one targets lineage S
- **THEN** `derive_taxa()` unions L into S's concept, not the lower-ranked opinion's target's concept

#### Scenario: A winning negation returns a lineage to its own concept

- **WHEN** lineage L's current `concept`-class opinions are a lower-ranked one (reason `junior synonym`, `negates = false`, target S) asserting L is a junior synonym of senior lineage S, and a higher-ranked one citing the same `junior synonym` reason with `negates = true` and the same target S, rejecting that claim
- **THEN** `derive_taxa()` reports `concept_permid` for L's members equal to L's own accepted spelling, not S's

#### Scenario: An unranked-clade lineage never merges into another concept via synonymy

- **WHEN** a lineage accepted at rank `unranked clade` (or `unranked`) has a winning `concept`-class opinion naming it a junior synonym of a lineage accepted at a Linnaean rank (e.g. `class`, `family`)
- **THEN** `derive_taxa()` excludes that edge from the concept union-find, and the unranked-clade lineage forms its own concept rather than merging into the Linnaean-ranked lineage's concept

#### Scenario: Two unranked-clade lineages do not merge with each other either

- **WHEN** two lineages both accepted at rank `unranked clade` have a winning `concept`-class opinion between them
- **THEN** `derive_taxa()` still excludes that edge — the exclusion applies whenever either side is unranked/unranked clade, not only when one side is Linnaean-ranked — and each forms its own concept

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

### Requirement: Classification is pooled across the whole concept (junior-synonym borrowing)

`derive_taxa()` SHALL choose each concept's `containing_concept_permid` from the top `assignment_opinions` pooled across **all permids in the concept**, by the canonical `ORDER BY`. Borrowing SHALL apply only at **equal rank**, and SHALL be **excluded for species** (a species is placed by its own direct allocation). A candidate SHALL be excluded from this pool entirely — never entering the ranking contest — if its `containing_permid` resolves to the same concept as the subject (i.e. the concept would be its own container). A candidate SHALL also be excluded if either the subject's lineage or the containing permid's lineage is accepted at rank `unranked` or `unranked clade` — the same cladistic-vs-Linnaean reasoning as the concept-grouping exclusion applies here: an unranked-clade lineage SHALL NOT be assigned a `containing_concept_permid` of its own, and SHALL NOT be eligible to serve as another concept's container. A candidate SHALL also be excluded if the containing lineage's accepted rank is **finer** than the subject lineage's accepted rank (a rank inversion — a container SHALL NOT be more finely ranked than what it contains); equal rank between subject and container SHALL NOT be excluded by this check, since equal-rank containment (e.g. one genus placed within another) is a legitimate, common pattern independent of the dedicated equal-rank-borrowing mechanism above. If excluding self-referential, unranked, or rank-inverted candidates leaves no candidate for a concept, that concept's `containing_concept_permid` SHALL be `NULL` (rootless), the same outcome already used elsewhere for "no container asserted," rather than an error or a synthesized guess.

#### Scenario: A placement filed under the junior name sets the concept's parent

- **WHEN** the most recent reliable equal-rank `belongs to` opinion in a concept is filed under a junior synonym
- **THEN** `derive_taxa()` uses it to set the concept's `containing_concept_permid`

#### Scenario: Species placement is not borrowed

- **WHEN** the subject concept is a species and a placement opinion exists on a synonym
- **THEN** `derive_taxa()` does not borrow it; the species is placed by its own direct assignment

#### Scenario: A self-referential candidate is excluded, and the next-ranked genuine candidate wins

- **WHEN** a concept's pooled candidates include one whose `containing_permid` resolves back to that same concept (e.g. a legacy `belongs to` opinion filed under a now-synonymized lineage naming the other, now-merged lineage as container) and at least one other candidate whose `containing_permid` resolves to a different concept
- **THEN** `derive_taxa()` excludes the self-referential candidate from the ranking contest entirely, and sets `containing_concept_permid` from the top-ranked remaining candidate, by the same `evidence DESC, yr DESC NULLS LAST, opinion_id DESC` order used when no self-reference is present

#### Scenario: A concept whose only candidates are self-referential ends up rootless

- **WHEN** every rank-matching `assignment_opinions` candidate pooled for a concept resolves its `containing_permid` back to that same concept
- **THEN** `derive_taxa()` sets that concept's `containing_concept_permid` to `NULL` rather than raising an error, selecting one of the excluded candidates anyway, or leaving the concept unresolved

#### Scenario: An unranked-clade concept is never assigned a container

- **WHEN** a concept's accepted spelling is at rank `unranked clade`, and its senior lineage has a winning `assignment_opinions` candidate
- **THEN** `derive_taxa()` excludes that candidate from the pool and sets the concept's `containing_concept_permid` to `NULL` rather than using it

#### Scenario: An unranked-clade lineage is never borrowed as another concept's container

- **WHEN** a concept's pooled candidates include one whose `containing_permid` resolves to a lineage accepted at rank `unranked` or `unranked clade`
- **THEN** `derive_taxa()` excludes that candidate from the pool, falling through to the next-ranked non-excluded candidate or to `NULL` if none remains

#### Scenario: A rank-inverted candidate is excluded, and a coarser or equal-rank candidate wins instead

- **WHEN** a concept's pooled candidates include one whose containing lineage's accepted rank is finer than the subject lineage's accepted rank (e.g. a family's senior lineage cited as contained by a subfamily), and at least one other candidate whose containing lineage is coarser-or-equal-ranked
- **THEN** `derive_taxa()` excludes the rank-inverted candidate from the ranking contest entirely, and sets `containing_concept_permid` from the top-ranked remaining candidate

#### Scenario: Equal-rank containment is not excluded by the rank-cardinality check

- **WHEN** a concept's pooled candidate names a containing lineage accepted at the same rank as the subject lineage (e.g. one genus placed within another)
- **THEN** `derive_taxa()` does not exclude that candidate on rank-cardinality grounds; it competes normally in the ranking contest

#### Scenario: A concept whose only candidates are rank-inverted ends up rootless

- **WHEN** every candidate pooled for a concept has a containing lineage finer-ranked than the subject lineage
- **THEN** `derive_taxa()` sets that concept's `containing_concept_permid` to `NULL` rather than raising an error or selecting one of the excluded candidates anyway

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

### Requirement: derive_taxa() terminates on cycles and surfaces containment cycles

`derive_taxa()` SHALL terminate on synonymy cycles (treating the cycle as one concept). A direct self-reference — a single concept whose only pooled containment candidate(s) resolve back to itself — SHALL be resolved to `containing_concept_permid = NULL` by the pooling exclusion above, and SHALL NOT reach the cycle guard at all. A cycle whose formation depended on an `unranked`/`unranked clade` lineage participating in concept-class merging or containment pooling, or on a rank-inverted containment candidate, SHALL likewise never form in the first place, per the exclusions above, and SHALL NOT reach the cycle guard. A genuine classification (containment) cycle spanning two or more distinct concepts of compatible rank — one that does not depend on unranked-clade participation or a rank inversion — SHALL still be surfaced as an error rather than looping or emitting a partial path.

#### Scenario: A synonymy cycle does not loop

- **WHEN** the concept edges form a cycle
- **THEN** `derive_taxa()` completes and returns one concept for the cycle's members

#### Scenario: A containment cycle raises

- **WHEN** assignment opinions imply that concept A contains concept B, and (directly or transitively through other distinct concepts) B contains A, no concept in the cycle is accepted at rank `unranked` or `unranked clade`, and no edge in the cycle is a rank inversion
- **THEN** `derive_taxa()` raises an error identifying the cycle rather than returning

#### Scenario: A direct self-containment candidate resolves to rootless, not a raised cycle

- **WHEN** a concept's only pooled containment candidate(s) name that same concept as container (a length-one cycle)
- **THEN** `derive_taxa()` resolves it to `containing_concept_permid = NULL` via the pooling exclusion, and this concept never triggers the containment-cycle guard

#### Scenario: A cycle that only forms via an unranked-clade lineage never reaches the guard

- **WHEN** a chain of concept-class and/or containment edges would form a cycle only because one of its links merges or places an `unranked`/`unranked clade` lineage
- **THEN** the concept-grouping and classification-pooling exclusions above prevent that link from ever forming, so the cycle never exists and the guard is never triggered by it

#### Scenario: A cycle that only forms via a rank-inverted containment edge never reaches the guard

- **WHEN** a chain of containment edges would form a cycle only because one of its links places a coarser-ranked lineage inside a finer-ranked one
- **THEN** the classification-pooling exclusion above prevents that link from ever forming, so the cycle never exists and the guard is never triggered by it

### Requirement: derive_taxa(subset) equals derive_taxa(all) for the requested permids

`derive_taxa(permids)` SHALL return, for each requested permid, exactly the row `derive_taxa(all)` would produce, by internally expanding the seed set to full lineage/concept components before computing.

#### Scenario: Deriving a single junior synonym matches the full derivation

- **WHEN** `derive_taxa(ARRAY[<one junior-synonym permid>])` is called
- **THEN** that permid's row equals its row from `derive_taxa(all)` (same `concept_permid`, `accepted_spelling_permid`, `containing_concept_permid`, `classification_path`)

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

### Requirement: classification_path materializes the concept adjacency

`derive_taxa()` SHALL produce `classification_path` as an `ltree` of concept permids from root to node, consistent with `containing_concept_permid` (adjacency is primary; the path is derived from it).

#### Scenario: The path matches the adjacency chain

- **WHEN** concept C is contained by B which is contained by root A
- **THEN** C's `classification_path` is the ltree `A.B.C` (and `containing_concept_permid = B`)

### Requirement: rebuild_taxa() materializes the ledger and the invariant holds

`rebuild_taxa()` SHALL call `derive_taxa(all)` and load the `taxa` ledger by upserting in place: updating a permid's existing row where derived output differs, and inserting a row where the permid is new, recording provenance (`winning_name_opinion_id`, `winning_assignment_opinion_id`, `winning_validity_opinion_id`). A callable check SHALL assert the invariant `derive_taxa(all) ≡ the current taxa rows`.

#### Scenario: After rebuild, derive_taxa(all) equals the ledger heads

- **WHEN** `rebuild_taxa()` runs over a fixture opinion set
- **THEN** the invariant check reports equality between `derive_taxa(all)` and the current `taxa` rows

#### Scenario: A no-op re-derivation appends no versions

- **WHEN** `rebuild_taxa()` runs twice with no intervening opinion changes
- **THEN** the second run updates and inserts no rows (output equals the existing `taxa` rows)

#### Scenario: Ledger rows carry winning-opinion provenance

- **WHEN** a taxon's classification is set by a specific assignment opinion
- **THEN** its `taxa` row's `winning_assignment_opinion_id` references that opinion

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
