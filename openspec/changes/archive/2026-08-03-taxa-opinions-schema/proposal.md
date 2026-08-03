## Why

The taxa/opinions redesign is out of its exploration phase: all A-item design decisions are closed (D-register, `docs/classic-taxa-opinions.md` §10.6), and the settled DDL lives in `postgresql/taxa-opinions-draft.sql` — a draft that has never been run. Meanwhile `create_new.sql` still carries the **obsolete** taxa / `*_opinions` / `homonyms` block that predates the §9 design work (and the §9.8 identity inversion). That block models the wrong thing: `permid` as the original combination, a `rank_opinions` fan-out, and `taxon_id` / `parent_taxon_id integer REFERENCES taxa("id")` FKs that would be swung on every belief change under versioning (§9.8.3).

This change folds the settled draft into `create_new.sql` (B3) so the storage layer physically exists. It is the foundation the derivation engine (B1/B2) and the migration (B4) build on — nothing downstream can proceed until the tables, dictionaries, and invariants are in place.

## What Changes

Fold `postgresql/taxa-opinions-draft.sql` into `postgresql/create_new.sql`, superseding the pre-design block.

- **BREAKING** — Replace the existing `taxa` / `assignment_opinions` / `rank_opinions` / `rename_opinions` / `homonyms` block. Drop `rank_opinions` (rank is now an immutable attribute of a name-as-spelled, D1) and `rename_opinions`. `type_opinions` / `trait_opinions` are **not** introduced — deferred to PBOT's description system (D6).
- **Layer 1 (assertions)** — Add three append-only, typed opinion tables: `name_opinions` (edges: `root` / `lineage` / `concept`), `assignment_opinions` (containment), `validity_opinions` (nomen family). Versioned via `permid` + `preceded_by_id`/`succeeded_by_id` but deliberately **without** `install_version_triggers()` — swinging derived provenance FKs would corrupt history (§9.5.2.1).
- **Layer 3 (ledger)** — Add the `taxa` ledger (one row per name-as-spelled; the derived identity triad `original_permid` / `accepted_spelling_permid` / `concept_permid`; `classification_path ltree`; `winning_*_opinion_id` provenance), versioned **with** `install_version_triggers()` (D8, point-in-time reconstruction is a confirmed requirement).
- **Outside the stack** — Add `taxon_annotations` (versioned curatorial prose) and `homonyms` (app-minted uuidv7 groups, D10).
- **Dictionaries** — Add `dictionaries.nomenclatural_statuses`; add `taxonomy_ranks.height` + the missing `order` rank (explicit rank ordering); reconcile `namechange_reasons` to the eight final tokens (D7: drop `code`, add `recombination`/`correction`/`replaced by`; `edge_class` + `never_accepted` columns).
- **Invariants as storage-layer CHECKs (D9, "Way 2")** — Denormalize the governing dictionary discriminant onto each opinion row (`name_opinions.edge_class`, `validity_opinions.targeted`) and FK-pin it to a composite unique key on the dictionary, so the minting-shape and "target required iff targeted" rules are plain same-row CHECKs that guard every writer.
- **Extension / indexes** — `CREATE EXTENSION ltree`; hand-created head-only permid indexes on the three opinion tables (they skip the trigger helper that would otherwise create them) plus the `taxa` head indexes derive()/reads need.
- **Not in scope** — `taxonomy.derive()` (B1), `dependency_closure` + the AFTER-STATEMENT hot path (B2), and the legacy→new data migration (B4). This change creates empty structure only; no data moves and no migration script changes.

## Capabilities

### New Capabilities
- `taxa-opinions`: The taxa/opinions storage model and its storage-layer invariants — the three-layer table structure (assertion opinion tables → the `taxa` ledger), the supporting dictionaries, the versioning discipline (which tables get triggers and why), and the CHECK/FK-enforced constraints. Later changes extend this capability with the derivation behavior (B1/B2); this change defines only what is stored and what the schema guarantees.

### Modified Capabilities
<!-- None. This change consumes entity-versioning-triggers and permid-uuidv7 but changes neither's requirements. No existing spec covers taxa/opinions storage or the dictionaries touched here. -->

## Impact

- **`postgresql/create_new.sql`** — the obsolete taxa/opinions/homonyms block is replaced; dictionary `CREATE`/seed statements for `taxonomy_ranks` and `namechange_reasons` are edited in place (the draft expresses these as `ALTER`/`INSERT`/`DELETE` against existing seeds; fold into the original `CREATE`s per the draft header). New `CREATE EXTENSION ltree`.
- **Depends on** existing target tables for FKs: `persons`, `refs`, `authorities`, and the `dictionaries.*` seeds; and on the `entity-versioning-triggers` (`install_version_triggers()`) and `permid-uuidv7` (`get_byte(...)` v7 CHECK) infrastructure already in `create_new.sql`.
- **No migration script changes, no API changes** — this is target-schema infrastructure only, matching the pattern of the archived `version-trigger-system` change.
- **Unblocks** B1 (`taxa-opinion-derivation`), B2 (`taxa-opinion-incremental`), and B4 (`migrate-taxa-opinions`).
- **Design references** (cited, not restated): `docs/classic-taxa-opinions.md` §9.5, §9.6, §9.8, §10.6 (B/D registers); `postgresql/taxa-opinions-draft.sql` is the concrete DDL and serves as this change's design basis.
