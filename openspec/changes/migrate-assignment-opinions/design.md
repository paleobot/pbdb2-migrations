## Context

`assignment_opinions` (schema from `taxa-opinions`) is empty. Classification in classic PBDB lives in `opinions` rows with `status = 'belongs to'`, which overload one statement with two facts: a containment edge (child belongs to parent) and a spelling act (`spelling_reason`). The new model splits these — containment goes to `assignment_opinions`, spelling/lineage goes to `name_opinions`. This change migrates only the subset where no spelling act occurred (`spelling_reason = 'original spelling'`), so each source row maps cleanly to one containment edge.

Prerequisites are in place: the persons, refs, authorities, and `name-opinions` migrations are applied. `name_opinions` holds one root/original row per legacy authority, keyed by `oldpbdb_taxon_no`, which is how this slice resolves the permids of the child and parent spellings.

Source column mapping and every skip decision are recorded in `payloadSchemas/mappings/authorities-opinions.md` ("Classic opinions to assignment_opinions migration"). The counts below were measured against the live source and the migrated target on 2026-08-14.

## Goals / Non-Goals

**Goals:**
- Load the 743,712-row `belongs to` + `original spelling` subset into `assignment_opinions` as containment edges (743,381 inserted).
- Handle the 331 unmigratable rows by an explicit, counted skip-and-log with a reconciliation invariant.
- Reuse the established migration patterns (`migrate-name-opinions.js`): in-memory resolution Maps, pinned person ids with 0-sentinel fallback, pre-insert attribution validation, single transaction, count reconciliation.

**Non-Goals:**
- Non-original-spelling `belongs to` opinions (recombination/rank change/correction/misspelling/reassignment — 183,800 rows). Their placements AND their `name_opinions` edges are deferred to later slices.
- The other `opinions` families (synonymy/spelling → `name_opinions`; nomen/invalid-subgroup → `validity_opinions`).
- Any `derive_taxa()` / `rebuild_taxa()` run. This change only loads Layer 1 assertions.
- Placing the 322 zero-parent genera — they assert no container and are intentionally left unparented by this slice.

## Decisions

### D1. Scope filter is `status = 'belongs to' AND spelling_reason = 'original spelling'`
The literal is `'original spelling'` (space), confirmed against the source (`spelling_reason` values: original spelling 743,712; recombination 146,103; rank change 20,743; correction 9,659; misspelling 6,983; reassignment 312). Taking only original-spelling rows means `child_spelling_no = child_no`, so each row is a pure containment edge with no rename to model. *Alternative considered:* migrate all `belongs to` rows now and split the spelling act out — rejected as it couples this slice to the not-yet-designed `name_opinions` lineage/concept migration.

### D2. Resolve subject/containing permids via `name_opinions.oldpbdb_taxon_no`, taking `permid`
Build one Map: `oldpbdb_taxon_no → permid` over current heads. `child_spelling_no → subject_permid`, `parent_spelling_no → containing_permid`. Taking `permid` is safe because `oldpbdb_taxon_no` is carried only by root/original rows, where `permid ≡ subject_permid` by the minting shape (0 divergent head rows measured). *Alternative considered:* take `subject_permid` instead — equivalent today; `permid` is the structurally-minted identity and no less safe. **Assumption to preserve:** `oldpbdb_taxon_no` must stay original-only (no unique index enforces it); if a future slice stamps it on a lineage row, this lookup must switch to filtering `edge_class = 'root'`.

### D3. `publication_year` and `attribution` are second-hand fields gated on `ref_has_opinion`
Same switch drives both. First-hand (`ref_has_opinion = 'YES'`, 634,889 rows): `publication_year = NULL`, `attribution` omitted — `derive_taxa()` recovers the year via `COALESCE(publication_year, ref.publicationYear)`. Second-hand (`ref_has_opinion IS NULL`, 108,823 rows): `publication_year = pubyr`, `attribution` built from author fields. *Alternative considered:* blind-copy `pubyr` into `publication_year` — rejected: it stores the reference's own year twice (the exact thing `opinionAttribution.schema.js` and authorities D5 avoid) and would make the two provenance fields inconsistent. Verified safe: 0 in-scope rows have a `pubyr` with no resolvable reference year, so NULLing never sinks a row to `NULLS LAST` in the derive ranking.

### D4. Skip-and-log with a hard reconciliation invariant
`subject_permid`, `containing_permid`, `reference_id` are `NOT NULL` and `assignment_not_self` forbids self-edges. Rather than let an insert abort mid-stream, pre-check each row and skip into five disjoint buckets (322 parent_spelling_zero, 6 parent_spelling_orphan, 1 orphan_reference, 1 child_spelling_unresolved, 1 self_reference = 331). Assert `inserted + skipped == in-scope` (743,381 + 331 == 743,712) and abort before commit if it fails. Mirrors `migrate-name-opinions.js`. The full 331 rows are enumerated in `failing-assignment-opinions.csv`.

### D5. Persons via pinned id + 0-sentinel fallback
`persons.id = person_no`, so `authorizer_no`/`enterer_no` are used directly, with the `migrate-name-opinions.js` fallback (0 → other; both 0 → 1). Measured: in scope every `authorizer_no`/`enterer_no` is non-zero and present in `persons`, so the fallback never fires — but it is carried for safety and consistency.

### D6. One fresh `permid` per source row; no dedup
Each in-scope opinion is a distinct published statement (often multiple placements per taxon across references), not a transcription-correction version of another, so each gets its own uuidv7. No dedup pass — unlike `migrate-authorities.js`, there is no name-level collapsing here.

## Risks / Trade-offs

- **Future slice breaks the original-only permid lookup (D2).** → The assumption is documented in the mapping and in D2; the fix (filter `edge_class = 'root'`) is one predicate. Consider adding a unique index on `name_opinions(oldpbdb_taxon_no) WHERE succeeded_by_id IS NULL` if it is ever meant to be a hard invariant.
- **322 genera left unparented.** → Expected, not data loss: these `belongs to` rows state no container. Many will be placed by their deferred recombination opinion; the mapping records this so "743,712 in, 743,381 out" is not misread.
- **Counts drift if the source changes before the run.** → All counts are as-of 2026-08-14; the reconciliation invariant is expressed as `inserted + skipped == in-scope` (not hard-coded totals) so the run stays correct if the source shifts, and the per-bucket counts in specs/design are documented as measured values, not assertions.
- **Non-idempotent on success.** → Re-running double-inserts (fresh permids each time). Same posture as prior migrations: `TRUNCATE assignment_opinions` before an intentional re-run; abort leaves the table untouched (pre-insert validation + single transaction).

## Migration Plan

1. Confirm prerequisites: `assignment_opinions` exists with `assignment_not_self`; `name_opinions` populated; `refs`/`persons` populated.
2. Run `migrate-assignment-opinions.js`: build Maps → stream+classify in-scope rows → validate attribution in memory → single-transaction bulk insert → assert reconciliation → commit.
3. Verify: row count 743,381; skip log totals 331 across five buckets; spot-check a few edges against source `opinion_no`s.
4. Rollback: `TRUNCATE assignment_opinions` (nothing else depends on it yet).

## Open Questions

- None blocking. (Whether to promote the original-only `oldpbdb_taxon_no` property to an enforced unique index is a possible follow-up, not required for this slice.)
