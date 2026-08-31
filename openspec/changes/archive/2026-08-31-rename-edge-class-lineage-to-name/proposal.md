## Why

`dictionaries.namechange_reasons.edge_class` uses the token `'lineage'` for the class of
`name_opinions` edges that relate one *spelling* of a name to another. The term overloads a word
this codebase already uses, correctly and pervasively, for a different thing: the **name-lineage**
that `derive_taxa()` builds *out of* those edges (the union-find component keyed by
`original_permid`, ≈ legacy `orig_no`). The edge and the component it produces should not share a
name.

`'name'` is the better token, and it aligns the enum with TDWG: TCS splits **NameRelationship**
from **TaxonConceptRelationship**, which is exactly the `'name'` | `'concept'` split this column
already encodes. We acknowledge `'name'` is not a perfect term either — but it is more accurate
than `'lineage'` and it is the standards-aligned one. Now is the moment because the opinions
migration is re-run from scratch (reset + migrate), so there is no production data to rewrite.

## What Changes

- **BREAKING (schema):** `dictionaries.namechange_reasons.edge_class` accepts `'name'` in place of
  `'lineage'`. The CHECK becomes `edge_class IN ('root', 'name', 'concept')`. Six seed rows —
  `correction`, `reranked`, `recombination`, `assignment`, `misspelling`,
  `historical misspelling` — move from `'lineage'` to `'name'`. The reason tokens themselves,
  `never_accepted`, and the eleven-token roster are unchanged.
- **BREAKING (schema):** the `name_opinion_shape` CHECK on `name_opinions` branches on
  `edge_class = 'name'`. The shape rule itself is unchanged (target set, no identity).
- `derive_taxa()` reads `'name'` at its two `edge_class` sites (`_dt_edge_cand`'s
  `IN ('root','lineage')` filter and `_dt_lin_winner`'s `= 'lineage'` filter). No logic changes.
- `migrate-opinions.js` looks up its dictionary reasons under `'name'` and stamps
  `edgeClass: 'name'` on the rows it emits.
- **`'root'` and `'concept'` are explicitly unchanged.** `'root'` stays even though it is arguably
  also a name-class row — it mints identity rather than asserting a relationship, and re-cutting
  the triple is out of scope for this change.
- **Vocabulary rule (applies to prose everywhere):** occurrences of "lineage" that mean *the edge
  class* become "name" ("lineage edge" → "name edge", "lineage backfill" → "name backfill",
  "lineage reason token" → "name reason token"). Occurrences that mean *the derived component*
  stay "lineage" (name-lineage, the lineage union-find, `_dt_lin`, "a lineage's accepted
  spelling", `place_in_lineage()`). This change does not sweep the word out of the codebase.
- Drive-by fix: `openspec/specs/taxa-opinions/spec.md` says the dictionary seeds "exactly the ten
  tokens" and lists ten, omitting `historical misspelling`. The seed and `create_new.sql`'s header
  both say eleven. That line is being edited anyway; correct it to eleven.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `taxa-opinions`: the `edge_class` enum, the `name_opinion_shape` minting-shape requirement, the
  negation requirement's per-class competition rule, the composite-FK drift scenario, the
  dictionary-seed requirement, and the lineage-grouping requirements all name `'lineage'`
  normatively and become `'name'`. Also corrects the ten-vs-eleven token count.
- `taxa-clades`: one scenario states that `derive_taxa_clades()` does not re-derive
  `name_opinions` `lineage`-class edges itself; that becomes `name`-class.
- `opinions-migration`: the universal-crosswalk, independent-resolution, `misspelling of`,
  mistagged-original-spelling, self-reference, and reconciliation requirements all describe the
  second output as the "lineage edge"/"lineage backfill". Under the vocabulary rule these name the
  edge class and become "name edge"/"name backfill". No migration behavior changes — the same rows
  are written, carrying the same reason tokens.

Unaffected specs (verified): `name-opinions-migration` (writes only `'root'`),
`synonymy-opinions-migration` (writes only `'concept'`), `assignment-opinions-migration` and
`authorities-migration` (no `edge_class` at all).

## Impact

**Target PostgreSQL schema** — `dictionaries.namechange_reasons` (CHECK + 6 of 11 seed rows) and
`name_opinions` (`name_opinion_shape` CHECK; the `(reason_id, edge_class)` composite FK to
`namechange_reasons (id, edge_class)` is structurally unchanged but its pinned value changes).

**Source MariaDB** — none. This change touches no legacy table, no type mapping, and no
0-as-NULL/timestamp/coordinate anomaly. Nothing is read differently from `pbdb_archive`.

**Code:**
- `postgresql/create_new.sql` — 5 value sites (L135, L142–147, L4778, L5108, L5160) plus header
  and derive comments.
- `reset-opinions.sql` — 3 value sites (L52, L59–64, L148). This file carries its **own** copy of
  the table, CHECK, and seed; it is not an include of `create_new.sql`, so the two must move
  together or the reset path silently diverges.
- `src/opinions-migration/migrate-opinions.js` — 5 sites (L141/143/145 dictionary lookups; L334,
  L362 emitted `edgeClass`), plus the internal summary bucket key `'lineage'`.
- `src/opinions-migration/tests/run-migration.js` — 4 assertion queries (L77, L132, L147, L157).
- `src/opinions-migration/tests/run-reference-handlers.js` — 1 count query (L149).
- Docs: `docs/classic-taxa-opinions.md`, `docs/taxa-opinions-migration-mapping.md`,
  `payloadSchemas/mappings/opinions.md`.

**Explicitly out of scope:** `migration_exploration/**` and `taxa-opinions-draft.sql` (cruft);
`src/opinions-migration/tests/cross-check-*.js` and their reports (a one-time sanity check against
the archived 48-script exploration); `migrate-authorities-opinions.js` (writes only `'root'`).

**Data integrity risk: low, and bounded by the reset.** `edge_class` is denormalized onto every
`name_opinions` row and FK-pinned to the dictionary's composite key, so the dictionary value and
the ~200k row copies must change together — there is no safe dictionary-only `UPDATE`. This change
takes the reset-then-migrate path (`reset-opinions.sql` then `migrate-opinions.js`), which sidesteps
that entirely: no existing rows are rewritten. For any future environment that does hold data, the
migration path is `DROP CONSTRAINT` → dual `UPDATE` (dictionary + `name_opinions`) → `ADD
CONSTRAINT` in one transaction; that is noted in design.md but not implemented here.

**Verification:** the change is behavior-preserving. Post-migration row counts per
`edge_class`, and `derive_taxa()`'s output (`original_permid`, `accepted_spelling_permid`,
`concept_permid`), must match the pre-change baseline exactly.
