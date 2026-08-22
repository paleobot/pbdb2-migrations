## 1. Prototype the fix against `derive_taxa_analyzed()`

- [x] 1.1 In `migration_exploration/testing/derive-taxa-analyzed.sql`, added the validated filter (from
      `test-unranked-exclusion.js`) to `_dt_con_winner`'s `cand` CTE: joined `_dt_linmeta` for both the
      subject's and target's lineage, excluding the edge if either's `accepted_rank_id` is `24`
      (`unranked clade`) or `25` (`unranked`).
- [x] 1.2 Added the analogous filter to `_dt_assign`'s `cand` CTE: excludes a candidate if the subject's
      lineage (`lm.accepted_rank_id`, already joined) or the containing permid's lineage (via a new
      `LEFT JOIN _dt_linmeta ccm ON ccm.lin_rep = ccl.lin_rep`) has `accepted_rank_id` `24` or `25`.
- [x] 1.3 Redeployed `derive_taxa_analyzed()` into `pg_play`.

## 2. Verify the fix on real data

- [x] 2.1 Re-ran `enumerate-containment-cycles.js` (updated its inline `_dt_con_winner`/`_dt_assign` copies
      with the same fix) — confirmed exactly 2 cycles remain (`Elasmotheriini`/`Elasmotheriina`,
      `Hyriidae`/`Hyriinae`), matching the memory's prediction exactly. No regression, no over-broad filter.
- [x] 2.2 Quantified the blast radius (`quantify-unranked-blast-radius.js`, new): of 357,439 total
      concepts, **912 (0.26%)** that were NOT downstream of any of the 18 original cycles flip from a
      real `containing_concept_permid` to `NULL`. Breakdown by old container confirms this is exactly the
      intended effect, not a stray side effect: dominated by `Ichnofossils` (298, trace fossils — not
      organisms), `Acritarcha` (150, a classic wastebasket microfossil taxon), domain-level clades
      (`Life`/`Eucarya`/`Bacteria`/`Prokarya`), and modern cladistic-only supergroup names
      (`Monocots`/`Eudicots`/`Campanulids`/`Excavata`/`Amoebozoa`/`Archaeplastida`/`Opisthokonta`). A
      smaller tail (e.g. `Alismatales`/`Arecaceae`, count ~9-11 each) is the *subject*-side exclusion — an
      unranked concept losing an otherwise-perfectly-fine Linnaean container, exactly as designed.
- [x] 2.3 Attempted `derive_taxa_analyzed(NULL)` directly — raises `classification containment cycle
      detected`, consistent with 2.1's finding that exactly 2 cycles remain (the guard has no reason to
      stay silent about a real cycle). Confirms parity between the peeling-based diagnostic and the
      actual cycle guard.
- [x] 2.4 **Blocked, not skipped** — 2.3 raised, so a full `derive_taxa_analyzed(NULL)` benchmark isn't
      obtainable yet (same situation `fix-dt-assign-containment-cycle`'s tasks 2.5/2.6 documented for
      the prior fix). This change's own scope (16/18 cycles, validated and quantified in 2.1-2.2) doesn't
      depend on it. Once the 2 remaining cycles (`Elasmotheriini`/`-ina`, `Hyriidae`/`-inae`) are resolved
      by a follow-up, re-attempt a full `derive_taxa_analyzed(NULL)`/`benchmark-derive-taxa.js`-style
      timing run then — not before.

## 3. Port the fix to the real function

- [x] 3.1 Applied the identical `_dt_con_winner`/`_dt_assign` changes to `postgresql/create_new.sql`.
- [x] 3.2 Added inline comments at `_dt_con_winner` and `_dt_assign` describing the exclusion and why,
      following the established per-CTE comment convention (done together with 3.1).
- [x] 3.3 Redeployed the real `derive_taxa()` into `pg_play`.
- [x] 3.4 Called the real `derive_taxa(NULL)` directly — raises the identical
      `classification containment cycle detected` message, confirming parity with
      `derive_taxa_analyzed(NULL)` (2.3) and the exactly-2-cycles finding (2.1). As with
      `fix-dt-assign-containment-cycle`'s task 3.4, a failed call rolls back its temp tables, so the
      detailed parity evidence (exact cycle count, blast-radius numbers) rests on the standalone scripts
      (`enumerate-containment-cycles.js`, `quantify-unranked-blast-radius.js`), which use SQL now
      byte-identical to `create_new.sql`'s `_dt_con_winner`/`_dt_assign`.

## 4. Close out (unranked-rank fix only — superseded as the final step; see section 8)

- [x] 4.1 Updated the `eukarya-eumetazoa-containment-cycle` memory: fix implemented, verified, and now
      live in `create_new.sql`/`pg_play` (not just the analyzed test copy); 16/18 cycles resolved, blast
      radius quantified and validated as expected, not a red flag.
- [x] 4.2 Confirmed the 2 remaining cycles (`Elasmotheriini`/`-ina`, `Hyriidae`/`-inae`) are explicitly
      tracked as a separate follow-up within the same memory file.
- [x] 4.3 **Superseded** — rather than archiving with 2 cycles still open, the root cause was found and a
      fix validated (sections 5-7 below); archiving is now the final task, 8.2.

## 5. Prototype the rank-cardinality fix against `derive_taxa_analyzed()`

- [x] 5.1 Root-caused both remaining cycles: `Hyriidae`/`Hyriinae` is a rerank-lineage interaction (a
      tribe/family dual-rank lineage's containment and synonymy pull in different directions);
      `Elasmotheriini`/`Elasmotheriina` is a direct, un-negated, reciprocal containment contradiction
      between two `evidence=true` opinions from different eras. Neither involves unranked ranks.
- [x] 5.2 Evaluated 4 candidate fixes empirically (spelling-rank consistency, MST weakest-link, rank
      cardinality strict, rank cardinality non-strict) — see design.md's comparison table. Adopted:
      rank cardinality, non-strict (exclude an `_dt_assign` candidate when the containing lineage's
      accepted rank is finer than the subject's; equal rank is permitted).
- [x] 5.3 Validated in `migration_exploration/testing/test-rank-cardinality.js` against a hand-rolled
      copy of the pipeline — confirmed 0 cycles remain, with `Hyriidae`/`Hyriinae` and
      `Elasmotheriini`/`Elasmotheriina` both resolving to correct, sensible alternate containers
      (`Hyrioidea`, `Rhinocerotinae`) rather than just going rootless.
- [x] 5.4 Added the validated filter to `migration_exploration/testing/derive-taxa-analyzed.sql`'s
      `_dt_assign` `cand` CTE: excludes a candidate unless `ccm.accepted_rank_id IS NULL OR
      ccm.accepted_rank_id >= lm.accepted_rank_id` (containing lineage at least as coarse as the
      subject lineage), layered on top of the already-present unranked-rank and self-reference
      exclusions.
- [x] 5.5 Redeployed `derive_taxa_analyzed()` into `pg_play`.

## 6. Verify the rank-cardinality fix on real data

- [x] 6.1 Re-ran `enumerate-containment-cycles.js` (updated its inline `_dt_assign` copy with the same
      rank-cardinality filter) — confirmed **zero** cycles remain. All 18 originally-found cycles are
      now resolved.
- [x] 6.2 Re-confirmed the blast radius (`quantify-rank-cardinality-blast-radius.js`): **220 of 357,439
      (0.06%)**, identical to the earlier number. Additionally cross-checked against the actual deployed
      `derive_taxa_analyzed()` (not just the hand-rolled script copy) — a direct sample lookup
      (`Raymondites`→`Bathyuridae`, `Gibbonucula`→`Nuculida`, `Stenoglossa`/`Praecardiida`/`Diodontoidea`→
      `NULL`) matches the script's predictions exactly.
- [x] 6.3 Attempted `derive_taxa_analyzed(NULL)` directly (done as part of 6.2's cross-check) — **succeeded
      for the first time**: 515,543 rows, no containment-cycle error, ~31.7s. This is the first full
      derive-all to complete against `pg_play`'s real, full-migration data in this entire investigation.
- [x] 6.4 Ran the `benchmark-derive-taxa.js`-style timing check deferred by task 2.4, 3 runs against
      `derive_taxa_analyzed(NULL)`: min 25.8s / max 26.2s / avg 26.0s (515,543 rows). **This is a real
      regression from the ~17s baseline** (`derive-taxa-performance-fix` memory), not "roughly the
      same" — ~53% slower, most likely from the two new `_dt_linmeta` joins added to `_dt_con_winner`
      (checked on every concept-class candidate edge). Not investigated further here: 26s absolute is
      still trivial next to the original 30+ minute bug, and `derive_taxa()`/`rebuild_taxa()` are used
      for batch rebuilds, not per-request latency, so this is likely acceptable — but it's a genuine,
      measured cost of these two fixes, not a non-issue, and worth the maintainer's awareness before
      considering this done.

## 7. Port the rank-cardinality fix to the real function

- [x] 7.1 Applied the identical `_dt_assign` change to `postgresql/create_new.sql`.
- [x] 7.2 Added an inline comment at `_dt_assign` describing the rank-cardinality exclusion and why
      (done together with 7.1, alongside the existing unranked-rank comment there).
- [x] 7.3 Redeployed the real `derive_taxa()` into `pg_play`.
- [x] 7.4 Called the real `derive_taxa(NULL)` directly — **succeeded**: 515,543 rows in ~25.9s, matching
      `derive_taxa_analyzed(NULL)`'s timing closely (6.3/6.4's ~26.0s avg). Confirms parity.
- [x] 7.5 Ran `rebuild_taxa()` cold and warm against `pg_play` (`taxa` was empty going in) — **first time
      ever succeeding against real, full-migration data**. Cold: 515,543 rows written in 82.5s. Warm
      (immediately after): 0 rows written in 28.6s — correctly finds no diff against the just-populated
      ledger, confirming the derive → diff → append pipeline works end-to-end, not just `derive_taxa()`
      in isolation.

## 8. Final close out

- [x] 8.1 Updated the `eukarya-eumetazoa-containment-cycle` memory (rewritten, not just appended, to
      correct a now-superseded speculative claim): both fixes implemented, verified, and live in
      `create_new.sql`/`pg_play`; 18/18 cycles resolved; full `derive_taxa(NULL)` and `rebuild_taxa()`
      both succeed against real data for the first time; measured performance cost disclosed. `MEMORY.md`
      index updated to match.
- [ ] 8.2 Archive this OpenSpec change once the maintainer confirms the implementation matches these
      artifacts — no longer blocked on an open follow-up, since both fixes are now in scope and (once
      sections 5-7 complete) verified.
