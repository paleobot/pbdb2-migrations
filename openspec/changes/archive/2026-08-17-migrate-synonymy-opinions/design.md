## Context

`name_opinions` holds the root/original naming acts (one per legacy authority, keyed by `oldpbdb_taxon_no`) from the authorities/name-opinions migration, but no `concept` edges. Synonymy in classic PBDB lives in `opinions` rows with `status = 'subjective synonym of'` or `'objective synonym of'`, which overload one statement with two facts: a synonymy edge (junior name → senior name) and a spelling act (`spelling_reason`). The new model splits these — synonymy goes to `name_opinions` as a `concept` edge, spelling/lineage as a `lineage` edge. This change migrates only the subset where no spelling act occurred (`spelling_reason = 'original spelling'`), so each source row maps cleanly to one concept edge.

Prerequisites are in place: the persons, refs, authorities, and root `name_opinions` migrations are applied. `name_opinions` holds one root/original row per legacy authority, keyed by `oldpbdb_taxon_no`, which is how this slice resolves the permids of the junior and senior spellings. The `namechange_reasons` dictionary carries `('junior synonym', 'concept')`, the composite key the `(reason_id, edge_class)` FK pins to.

Source column mapping and every skip decision are recorded in `payloadSchemas/mappings/authorities-opinions.md` ("Classic opinions synonymy opinions (original spellings) migration"). The counts below were measured against the live source and the migrated target on 2026-08-17.

## Goals / Non-Goals

**Goals:**
- Load the 48,839-row synonymy + `original spelling` subset into `name_opinions` as `concept` edges (48,822 inserted).
- Handle the 17 unmigratable rows by an explicit, counted skip-and-log with a reconciliation invariant.
- Reuse the established migration patterns (`migrate-assignment-opinions.js`): in-memory resolution Maps, pinned person ids with 0-sentinel fallback, pre-insert attribution validation, single transaction, count reconciliation.

**Non-Goals:**
- Non-original-spelling synonymy opinions. Their `name_opinions` lineage edge AND their concept edge are deferred to later slices.
- The `'replaced by'` status — also a `concept` reason in the dictionary, but a distinct slice.
- The other `opinions` families (`belongs to` → `assignment_opinions`, already migrated; nomen/invalid-subgroup → `validity_opinions`).
- Any `derive_taxa()` / `rebuild_taxa()` run. This change only loads Layer 1 assertions.

## Decisions

### D1. Scope filter is the two synonym statuses + `spelling_reason = 'original spelling'`
`(status = 'subjective synonym of' OR status = 'objective synonym of') AND spelling_reason = 'original spelling'` — 48,839 rows (47,687 subjective + 1,152 objective). Taking only original-spelling rows means `child_spelling_no = child_no`, so each row is a pure concept edge with no rename to model. *Alternative considered:* migrate all synonymy rows now and split the spelling act out — rejected as it couples this slice to the not-yet-designed `name_opinions` lineage migration.

### D2. Target is `name_opinions` as a `concept` edge, carrying no identity
A synonymy opinion is a typed edge `subject_permid` (junior, `child_spelling_no`) → `target_permid` (senior, `parent_spelling_no`) with `reason_id = 'junior synonym'`, `edge_class = 'concept'`. The `name_opinion_shape` CHECK forbids a `concept` row from carrying identity, so `new_name`, `rank_id`, and `authority_id` are NULL (the junior name's spelling/rank already live on its own root row). `oldpbdb_taxon_no` is also NULL — it must stay original-only (D3). *Alternative considered:* copy the target's `new_name`/`rank_id` onto the row — rejected: it violates `name_opinion_shape` and would stamp the *senior* name onto the *junior* opinion's row.

### D3. Resolve subject/target permids via `name_opinions.oldpbdb_taxon_no`, taking `permid`
Build one Map: `oldpbdb_taxon_no → permid` over current heads. `child_spelling_no → subject_permid`, `parent_spelling_no → target_permid`. Taking `permid` is safe because `oldpbdb_taxon_no` is carried only by root/original rows, where `permid ≡ subject_permid` by the minting shape (0 divergent head rows measured). **Assumption to preserve:** `oldpbdb_taxon_no` must stay original-only — this slice sets it NULL on every concept row it writes, preserving the invariant. If a future slice ever stamps it on a lineage row, this lookup must switch to filtering `edge_class = 'root'`.

### D4. `objective` carries the subjective/objective split (no separate reason token)
Both statuses map to the single reason `'junior synonym'`; the distinction rides the `objective` boolean: `status = 'objective synonym of' → TRUE`, `'subjective synonym of' → FALSE`. This is the schema's intent (A3: `objective` is the sole carrier of the split). *Alternative considered:* two reason tokens — rejected; the dictionary has exactly one `'junior synonym'` concept reason, and the boolean is where `derive_taxa()` reads the split.

### D5. `publication_year` and `attribution` are second-hand fields gated on `ref_has_opinion`
Same switch drives both. First-hand (`ref_has_opinion = 'YES'`): `publication_year = NULL`, `attribution` omitted — `derive_taxa()` recovers the year via `COALESCE(publication_year, ref.publicationYear)`. Second-hand (`ref_has_opinion IS NULL`): `publication_year = pubyr`, `attribution` built from author fields (1,498 in-scope second-hand rows carry a `pubyr` override; 7 have no author and take the "authority unknown" sentinel). *Alternative considered:* blind-copy `pubyr` — rejected, stores the reference's own year twice. **Re-verified for this slice (not inherited):** among all 48,822 retained rows, `COALESCE(publication_year, ref.publicationYear)` is non-NULL for every row (0 first-hand and 0 second-hand would sink to `NULLS LAST`).

### D6. Skip-and-log with a hard reconciliation invariant
`subject_permid`, `target_permid`, `reference_id` are `NOT NULL` (for a concept edge `target_permid` is forced NOT NULL by `name_opinion_shape`), and `name_opinion_not_self` forbids self-edges. Rather than let an insert abort mid-stream, pre-check each row and skip into five disjoint buckets, first-match-wins: 7 self_reference, 6 child_spelling_unresolved, 4 orphan_reference, 0 parent_spelling_zero, 0 parent_spelling_orphan = 17. Assert `inserted + skipped == in-scope` (48,822 + 17 == 48,839) and abort before commit if it fails. Mirrors `migrate-assignment-opinions.js`. The full 17 rows are enumerated in `failing-synonymy-opinions.csv`.

### D7. Persons via pinned id + 0-sentinel fallback
`persons.id = person_no`, so `authorizer_no`/`enterer_no` are used directly, with the established fallback (0 → other; both 0 → 1). In scope the fallback never fires but is carried for safety and consistency.

### D8. One fresh `permid` per source row; no dedup
Each in-scope opinion is a distinct published synonymy statement (a taxon may be synonymized under different references), not a transcription-correction version of another, so each gets its own uuidv7. No dedup pass.

### D9. Reading and writing the same table is safe
This slice reads root rows from `name_opinions` and writes concept rows to it. Resolution reads only current heads, preloaded into the Map before any insert, so the inserts (which set `oldpbdb_taxon_no = NULL` and cannot match any lookup key) never affect resolution. The single-transaction insert also means no partial state is visible to the (already-completed) read phase.

## Risks / Trade-offs

- **Future slice breaks the original-only permid lookup (D3).** → The assumption is documented in the mapping and in D3; this slice actively preserves it (NULL `oldpbdb_taxon_no` on every row). Fix if ever violated: filter `edge_class = 'root'` in the Map query.
- **The `42348`/`42322` dangling references recur across slices.** → `reference_no 42348` skips rows in both the assignment slice (opinion_no 422326) and here (4 orphan_reference + 3 child_spelling_unresolved rows cite it); `42322` accounts for 3 more. Known source defects, enumerated in `failing-synonymy-opinions.csv`, not this migration's to fix.
- **Counts drift if the source changes before the run.** → All counts are as-of 2026-08-17; the reconciliation invariant is expressed as `inserted + skipped == in-scope` (not hard-coded totals), so the run stays correct if the source shifts. Per-bucket counts in specs/design are documented measured values, not assertions.
- **Non-idempotent on success.** → Re-running double-inserts (fresh permids each time). Same posture as prior migrations: delete this slice's concept rows before an intentional re-run; abort leaves the table untouched (pre-insert validation + single transaction). Because concept rows are distinguishable (`edge_class = 'concept'` AND `reason_id = 'junior synonym'`), a targeted re-run cleanup is possible without touching the root rows.

## Migration Plan

1. Confirm prerequisites: `name_opinions` exists with `name_opinion_shape`, `name_opinion_not_self`, and the `(reason_id, edge_class)` FK; `namechange_reasons` has `('junior synonym','concept')`; root `name_opinions`, `refs`, `persons` populated.
2. Run `migrate-synonymy-opinions.js`: build Maps → stream+classify in-scope rows → validate attribution in memory → single-transaction bulk insert → assert reconciliation → commit.
3. Verify: 48,822 concept rows inserted; skip log totals 17 across the buckets; spot-check a few edges against source `opinion_no`s and confirm `objective` matches `status`.
4. Rollback: `DELETE FROM name_opinions WHERE edge_class = 'concept' AND reason_id = <junior synonym id>` (nothing derived depends on it yet).

## Open Questions

- None blocking. (Whether to promote the original-only `oldpbdb_taxon_no` property to an enforced partial unique index is a possible follow-up shared with the assignment slice, not required here.)
