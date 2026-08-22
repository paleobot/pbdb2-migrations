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

## 4. Close out

- [x] 4.1 Updated the `eukarya-eumetazoa-containment-cycle` memory: fix implemented, verified, and now
      live in `create_new.sql`/`pg_play` (not just the analyzed test copy); 16/18 cycles resolved, blast
      radius quantified and validated as expected, not a red flag.
- [x] 4.2 Confirmed the 2 remaining cycles (`Elasmotheriini`/`-ina`, `Hyriidae`/`-inae`) are explicitly
      tracked as a separate follow-up within the same memory file (a dedicated new memory entry would be
      redundant duplication given there's no additional content yet beyond "these exist, need
      root-causing, likely their own OpenSpec change") — not left implicit.
- [ ] 4.3 Archive this OpenSpec change once the maintainer confirms the implementation matches these
      artifacts — same open question as the prior change: archive on this change's own completed scope,
      or hold until the 2 remaining cycles also resolve.
