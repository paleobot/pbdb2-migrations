## 0. Schema change: add `negates` (Decision 5)

- [ ] 0.1 Add `negates boolean NOT NULL DEFAULT false` to `name_opinions`.
- [ ] 0.2 Extend the `name_opinion_shape` CHECK: `edge_class = 'root'` rows must have `negates = false`.
- [ ] 0.3 Add an inline comment on the `negates` column documenting that it flips the polarity of
      whatever `reason` names (`reason = 'misspelling', negates = true` reads as "not a misspelling of
      [target]," not "misspelling") — the Risks section's mitigation for a reader assuming `reason`
      alone still means what it names.

## 1. Split identity from edge-candidates (Decision 1)

- [ ] 1.1 Replace `_dt_mint` with `_dt_identity` — one row per permid, `WHERE edge_class = 'root'` only, carrying `permid, opinion_id, new_name, rank_id, authority_id`.
- [ ] 1.2 Add `_dt_edge_cand` — one row per (permid, introducing opinion), `WHERE edge_class IN ('root','lineage')` (same filter the old `_dt_mint` used), carrying `evidence`/`yr`/`never_accepted`, and `negates` (needed by task 2.3 and reused by task 6.1).
- [ ] 1.3 Compute `_dt_permid_edge` from `_dt_edge_cand` — one row per permid, its own canonical introducing edge via `row_number() OVER (PARTITION BY permid ORDER BY evidence DESC, yr DESC NULLS LAST, opinion_id DESC) = 1`, carrying `negates` through.
- [ ] 1.4 Add the duplicate-root-mint integrity check: `RAISE EXCEPTION` identifying the permid if `_dt_identity`'s underlying root-row count for any permid is more than 1.

## 2. Permid-scoped eligibility: never_accepted + nomen-nudum + negation bar (Decision 2)

- [ ] 2.1 Move `_dt_valid`'s `CREATE TEMP TABLE` earlier in the function body, before `_dt_linmeta` (it currently runs near the end).
- [ ] 2.2 Extend `_dt_valid`'s `SELECT` to include `bars_candidacy` via a join to `dictionaries.nomenclatural_statuses` (currently selects only `status_id`).
- [ ] 2.3 Build an `eligible` CTE: `_dt_permid_edge` filtered `WHERE never_accepted = false AND negates = false`, `LEFT JOIN _dt_valid` filtered `WHERE COALESCE(bars_candidacy, false) = false`.
- [ ] 2.4 Rewire `_dt_linmeta`'s `spelling` CTE to rank `_dt_lin JOIN eligible` (by the canonical `ORDER BY`) instead of `_dt_lin JOIN _dt_mint WHERE m.never_accepted = false`.

## 3. Confirm the empty-lineage/-concept cascade needs no new code (Decision 3)

- [ ] 3.1 Audit every join reading from `_dt_linmeta` — `_dt_conmeta`'s `ranked` CTE and the final `RETURN QUERY` — and confirm each stays a plain `JOIN` (inner), never a `LEFT JOIN`, so a lineage/concept with zero eligible candidates naturally drops out rather than needing bespoke exclusion logic.
- [ ] 3.2 No new SQL expected from this section beyond what group 2 already produces — verified by the fixtures in group 8 (8.6, 8.7), not by additional code here.

## 4. Topological `original_permid` (Decision 4)

- [ ] 4.1 Replace the `roots` CTE's earliest-year-root method with a `sinks` CTE: permids in `_dt_lin` that are never the subject of a live `lineage`-class edge.
- [ ] 4.2 Add `sink_counts` and branch on it: unique sink (`n = 1`) → that permid directly; otherwise (`n = 0` or `n >= 2`) → fall back to the canonical `ORDER BY` (`evidence DESC, yr DESC NULLS LAST, opinion_id DESC`, tiebroken further as needed) over the candidate set — the tied sinks when `n >= 2`, every lineage member when `n = 0`.
- [ ] 4.3 Rewire `_dt_linmeta`'s final `SELECT` to source `original_permid` from the new `roots` CTE.

## 5. Rewire remaining `_dt_mint` references and re-verify seeding

- [ ] 5.1 Update the final `RETURN QUERY` to source `name`/`rank_id`/`authority_id` from `_dt_identity` instead of `_dt_mint`.
- [ ] 5.2 Update `winning_name_opinion_id` in the final output to come from `_dt_permid_edge` (the permid's own canonical introducing edge — `classic-taxa-opinions.md` §9.8.4.1's "canonical-winner introducing edge, or the root if the permid has no lineage edge"), not `m.opinion_id` off whichever row joined.
- [ ] 5.3 Re-verify `_dt_lin`'s seeding (`reach(src, node) AS (SELECT permid, permid FROM _dt_mint ...)`) is re-pointed at the right source (`_dt_identity`, since every valid permid has exactly one root row) and still reaches every permid that should participate in lineage grouping.
- [ ] 5.4 Sweep the full function body for any other reference to the old `_dt_mint` name; rename or remove consistently — no stale references left.

## 6. Union-find ranking feeds lineage/concept grouping, with negation (Decisions 5-7)

- [ ] 6.1 Build `_dt_lin_winner` from `_dt_edge_cand` (task 1.2) filtered `WHERE edge_class = 'lineage'`, re-ranked per permid over that narrower set: `row_number() OVER (PARTITION BY permid ORDER BY evidence DESC, yr DESC NULLS LAST, opinion_id DESC) = 1`, carrying `target_permid` and `negates`. (Not a reuse of `_dt_permid_edge` itself — that ranking pool includes `root` rows, which is correct for eligibility (group 2) but wrong here, since a `root` row has no target and can never contribute a union-find edge.)
- [ ] 6.2 Rewire `lin_undir` to source both directions of its edges from `_dt_lin_winner WHERE negates = false`, instead of unconditionally from every current `lineage`-class `name_opinions` row.
- [ ] 6.3 Build `_dt_con_winner`: pool `concept`-class `name_opinions` rows by lineage (`ls.lin_rep`, joining `_dt_lin`), rank per `lin_rep` by the canonical `ORDER BY`, carrying the target lineage (`sr`) and `negates`. This is a new computation, not sourced from `_dt_edge_cand` (which is scoped to `root`/`lineage` only).
- [ ] 6.4 Rewire `con_edge`/`con_undir` to source edges from `_dt_con_winner WHERE negates = false`, instead of unconditionally from every current `concept`-class `name_opinions` row.
- [ ] 6.5 Add an inline comment at `_dt_lin_winner`/`_dt_con_winner` documenting that a negating winner's `target_permid` is retained for provenance only and is never read by the union-find construction — the Risks section's mitigation for a reader assuming that target is computationally binding.

## 7. `con_sources` reflects active concept edges (Decision 8)

- [ ] 7.1 Redefine `con_sources` as `SELECT DISTINCT jr FROM con_edge` (task 6.4's winning-edge output), replacing the raw existence check against `name_opinions`.

## 8. Fixtures (rebuild the harness; regression + new scenarios)

- [ ] 8.1 Rebuild the fixtures harness (minimal persons/refs + opinion sets, analogous to the archived change's group 8) since `.scratch/` no longer has the original SQL on disk.
- [ ] 8.2 Regression: re-run all 23 originally-passing scenarios (spec sections: grouping, accepted spelling recency/misspelling/senior-scoping, junior-synonym borrowing, seniority tiebreak, cycles, subset equivalence, totality, path, rebuild/invariant) — confirm no behavior changed for the already-correct cases.
- [ ] 8.3 New: a permid with a root mint plus two competing `lineage`-class edges naming it as subject still gets exactly one output row (spec: "A permid with competing lineage claims still gets exactly one row").
- [ ] 8.4 New: a permid whose only introducing claim is a `never_accepted` edge is excluded from `accepted_spelling_permid` eligibility even though it also has an unexcluded `root` mint (spec: "A permid is not made eligible by an unexcluded root mint alone").
- [ ] 8.5 New: a permid barred by a winning `nomen nudum` validity opinion is excluded from its lineage's contest, and a later non-barring validity opinion on the same permid reverses the exclusion.
- [ ] 8.6 New: a concept with one fully-exhausted lineage and one eligible sibling lineage emits no rows for the exhausted lineage's permids, while the concept's other members still resolve normally.
- [ ] 8.7 New: a concept where every lineage is exhausted emits no rows for any of its permids.
- [ ] 8.8 New: a two-way tie between candidate lineage originals (two sinks) resolves `original_permid` deterministically and repeatably.
- [ ] 8.9 New: a lineage-level cycle (zero sinks) resolves `original_permid` deterministically via the fallback.
- [ ] 8.10 New: two live root rows for the same permid raise an error identifying the permid.
- [ ] 8.11 New: a subject with two competing `lineage`-class opinions, where the higher-ranked one targets a different permid, is unioned into the higher-ranked target's lineage, not the lower-ranked one's (spec: "A later, higher-ranked opinion redirects a subject's lineage").
- [ ] 8.12 New: a subject whose higher-ranked current `lineage`-class opinion is negating forms its own lineage instead of joining the target a lower-ranked opinion named (spec: "A winning negation removes a subject from its claimed lineage").
- [ ] 8.13 New: a lineage with two current `concept`-class opinions (filed under any of its member permids) targeting different lineages is unioned into the higher-ranked target's concept, not the lower-ranked one's (spec: "A later, higher-ranked opinion redirects a lineage's concept").
- [ ] 8.14 New: a lineage whose higher-ranked current `concept`-class opinion is negating forms its own concept instead of joining the target a lower-ranked opinion named (spec: "A winning negation returns a lineage to its own concept").
- [ ] 8.15 New: a permid whose own canonical introducing edge has `negates = true` is excluded from `accepted_spelling_permid` eligibility even when it has the highest evidence/year in its lineage (spec: "A negating opinion is never the accepted spelling").
- [ ] 8.16 New: a lineage whose only `concept`-class opinion is outranked or successfully negated is not deprioritized against a lineage with no `concept`-class history at all, when tied on the other tiebreak criteria (spec: "An outranked or negated concept claim does not deprioritize a lineage's seniority").
- [ ] 8.17 New: a `name_opinions` insert with `edge_class = 'root'` and `negates = true` is rejected by the minting-shape CHECK (spec: "A root opinion cannot negate").
- [ ] 8.18 New: a negating opinion inserted with no prior opinion about that specific relationship is accepted and `derive_taxa()` treats the subject exactly as if it had no opinion of that edge_class at all (spec: "A negating row with no antecedent opinion is well-formed").

## 9. Verification

- [ ] 9.1 Apply `create_new.sql` to a fresh empty PG16 DB (PostGIS + ltree); confirm the rewritten function (and the new `negates` column/CHECK) builds clean.
- [ ] 9.2 Run the full fixture suite (group 8); all scenarios pass, including the regression set.
- [ ] 9.3 Re-run `rebuild_taxa()` / `assert_taxa_invariant()` over the extended fixtures; confirm `derive_taxa(all) ≡ heads`, and confirm `derive_taxa(subset) ≡ derive_taxa(all)` for at least one permid drawn from each new fixture case (8.3-8.18).
- [ ] 9.4 `openspec validate rework-derive-taxa --strict`; reconcile any drift between the delta spec and the final implementation.
- [ ] 9.5 Confirm this change's only schema-level edit is the `negates` column and its `name_opinion_shape` CHECK clause (task 0) — no other `taxa-opinions-schema` table is touched. If scope expanded beyond that, note the additional schema delta and update `proposal.md`/`design.md`'s Impact section accordingly rather than silently expanding scope.
