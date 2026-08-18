## MODIFIED Requirements

### Requirement: name_opinions models typed edges with a minting shape

`name_opinions` SHALL represent typed edges between name-as-spelled permids: `subject_permid` defers to `target_permid` in the manner given by `reason_id`, whose `edge_class` (`'root'` | `'lineage'` | `'concept'`) selects the derivation grouping. Identity (`new_name`, `rank_id`) is an immutable attribute of a permid, minted once on its `root` row; edges assert relationships between permids whose identities already live on their own root rows. A same-row CHECK SHALL enforce the minting shape so that `new_name` and `rank_id` are populated **iff** `edge_class = 'root'`: `'root'` rows carry no target but do carry `new_name` and `rank_id`; `'lineage'` rows carry a target and carry neither `new_name` nor `rank_id`; `'concept'` rows carry a target and carry neither `new_name` nor `rank_id`. A row SHALL NOT have `subject_permid` equal to `target_permid`.

#### Scenario: A valid root (minting) opinion is accepted

- **WHEN** a `name_opinions` row is inserted with `edge_class = 'root'`, `target_permid IS NULL`, and `new_name` and `rank_id` populated
- **THEN** the insert succeeds

#### Scenario: A root opinion carrying a target is rejected

- **WHEN** a `name_opinions` row is inserted with `edge_class = 'root'` and a non-NULL `target_permid`
- **THEN** the minting-shape CHECK rejects the insert

#### Scenario: A valid lineage edge with no identity is accepted

- **WHEN** a `name_opinions` row is inserted with `edge_class = 'lineage'`, a non-NULL `target_permid`, and `new_name IS NULL` and `rank_id IS NULL`
- **THEN** the insert succeeds

#### Scenario: A lineage edge carrying an identity is rejected

- **WHEN** a `name_opinions` row is inserted with `edge_class = 'lineage'` and a non-NULL `new_name` or `rank_id`
- **THEN** the minting-shape CHECK rejects the insert

#### Scenario: A concept edge carrying an identity is rejected

- **WHEN** a `name_opinions` row is inserted with `edge_class = 'concept'` and a non-NULL `new_name` or `rank_id`
- **THEN** the minting-shape CHECK rejects the insert

#### Scenario: A self-referential edge is rejected

- **WHEN** a `name_opinions` row is inserted with `subject_permid = target_permid`
- **THEN** the `name_opinion_not_self` CHECK rejects the insert
