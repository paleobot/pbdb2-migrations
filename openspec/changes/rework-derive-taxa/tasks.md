## 0. Schema change: add `negates` (Decision 5)

- [x] 0.1 Add `negates boolean NOT NULL DEFAULT false` to `name_opinions`.
- [x] 0.2 Extend the `name_opinion_shape` CHECK: `edge_class = 'root'` rows must have `negates = false`.
- [x] 0.3 Add an inline comment on the `negates` column documenting that it flips the polarity of
      whatever `reason` names (`reason = 'misspelling', negates = true` reads as "not a misspelling of
      [target]," not "misspelling") — the Risks section's mitigation for a reader assuming `reason`
      alone still means what it names.

## 1. Split identity from edge-candidates (Decision 1)

- [x] 1.1 Replace `_dt_mint` with `_dt_identity` — one row per permid, `WHERE edge_class = 'root'` only, carrying `permid, opinion_id, new_name, rank_id, authority_id`.
- [x] 1.2 Add `_dt_edge_cand` — one row per (permid, introducing opinion), `WHERE edge_class IN ('root','lineage')` (same filter the old `_dt_mint` used), carrying `evidence`/`yr`/`never_accepted`, and `negates` (needed by task 2.3 and reused by task 6.1).
- [x] 1.3 Compute `_dt_permid_edge` from `_dt_edge_cand` — one row per permid, its own canonical introducing edge via `row_number() OVER (PARTITION BY permid ORDER BY evidence DESC, yr DESC NULLS LAST, opinion_id DESC) = 1`, **ranked only among `WHERE negates = false` candidates** (corrected during implementation — see design.md Decision 1/2 note; ranking over all candidates let a negating row win and wrongly exhaust the permid's own eligibility).
- [x] 1.4 Add the duplicate-root-mint integrity check: `RAISE EXCEPTION` identifying the permid if `_dt_identity`'s underlying root-row count for any permid is more than 1.

## 2. Permid-scoped eligibility: never_accepted + nomen-nudum + negation bar (Decision 2)

- [x] 2.1 Move `_dt_valid`'s `CREATE TEMP TABLE` earlier in the function body, before `_dt_linmeta` (it currently runs near the end).
- [x] 2.2 Extend `_dt_valid`'s `SELECT` to include `bars_candidacy` via a join to `dictionaries.nomenclatural_statuses` (currently selects only `status_id`).
- [x] 2.3 Build an `eligible` CTE: `_dt_permid_edge` filtered `WHERE never_accepted = false`, `LEFT JOIN _dt_valid` filtered `WHERE COALESCE(bars_candidacy, false) = false`. (No separate `negates` filter here — task 1.3's `_dt_permid_edge` already excludes negating rows from its ranking pool entirely.)
- [x] 2.4 Rewire `_dt_linmeta`'s `spelling` CTE to rank `_dt_lin JOIN eligible` (by the canonical `ORDER BY`) instead of `_dt_lin JOIN _dt_mint WHERE m.never_accepted = false`.

## 3. Confirm the empty-lineage/-concept cascade needs no new code (Decision 3)

- [x] 3.1 Audit every join reading from `_dt_linmeta` — `_dt_conmeta`'s `ranked` CTE and the final `RETURN QUERY` — and confirm each stays a plain `JOIN` (inner), never a `LEFT JOIN`, so a lineage/concept with zero eligible candidates naturally drops out rather than needing bespoke exclusion logic. Confirmed: both are plain `JOIN`s in the rewritten function.
- [x] 3.2 No new SQL expected from this section beyond what group 2 already produces — verified by the fixtures in group 8 (8.6, 8.7), not by additional code here. Confirmed: 8.6/8.7 passed with no code beyond group 2's `eligible` CTE.

## 4. Topological `original_permid` (Decision 4)

- [x] 4.1 Replace the `roots` CTE's earliest-year-root method with a `sinks` CTE: permids in `_dt_lin` with no active outgoing lineage edge, checked against task 6.1's `_dt_lin_winner` (`negates = false`) — not raw `name_opinions` existence, which a winning negation would satisfy while contributing no edge (same fix `con_sources`/task 7.1 needed, corrected during implementation).
- [x] 4.2 Add `sink_counts` and branch on it: unique sink (`n = 1`) → that permid directly; otherwise (`n = 0` or `n >= 2`) → fall back to the canonical `ORDER BY` (`evidence DESC, yr DESC NULLS LAST, opinion_id DESC`, tiebroken further as needed) over the candidate set — the tied sinks when `n >= 2`, every lineage member when `n = 0`.
- [x] 4.3 Rewire `_dt_linmeta`'s final `SELECT` to source `original_permid` from the new `roots` CTE.

## 5. Rewire remaining `_dt_mint` references and re-verify seeding

- [x] 5.1 Update the final `RETURN QUERY` to source `name`/`rank_id`/`authority_id` from `_dt_identity` instead of `_dt_mint`.
- [x] 5.2 Update `winning_name_opinion_id` in the final output to come from `_dt_permid_edge` (the permid's own canonical introducing edge — `classic-taxa-opinions.md` §9.8.4.1's "canonical-winner introducing edge, or the root if the permid has no lineage edge"), not `m.opinion_id` off whichever row joined.
- [x] 5.3 Re-verify `_dt_lin`'s seeding (`reach(src, node) AS (SELECT permid, permid FROM _dt_mint ...)`) is re-pointed at the right source (`_dt_identity`, since every valid permid has exactly one root row) and still reaches every permid that should participate in lineage grouping.
- [x] 5.4 Sweep the full function body for any other reference to the old `_dt_mint` name; rename or remove consistently — no stale references left. Confirmed via grep: zero remaining `_dt_mint` references (also swept and fixed `pubyr` → `publication_year`, a pre-existing bug found during this sweep — see design.md note).

## 6. Union-find ranking feeds lineage/concept grouping, with negation (Decisions 5-7)

- [x] 6.1 Build `_dt_lin_winner` from `_dt_edge_cand` (task 1.2) filtered `WHERE edge_class = 'lineage'`, re-ranked per permid over that narrower set: `row_number() OVER (PARTITION BY permid ORDER BY evidence DESC, yr DESC NULLS LAST, opinion_id DESC) = 1`, carrying `target_permid` and `negates`. (Not a reuse of `_dt_permid_edge` itself — that ranking pool includes `root` rows, which is correct for eligibility (group 2) but wrong here, since a `root` row has no target and can never contribute a union-find edge.)
- [x] 6.2 Rewire `lin_undir` to source both directions of its edges from `_dt_lin_winner WHERE negates = false`, instead of unconditionally from every current `lineage`-class `name_opinions` row.
- [x] 6.3 Build `_dt_con_winner`: pool `concept`-class `name_opinions` rows by lineage (`ls.lin_rep`, joining `_dt_lin`), rank per `lin_rep` by the canonical `ORDER BY`, carrying the target lineage (`sr`) and `negates`. This is a new computation, not sourced from `_dt_edge_cand` (which is scoped to `root`/`lineage` only).
- [x] 6.4 Rewire `con_edge`/`con_undir` to source edges from `_dt_con_winner WHERE negates = false`, instead of unconditionally from every current `concept`-class `name_opinions` row.
- [x] 6.5 Add an inline comment at `_dt_lin_winner`/`_dt_con_winner` documenting that a negating winner's `target_permid` is retained for provenance only and is never read by the union-find construction — the Risks section's mitigation for a reader assuming that target is computationally binding.

## 7. `con_sources` reflects active concept edges (Decision 8)

- [x] 7.1 Redefine `con_sources` as `SELECT DISTINCT jr FROM _dt_con_winner WHERE negates = false` (task 6.3's ranked output, filtered — the same set `con_edge` is, but `con_edge` itself only exists as a CTE inside task 6.4's statement and isn't visible here), replacing the raw existence check against `name_opinions`.

## 8. Fixtures (rebuild the harness; regression + new scenarios)

- [x] 8.1 Rebuild the fixtures harness (minimal persons/refs + opinion sets, analogous to the archived change's group 8) since `.scratch/` no longer has the original SQL on disk. Built against a local PostgreSQL 17 "play" database (`PG_PLAY_*`), isolated from the `pbdb_archive` Classic mirror.
- [x] 8.2 Regression: re-run all 23 originally-passing scenarios (spec sections: grouping, accepted spelling recency/misspelling/senior-scoping, junior-synonym borrowing, seniority tiebreak, cycles, subset equivalence, totality, path, rebuild/invariant) — confirm no behavior changed for the already-correct cases. **Caveat:** the archived change's own 23 fixtures aren't available to literally re-run (per this task's own premise). Covered instead with equivalent smoke coverage: simple lineage/concept grouping, fan-out, never_accepted + root-mint-alone, nomen-nudum bar + both cascade cases, cycle resolution, subset equivalence (`derive_taxa([x])` vs. `derive_taxa()`), and duplicate-root-mint raising. Full historical parity isn't independently verifiable without the original fixtures.
- [x] 8.3 New: a permid with a root mint plus two competing `lineage`-class edges naming it as subject still gets exactly one output row (spec: "A permid with competing lineage claims still gets exactly one row").
- [x] 8.4 New: a permid whose only introducing claim is a `never_accepted` edge is excluded from `accepted_spelling_permid` eligibility even though it also has an unexcluded `root` mint (spec: "A permid is not made eligible by an unexcluded root mint alone").
- [x] 8.5 New: a permid barred by a winning `nomen nudum` validity opinion is excluded from its lineage's contest, and a later non-barring validity opinion on the same permid reverses the exclusion.
- [x] 8.6 New: a concept with one fully-exhausted lineage and one eligible sibling lineage emits no rows for the exhausted lineage's permids, while the concept's other members still resolve normally.
- [x] 8.7 New: a concept where every lineage is exhausted emits no rows for any of its permids.
- [x] 8.8 A two-way tie between candidate lineage originals is structurally unconstructable under Decision 7 (per-subject ranking makes a lineage's reachability graph a functional graph — never two genuine sinks in one component; see design.md's Decision 4 note added 2026-08-20). Not skipped silently: verified the fallback's shared `ORDER BY` ranking logic via 8.9's cycle case instead, which exercises the identical expression over a different candidate set.
- [x] 8.9 New: a lineage-level cycle (zero sinks) resolves `original_permid` deterministically via the fallback.
- [x] 8.10 New: two live root rows for the same permid raise an error identifying the permid.
- [x] 8.11 New: a subject with two competing `lineage`-class opinions, where the higher-ranked one targets a different permid, is unioned into the higher-ranked target's lineage, not the lower-ranked one's (spec: "A later, higher-ranked opinion redirects a subject's lineage").
- [x] 8.12 New: a subject whose higher-ranked current `lineage`-class opinion is negating forms its own lineage instead of joining the target a lower-ranked opinion named (spec: "A winning negation removes a subject from its claimed lineage"). First run of this fixture caught a real bug — see design.md Decision 1/2's 2026-08-20 correction note.
- [x] 8.13 New: a lineage with two current `concept`-class opinions (filed under any of its member permids) targeting different lineages is unioned into the higher-ranked target's concept, not the lower-ranked one's (spec: "A later, higher-ranked opinion redirects a lineage's concept").
- [x] 8.14 New: a lineage whose higher-ranked current `concept`-class opinion is negating forms its own concept instead of joining the target a lower-ranked opinion named (spec: "A winning negation returns a lineage to its own concept").
- [x] 8.15 New: a permid whose only non-`root` introducing claim is a higher-evidence `negates = true` lineage edge still resolves — its canonical introducing edge is its own `root` mint (the negation never wins that ranking), so it remains eligible and, forming its own lineage, becomes its own `accepted_spelling_permid` (spec: "A negating opinion never wins canonical-introducing-edge ranking, but its permid stays eligible via its own root row").
- [x] 8.16 New: a lineage whose only `concept`-class opinion is outranked or successfully negated is not deprioritized against a lineage with no `concept`-class history at all, when tied on the other tiebreak criteria (spec: "An outranked or negated concept claim does not deprioritize a lineage's seniority").
- [x] 8.17 New: a `name_opinions` insert with `edge_class = 'root'` and `negates = true` is rejected by the minting-shape CHECK (spec: "A root opinion cannot negate").
- [x] 8.18 New: a negating opinion inserted with no prior opinion about that specific relationship is accepted and `derive_taxa()` treats the subject exactly as if it had no opinion of that edge_class at all (spec: "A negating row with no antecedent opinion is well-formed").

## 9. Verification

- [x] 9.1 Apply `create_new.sql` to a fresh empty PG16 DB (PostGIS + ltree); confirm the rewritten function (and the new `negates` column/CHECK) builds clean. Ran on local PostgreSQL 17 (Postgres.app, `PG_PLAY_*`) rather than 16 — immaterial version difference for this function; PostGIS enabled as an environment prerequisite (matches this task's own framing), not added into `create_new.sql` itself (unrelated to this change's scope).
- [x] 9.2 Run the full fixture suite (group 8); all scenarios pass, including the regression set. 22/22 checks passed on the final run.
- [x] 9.3 Re-run `rebuild_taxa()` / `assert_taxa_invariant()` over the extended fixtures; confirm `derive_taxa(all) ≡ heads`, and confirm `derive_taxa(subset) ≡ derive_taxa(all)` for at least one permid drawn from each new fixture case (8.3-8.18). Confirmed: `rebuild_taxa()` inserted 30 rows then 0 on immediate re-call (no-op re-derivation appends no versions); `assert_taxa_invariant()` raised nothing; subset equivalence held across 10 sampled permids spanning the new fixture cases.
- [x] 9.4 `openspec validate rework-derive-taxa --strict`; reconcile any drift between the delta spec and the final implementation. Valid, no drift.
- [x] 9.5 Confirm this change's only schema-level edit is the `negates` column and its `name_opinion_shape` CHECK clause (task 0) — no other `taxa-opinions-schema` table is touched. Confirmed via `git diff` — zero added/removed `CREATE TABLE`/`ALTER TABLE` statements; the only structural change is inside the existing `name_opinions` definition.

## 10. Versioning/retraction robustness (2026-08-20, added after 9.1-9.5 — group 8's fixtures never exercised `succeeded_by_id`/`removed`, an existing spec requirement — "derive_taxa() is a pure function of the opinions" / "superseded and removed opinions are ignored" — this rewrite substantially touches every CTE that requirement depends on)

- [x] 10.1 A `lineage`-class version chain (superseded row with a higher, wrong `publication_year`; head row with the corrected, lower one) does not let the superseded row win the per-subject ranking over an unversioned competing opinion.
- [x] 10.2 A `removed = true` `lineage`-class opinion with higher evidence/pubyr does not win the per-subject ranking over an active, lower-ranked one.
- [x] 10.3 Retracting a negation (`removed = true` on the negating row, itself unversioned) restores the underlying claim the negation had displaced — confirms retraction and negation compose correctly, not just independently.
- [x] 10.4 A `root`-class version chain: `derive_taxa()` reports the head's `new_name`, not the superseded one, and the superseded row does **not** trip the duplicate-live-root-row integrity check (task 1.4) — confirms that check is itself version-aware.
- [x] 10.5 A `concept`-class version chain (mirroring 10.1) does not let a superseded, higher-pubyr concept edge win over an unversioned competing one.
- [x] 10.6 An `assignment_opinions` version chain: classification follows the head's `containing_permid`, not a superseded row with a misleadingly high pubyr.
- [x] 10.7 A `validity_opinions` version chain where a superseded `nomen nudum` ruling is succeeded by a non-barring status does not bar candidacy.
- [x] 10.8 A `removed = true` `nomen nudum` ruling (retracted, unversioned) does not bar candidacy.

All 9 checks passed against the same `PG_PLAY` database used for groups 8-9 (added alongside the existing fixtures, not a fresh reset); `rebuild_taxa()`/`assert_taxa_invariant()` re-confirmed over the combined set (17 new rows inserted, 0 on immediate re-call, invariant holds).
