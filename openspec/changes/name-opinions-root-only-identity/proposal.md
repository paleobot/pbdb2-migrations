## Why

Under the append-only **ledger model** (the opinion tables record *every* opinion ever entered; all collapse happens only when `taxa` is derived), a permid's identity — `new_name` and `rank_id` — is minted exactly once, on its `root` row, sourced from its `authorities` row. `new_name`/`rank_id` are immutable attributes of a *permid*, not of an opinion (classic-taxa-opinions §9.8.1). The current `name_opinion_shape` CHECK still requires `lineage` rows to carry `new_name`/`rank_id`, a fossil of the abandoned "Option 1" mint-once design in which a derived spelling had no root row. Carried forward, that rule forces every `lineage` edge to restate its subject's identity — redundant at best, and, in the belongs-to/misspelling mapping as written, a bug (it copies the *target's* name onto the edge). This change makes identity **root-only**, decided in mapping-doc §3.2 (2026-08-17).

## What Changes

- Tighten the `name_opinion_shape` CHECK so `'lineage'` rows carry `new_name = NULL` and `rank_id = NULL` (joining `'concept'`). The CHECK collapses to a single invariant: `new_name`/`rank_id` are set **iff** `edge_class = 'root'`.
- Update the CHECK comment in both DDL files to state "identity set ⇔ `root`".
- Fix the belongs-to/misspelling mapping in `payloadSchemas/mappings/authorities-opinions.md` so the `lineage` `name_opinions` row sets `new_name`/`rank_id` to NULL (was: sourced from `target_permid`).
- NOT **BREAKING** against existing data: all migrated `name_opinions` rows are `root` (identity set) or `concept` (identity NULL); both already satisfy the tightened CHECK, and no `lineage` rows have been migrated yet. Zero backfill, no re-run.

## Capabilities

### New Capabilities

<!-- none -->

### Modified Capabilities

- `taxa-opinions`: the "name_opinions models typed edges with a minting shape" requirement changes — `'lineage'` rows now carry neither `new_name` nor `rank_id` (was: carry both). Adds a scenario asserting a `lineage` edge with a non-NULL identity is rejected, and one asserting a `lineage` edge with NULL identity is accepted.

## Impact

- **Schema/DDL:** `postgresql/create_new.sql` (`name_opinion_shape` CHECK + comment, ~L4710-4718); `postgresql/taxa-opinions-draft.sql` (same, ~L356-361).
- **Mapping doc:** `payloadSchemas/mappings/authorities-opinions.md` (misspelling section, `new_name`/`rank_id` rows).
- **Design rationale (already captured):** `docs/taxa-opinions-migration-mapping.md §3.2`; `docs/classic-taxa-opinions.md §9.8.2` superseding note.
- **No migration-script changes:** `migrate-name-opinions.js` (roots), `migrate-synonymy-opinions.js` (concept, already NULL) are unaffected; future `lineage`-writing slices (misspelling, correction, recombination, reranked, reassignment) must write NULL identity.
- **Out of scope / deferred with the derivation redesign:** `taxa-opinions/spec.md` `derive_taxa()` requirements (`:190`, `:255-260`) that read identity from a "`lineage` reason" minting row are now inconsistent with root-only identity; they ride along with the separate `derive_taxa()` rework (the current routine is explicitly non-authoritative).
