## 1. Prototype the fix against `derive_taxa_analyzed()`

- [x] 1.1 In `migration_exploration/testing/derive-taxa-analyzed.sql`, add the `_dt_lin`/`_dt_con`
      resolution for `containing_permid` into `_dt_assign`'s `cand` CTE (the same resolution the final
      `SELECT` already does for the winner), and exclude a candidate whose resolved containing `con_rep`
      equals its own `cm.con_rep`.
- [x] 1.2 Redeploy `derive_taxa_analyzed()` into `pg_play` (the established `node -e` pattern from the
      performance-fix work).

## 2. Verify the fix on real data

- [x] 2.1 Re-run `find-containment-cycle.js` against the analyzed copy — **partial.** Zero self-loops
      survive, but peeling converged on a **different, previously-hidden, genuine transitive cycle**
      (`Eukarya -> Proepitheliozoa -> Euradiculata -> Eukarya`, really a synonymy chain folding
      `Eumetazoa`'s concept back into an ancestor's) — see the new `eukarya-eumetazoa-containment-cycle`
      memory. Not a regression from this fix; it's a separate, real bug this fix correctly stopped
      masking. "Zero cycles" is not achieved overall, but not because of anything in scope here.
- [x] 2.2 Re-run `diagnose-containment-self-loops.js` — confirmed zero direct self-loops, down from 73.
- [x] 2.3 Re-run `diagnose-same-lineage-self-loops.js` — confirmed zero same-lineage cases found, down
      from 2.
- [x] 2.4 Spot-checked "Parafollicucullus (Yaoconus)" (`spotcheck-dt-assign-fix.js`) — now resolves to
      `containing_concept_permid = NULL` (rootless; excluded down to no candidate), not self-referential.
- [ ] 2.5 **Blocked, not skipped.** `benchmark-derive-taxa.js` calls the real (still-unfixed)
      `derive_taxa(NULL)`, and even a direct `derive_taxa_analyzed(NULL)` timing call now raises on the
      Eukarya/Eumetazoa cycle instead of completing — there's nothing to time until that separate cycle is
      resolved.
- [ ] 2.6 **Blocked, not skipped, and rescoped.** No automated fixture-comparison harness exists for the 48
      pairs (they were live-probed, not asserted against expected output — see
      `opinions-validation-status` memory), and re-running `run-full-migration.js` wouldn't test this
      change anyway (it only re-seeds Layer 1 tables, which this fix never touches). Built
      `regression-check-dt-assign-fix.js` instead: sampled 500 concept_permids from the peeling-safe
      complement (unaffected by the Eukarya cycle) and attempted `derive_taxa(seed)` vs.
      `derive_taxa_analyzed(seed)` diffing. **Also blocked** — confirmed empirically that the
      Eukarya/Eumetazoa cycle makes every `derive_taxa()`/`derive_taxa_analyzed()` call raise, scoped seed
      or not (the real implementation evidently computes the full graph internally regardless of the
      requested seed, consistent with the `derive_taxa(subset) ≡ derive_taxa(all)` spec invariant). No
      regression diff is possible against real data until that cycle is resolved.

## 3. Port the fix to the real function

- [x] 3.1 Apply the identical `_dt_assign` change to `postgresql/create_new.sql`.
- [x] 3.2 Replace the inline `KNOWN GAP` comment (lines ~5391-5404) with a comment describing the fix and
      its outcome (self-referential candidates excluded before ranking; fully-excluded concepts resolve
      to `containing_concept_permid = NULL`), following the same per-CTE comment convention used for the
      `_dt_linmeta` `MATERIALIZED` fix.
- [x] 3.3 Redeployed the real `derive_taxa()` into `pg_play`.
- [x] 3.4 Called `derive_taxa(NULL)` directly — confirmed parity: it no longer raises on the old
      self-reference bug, and now raises with the exact same message as `derive_taxa_analyzed(NULL)` did
      in section 2 (`classification containment cycle detected`, from the separate, still-unresolved
      Eukarya/Eumetazoa cycle — see `fix-eukarya-eumetazoa-containment-cycle`). A failed call rolls back
      its temp tables in the same transaction, so 2.1-2.3's self-loop counts can't be re-inspected via a
      failed real-function call directly; `_dt_assign`'s SQL in `create_new.sql` is now byte-identical to
      the standalone diagnostic scripts' already-verified copy, which is the parity evidence for those.

## 4. Close out

- [x] 4.1 Updated the `containment-cycle-open-problem` memory: fix is resolved and now live in
      `create_new.sql`/`pg_play` (not just the analyzed test copy), with the downstream Eukarya/Eumetazoa
      blocker noted separately.
- [ ] 4.2 Archive this OpenSpec change once `openspec verify` / the maintainer confirms the implementation
      matches these artifacts. **Open question for the maintainer:** this change's own scope (the
      `_dt_assign` self-reference exclusion) is fully implemented and verified — archive now on that
      basis, or hold open until `fix-eukarya-eumetazoa-containment-cycle` also lands, since this change's
      design.md Goal ("get a full derive_taxa(NULL) to complete... with zero containment-cycle errors")
      isn't achieved until then?
