## 1. Payload construction

- [x] 1.1 In `migrate-authorities.js`, add a `scenario === '4'` branch to `buildAuthorityPayload` that emits the sentinel payload: `citation: 'authority unknown'`, `year: '0'` (string), `descriptors: []`, `publishedInReference: false`, `legacyIDs.oldpbdbIDs: [String(taxon_no)]`
- [x] 1.2 Confirm the existing `publishedInReference: scenario === '1' || scenario === '2'` expression already yields `false` for scenario ④ (no change needed, or make it explicit)

## 2. Pipeline routing

- [x] 2.1 Remove the early `if (scenario === '4') { scenario4Skipped++; logScenario4(...); continue; }` guard in `main()` so scenario ④ flows into the ref-lookup / person-resolution / dedup / validation path
- [x] 2.2 Verify scenario ④ rows are counted into the survivor/merge branches (add a `scenario4` bump alongside the existing `scenario1/2/3` increments in both the new-survivor and merge cases)

## 3. Counters and sanity assertion

- [x] 3.1 Repurpose `scenario4Skipped` → a migrated `scenario4` counter; update the summary log lines (`Scenario ④ ...`) to report it as migrated, not skipped
- [x] 3.2 Rework the end-of-run assertion to `survivors.size + mergesAbsorbed + orphanRefSkipped == sourceRows` (drop the `scenario4Skipped` term); keep the loud mismatch warning
- [x] 3.3 Update the final-counts log so scenario ④ appears as a migrated count and orphan-ref remains reported

## 4. Verification

- [x] 4.1 Dry-run `buildAuthorityPayload` for a scenario ④ input; assert the sentinel shape and that it passes ajv validation against `authority.schema.js` (year is the string `'0'`)
- [x] 4.2 Run the full migration against a non-production target; confirm counters: ~16,606 scenario ④ processed, ~1,299 new survivors, ~15,307 merges, orphan-ref = 0, final table count ~163,067, sanity assertion passes
- [x] 4.3 Spot-check 5–10 scenario ④ survivor rows in PG: `citation='authority unknown'`, `year='0'`, `descriptors=[]`, `publishedInReference=false`, multi-entry `oldpbdbIDs`, non-null `reference_id`
- [x] 4.4 Confirm no scenario ④ survivor collides with a scenario ①/②/③ survivor (all ④ citations are the sentinel string)

## 5. Spec sync

- [x] 5.1 After implementation is verified, sync the delta spec into `openspec/specs/authorities-migration/spec.md` and archive the change
