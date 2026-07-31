# Tasks — taxa-opinions-schema (B3)

This is a target-schema fold, not a data migration: no rows move, so the row-count /
0-as-NULL / FK-chain migration steps do not apply here — they belong to B4
(`migrate-taxa-opinions`). Source of truth for every object is
`postgresql/taxa-opinions-draft.sql`; rationale citations are in
`docs/classic-taxa-opinions.md` (§9.5, §9.6, §9.8, §10.6).

> **Applied 2026-07-31.** Folded into `postgresql/create_new.sql` and verified by a
> from-empty build on localhost PG16 (PostGIS + ltree), all spec scenarios exercised.
> One scope decision taken during apply: `occurrences` carried a `taxon_id →
> taxa("id")` swing FK (the anti-pattern §9.8.3 removes) and is an under-designed
> placeholder; per user direction it was **stubbed out** (commented) pending its own
> reform, rather than reshaped here. See task 6.3.

## 1. Preparation

- [x] 1.1 Locate the obsolete taxa/opinions block in `create_new.sql` (the `taxa` / `assignment_opinions` / `rank_opinions` / `rename_opinions` / `homonyms` definitions with `taxon_id`/`parent_taxon_id → taxa("id")` FKs) and note its line range. — was lines 4557–4624; confirmed never ran (FKs to non-existent `nomenclature_opinions`/`descriptions`).
- [x] 1.2 Confirm the insertion point: the fold must land after `persons`, `refs`, `authorities`, the `dictionaries.*` seed statements, and the `install_version_triggers()` / permid-v7 infrastructure it depends on. — replaced in place, right after `install_version_triggers('authorities')`.
- [x] 1.3 Add `CREATE EXTENSION IF NOT EXISTS ltree;` near the other extension setup (or at the head of the folded block). — added at top of file.

## 2. Remove the obsolete block

- [x] 2.1 Delete the pre-inversion `taxa` / `assignment_opinions` / `rank_opinions` / `rename_opinions` / `homonyms` definitions identified in 1.1.
- [x] 2.2 Grep the whole file for `REFERENCES taxa("id")` and confirm no `taxon_id` / `parent_taxon_id` swing FKs survive anywhere (only `taxa`'s own succession columns are allowed, added in step 5). — only `taxa.preceded_by_id`/`succeeded_by_id` remain.

## 3. Fold the dictionaries

Convert the draft's `ALTER`/`INSERT`/`DELETE`-against-existing-seed idiom into edits of the original `CREATE`/seed statements (there is no pre-existing state in a from-empty build).

- [x] 3.1 `dictionaries.taxonomy_ranks`: add `height integer`; add the missing `order` rank; populate `height` per the draft's VALUES list, leaving `unranked`/`unranked clade` NULL. (§10.6 D11) — folded into the `CREATE`/seed; verified 25 rows, `order` present, 2 NULL heights.
- [x] 3.2 `dictionaries.namechange_reasons`: add `edge_class text` and `never_accepted boolean`; seed exactly the eight reconciled tokens (`original`, `misspelling`, `reranked`, `recombination`, `assignment`, `correction`, `junior synonym`, `replaced by`) — do **not** seed `code` or `nomen oblitum`; set `edge_class`/`never_accepted` per the draft; lock `edge_class` to `NOT NULL` + `CHECK (edge_class IN ('root','lineage','concept'))`; add `UNIQUE (id, edge_class)`. (§10.6 D2/D7) — verified 8 tokens, 0 forbidden, `misspelling` never_accepted=t.
- [x] 3.3 `dictionaries.nomenclatural_statuses`: create the table with `(status, targeted)` and `UNIQUE (id, targeted)`; seed the nomen family + `invalid subgroup of` per the draft. (§10.6 D2) — verified 5 statuses with correct `targeted`.

## 4. Fold Layer 1 — assertion tables

- [x] 4.1 `name_opinions`: transcribe the full definition — permid-v7 CHECK, `subject_permid`/`target_permid`/`reason_id`/`edge_class`/`objective`, the minting-identity columns (`new_name`, `rank_id`, `authority_id`, `pages`, `figures`), provenance columns, succession columns; the `name_opinion_not_self` CHECK; the composite FK `(reason_id, edge_class) → namechange_reasons(id, edge_class)`; the `name_opinion_shape` CHECK. Do **not** call `install_version_triggers()`. (§9.5.2.1, §9.8, §10.6 D9)
- [x] 4.2 `assignment_opinions`: transcribe with `subject_permid`/`containing_permid`/`questioned`, provenance + succession columns, and the `assignment_not_self` CHECK. No version triggers. (§9.6.1)
- [x] 4.3 `validity_opinions`: transcribe with `status_id`/`targeted`/`target_permid`, the composite FK `(status_id, targeted) → nomenclatural_statuses(id, targeted)`, and the `validity_target_shape` CHECK. No version triggers. (§10.5, §10.6 D9)

## 5. Fold Layer 3 — the ledger

- [x] 5.1 `taxa`: transcribe with the immutable identity (`name`, `rank_id NOT NULL`, `authority_id`), the derived triad (`original_permid`/`accepted_spelling_permid`/`concept_permid`, all `NOT NULL`), `containing_concept_permid` + `classification_path ltree`, `nomenclatural_status_id`, the three `winning_*_opinion_id` FKs, and succession columns — with **no** authorizer/enterer and **no** `winning_rank_opinion_id`. (§9.8.3, §10.6 D8/D11)
- [x] 5.2 Call `SELECT install_version_triggers('taxa');` immediately after the table, carrying over the C2 note. (§10.6 C2, D8)
- [x] 5.3 Create the `taxa` head-only indexes (original / accepted_spelling / concept / containing / path via GiST / name), all `WHERE succeeded_by_id IS NULL`.

## 6. Fold "outside the stack"

- [x] 6.1 `taxon_annotations`: transcribe (`subject_permid`, `common_name`, `comments`, `discussion`, `discussed_by_reference_id`, succession columns); call `install_version_triggers('taxon_annotations');`; create its head-only `subject_permid` index.
- [x] 6.2 `homonyms`: transcribe with `homonym_group_id uuid` (permid-v7 CHECK), `permid`, `UNIQUE (homonym_group_id, permid)`, and the `homonyms_permid_idx` index. (§10.6 D10)
- [x] 6.3 Stub out the `occurrences` placeholder (comment it out with an explanatory note) — it carried a `taxon_id → taxa("id")` swing FK and is inconsistent with the inversion; deferred to its own reform. (User decision during apply.)

## 7. Fold Layer 1 indexes

- [x] 7.1 Create the head-only edge indexes on the three opinion tables (`subject_permid`, plus `target_permid` on `name_opinions` and `containing_permid` on `assignment_opinions`), all `WHERE succeeded_by_id IS NULL`.
- [x] 7.2 Hand-create the head-only `permid` indexes on all three opinion tables (`WHERE succeeded_by_id IS NULL`) — required because these tables skip `install_version_triggers()`, which would otherwise supply them. (§9.5.2.1)

## 8. Verification (against specs/taxa-opinions/spec.md)

- [x] 8.1 Apply `create_new.sql` to a fresh, empty PostgreSQL database; confirm it completes without error and `ltree` is present. — clean build on localhost PG16 (PostGIS pre-installed), exit 0, `ltree` present.
- [x] 8.2 Confirm structure: the three opinion tables, `taxa`, `taxon_annotations`, `homonyms` exist; no `rank_opinions`/`rename_opinions`/`type_opinions`/`trait_opinions`; `taxa` has no authorizer/enterer/`winning_rank_opinion_id`/`has_homonym`. — verified via information_schema.
- [x] 8.3 Confirm versioning regimes: triggers on `taxa` + `taxon_annotations`; none on the opinion tables; the hand-created opinion `permid` head indexes exist. — verified.
- [x] 8.4 Exercise the D9 CHECKs: a malformed `name_opinions` shape (root-with-target, concept-with-identity), a mismatched `(reason_id, edge_class)` pair, and a `validity_opinions` targeted/target mismatch are each rejected. — all rejected (shape 23514, composite-FK 23503); valid root accepted; self-edge also rejected.
- [x] 8.5 Confirm dictionaries: `taxonomy_ranks` has `order` + heights (NULL for unranked); `namechange_reasons` has exactly the eight tokens with `code`/`nomen oblitum` absent and `misspelling.never_accepted = true`; `nomenclatural_statuses` seeded with correct `targeted` flags. — verified.
- [x] 8.6 Confirm a non-v7 uuid is rejected on a permid column, and grep confirms no residual `taxon_id`/`parent_taxon_id → taxa("id")` FKs. — non-v7 rejected (23514); grep clean.
- [x] 8.7 Run `openspec validate taxa-opinions-schema` and reconcile any drift between the folded schema and the spec scenarios. — `Change 'taxa-opinions-schema' is valid`.
