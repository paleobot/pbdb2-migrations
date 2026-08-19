Rework of `derive_taxa()` in `postgresql/create_new.sql` (~L5050-5298), on top of the schema from
`taxa-opinions-schema`. Not a data migration — exercised by SQL fixtures, same verification bar as the
original `taxa-opinion-derivation` change. Design in `design.md`; requirement deltas in
`specs/taxa-opinions/spec.md`. **Note:** the original change's fixture SQL lived in `.scratch/` (gitignored)
and no longer exists on disk, so group 6 below rebuilds the full fixture harness, not just the new cases —
this also serves as the regression check that nothing here breaks the 23 already-correct scenarios.

## 1. Split identity from edge-candidates (Decision 1)

- [ ] 1.1 Replace `_dt_mint` with `_dt_identity` — one row per permid, `WHERE edge_class = 'root'` only, carrying `permid, opinion_id, new_name, rank_id, authority_id`.
- [ ] 1.2 Add `_dt_edge_cand` — one row per (permid, introducing opinion), `WHERE edge_class IN ('root','lineage')` (same filter the old `_dt_mint` used), carrying `evidence`/`yr`/`never_accepted`.
- [ ] 1.3 Compute `_dt_permid_edge` from `_dt_edge_cand` — one row per permid, its own canonical introducing edge via `row_number() OVER (PARTITION BY permid ORDER BY evidence DESC, yr DESC NULLS LAST, opinion_id DESC) = 1`.
- [ ] 1.4 Add the duplicate-root-mint integrity check: `RAISE EXCEPTION` identifying the permid if `_dt_identity`'s underlying root-row count for any permid is more than 1.

## 2. Permid-scoped eligibility: never_accepted + nomen-nudum bar (Decision 2)

- [ ] 2.1 Move `_dt_valid`'s `CREATE TEMP TABLE` earlier in the function body, before `_dt_linmeta` (it currently runs near the end).
- [ ] 2.2 Extend `_dt_valid`'s `SELECT` to include `bars_candidacy` via a join to `dictionaries.nomenclatural_statuses` (currently selects only `status_id`).
- [ ] 2.3 Build an `eligible` CTE: `_dt_permid_edge` filtered `WHERE never_accepted = false`, `LEFT JOIN _dt_valid` filtered `WHERE COALESCE(bars_candidacy, false) = false`.
- [ ] 2.4 Rewire `_dt_linmeta`'s `spelling` CTE to rank `_dt_lin JOIN eligible` (by the canonical `ORDER BY`) instead of `_dt_lin JOIN _dt_mint WHERE m.never_accepted = false`.

## 3. Confirm the empty-lineage/-concept cascade needs no new code (Decision 3)

- [ ] 3.1 Audit every join reading from `_dt_linmeta` — `_dt_conmeta`'s `ranked` CTE and the final `RETURN QUERY` — and confirm each stays a plain `JOIN` (inner), never a `LEFT JOIN`, so a lineage/concept with zero eligible candidates naturally drops out rather than needing bespoke exclusion logic.
- [ ] 3.2 No new SQL expected from this section beyond what group 2 already produces — verified by the fixtures in group 6 (6.5, 6.6), not by additional code here.

## 4. Topological `original_permid` (Decision 4)

- [ ] 4.1 Replace the `roots` CTE's earliest-year-root method with a `sinks` CTE: permids in `_dt_lin` that are never the subject of a live `lineage`-class edge.
- [ ] 4.2 Add `sink_counts` and branch on it: unique sink (`n = 1`) → that permid directly; otherwise (`n = 0` or `n >= 2`) → fall back to the canonical `ORDER BY` (`evidence DESC, yr DESC NULLS LAST, opinion_id DESC`, tiebroken further as needed) over the candidate set — the tied sinks when `n >= 2`, every lineage member when `n = 0`.
- [ ] 4.3 Rewire `_dt_linmeta`'s final `SELECT` to source `original_permid` from the new `roots` CTE.

## 5. Rewire remaining `_dt_mint` references and re-verify seeding

- [ ] 5.1 Update the final `RETURN QUERY` to source `name`/`rank_id`/`authority_id` from `_dt_identity` instead of `_dt_mint`.
- [ ] 5.2 Update `winning_name_opinion_id` in the final output to come from `_dt_permid_edge` (the permid's own canonical introducing edge — `classic-taxa-opinions.md` §9.8.4.1's "canonical-winner introducing edge, or the root if the permid has no lineage edge"), not `m.opinion_id` off whichever row joined.
- [ ] 5.3 Re-verify `_dt_lin`'s seeding (`reach(src, node) AS (SELECT permid, permid FROM _dt_mint ...)`) is re-pointed at the right source (`_dt_identity`, since every valid permid has exactly one root row) and still reaches every permid that should participate in lineage grouping.
- [ ] 5.4 Sweep the full function body for any other reference to the old `_dt_mint` name; rename or remove consistently — no stale references left.

## 6. Fixtures (rebuild the harness; regression + new scenarios)

- [ ] 6.1 Rebuild the fixtures harness (minimal persons/refs + opinion sets, analogous to the archived change's group 8) since `.scratch/` no longer has the original SQL on disk.
- [ ] 6.2 Regression: re-run all 23 originally-passing scenarios (spec sections: grouping, accepted spelling recency/misspelling/senior-scoping, junior-synonym borrowing, seniority tiebreak, cycles, subset equivalence, totality, path, rebuild/invariant) — confirm no behavior changed for the already-correct cases.
- [ ] 6.3 New: a permid with a root mint plus two competing `lineage`-class edges naming it as subject still gets exactly one output row (spec: "A permid with competing lineage claims still gets exactly one row").
- [ ] 6.4 New: a permid whose only introducing claim is a `never_accepted` edge is excluded from `accepted_spelling_permid` eligibility even though it also has an unexcluded `root` mint (spec: "A permid is not made eligible by an unexcluded root mint alone").
- [ ] 6.5 New: a permid barred by a winning `nomen nudum` validity opinion is excluded from its lineage's contest, and a later non-barring validity opinion on the same permid reverses the exclusion.
- [ ] 6.6 New: a concept with one fully-exhausted lineage and one eligible sibling lineage emits no rows for the exhausted lineage's permids, while the concept's other members still resolve normally.
- [ ] 6.7 New: a concept where every lineage is exhausted emits no rows for any of its permids.
- [ ] 6.8 New: a two-way tie between candidate lineage originals (two sinks) resolves `original_permid` deterministically and repeatably.
- [ ] 6.9 New: a lineage-level cycle (zero sinks) resolves `original_permid` deterministically via the fallback.
- [ ] 6.10 New: two live root rows for the same permid raise an error identifying the permid.

## 7. Verification

- [ ] 7.1 Apply `create_new.sql` to a fresh empty PG16 DB (PostGIS + ltree); confirm the rewritten function builds clean.
- [ ] 7.2 Run the full fixture suite (group 6); all scenarios pass, including the regression set.
- [ ] 7.3 Re-run `rebuild_taxa()` / `assert_taxa_invariant()` over the extended fixtures; confirm `derive_taxa(all) ≡ heads`, and confirm `derive_taxa(subset) ≡ derive_taxa(all)` for at least one permid drawn from each new fixture case (6.3-6.10).
- [ ] 7.4 `openspec validate rework-derive-taxa --strict`; reconcile any drift between the delta spec and the final implementation.
- [ ] 7.5 Confirm this change required no edits to the `taxa-opinions-schema` tables themselves (function-only rework) — if it did, note the schema delta and update `proposal.md`/`design.md`'s Impact section accordingly rather than silently expanding scope.
