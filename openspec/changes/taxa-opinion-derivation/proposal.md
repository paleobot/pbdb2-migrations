## Why

Change `taxa-opinions-schema` (B3) built the storage layer, but **Layer 2 is empty**: the `taxa` ledger has no way to be populated, because `derive_taxa()` — the single canonical definition of truth — does not exist. `derive_taxa()` is the whole point of the design (§9.5, §9.8): the accepted name, rank, concept, and classification of every taxon are a *pure function of the opinions*, and both the eventual hot path (B2) and every rebuild/migration/CI check call that one function. It is also the largest and highest-risk remaining piece (§10.6 B1) — the two union-finds, the ordered ranking, and the totality/determinism/cycle obligations all live here and nowhere else.

Implementing `derive_taxa()` now, proven **correct-by-rebuild** against the schema just folded in, is what validates that the storage shape (columns, indexes, constraints) is actually right before the incremental machinery (B2) and the data migration (B4) build on it.

## What Changes

- Add `derive_taxa(permids)` — in `public` with a descriptive name, matching the existing versioning-function convention (`install_version_triggers` et al.); no dedicated schema — a pure, set-returning function over the Layer 1 opinion tables (+ `refs` for `pubyr`) that produces one output row per permid matching the `taxa` ledger's derived columns (`name`, `rank_id`, `original_permid`, `accepted_spelling_permid`, `concept_permid`, `containing_concept_permid`, `classification_path`, `nomenclatural_status_id`, and the three `winning_*_opinion_id`). It reads **only** Layer 1 — never the ledger. (§9.5.2, §9.8.4)
  - **Two union-finds**: lineage (over `lineage`-class name edges → `original_permid`) and concept (over `concept`-class name edges → the senior lineage per concept). (§9.8.4 steps 1–2)
  - **Ordered ranking** for the accepted spelling per lineage, `ORDER BY evidence DESC, COALESCE(pubyr, ref.pubyr) DESC, id DESC`, excluding `never_accepted` misspellings — this single `ORDER BY` *is* Classic's `getMostRecentClassification`, in one place. (§9.8.4 step 3)
  - **Two opposite scopes**: accepted spelling pooled within the **senior lineage only**; classification pooled across the **whole concept** (junior-synonym borrowing — equal rank only, species excluded). (§9.8.4 steps 3–5, §9.5.2 step 3)
  - **Totality, determinism, cycle handling** (A synonym-of B, B synonym-of A) resolved in this one function, with explicit tie-breaks. (§9.5.6)
- Add a `rebuild_taxa()` cold path that calls `derive_taxa(all)` and loads/diffs the `taxa` ledger — the from-scratch and recovery entry point. In this change `rebuild_taxa()` is the *only* way the ledger is refreshed; there is no incremental trigger yet.
- Add the invariant check **`derive_taxa(all) ≡ current ledger heads`** as a callable assertion, usable in CI / post-import. (§9.5.5)
- **Not in scope**: `dependency_closure` and the `AFTER STATEMENT` hot-path trigger (B2); the legacy→new data migration (B4). This change makes the ledger *derivable and rebuildable*, not yet *incrementally maintained*.

## Capabilities

### New Capabilities
<!-- None. Derivation extends the existing taxa-opinions capability. -->

### Modified Capabilities
- `taxa-opinions`: Add the derivation behavior — `derive_taxa()` as the canonical, pure definition of the accepted tree; the `rebuild_taxa()` cold path that materializes the `taxa` ledger from it; and the `derive_taxa(all) ≡ heads` invariant. The B3 change defined *what is stored and guaranteed*; this change defines *how the stored beliefs are computed from the assertions*.

## Impact

- **`postgresql/create_new.sql`** — the `derive_taxa()` / `rebuild_taxa()` / `assert_taxa_invariant()` functions in `public` (no new schema), placed after the taxa/opinions tables they read and write. Target-schema infrastructure, following the `version-trigger-system` precedent (functions through OpenSpec, in `public` with descriptive names).
- **Depends on** the `taxa-opinions` schema from change `taxa-opinions-schema` (the three opinion tables, the `taxa` ledger, the dictionaries with `height`/`edge_class`/`targeted`, and the head indexes `derive_taxa()` reads through).
- **No migration script changes, no API changes.** `derive_taxa()` is exercised by SQL fixtures/tests, not by a data load (that is B4).
- **Validates B3's schema shape**: if `derive_taxa()` needs an index or column the fold didn't provide, that surfaces here as a cheap edit to the same `create_new.sql` block — which is why `taxa-opinions-schema` is not archived until this change lands.
- **Unblocks** B2 (`taxa-opinion-incremental`, which wraps `derive_taxa()` in the hot path) and B4 (`migrate-taxa-opinions`, which loads opinions then calls `rebuild_taxa()`).
- **Design references** (cited, not restated): `docs/classic-taxa-opinions.md` §9.5.2 (three layers / winner ordering), §9.5.5 (the invariant), §9.5.6 (totality/determinism/cycles), §9.8.4 (`derive_taxa()` — two union-finds, two scopes), §10.6 B1.
