## 1. Dictionary change

- [x] 1.1 In `postgresql/create_new.sql`'s `dictionaries.nomenclatural_statuses`, replace `bars_candidacy`
      with `invalidates boolean NOT NULL DEFAULT false`.
- [x] 1.2 Update the seed `INSERT`: `invalidates = true` for `nomen dubium`, `nomen nudum`, and
      `nomen vanum`; `false` for `nomen oblitum`.
- [x] 1.3 Rewrite the inline comment above the table to state the new rule plainly — no "supersedes an
      earlier decision" framing. Explain why all three (dubium/nudum/vanum) get identical treatment (ICZN
      doesn't distinguish dubium/vanum; Classic's nudum tagging isn't trustworthy as a strict Code ruling)
      and reference the veto mechanism in `derive_taxa()`, not a pre-filter.
- [x] 1.4 Against `pg_play`: added `invalidates` (true for dubium/nudum/vanum) alongside the existing
      `bars_candidacy` column, rather than dropping it yet — the currently-deployed `derive_taxa()` still
      references `bars_candidacy` and must keep working unmodified until section 2 replaces its logic.
      `bars_candidacy` will be dropped once nothing references it.

## 2. Build the validity veto directly against the real `derive_taxa()`

**Deviation from the original plan, confirmed with the user:** `migration_exploration/testing/
derive-taxa-analyzed.sql` turned out to be a stale, pre-cycle-breaking snapshot (no loop/DECLARE
machinery at all, still uses the retired `'lineage'` edge_class name) — not representative enough to
prototype against. Built directly against `postgresql/create_new.sql`'s real `derive_taxa()` and tested
via `pg_play` redeploys (trivially revertible, demonstrated repeatedly this session) instead.

- [x] 2.1 Added `_dtu_concept_target_best`: for each `lin_rep`, the best-rated (`evidence DESC, yr DESC,
      id DESC`) current, non-negating `concept`-class opinion whose target resolves to it — computed once,
      right after the lineage union-find.
- [x] 2.2 **Design correction made live during implementation, not the loop originally planned**: a first
      attempt used a provisional-winner/evict/rerun loop (mirroring the classification cycle-breaking
      loop), but that only ever inspects whoever is CURRENTLY winning — confirmed live it misses exactly
      the Triceratops/Agathaumas shape (a non-invalidated candidate wins only because its competitor's
      disqualifying edge targets an invalidated lineage that a reactive check never examines). Replaced
      with a **static, one-pass** determination (`_dtu_permid_invalidated`, `_dtu_lin_all_invalidated`):
      whether a permid's winning validity opinion outranks the best of its own canonical edge and
      `_dtu_concept_target_best` never depends on any ranking contest's outcome, so no loop is needed —
      `eligible` in `_dtu_linmeta` excludes invalidated permids directly, with the all-invalidated escape
      hatch as a simple aggregate.
- [x] 2.3 In `_dtu_con_winner`/`_dtu_conmeta`: same static correction (`_dtu_lin_invalidated`,
      `_dtu_con_all_invalidated`). **Second correction found during verification**: leaving criteria (a)-(d)
      completely unmodified (as originally planned) does NOT fix Triceratops even after excluding
      Agathaumas/Monoclonius — the survivors (Triceratops/Avaceratops/Brachyceratops) tie on sink
      preference and fall to the same recency-biased `acc_ev/acc_yr/acc_id` mechanical tiebreak that
      caused the original bug one level up. Added `_dtu_con_has_invalidated` (concepts where SOME but not
      all members are invalidated — the only concepts whose candidate pool is actually narrowed) and
      promote `original_yr` (priority) ahead of the mechanical tiebreak **only** for those concepts,
      leaving concepts with no invalidated member (Cathartidae/Vulturidae, Dipterus, Anthocyrtis) on the
      exact original ordering. Criterion (a)'s `con_sources` skips edges targeting invalidated lineages.
- [x] 2.4 Applied the identical fix to `derive_linnaean()` (feeding `taxa_linnaean`) as well as
      `derive_taxa()` — confirmed live it reads `bars_candidacy` directly and has the same bug shape;
      out of scope in the original artifacts, added after confirming with the user. `bars_candidacy` was
      renamed to `invalidates` (single column, replacing an earlier two-column design attempt) with inline
      comments describing the static veto and why, following the function's existing per-section comment
      convention.
- [x] 2.5 Redeployed both modified functions into `pg_play`.

## 3. Verify on real data

- [x] 3.1 Confirmed Triceratops horridus resolves to itself — Agathaumas, Avaceratops, Brachyceratops, and
      Monoclonius all correctly defer to it now.
- [x] 3.2 Confirmed Majungasaurus, Coelophysis, Fabrosaurus australis, Eucnemesaurus fortis, and
      Ornithomimus affinis all now win over their invalidated status.
- [x] 3.3 Confirmed Cathartidae/Vulturidae, Anthocyrtis/Anthocyrtella, and Dipterus are unaffected —
      identical picks to before this change.
- [x] 3.4 Self-consistency check: independently reconstructed the ranking from the persisted
      `_dtu_lin_invalidated`/`_dtu_con_all_invalidated`/`_dtu_con_has_invalidated` tables and confirmed
      100% agreement with the deployed `_dtu_conmeta` — 0 mismatches across 474,598 concepts. Additionally
      ran a refined evidenced-conflict check (every one-directional diff between the old and new picks)
      across the whole dataset: 46 diffs found, and every single one has `old_pick_was_invalidated = true`
      — i.e. every diff is a legitimate correction (the old pick lost because it was itself nomen
      dubium/nudum/vanum), zero cases of a real evidenced determination being overridden.
- [x] 3.5 Blast radius: 8,116 permids/lineages invalidated; 6,974 concepts hit the all-invalidated escape
      hatch (no effective change); 719 concepts had their candidate pool genuinely narrowed (priority
      promoted for these only); 515,489 total taxa.
- [x] 3.6 Timed `derive_taxa(NULL)`: 115.8s, up from the ~26s baseline (~4.5x slower) — a bigger jump than
      either prior fix to this function. Confirmed with the user this is acceptable (batch/rebuild
      operation, not request-path latency) rather than blocking on optimization now.

## 4. Rebuild and re-verify

- [x] 4.1 Ran `SELECT * FROM rebuild_taxa_full();` against `pg_play` — **59m4s**, up from the ~14min
      baseline (a bigger jump than the ~4.5x seen on `derive_taxa()` alone, implying `derive_linnaean()`
      took a disproportionate hit too). Confirmed with the user this is acceptable to accept and move on
      rather than block on profiling now. `taxa_linnaean_changed: 467856, taxa_clades_changed: 1108,
      taxa_attachments_changed: 5474, taxa_changed: 497066` (large changed-counts are expected: the
      previous `pg_play` state was built under this session's earlier, broken loop-based attempt).
- [x] 4.2 Re-ran the named spot checks against the real, persisted `taxa` AND `taxa_linnaean` tables
      directly (not just the temp tables from a single `derive_taxa(NULL)` call) — identical, correct
      results in both: Triceratops resolves to itself, all 5 stale-nomen-dubium cases fixed,
      Cathartidae/Vulturidae unaffected.
- [x] 4.3 Spot-checked 5 new, previously-unchecked taxa against `pg_classic`'s own `taxon_trees`
      (Iguanodon, Diplodocus, Stegosaurus, Allosaurus, Brontosaurus). Iguanodon and Stegosaurus matched.
      **Found 3 new mismatches — Allosaurus→"Antrodemus", Diplodocus→"Atlantaurus",
      Brontosaurus→"Atlantaurus"** — but confirmed none of the 6 names involved (Allosaurus, Antrodemus,
      Diplodocus, Atlantaurus, Brontosaurus, Apatosaurus) carry any nomenclatural status at all, and
      Allosaurus/Antrodemus's own concept-class opinions show a genuine mutual, fully-`evidence=false`
      dispute (13 opinions one direction, 8 the other, spanning 1920-2004) — structurally identical to the
      Anthocyrtis/Anthocyrtella case already confirmed out of scope. **This is a pre-existing,
      out-of-scope issue** (the same "mechanical acc_ev/acc_yr/acc_id tiebreak is an unreliable
      senior-signal for genuine multi-way ties" weakness that also, coincidentally, correctly resolves
      Cathartidae) — not a regression from this change, since `_dtu_con_has_invalidated` structurally
      cannot engage for a concept with zero invalidated members. Flagged to the user as a candidate for a
      separate future investigation; not fixed here.
- [x] 4.4 Dropped `bars_candidacy` from `pg_play`'s `dictionaries.nomenclatural_statuses`;
      `postgresql/create_new.sql` never had it alongside `invalidates` (replaced in place in section 1) —
      confirmed zero remaining references in the file.

## 5. Close out

- [x] 5.1 Updated the `Triceratops concept-tiebreak bug` memory: fix implemented, verified, and live in
      `create_new.sql`/`pg_play`; recorded final blast-radius numbers and measured performance cost.
- [x] 5.2 Updated `MEMORY.md`'s index line for that memory to reflect the resolved status.
- [x] 5.3 Noted the deferred veto-exclusion-logging question, and the newly-discovered pre-existing
      Allosaurus/Antrodemus/Diplodocus/Atlantaurus/Brontosaurus mechanical-tiebreak weakness, in
      `design.md`'s Open Questions as candidate follow-ups — neither blocks archive.
- [x] 5.4 Archived this OpenSpec change — maintainer confirmed the implementation matches these artifacts.
