## Why

`taxa`/`derive_taxa()` currently model only the Linnaean hierarchy, with `taxa_clades`/`derive_taxa_clades()`
and `clade_attachments`/`derive_clade_attachments()` carrying the clade side and the cross-boundary edges
between the two as separate tables and separate derivations (see [taxa-opinions](../../specs/taxa-opinions/spec.md)
and the pending `derive-clade-attachments` change). That three-way split was the right way to make each
piece individually tractable, but it means there is no single table that answers "what is this taxon's
place in the hierarchy" without a caller stitching `taxa`, `taxa_clades`, and `clade_attachments` back
together itself. We want one primary table and one derive function that resolves Linnaean and clade
opinions together, accepting that this reintroduces the containment-cycle problems the split was
originally built to dodge — the fix this time is to keep adding loop-break rules to the combined
derivation until it's accurate, rather than to keep the domains apart.

The existing per-domain tables are not going away: they stay as the supporting/audit layer the new
combined derivation can be checked against. But `taxa`/`derive_taxa()` need to stop meaning "Linnaean
only" so those names are free for the new combined table and function to take over as the primary,
caller-facing pair.

## What Changes

- **BREAKING**: Rename the existing Linnaean table `taxa` to `taxa_linnaean`, and rename
  `derive_taxa()` / `rebuild_taxa()` to `derive_linnaean()` / `rebuild_linnaean()`. No behavior change —
  same columns, same derivation logic, same requirements, new names. Every caller and every reference in
  `openspec/specs/taxa-opinions/spec.md` that names `taxa`/`derive_taxa()` moves to the new names.
- `taxa_clades` and `derive_taxa_clades()` are unchanged — name and behavior both stay as they are. They
  become one of the new combined table's supporting inputs rather than a peer top-level table.
- **BREAKING**: Rename `clade_attachments` to `taxa_attachments`. No behavior change to
  `derive_clade_attachments()`/`rebuild_clade_attachments()` beyond the table name they write; function
  names are left as-is unless design work finds a reason to rename them too.
- Introduce a new primary `taxa` table and a new `derive_taxa()` function that supersede the names just
  vacated by the rename above. This is a new derivation, not a rename: it resolves Linnaean and clade
  opinions in one pass instead of delegating to the three separate derivations, and is responsible for
  its own loop-break rules for the containment cycles that cross the Linnaean/clade boundary (the same
  class of cycle `derive_clade_attachments()` exists to route around today). `taxa_linnaean`,
  `taxa_clades`, and `taxa_attachments` remain as independently derivable, secondary tables — the new
  `taxa` does not replace their derivation, it adds a fourth, combined one.
- No backwards-compatibility shims: since the new `taxa`/`derive_taxa()` serve the same conceptual role
  (the primary, caller-facing hierarchy) as the ones being renamed away, callers migrate to the new
  combined semantics directly rather than getting a transition period under the old names.

## Capabilities

### New Capabilities
- `taxa-unified`: the new primary `taxa` table and `derive_taxa()` function that combine Linnaean and
  clade opinions into one hierarchy, with their own loop-break rules for cross-boundary containment
  cycles.

### Modified Capabilities
- `taxa-opinions`: `taxa` → `taxa_linnaean`, `derive_taxa()` → `derive_linnaean()`,
  `rebuild_taxa()` → `rebuild_linnaean()`. Pure rename of the table/functions this capability's
  requirements already describe — no requirement text changes in substance, only the identifiers the
  scenarios refer to.

## Impact

- **`postgresql/create_new.sql`**: rename the `taxa` table and its indexes/constraints, `derive_taxa()`,
  `rebuild_taxa()`; rename `clade_attachments` and its indexes/constraints; add the new combined `taxa`
  table and `derive_taxa()` function. `rebuild_taxa_full()` (the three-table orchestrator) needs to be
  updated for the new naming and extended to also (re)build the new combined `taxa`.
- **`openspec/specs/taxa-opinions/spec.md`**: every scenario and requirement that names `taxa` or
  `derive_taxa()`/`rebuild_taxa()` needs its identifiers updated to `taxa_linnaean`/`derive_linnaean()`/
  `rebuild_linnaean()`.
- **Pending `derive-clade-attachments` change** (not yet archived; its `taxa-clades` and
  `clade-attachments` specs live under `openspec/changes/derive-clade-attachments/specs/`, not yet under
  `openspec/specs/`): that change's `clade-attachments` spec names the `clade_attachments` table
  throughout. Whichever change lands first, the other needs a follow-up to the renamed
  `taxa_attachments`. Also relevant: the still-open choice between the `derive-clade-attachments` design
  and the `extend-taxa-for-clades` alternative — this proposal assumes the three-table design
  (`taxa_linnaean`/`taxa_clades`/`taxa_attachments`) is the one being kept as the secondary layer.
- Any application code, views, or docs (e.g. the clade-hierarchy and taxonomy-identity user guides)
  that reference `taxa`/`derive_taxa()` meaning the Linnaean-only table need updating for the new
  meaning of those names.
- `_dt_*`-prefixed helper functions inside `derive_taxa()` are internal to the function being renamed;
  whether they move, get renamed, or get duplicated for the new combined `derive_taxa()` is a design
  decision, not a proposal-level one.
