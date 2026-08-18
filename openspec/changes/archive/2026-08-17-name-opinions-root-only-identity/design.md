## Context

The taxa/opinions subsystem is being migrated piecemeal into an append-only **ledger**: `name_opinions`, `assignment_opinions`, and `validity_opinions` each hold one row per opinion ever entered, with no dedup or collapse at migration time. All collapse (canonical-winner, accepted-spelling election, misspelling exclusion) happens only when the derived `taxa` table is built.

`name_opinions` rows are typed edges. `edge_class` ∈ {`root`, `lineage`, `concept`}:
- `root` (`original`) mints a permid's identity — `new_name`, `rank_id` — from its `authorities` row.
- `lineage` (`correction`, `recombination`, `reranked`, `reassignment`, `misspelling`) links a spelling to its form-of target.
- `concept` (`junior synonym`, `replaced by`) links a name to the taxon it is the same as.

The already-run authorities pass (`migrate-name-opinions.js`) mints a `root` row for **every** name-as-spelled (~517K), so every spelling's identity is already recorded once. The current `name_opinion_shape` CHECK, however, still requires `lineage` rows to carry `new_name`/`rank_id` — a leftover of the superseded "Option 1" design (mapping-doc §3/§9.1) in which a derived spelling had no root row and its `lineage` edge was its sole mint. Mapping-doc §3.2 (2026-08-17) settled that identity is `root`-only under the ledger model.

## Goals / Non-Goals

**Goals:**
- Make `new_name`/`rank_id` populated **iff** `edge_class = 'root'`, enforced by `name_opinion_shape`.
- Keep the DDL, the `taxa-opinions` spec, and the belongs-to/misspelling mapping doc consistent with that rule.

**Non-Goals:**
- No change to `derive_taxa()` (the current routine is explicitly non-authoritative and is being reworked separately; its identity-from-lineage reads and the permid-scoped `never_accepted` exclusion ride with that work).
- No change to the already-run root/concept/assignment migrations and no data backfill.
- No change to `lineage` edges' *provenance* columns (`reference_id`, `attribution`, `publication_year`, `evidence`, `authority_id`, `pages`, `figures`) — only the two identity columns.

## Decisions

**D1 — Fold `lineage` into the "no identity" branch of the CHECK.** The `name_opinion_shape` CHECK becomes:

```
root    ⇒ target NULL     AND new_name NOT NULL AND rank_id NOT NULL
lineage ⇒ target NOT NULL AND new_name NULL     AND rank_id NULL
concept ⇒ target NOT NULL AND new_name NULL     AND rank_id NULL
```

i.e. identity set ⇔ `root`. *Alternative considered:* source `lineage` identity from the **subject** (correct but redundant with the subject's root row, and leaves the CHECK carrying dead columns). Rejected — it duplicates immutable per-permid data on every edge and must be kept in sync forever.

**D2 — Guarding invariant is already met operationally.** Root-only identity is safe because every retained non-root edge's `subject_permid` resolves to a root row (its authorities-minted identity). The per-slice skip-and-log framework already drops any edge whose subject is unresolvable (`child_spelling_unresolved`), so every retained `lineage`/`concept` row satisfies the invariant by construction.

**D3 — Mapping fix, not a mapping addition.** The belongs-to/misspelling section of `authorities-opinions.md` currently sources `new_name`/`rank_id` from `target_permid`. That is removed (set NULL), which also resolves the separate defect of stamping the *target's* (correct) name onto a *misspelling* edge.

## Risks / Trade-offs

- [Existing data violates the new CHECK] → No: all migrated rows are `root` (identity set) or `concept` (identity NULL); both satisfy old and new CHECK, and no `lineage` rows exist yet. Verified by the migration inventory. No backfill.
- [A future `lineage` subject has no root row → identity lost] → The ledger guarantees every `child_spelling_no` has an `authorities` row (hence a root mint); unresolvable subjects are skip-and-logged, never inserted. If that invariant were ever violated, the row would be skipped, not silently identity-less.
- [`derive_taxa()` still reads identity from `lineage` minting rows] → Known and deferred: `taxa-opinions` spec `:190`/`:255-260` are inconsistent with root-only identity and are corrected as part of the derivation rework, not here. Documented in the proposal's Impact.

## Migration Plan

1. Edit the `name_opinion_shape` CHECK + comment in `postgresql/create_new.sql` and `postgresql/taxa-opinions-draft.sql` (`lineage` branch → NULL identity).
2. Update the `authorities-opinions.md` misspelling mapping (`new_name`/`rank_id` → NULL/NA).
3. Sync the `taxa-opinions` spec requirement + lineage scenarios (this change's delta).
4. No script re-run, no data migration. Rollback = revert the CHECK to the prior three-branch form (still satisfied by existing data).
