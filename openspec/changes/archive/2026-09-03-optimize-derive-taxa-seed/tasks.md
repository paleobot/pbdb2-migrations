## 1. Fixtures and verification tooling

- [x] 1.1 Against `pg_play`, identify and record a battery of test seed permids: one with a fully
      cycle-free ancestry, one inside each distinct cycle-cluster shape found in the live 53-cut dump
      (2-, 3-, 4-, 5-, 6-, and 8-node clusters), and the previously rollback-tested *Rhombotrypella
      dvinensis* reassignment scenario from the seed-parameter benchmark session.
- [x] 1.2 Write a small reusable diff helper (SQL or JS script) that runs `derive_taxa(seed)` and
      `derive_taxa(NULL)` filtered to the same permids and reports any row-level divergence — reused for
      every correctness check below, not rewritten per function.

## 2. `derive_taxa()` seed-scoped rewrite

- [x] 2.1 For `seed IS NOT NULL` only, implement the per-seed upward walk: resolve each seed permid's own
      con_rep, then walk `containing_concept_permid` one step at a time via the existing single-con_rep
      candidate query (the current incremental "ELSE" branch), maintaining a per-walk visited map. Leave
      the pre-loop table builds (`_dtu_identity` through `_dtu_conmeta`) and the entire `seed IS NULL`
      path untouched.
- [x] 2.2 Implement local cycle handling: on revisiting an already-visited con_rep, compute the weakest
      edge among exactly the visited cycle members (same tiebreak order as the existing global walk),
      insert it into `_dtu_excluded_opinions`, re-resolve the affected con_rep, and restart the walk from
      the seed's own con_rep. Add an iteration guard (same style as the existing 1000-iteration guard).
- [x] 2.3 Assemble `classification_path` directly from the walked (now-acyclic) chain, reversed, for
      `seed IS NOT NULL` — no recursive CTE over the full tree in this path.
- [x] 2.4 Share a resolved-con_rep cache across all permids in one `seed` array so overlapping ancestries
      aren't re-walked redundantly.
- [x] 2.5 Run the diff helper (1.2) against every permid in the battery (1.1), including multi-element
      `seed` arrays mixing unrelated and common-ancestor permids. Fix any divergence before proceeding.
- [x] 2.6 Benchmark `derive_taxa(seed)` before/after for a single-permid seed and confirm it lands in the
      low tens of seconds, not minutes.

## 3. `derive_linnaean()` seed-scoped rewrite

- [x] 3.1 Profile `derive_linnaean(seed)` live against `pg_play` using the same instrumented-`DO`-block
      timing technique used for `derive_taxa()`, to confirm (or refute) the same cycle-loop-dominates
      split before writing any code.
- [x] 3.2 Port the walk-based redesign (2.1-2.4) to `derive_linnaean()`, adapted for its own table names
      and rank-based exclusions.
- [x] 3.3 Run the diff helper against a `derive_linnaean(NULL)`-equivalent battery and benchmark
      before/after, same bar as 2.5/2.6.

## 4. `derive_taxa_clades()` seed-scoped rewrite

- [x] 4.1 Profile `derive_taxa_clades(permids)` live against `pg_play`. Given its much smaller graph
      (~2,525 clade-rank taxa), use the measured numbers to decide whether scoping it is worth the added
      complexity, or whether its existing cost is already acceptable.

      **Decision: not worth porting.** Live profile (instrumented `DO` block, same technique as
      `derive_taxa()`/`derive_linnaean()`): total **~7.56s**, cycle loop again dominant (~85%, `iter=18` —
      up from the ~3 cuts recorded when this function was first built, same "more real cycles after the
      lineage-merge fix" story seen for the other two functions) but the *absolute* cost is already well
      inside the "low tens of seconds" bar this whole change targets, regardless of which permid is
      seeded (the loop is exactly as seed-independent here as in `derive_taxa()`, confirmed by inspection
      of `_dtc_cycle_members`'s unscoped `_dtc_peel`/`_dtc_node` reads). A third bespoke walk
      implementation would add real maintenance surface (this function's shape already differs from the
      other two in ways that don't carry over cleanly — no `classification_path` output at all, and it
      reads from the persisted `taxa_linnaean` ledger via `_dtc_permid_lineage`/`_dtc_lineage` rather than
      raw `name_opinions` — see design.md's own Decision 2 note that this needed independent profiling,
      not an assumed port) for a gain that isn't needed to hit this change's stated goal.
- [x] 4.2 Not applicable — no code change, per the 4.1 decision.
- [x] 4.3 Not applicable — no code change, per the 4.1 decision.

## 5. Final validation and cleanup

- [x] 5.1 Re-run `assert_taxa_invariant()`, `assert_linnaean_invariant()`, and (if changed)
      `assert_taxa_clades_invariant()` against `pg_play` to confirm the `rebuild_*()`/`seed IS NULL` paths
      are still byte-identical and untouched by this change.

      All three pass clean against `pg_play`: `assert_linnaean_invariant()` (38.2s), `assert_taxa_clades_invariant()`
      (11.3s, run even though unchanged, for completeness), `assert_taxa_invariant()` (5m48.6s, matching the
      unchanged `derive_taxa(NULL)` baseline cost — expected, that path was never touched).
- [x] 5.2 Drop any scratch tables and remove any temporary scripts created for live profiling/verification
      during this change.

      Confirmed clean: no stray `_`-prefixed tables left in `pg_play` (`information_schema.tables` query),
      no leftover files in the scratchpad or repo root.
- [x] 5.3 Update the affected functions' own header/inline comments in `postgresql/create_new.sql` to
      describe the seed-scoped walk algorithm, matching this codebase's existing convention of recording
      the rationale inline (see `derive_taxa()`'s current cycle-breaking-loop comment block for the style).

      Added a header paragraph to each of the three functions: `derive_taxa()` and `derive_linnaean()`
      describe the walk algorithm and correctness argument (the latter pointing back to the former rather
      than repeating it); `derive_taxa_clades()` records the 4.1 decision not to port it, so a future
      reader doesn't wonder why it's inconsistent with the other two. Re-verified all three functions still
      compile after the comment edits.
