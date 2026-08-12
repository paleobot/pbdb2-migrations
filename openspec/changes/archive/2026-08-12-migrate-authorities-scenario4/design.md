## Context

The authorities migration (`migrate-authorities.js`, archived change `2026-06-02-migrate-authorities`) classifies each legacy `authorities` row into one of four scenarios on `(ref_is_authority, author1last)`. Scenarios ①/②/③ are migrated; scenario ④ (`ref_is_authority != 'YES'` AND empty `author1last`, ~16,606 rows) is skipped-and-logged because it has no discernible authorship.

We now want scenario ④ retained rather than dropped, using an explicit "unknown authority" sentinel so the taxon→reference linkage and legacy `taxon_no`s survive. The migration is re-runnable (transaction-wrapped, no manual cleanup needed) and is slated to re-run combined with the taxa/opinions work, so changing it in place is safe.

Measured facts (queried 2026-08-12 against source MariaDB + current target PG):
- Scenario ④ total: **16,606** rows.
- `reference_no = 0` / NULL among them: **0**.
- Non-resolving (orphan) `reference_no` among them: **0**.
- Distinct resolving references: **1,299** → after dedup, **1,299** survivors, **15,307** merges.
- Table effect: 161,768 → **163,067** authority rows.

## Goals / Non-Goals

**Goals:**
- Migrate all resolvable scenario ④ rows with a fixed sentinel payload instead of skipping them.
- Keep scenario ④ on the exact same ref-lookup / person-resolution / dedup / validation / insert pipeline as the other scenarios (no special-case insert path).
- Keep the end-of-run counters and sanity assertion correct after ④ stops being a skip bucket.

**Non-Goals:**
- No attempt to recover or infer authorship for scenario ④ rows.
- No schema change to `authorities` or to `authority.schema.js`.
- No change to scenarios ①/②/③ behavior.
- Not reprocessing the already-migrated data destructively outside the normal re-run (a re-run replaces the full table state).

## Decisions

### D1. Sentinel values: `citation = "authority unknown"`, `year = "0"`, `descriptors = []`
The schema (`payloadSchemas/authority.schema.js`) requires `citation` + `publishedInReference` and types `year` as `string` (maxLength 4). We store `year` as the **string** `"0"`, not the number `0` — the numeric form would fail validation. `"0"` is a positive "unknown" sentinel, distinguishable from an omitted/empty year and from real citations (which always begin with an author surname).
- *Alternative considered:* omit `year` entirely. Rejected — the user wants a positive sentinel so "unknown" is explicit rather than "not filled in."

### D2. Route scenario ④ through the shared pipeline; branch only in `buildAuthorityPayload`
Remove the early `if (scenario === '4') { … continue }` guard in `main()`. Add a `scenario === '4'` branch in `buildAuthorityPayload` that emits the sentinel payload. Everything downstream — ref lookup, person fallback, dedup key, validation, batched insert — is reused unchanged.
- *Alternative considered:* a separate scenario-④ insert loop. Rejected — duplicates the pipeline and diverges dedup/validation behavior.

### D3. `publishedInReference = false` for scenario ④
Consistent with `ref_is_authority != 'YES'` (same as scenario ③). The existing `buildAuthorityPayload` already computes `publishedInReference: scenario === '1' || scenario === '2'`, which yields `false` for ④ with no change.

### D4. Dedup collapse is intended
All scenario ④ rows for one reference produce the identical key `(reference_id, "authority unknown", "0", [])`, collapsing to one survivor per reference (16,606 → 1,299). The taxon→authority mapping is preserved in `oldpbdbIDs`, exactly as for every other scenario. No collision with ①/②/③ survivors is possible because their citations always start with an author surname.

### D5. Rework counters and the sanity assertion
Rename/repurpose the `scenario4Skipped` counter to a migrated `scenario4` count (survivors + merges contribution), and update the end-of-run assertion. New accounting:

```
survivors.size + mergesAbsorbed + orphanRefSkipped == sourceRows
```

`scenario4Skipped` is dropped from the assertion term (scenario ④ now lands in survivors/merges). Keep an `orphanRefSkipped` term — it is currently 0 for ④ but remains the correct general form and guards future data drift.

## Risks / Trade-offs

- **[Future data introduces scenario ④ orphans]** → The shared pipeline already handles this: a non-resolving `reference_no` is skipped-and-logged as an orphan (kept in the assertion term). No NOT NULL violation on `reference_id` can occur because orphans never reach insert. Today the count is 0.
- **[`year: "0"` mistyped as number]** → Guarded by the mandatory pre-insert ajv validation, which aborts the whole run before any DB write if the payload is malformed.
- **[Sentinel collides with a real citation]** → Impossible in practice: real ②/③ citations begin with `author1last` (non-empty by definition of those scenarios) and ① citations begin with a ref author surname or a year; none equal `"authority unknown"`.
- **[Downstream consumers treat `"authority unknown"` / `"0"` as real data]** → Accepted; the sentinel is intentionally queryable. Documented here and in the spec.

## Migration Plan

1. Edit `migrate-authorities.js` per D2/D3/D5.
2. Dry-run the pure `buildAuthorityPayload` transform for a scenario ④ input; confirm the sentinel shape and ajv validity.
3. Re-run the full migration against the non-production target; confirm counters: scenario ④ ≈ 16,606 processed, ≈ 1,299 new survivors, ≈ 15,307 merges, orphan-ref = 0, final table ≈ 163,067, and the sanity assertion passes.
4. Spot-check a handful of scenario ④ survivors: `citation="authority unknown"`, `year="0"`, `descriptors=[]`, `publishedInReference=false`, multi-entry `oldpbdbIDs`, valid `reference_id`.

Rollback: the insert is transaction-wrapped; an aborted run leaves the table unchanged. A prior good state is restored by re-running the previous script version (the migration fully repopulates the table).

## Open Questions

None — all five design points were confirmed with the user before this change was opened.
