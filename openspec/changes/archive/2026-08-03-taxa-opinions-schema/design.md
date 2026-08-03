## Context

The technical design for taxa/opinions is already fully worked out and settled; it does **not** need to be re-derived here. The authoritative sources are:

- **`docs/classic-taxa-opinions.md`** — the reasoning. §9.5 (truth vs. materialization; the three layers), §9.6 (column vocabulary: succession / concept / classification), §9.8 (the identity inversion — `permid` = name-as-spelled, the committed model), §10.6 (the B/D registers).
- **`postgresql/taxa-opinions-draft.sql`** — the concrete DDL, extensively commented with per-object rationale and section back-references. This change is the act of folding that file into `create_new.sql`; the draft **is** this change's detailed design.

This document therefore does not restate the model. It records only the decisions specific to *folding the draft into `create_new.sql`* (B3) — the parts a reader needs to execute the fold correctly and safely — and cites the sources for everything else.

Current state: `create_new.sql` still contains the pre-design taxa / `assignment_opinions` / `rank_opinions` / `rename_opinions` / `homonyms` block. It predates §9 and the §9.8 inversion, models `permid` as the original combination, includes a `rank_opinions` fan-out, and carries `taxon_id` / `parent_taxon_id integer REFERENCES taxa("id")` FKs that versioning would swing on every belief change (§9.8.3). It must be removed, not amended.

## Goals / Non-Goals

**Goals:**

- Fold `taxa-opinions-draft.sql` into `create_new.sql` so the storage layer physically exists and `create_new.sql` runs clean from empty.
- Preserve every settled decision exactly as the draft encodes it (D-register); the fold is transcription + placement, not redesign.
- Convert the draft's `ALTER`/`INSERT`/`DELETE`-against-existing-seeds idiom into the corresponding edits to the original `CREATE`/seed statements, since in `create_new.sql` there is no pre-existing state to alter.
- Leave the schema in a state the derivation engine (B1/B2) and migration (B4) can build on with no further structural change.

**Non-Goals:**

- `taxonomy.derive()` (B1), `dependency_closure` + the AFTER-STATEMENT hot path (B2), and the legacy→new data migration (B4). This change creates empty structure only.
- `type_opinions` / `trait_opinions` and the legacy type/trait fields — deferred to PBOT's description system (D6).
- Re-opening any D-register decision. Those are closed; §10.6 D5–D11 and the draft's "OPEN QUESTIONS" footer record the resolutions.
- Point-in-time *query* implementation — D8 fixes that `taxa` stays versioned so the capability is *possible*; building the historical read path is not part of this change.

## Decisions

All of these are already settled in the docs; they are surfaced here because they shape how the fold must be done, each with its citation.

1. **Supersede, don't amend, the existing block.** The pre-inversion FKs (`taxon_id`/`parent_taxon_id → taxa("id")`) are exactly the keys the inversion deletes; there is no incremental edit from old to new. Remove the block wholesale and drop in the draft. → §9.8.3, proposal "BREAKING".

2. **Two versioning regimes, deliberately split.**
   - The **three opinion tables** are versioned (`permid` + `preceded_by_id`/`succeeded_by_id`) but **do not** call `install_version_triggers()`. Swinging inbound FKs would corrupt derived provenance (`taxa.winning_*_opinion_id`) and falsify history. → §9.5.2.1.
   - **`taxa`** and **`taxon_annotations`** call `install_version_triggers()` normally. On `taxa` the swing half is inert (nothing FKs to `taxa("id")`), which is the payoff of pointing at `permid` — kept as the standard helper anyway (see risk C2). → `taxa` header note in the draft, §10.6 C2, D8.
   - Consequence: the opinion tables must **hand-create** their `permid` head indexes (the helper would otherwise supply them). This is the one place hand-creating that index is correct, not a mistake. → draft "LAYER 1 INDEXES", §9.5.2.1.

3. **Invariants as storage-layer CHECKs via "Way 2" (D9).** Denormalize the governing dictionary discriminant onto each opinion row (`name_opinions.edge_class`, `validity_opinions.targeted`) and FK-pin it to a composite unique key on the dictionary (`(id, edge_class)`, `(id, targeted)`), making the minting-shape and "target required iff `targeted`" rules plain same-row CHECKs that guard every writer. This forces `edge_class` `NOT NULL`, hence `'original'` gets an explicit `'root'` value rather than NULL. → §10.6 D9, draft dictionary header ("WHY 'root' RATHER THAN NULL").

4. **Dictionary reconciliation is part of the fold, not a later step.** `namechange_reasons` drops `code` and gains `recombination`/`correction`/`replaced by`, plus `edge_class`/`never_accepted` (D7); `taxonomy_ranks` gains `height` and the missing `order` rank; `nomenclatural_statuses` is new (D2 moves `nomen oblitum` here). The draft expresses these as `ALTER`/`INSERT`/`DELETE`; when folding, apply them to the original seed `CREATE`s so the `DELETE FROM … WHERE reason = 'code'` becomes simply *not seeding* `code`. → §10.6 D2/D7/D11, draft "DICTIONARIES".

5. **`ltree` and existing infrastructure are prerequisites.** `CREATE EXTENSION IF NOT EXISTS ltree`; the block must be placed after `persons`, `refs`, `authorities`, the `dictionaries.*` seeds, and the `install_version_triggers()` / `permid` v7 CHECK infrastructure it depends on. → draft header conventions.

**Alternatives considered** (all recorded as closed in the D-register — noted here only so the fold isn't second-guessed mid-edit): keeping `permid` = original combination (rejected, §9.8); a `rank_opinions` fan-out (rejected, D1); enforcing invariants on the write path instead of CHECKs (rejected in favor of Way 2, D9); a trimmed `taxa`-only version trigger (deferred, not now, C2); an A/B homonym pair table vs. uuidv7 groups (rejected, D10).

## Risks / Trade-offs

- **Transcription drift while folding** (the draft's `ALTER`-idiom must become `CREATE`-idiom) → Fold mechanically, object by object, and verify by running `create_new.sql` against an empty database; the `specs` requirements (tables exist, CHECKs reject bad rows, correct tables versioned) are the acceptance gate.
- **Placement/ordering errors** — FKs to `persons`/`refs`/`authorities`/dictionaries and the `install_version_triggers()` call fail if emitted before their dependencies exist → Place the whole block after those definitions; a clean run from empty is the check.
- **Inert-swing cost on `taxa`'s hot write path** (C2) — `handle_new_version()` scans `pg_constraint` per append finding zero FKs to swing → Deliberately **not** optimized now: keep the shared helper for uniformity and correctness under any future FK topology; revisit only if §9.7 profiling flags it, and only with a loud guard. → §10.6 C2.
- **No `permid` registry table** — nothing at the SQL layer prevents an opinion referencing a never-minted `permid` → Accepted by decision; the `derive(all) ≡ heads` invariant (a B1/CI concern, not this change) is the backstop. → §9.5.1, draft OPEN QUESTIONS #6.
- **Residual invariant not covered by a CHECK** — "`objective` non-NULL iff reason = `junior synonym`" needs reason-token granularity `edge_class` lacks → Left to the write path + a `derive(all)` assertion; out of scope here. → §10.6 D9 "Residual".

## Migration Plan

This is a target-schema (`create_new.sql`) change, not a data migration — no rows move.

1. Remove the obsolete taxa/opinions/homonyms block from `create_new.sql`.
2. Fold in the draft, converting `ALTER`/seed-`DELETE` idioms to edits of the original `CREATE`/seed statements, placed after all dependencies.
3. Verify `create_new.sql` builds an empty database clean; spot-check the D9 CHECKs reject malformed opinion rows and that `taxa`/`taxon_annotations` are versioned while the opinion tables are not.

**Rollback:** revert the `create_new.sql` edit. Because `create_new.sql` describes a from-scratch build (no deployed data depends on it yet), rollback is a pure file revert with no data implications.

## Open Questions

None blocking. All A-items are decided (§10.6 D-register); the draft's "OPEN QUESTIONS" footer items are each marked RESOLVED/SUPERSEDED/accepted. The one acknowledged residual (decision 5's "objective iff junior synonym" sub-rule) is intentionally deferred to the write path and does not affect this change.
