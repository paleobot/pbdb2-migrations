# Classic opinions → assignment/name/validity_opinions migration — pair-based field mapping

Companion to [`DESIGN.md`](./DESIGN.md) (the pair-based decomposition rationale, §1–§7) and
[`payloadSchemas/mappings/authorities-opinions.md`](../payloadSchemas/mappings/authorities-opinions.md)
(the pre-existing mapping doc this one extends the same style to). Every legacy `opinions` row is
handled by exactly one `migration_exploration/opinions/<status-folder>/<spelling_reason>.js` — this
document gives the field-level mapping for each of the 48 `(status, spelling_reason)` pairs, in the same
`Classic opinions | <target table> | Notes` + skip-and-log + reconciliation-invariant style as the
existing doc.

**Universal conventions, true for every pair below** (stated once here rather than re-derived per
pair): `child_spelling_no` is always the subject (`subject_permid`) of every emitted row, no exceptions.
Migration writes every qualifying opinion as its own ledger row, unconditionally — it never ranks or
selects a "winning" opinion; that is exclusively `derive_taxa()`'s job (`DESIGN.md` §2). Rows are
resolved and skipped independently per emission — a failure in one output (e.g. the lineage edge) never
blocks another (e.g. the concept/assignment/validity row) for the same source opinion.

Row counts below are as stated in each handler's own header comment, live-probed against the
Postgres-ported classic mirror (`pg_classic`) during the 2026-08-19 validation pass (`DESIGN.md` §7).
They sum to exactly 998,565 across all 48 pairs, reconciling against `docs/taxa-opinions-migration-mapping.md`'s
per-status totals (`DESIGN.md` §4). Skip-bucket counts are given where a folder's `anomalies.csv` — a
live-probed, per-script anomaly ledger, not a static artifact — carries rows for that specific script;
where a script has no rows in its folder's current `anomalies.csv`, that is noted explicitly rather than
assumed to mean zero anomalies (the CSV is gitignored and rebuilt per-script on each run, so an empty
result can mean either "clean" or "not re-probed since the last flush" — see `DESIGN.md` §5).

---

## 1. `belongs to` (6 pairs, 927,512 rows) → `assignment_opinions` (+ `name_opinions` lineage backfill)

Every row in this status is a containment assertion. `parent_spelling_no = 0` is Classic's own "no
parent asserted" sentinel, not unresolvable data — migrated with `containing_permid = NULL` (`warning`/
`asserted_rootless`, not skipped) so the claim can still win or lose `derive_taxa()`'s usual contest.
`parent_spelling_orphan` (unresolvable) is always skipped. Six pairs share one field shape below; only
the lineage reason token and the mistagged-`original spelling` backfill logic differ per pair.

### 1.1 `belongs to` / `original spelling` — 743,712 rows

```sql
SELECT * FROM opinions WHERE status = 'belongs to' AND spelling_reason = 'original spelling';
```

Primary disposition only, for all but 50 anomalous rows (see backfill below).

Classic opinions | assignment_opinions | Notes
-- | -- | --
N/A | id | pk
N/A | permid | generated
authorizer_no | authorizer_person_id | This is a foreign key to the new persons table record whose person.legacyIDs.oldpbdbid = authorizer_no.
enterer_no | enterer_person_id | This is a foreign key to the new persons table record whose person.legacyIDs.oldpbdbid = enterer_no.
child_spelling_no | subject_permid | permid of the name_opinions record with oldpbdb_taxon_no = child_spelling_no
parent_spelling_no | containing_permid | permid of the name_opinions record with oldpbdb_taxon_no = parent_spelling_no; NULL when parent_spelling_no = 0 (Classic asserts no parent — inserted with a `warning`/`asserted_rootless` anomaly log entry, not skipped)
N/A | questioned | false
reference_no | reference_id | fk to the refs record with reference.legacyIDs.oldpbdbid = reference_no.
basis | evidence | 'stated with evidence' = TRUE, everything else = FALSE
pubyr | publication_year | Second-hand override only, gated on ref_has_opinion. When ref_has_opinion = 'YES' (first-hand), leave NULL — derive_taxa() reads the year off the reference via COALESCE(publication_year, ref.publicationYear). When ref_has_opinion IS NULL (second-hand), set publication_year = pubyr.
author1last, author2last, otherauthors, ref_has_opinion | attribution | Using opinionAttribution.schema.js, per the Decisions section of the 2026-06-02 migrate-authorities design doc.
N/A | removed | false

**Backfill (50 of the 743,712 rows have `child_spelling_no != child_no` despite the label) →**
`name_opinions` lineage edge, reason from the pre-computed `mistagged-original-spelling.csv` worklist:

Classic opinions | name_opinions (lineage) | Notes
-- | -- | --
child_spelling_no | subject_permid | same permid resolved above
child_no | target_permid | permid of the name_opinions record with oldpbdb_taxon_no = child_no
N/A | reason_id | from worklist: reranked (16 rows) / recombination (10) / correction (1) / duplicate-or-homonym → generic `assignment` token (22, no more specific token fits "same name, same rank, new authority")
N/A | edge_class | 'lineage'
(same person/reference/evidence/pubyr/attribution/removed mapping as above)

**Skip-and-log** (assignment_opinions):

Skip bucket | Rows | Cause
-- | -- | --
parent_spelling_orphan | 6 | parent_spelling_no points at a taxon_no absent from authorities/name_opinions
orphan_reference | 1 | reference_no not resolvable (opinion_no 422326 → reference_no 42348, dangling in source)
child_spelling_unresolved | 1 | child_spelling_no has no migrated permid
self_reference | 1 | child_spelling_no = parent_spelling_no

322 further rows have `parent_spelling_no = 0`; these are not a skip — they're inserted normally with
`containing_permid = NULL` (logged as `warning`/`asserted_rootless`, per §1's intro note above).

> inserted (743,703) + skipped (9) == in-scope (743,712).

Lineage backfill: 49 of 50 worklist rows emit successfully (`warning`/`mislabeled_original_spelling`); 1
is excluded upstream by `child_spelling_unresolved` before the backfill check ever runs.

### 1.2 `belongs to` / `recombination` — 146,103 rows

```sql
SELECT * FROM opinions WHERE status = 'belongs to' AND spelling_reason = 'recombination';
```

Dual emission, unconditional: every row emits both an `assignment_opinions` containment row and a
`name_opinions` lineage row. `child_spelling_no` is a shared prerequisite (subject of both), resolved
once; only the "other end" (`parent_spelling_no` vs `child_no`) differs.

Classic opinions | assignment_opinions | Notes
-- | -- | --
N/A | id | pk
N/A | permid | generated
authorizer_no | authorizer_person_id | FK to persons.legacyIDs.oldpbdbid = authorizer_no.
enterer_no | enterer_person_id | FK to persons.legacyIDs.oldpbdbid = enterer_no.
child_spelling_no | subject_permid | permid of the name_opinions record with oldpbdb_taxon_no = child_spelling_no
parent_spelling_no | containing_permid | permid of the name_opinions record with oldpbdb_taxon_no = parent_spelling_no; NULL when parent_spelling_no = 0
N/A | questioned | false
reference_no | reference_id | fk to refs.legacyIDs.oldpbdbid = reference_no.
basis | evidence | 'stated with evidence' = TRUE, else FALSE
pubyr | publication_year | second-hand override only (same rule as 1.1)
author1last, author2last, otherauthors, ref_has_opinion | attribution | opinionAttribution.schema.js
N/A | removed | false

Classic opinions | name_opinions (lineage) | Notes
-- | -- | --
child_spelling_no | subject_permid | same permid resolved above (shared prerequisite)
child_no | target_permid | permid of the name_opinions record with oldpbdb_taxon_no = child_no
N/A | reason_id | 'recombination'
N/A | edge_class | 'lineage'
(same person/reference/evidence/pubyr/attribution/removed mapping as the assignment table)

**Skip-and-log:**

Skip bucket | Table | Cause
-- | -- | --
orphan_reference (shared) | both | reference_no not resolvable — blocks both emissions
child_spelling_unresolved (shared) | both | child_spelling_no has no migrated permid — blocks both emissions
parent_spelling_orphan | assignment_opinions | parent_spelling_no has no migrated permid
self_reference | assignment_opinions | child_spelling_no == parent_spelling_no
child_no_unresolved | name_opinions | child_no has no migrated permid
self_reference | name_opinions | child_spelling_no == child_no despite spelling_reason='recombination' — row carries no actual spelling deviation

> Two independent reconciliations enforced in code: `assignment inserted + assignment skipped == 146,103`
> and `lineage inserted + lineage skipped == 146,103`. Exact live counts not captured in this pass beyond
> the structure above.

### 1.3 `belongs to` / `correction` — 9,659 rows

```sql
SELECT * FROM opinions WHERE status = 'belongs to' AND spelling_reason = 'correction';
```

Same dual-emission shape as 1.2, differing only in the lineage reason token (`'correction'`).

Classic opinions | assignment_opinions | Notes
-- | -- | --
(identical column mapping to §1.2's assignment_opinions table)

Classic opinions | name_opinions (lineage) | Notes
-- | -- | --
child_spelling_no | subject_permid | shared prerequisite
child_no | target_permid | permid of the name_opinions record with oldpbdb_taxon_no = child_no
N/A | reason_id | 'correction'
N/A | edge_class | 'lineage'
(same tail mapping as §1.2)

**Skip-and-log** (live-probed, `belongs-to/anomalies.csv`):

Skip bucket | Table | Rows | Cause
-- | -- | --: | --
child_spelling_unresolved (shared) | both | 1 | opinion_no 294387 — child_spelling_no=161644 not present in classic authorities (a genuine deleted-authority gap, `DESIGN.md` §3)
self_reference | name_opinions | 5 | child_spelling_no == child_no despite spelling_reason='correction' (opinion_no 34880, 81264, 219915, 229602, 304174)

7 further rows have `parent_spelling_no = 0`; not a skip — inserted normally with `containing_permid =
NULL` (`warning`/`asserted_rootless`, per §1's intro note).

> assignment: 9,659 − 1 (shared) == 9,658 inserted, of which 7 are asserted-rootless (containing_permid=NULL).
> lineage: 9,659 − (1 shared + 5 self_reference) == 9,653 inserted.

### 1.4 `belongs to` / `misspelling` — 6,983 rows

```sql
SELECT * FROM opinions WHERE status = 'belongs to' AND spelling_reason = 'misspelling';
```

Same dual-emission shape; lineage reason token is `'misspelling'` — the **curatorial** provenance token
(`never_accepted=true`), distinct from `misspelling of`'s dedicated `'historical misspelling'` token
(`DESIGN.md` §3's two-provenance rule).

Classic opinions | assignment_opinions | Notes
-- | -- | --
(identical column mapping to §1.2)

Classic opinions | name_opinions (lineage) | Notes
-- | -- | --
child_spelling_no | subject_permid | shared prerequisite
child_no | target_permid | permid of the name_opinions record with oldpbdb_taxon_no = child_no
N/A | reason_id | 'misspelling'
N/A | edge_class | 'lineage'
(same tail mapping as §1.2)

**Skip-and-log** (live-probed, `belongs-to/anomalies.csv`):

Skip bucket | Table | Rows | Cause
-- | -- | --: | --
child_spelling_unresolved (shared) | both | 1 | opinion_no 289111 — no migrated permid
self_reference | name_opinions | 63 | child_spelling_no == child_no despite spelling_reason='misspelling' — the heaviest self-reference bucket of any pair (`DESIGN.md` §3's "lineage self-reference" anomaly class, root cause unclear, no migration-side fix)

> assignment: 6,983 − 1 == 6,982 inserted. lineage: 6,983 − (1 + 63) == 6,919 inserted.

### 1.5 `belongs to` / `rank change` — 20,743 rows

```sql
SELECT * FROM opinions WHERE status = 'belongs to' AND spelling_reason = 'rank change';
```

Same dual-emission shape; lineage reason token is `'reranked'` (§4 crosswalk: `rank change` → `reranked`).

Classic opinions | assignment_opinions | Notes
-- | -- | --
(identical column mapping to §1.2)

Classic opinions | name_opinions (lineage) | Notes
-- | -- | --
child_spelling_no | subject_permid | shared prerequisite
child_no | target_permid | permid of the name_opinions record with oldpbdb_taxon_no = child_no
N/A | reason_id | 'reranked'
N/A | edge_class | 'lineage'
(same tail mapping as §1.2)

**Skip-and-log** (live-probed, `belongs-to/anomalies.csv`):

Skip bucket | Table | Rows | Cause
-- | -- | --: | --
parent_spelling_orphan | assignment_opinions | 1 | opinion_no 567429 — parent_spelling_no has no migrated permid
self_reference | name_opinions | 73 | child_spelling_no == child_no despite spelling_reason='rank change'

3 further rows have `parent_spelling_no = 0`; not a skip — inserted normally with `containing_permid =
NULL` (`warning`/`asserted_rootless`, per §1's intro note).

> assignment: 20,743 − 1 == 20,742 inserted (3 asserted-rootless). lineage: 20,743 − 73 == 20,670 inserted.

### 1.6 `belongs to` / `reassignment` — 312 rows

```sql
SELECT * FROM opinions WHERE status = 'belongs to' AND spelling_reason = 'reassignment';
```

Last of the six `belongs to` variants. The legacy literal is `spelling_reason = 'reassignment'`; the
lineage reason token is the generic `'assignment'` (§4 crosswalk: `reassignment` → `assignment`).

Classic opinions | assignment_opinions | Notes
-- | -- | --
(identical column mapping to §1.2)

Classic opinions | name_opinions (lineage) | Notes
-- | -- | --
child_spelling_no | subject_permid | shared prerequisite
child_no | target_permid | permid of the name_opinions record with oldpbdb_taxon_no = child_no
N/A | reason_id | 'assignment'
N/A | edge_class | 'lineage'
(same tail mapping as §1.2)

**Skip-and-log:** no rows for `reassignment.js` appear in `belongs-to/anomalies.csv` — smallest pair in
the folder, live-probed clean.

> assignment: 312 + 0 == 312. lineage: 312 + 0 == 312.

---

## 2. `subjective synonym of` (6 pairs, 52,106 rows) → `name_opinions` concept edge (`reason='junior synonym'`, `objective=false`)

### 2.1 `subjective synonym of` / `original spelling` — 47,687 rows

```sql
SELECT * FROM opinions WHERE status = 'subjective synonym of' AND spelling_reason = 'original spelling';
```

Already documented (combined with 3.1) in `authorities-opinions.md`'s "Classic opinions synonymy
opinions (original spellings) migration" section — 48,839 rows total across both pairs, 17 skipped. This
section adds the 2-row mistagged-label backfill discovered live 2026-08-19 (not in the existing doc).

Classic opinions | name_opinions (concept) | Notes
-- | -- | --
N/A | id | pk
N/A | permid | generated
authorizer_no | authorizer_person_id | FK to persons.legacyIDs.oldpbdbid = authorizer_no.
enterer_no | enterer_person_id | FK to persons.legacyIDs.oldpbdbid = enterer_no.
N/A | oldpbdb_taxon_no | NA
N/A | reason_id | 'junior synonym'
child_spelling_no | subject_permid | permid of the name_opinions record with oldpbdb_taxon_no = child_spelling_no
parent_spelling_no | target_permid | permid of the name_opinions record with oldpbdb_taxon_no = parent_spelling_no
N/A | edge_class | 'concept'
N/A | objective | false
N/A | new_name | NA
N/A | rank_id | NA
N/A | authority_id | NA
reference_no | reference_id | fk to refs.legacyIDs.oldpbdbid = reference_no.
basis | evidence | 'stated with evidence' = TRUE, else FALSE
pubyr | publication_year | second-hand override only (same rule as §1.1)
author1last, author2last, otherauthors, ref_has_opinion | attribution | opinionAttribution.schema.js
N/A | removed | false

**Backfill** (2 of 47,687 rows, found live 2026-08-19 — the first case where this pair's
concept-only handler needed a lineage split, per `DESIGN.md` §3):

Classic opinions | name_opinions (lineage) | Notes
-- | -- | --
child_spelling_no | subject_permid | opinion_no 71324 ("Subdromomeryx") / 912640 ("Ericales")
child_no | target_permid | permid of the name_opinions record with oldpbdb_taxon_no = child_no
N/A | reason_id | opinion_no 71324 → 'reranked' (rank-change claim); opinion_no 912640 → 'assignment' (duplicate-or-homonym, different taxon_no, same name+rank)
N/A | edge_class | 'lineage'
(same tail mapping)

**Skip-and-log** (combined-pair figures from `authorities-opinions.md`; this pair alone contributes
47,687 of the combined 48,839 in-scope total):

Skip bucket | Rows (combined w/ 3.1) | Cause
-- | --: | --
self_reference | 7 | child_spelling_no = parent_spelling_no (3 are byte-identical duplicates: 525425/525426/525427)
child_spelling_unresolved | 6 | child_spelling_no has no name_opinions root row (cluster on taxon_nos 242140/242141/242243)
orphan_reference | 4 | reference_no not resolvable (all cite the same dangling reference_no 42348)

> Live-probed for THIS pair specifically (`subjective-synonym-of/anomalies.csv`): 6 self_reference rows
> (525425, 525426, 525427, 539297, 549465, 912640 — one of which, 912640, is also the backfill's
> duplicate-or-homonym row: its concept edge is independently skipped as self-reference while its lineage
> backfill still fires, per `DESIGN.md` §3's "resolved independently" principle). Combined inserted
> (48,822) + skipped (17) == in-scope (48,839) per the existing doc; this pair's own split is not
> separately re-stated there.

### 2.2 `subjective synonym of` / `correction` — 399 rows

```sql
SELECT * FROM opinions WHERE status = 'subjective synonym of' AND spelling_reason = 'correction';
```

Dual emission. `orphan_reference` and `child_spelling_unresolved` are shared prerequisites (block both
emissions); `parent_spelling_zero`/`parent_spelling_orphan`/self_reference gate the concept edge only,
`child_no_unresolved`/self_reference gate the lineage edge only.

Classic opinions | name_opinions (concept) | Notes
-- | -- | --
(same as §2.1's concept table, `objective = false`)

Classic opinions | name_opinions (lineage) | Notes
-- | -- | --
child_spelling_no | subject_permid | shared prerequisite
child_no | target_permid | permid of the name_opinions record with oldpbdb_taxon_no = child_no
N/A | reason_id | 'correction'
N/A | edge_class | 'lineage'
(same tail mapping)

**Skip-and-log** (live-probed, `subjective-synonym-of/anomalies.csv`):

Skip bucket | Table | Rows | Cause
-- | -- | --: | --
self_reference | name_opinions (concept) | 9–11 (csv lists 11; DESIGN.md's convergent-correction pattern is documented for `replaced-by/correction.js`, not this pair — treat the full count as ordinary self-reference here) | child_spelling_no == parent_spelling_no
self_reference | name_opinions (lineage) | 3 | child_spelling_no == child_no despite spelling_reason='correction'

> concept: 399 − ~11 ≈ 388 inserted (pending confirmation of shared-gate counts). lineage: 399 − 3 == 396 inserted.

### 2.3 `subjective synonym of` / `rank change` — 880 rows

```sql
SELECT * FROM opinions WHERE status = 'subjective synonym of' AND spelling_reason = 'rank change';
```

Structurally identical to §2.2; lineage reason token is `'reranked'`.

Classic opinions | name_opinions (concept) | Notes
-- | -- | --
(same as §2.1, `objective = false`)

Classic opinions | name_opinions (lineage) | Notes
-- | -- | --
child_spelling_no | subject_permid | shared prerequisite
child_no | target_permid | permid of the name_opinions record with oldpbdb_taxon_no = child_no
N/A | reason_id | 'reranked'
N/A | edge_class | 'lineage'
(same tail mapping)

**Skip-and-log** (live-probed): 0 concept self_reference rows logged for `rank-change.js`; 4 lineage
self_reference rows (opinion_no 79305, 189643, 201139, 293798).

> lineage: 880 − 4 == 876 inserted. concept: 880 inserted (no concept-specific skips observed in this csv
> snapshot; shared-gate counts for this script not independently confirmed at 0).

### 2.4 `subjective synonym of` / `recombination` — 2,816 rows

```sql
SELECT * FROM opinions WHERE status = 'subjective synonym of' AND spelling_reason = 'recombination';
```

`DESIGN.md`'s canonical example of the dual-output shape (§6). Two distinct 2.0-model assertions
(synonymy from `status`, spelling claim from `spelling_reason`) collapse onto one legacy row, hence two
`name_opinions` records.

Classic opinions | name_opinions (concept) | Notes
-- | -- | --
(same as §2.1, `objective = false`)

Classic opinions | name_opinions (lineage) | Notes
-- | -- | --
child_spelling_no | subject_permid | shared prerequisite
child_no | target_permid | permid of the name_opinions record with oldpbdb_taxon_no = child_no
N/A | reason_id | 'recombination'
N/A | edge_class | 'lineage'
(same tail mapping)

**Skip-and-log** (live-probed, `subjective-synonym-of/anomalies.csv` — the heaviest concept self_reference
bucket in the folder):

Skip bucket | Table | Rows | Cause
-- | -- | --: | --
self_reference | name_opinions (concept) | 57 | child_spelling_no == parent_spelling_no
self_reference | name_opinions (lineage) | 4 | child_spelling_no == child_no despite spelling_reason='recombination'

> concept: 2,816 − 57 == 2,759 inserted. lineage: 2,816 − 4 == 2,812 inserted.

### 2.5 `subjective synonym of` / `misspelling` — 320 rows

```sql
SELECT * FROM opinions WHERE status = 'subjective synonym of' AND spelling_reason = 'misspelling';
```

Curatorial `'misspelling'` token (never_accepted, incidental provenance — `DESIGN.md` §3), not `'historical
misspelling'`.

Classic opinions | name_opinions (concept) | Notes
-- | -- | --
(same as §2.1, `objective = false`)

Classic opinions | name_opinions (lineage) | Notes
-- | -- | --
child_spelling_no | subject_permid | shared prerequisite
child_no | target_permid | permid of the name_opinions record with oldpbdb_taxon_no = child_no
N/A | reason_id | 'misspelling'
N/A | edge_class | 'lineage'
(same tail mapping)

**Skip-and-log** (live-probed): 0 concept self_reference rows for `misspelling.js`; 7 lineage
self_reference rows (opinion_no 53051, 114231, 293698, 305435, 312392, 350256, 470188).

> lineage: 320 − 7 == 313 inserted. concept: 320 inserted (no concept-specific skips observed).

### 2.6 `subjective synonym of` / `reassignment` — 4 rows

```sql
SELECT * FROM opinions WHERE status = 'subjective synonym of' AND spelling_reason = 'reassignment';
```

Smallest pair in the folder; last of the six `subjective synonym of` variants. Lineage token is the
generic `'assignment'`.

Classic opinions | name_opinions (concept) | Notes
-- | -- | --
(same as §2.1, `objective = false`)

Classic opinions | name_opinions (lineage) | Notes
-- | -- | --
child_spelling_no | subject_permid | shared prerequisite
child_no | target_permid | permid of the name_opinions record with oldpbdb_taxon_no = child_no
N/A | reason_id | 'assignment'
N/A | edge_class | 'lineage'
(same tail mapping)

**Skip-and-log:** no rows for `reassignment.js` in `subjective-synonym-of/anomalies.csv` — live-probed
clean with only 4 source rows.

> concept: 4 + 0 == 4. lineage: 4 + 0 == 4.

---

## 3. `objective synonym of` (5 pairs, 1,246 rows) → `name_opinions` concept edge (`reason='junior synonym'`, `objective=true`)

Field mapping is identical to §2's five equivalent pairs except the hardcoded `objective` literal is
`true` instead of `false`; there is no `reassignment` variant for this status (only 5 files exist in this
folder).

### 3.1 `objective synonym of` / `original spelling` — 1,152 rows

```sql
SELECT * FROM opinions WHERE status = 'objective synonym of' AND spelling_reason = 'original spelling';
```

Combined with §2.1 in `authorities-opinions.md`'s existing synonymy-opinions section (48,839 rows,
combined skip figures self_reference=7/child_spelling_unresolved=6/orphan_reference=4 — those combined
totals do not cleanly decompose into this pair's own 1,152-row slice; this pair's own live-probed csv
shows only 1 self_reference skip, so most of the combined skips likely belong to the subjective slice,
but this is not independently confirmed).

Classic opinions | name_opinions (concept) | Notes
-- | -- | --
N/A | id | pk
N/A | permid | generated
authorizer_no | authorizer_person_id | FK to persons.legacyIDs.oldpbdbid = authorizer_no.
enterer_no | enterer_person_id | FK to persons.legacyIDs.oldpbdbid = enterer_no.
N/A | oldpbdb_taxon_no | NA
N/A | reason_id | 'junior synonym'
child_spelling_no | subject_permid | permid of the name_opinions record with oldpbdb_taxon_no = child_spelling_no
parent_spelling_no | target_permid | permid of the name_opinions record with oldpbdb_taxon_no = parent_spelling_no
N/A | edge_class | 'concept'
N/A | objective | true
N/A | new_name / rank_id / authority_id | NA
reference_no | reference_id | fk to refs.legacyIDs.oldpbdbid = reference_no.
basis | evidence | 'stated with evidence' = TRUE, else FALSE
pubyr | publication_year | second-hand override only (same rule as §1.1)
author1last, author2last, otherauthors, ref_has_opinion | attribution | opinionAttribution.schema.js
N/A | removed | false

No lineage backfill logic exists in this file (unlike §2.1) — no mistagged `original spelling` rows have
been found for this specific pair.

**Skip-and-log** (live-probed, `objective-synonym-of/anomalies.csv`): 1 self_reference row (opinion_no
939320, child_spelling_no = parent_spelling_no = 18949).

> 1,152 − 1 == 1,151 inserted, 1 skipped (pending confirmation this is the only skip for this pair).

### 3.2 `objective synonym of` / `correction` — 15 rows

```sql
SELECT * FROM opinions WHERE status = 'objective synonym of' AND spelling_reason = 'correction';
```

Classic opinions | name_opinions (concept) | Notes
-- | -- | --
(same as §3.1, `objective = true`)

Classic opinions | name_opinions (lineage) | Notes
-- | -- | --
child_spelling_no | subject_permid | shared prerequisite
child_no | target_permid | permid of the name_opinions record with oldpbdb_taxon_no = child_no
N/A | reason_id | 'correction'
N/A | edge_class | 'lineage'; objective NULL
(same tail mapping)

**Skip-and-log** (live-probed): 1 concept self_reference (opinion_no 707085, child_spelling_no =
parent_spelling_no = 380537; child_no = parent_no = 112749 too — a same-taxon self-synonymy opinion, `DESIGN.md`
§3 bucket 2). Its paired lineage edge is not logged as skipped, implying it fired.

> concept: 15 − 1 == 14 inserted. lineage: 15 inserted (this row's lineage edge fired normally).

### 3.3 `objective synonym of` / `rank change` — 37 rows

```sql
SELECT * FROM opinions WHERE status = 'objective synonym of' AND spelling_reason = 'rank change';
```

Classic opinions | name_opinions (concept) | Notes
-- | -- | --
(same as §3.1, `objective = true`)

Classic opinions | name_opinions (lineage) | Notes
-- | -- | --
child_spelling_no | subject_permid | shared prerequisite
child_no | target_permid | permid of the name_opinions record with oldpbdb_taxon_no = child_no
N/A | reason_id | 'reranked'
N/A | edge_class | 'lineage'
(same tail mapping)

**Skip-and-log** (live-probed): 1 concept self_reference (opinion_no 494092, child_spelling_no =
parent_spelling_no = 276037; child_no = parent_no = 67345, same-taxon self-synonymy).

> concept: 37 − 1 == 36 inserted. lineage: 37 inserted.

### 3.4 `objective synonym of` / `recombination` — 36 rows

```sql
SELECT * FROM opinions WHERE status = 'objective synonym of' AND spelling_reason = 'recombination';
```

Classic opinions | name_opinions (concept) | Notes
-- | -- | --
(same as §3.1, `objective = true`)

Classic opinions | name_opinions (lineage) | Notes
-- | -- | --
child_spelling_no | subject_permid | shared prerequisite
child_no | target_permid | permid of the name_opinions record with oldpbdb_taxon_no = child_no
N/A | reason_id | 'recombination'
N/A | edge_class | 'lineage'
(same tail mapping)

**Skip-and-log** (live-probed): 1 concept self_reference (opinion_no 311825, child_spelling_no =
parent_spelling_no = 171287; child_no = 171289, NOT equal to parent_no — a plain spelling-pair
self-reference, not a same-taxon self-synonymy case).

> concept: 36 − 1 == 35 inserted. lineage: 36 inserted (child_spelling_no ≠ child_no for this row).

### 3.5 `objective synonym of` / `misspelling` — 6 rows

```sql
SELECT * FROM opinions WHERE status = 'objective synonym of' AND spelling_reason = 'misspelling';
```

Smallest pair in the folder.

Classic opinions | name_opinions (concept) | Notes
-- | -- | --
(same as §3.1, `objective = true`)

Classic opinions | name_opinions (lineage) | Notes
-- | -- | --
child_spelling_no | subject_permid | shared prerequisite
child_no | target_permid | permid of the name_opinions record with oldpbdb_taxon_no = child_no
N/A | reason_id | 'misspelling' (curatorial token)
N/A | edge_class | 'lineage'
(same tail mapping)

**Skip-and-log** (live-probed): opinion_no 598389 has child_spelling_no = child_no = parent_spelling_no =
39016 — a single row that independently fails BOTH the concept self_reference check and the lineage
self_reference check, contributing zero inserted rows to either emission while counting once toward each
invariant's skip side.

> concept: 6 − 1 == 5 inserted. lineage: 6 − 1 == 5 inserted.

---

## 4. `invalid subgroup of` (6 pairs, 1,420 rows) → `name_opinions` concept edge (`reason='invalid subgroup'`, `objective=NULL`)

### 4.1 `invalid subgroup of` / `original spelling` — 1,316 rows

```sql
SELECT * FROM opinions WHERE status = 'invalid subgroup of' AND spelling_reason = 'original spelling';
```

Single-output pair — no lineage edge, no mistagged-label backfill logic present in this file.

Classic opinions | name_opinions (concept) | Notes
-- | -- | --
N/A | id | pk
N/A | permid | generated
authorizer_no | authorizer_person_id | FK to persons.legacyIDs.oldpbdbid = authorizer_no.
enterer_no | enterer_person_id | FK to persons.legacyIDs.oldpbdbid = enterer_no.
N/A | oldpbdb_taxon_no | NA
N/A | reason_id | 'invalid subgroup'
child_spelling_no | subject_permid | permid of the name_opinions record with oldpbdb_taxon_no = child_spelling_no
parent_spelling_no | target_permid | permid of the name_opinions record with oldpbdb_taxon_no = parent_spelling_no
N/A | edge_class | 'concept'
N/A | objective | NULL
N/A | new_name / rank_id / authority_id | NA
reference_no | reference_id | fk to refs.legacyIDs.oldpbdbid = reference_no.
basis | evidence | 'stated with evidence' = TRUE, else FALSE
pubyr | publication_year | second-hand override only (same rule as §1.1)
author1last, author2last, otherauthors, ref_has_opinion | attribution | opinionAttribution.schema.js
N/A | removed | false

**Skip-and-log:** no rows for `original-spelling.js` currently in `invalid-subgroup-of/anomalies.csv` —
structure only, buckets are `child_spelling_unresolved`, `parent_spelling_zero`, `parent_spelling_orphan`,
`self_reference`, `orphan_reference`.

> Reconciliation: inserted + sum(5 skip buckets) == 1,316 (enforced by a FATAL/exit(1) check in code).

### 4.2 `invalid subgroup of` / `correction` — 23 rows

```sql
SELECT * FROM opinions WHERE status = 'invalid subgroup of' AND spelling_reason = 'correction';
```

Dual emission; `orphan_reference`/`child_spelling_unresolved` shared, rest independent per emission.

Classic opinions | name_opinions (concept) | Notes
-- | -- | --
(same as §4.1)

Classic opinions | name_opinions (lineage) | Notes
-- | -- | --
child_spelling_no | subject_permid | shared prerequisite
child_no | target_permid | permid of the name_opinions record with oldpbdb_taxon_no = child_no
N/A | reason_id | 'correction'
N/A | edge_class | 'lineage'
(same tail mapping)

**Skip-and-log:** no rows for `correction.js` currently logged — structure only.

> concept: inserted + sum(orphan_reference, child_spelling_unresolved, parent_spelling_zero,
> parent_spelling_orphan, self_reference) == 23. lineage: inserted + sum(orphan_reference,
> child_spelling_unresolved, child_no_unresolved, self_reference) == 23.

### 4.3 `invalid subgroup of` / `rank change` — 43 rows

```sql
SELECT * FROM opinions WHERE status = 'invalid subgroup of' AND spelling_reason = 'rank change';
```

Same structure as §4.2; lineage reason token `'reranked'`.

Classic opinions | name_opinions (concept) | Notes
-- | -- | --
(same as §4.1)

Classic opinions | name_opinions (lineage) | Notes
-- | -- | --
child_spelling_no | subject_permid | shared prerequisite
child_no | target_permid | permid of the name_opinions record with oldpbdb_taxon_no = child_no
N/A | reason_id | 'reranked'
N/A | edge_class | 'lineage'
(same tail mapping)

**Skip-and-log:** no rows for `rank-change.js` currently logged — structure only.

> Same reconciliation shape as §4.2, against 43 source rows.

### 4.4 `invalid subgroup of` / `recombination` — 28 rows

```sql
SELECT * FROM opinions WHERE status = 'invalid subgroup of' AND spelling_reason = 'recombination';
```

Same structure as §4.2; lineage reason token `'recombination'`.

Classic opinions | name_opinions (concept) | Notes
-- | -- | --
(same as §4.1)

Classic opinions | name_opinions (lineage) | Notes
-- | -- | --
child_spelling_no | subject_permid | shared prerequisite
child_no | target_permid | permid of the name_opinions record with oldpbdb_taxon_no = child_no
N/A | reason_id | 'recombination'
N/A | edge_class | 'lineage'
(same tail mapping)

**Skip-and-log:** no rows for `recombination.js` currently logged — structure only.

> Same reconciliation shape as §4.2, against 28 source rows.

### 4.5 `invalid subgroup of` / `misspelling` — 8 rows

```sql
SELECT * FROM opinions WHERE status = 'invalid subgroup of' AND spelling_reason = 'misspelling';
```

Curatorial `'misspelling'` lineage token (not `'historical misspelling'`).

Classic opinions | name_opinions (concept) | Notes
-- | -- | --
(same as §4.1)

Classic opinions | name_opinions (lineage) | Notes
-- | -- | --
child_spelling_no | subject_permid | shared prerequisite
child_no | target_permid | permid of the name_opinions record with oldpbdb_taxon_no = child_no
N/A | reason_id | 'misspelling'
N/A | edge_class | 'lineage'
(same tail mapping)

**Skip-and-log** (live-probed, `invalid-subgroup-of/anomalies.csv` — the only file in this folder with a
live-logged row): 1 concept self_reference (opinion_no 546725: child_spelling_no = parent_spelling_no =
308149; child_no = parent_no = 305049 too — a same-taxon self-reference, `DESIGN.md` §3 bucket 2, no
action needed).

> concept: 8 − 1 == 7 inserted. lineage: 8 inserted (this row's own child_spelling_no likely ≠ child_no; not
> independently confirmed).

### 4.6 `invalid subgroup of` / `reassignment` — 2 rows

```sql
SELECT * FROM opinions WHERE status = 'invalid subgroup of' AND spelling_reason = 'reassignment';
```

Smallest pair in the folder; last of the six `invalid subgroup of` variants. Lineage token `'assignment'`.

Classic opinions | name_opinions (concept) | Notes
-- | -- | --
(same as §4.1)

Classic opinions | name_opinions (lineage) | Notes
-- | -- | --
child_spelling_no | subject_permid | shared prerequisite
child_no | target_permid | permid of the name_opinions record with oldpbdb_taxon_no = child_no
N/A | reason_id | 'assignment'
N/A | edge_class | 'lineage'
(same tail mapping)

**Skip-and-log:** no rows logged for `reassignment.js` — with only 2 source rows, structure only.

> Same reconciliation shape as §4.2, against 2 source rows.

---

## 5. `misspelling of` (1 pair, 875 rows) → `name_opinions` lineage edge only

### 5.1 `misspelling of` / `misspelling` — 875 rows

```sql
SELECT * FROM opinions WHERE status = 'misspelling of' AND spelling_reason = 'misspelling';
```

The only `spelling_reason` this status ever takes. Live-confirmed: `child_no = parent_no` for all 875
rows, but both are just same-name anchors (a misspelling isn't a distinct taxonomic concept) — **not
the target**. The real target is `parent_spelling_no`, the specific correct spelling this opinion
asserts `child_spelling_no` is a misspelling of; it differs from `child_no` in 104 of 875 rows
(corrected 2026-08-21, `docs/taxa-opinions-migration-mapping.md` §11 — real examples there, e.g.
`Caulastraea` misspelling of `Caulastrea`). **Single-output pair: no `assignment_opinions` row** — this
status asserts a spelling relationship, not containment, so there is no primary/lineage split to make.

Classic opinions | name_opinions (lineage) | Notes
-- | -- | --
N/A | id | pk
N/A | permid | generated
authorizer_no | authorizer_person_id | FK to persons.legacyIDs.oldpbdbid = authorizer_no.
enterer_no | enterer_person_id | FK to persons.legacyIDs.oldpbdbid = enterer_no.
N/A | oldpbdb_taxon_no | NA
N/A | reason_id | 'historical misspelling' — the dedicated token for a formally published misspelling claim (own reference, own evidence), distinct from the curatorial `'misspelling'` token used elsewhere
child_spelling_no | subject_permid | permid of the name_opinions record with oldpbdb_taxon_no = child_spelling_no
parent_spelling_no | target_permid | permid of the name_opinions record with oldpbdb_taxon_no = parent_spelling_no — **corrected 2026-08-21, was wrongly `child_no`, see above**
N/A | edge_class | 'lineage'
N/A | objective / new_name / rank_id / authority_id | NA
reference_no | reference_id | fk to refs.legacyIDs.oldpbdbid = reference_no.
basis | evidence | 'stated with evidence' = TRUE, else FALSE
pubyr | publication_year | second-hand override only (same rule as §1.1)
author1last, author2last, otherauthors, ref_has_opinion | attribution | opinionAttribution.schema.js
N/A | removed | false

**Skip-and-log** (live-probed, `misspelling-of/anomalies.csv`):

> ⚠ **SUPERSEDED, 2026-08-21.** The table below described the *old, wrong* `target = child_no`
> mapping. `child_spelling_no` is never equal to `parent_spelling_no` (0 of 875, live-confirmed), so
> under the corrected `target = parent_spelling_no` mapping **none of the 29 rows below are actually
> self-references** — they migrate as real lineage edges instead. See
> `docs/taxa-opinions-migration-mapping.md` §11 and `DESIGN.md` §3's corrected "lineage self-reference"
> writeup. Left in place per this project's decision-log convention; do not rely on the counts below.

Skip bucket | Rows | Cause
-- | --: | --
self_reference | 29 (**stale, see above**) | child_spelling_no == child_no despite status='misspelling of' — row carries no actual spelling deviation (`DESIGN.md` §3's "lineage self-reference" anomaly class — root cause traced to two sub-patterns: curators sometimes populate `spelling_reason`/status from the taxon's general nomenclatural history rather than this row's own pair, and this handler never even reads `parent_spelling_no`, which differs from `parent_no`/`child_no` on these rows anyway but is inert either way)
child_spelling_unresolved | ≥1 | child_spelling_no has no migrated permid
child_no_unresolved | — | child_no has no migrated permid
orphan_reference | — | reference_no not resolvable

> inserted + skipped(≥30, dominated by the 29 self_reference rows) == 875. **Stale per the note above** —
> the corrected handler re-checks `child_spelling_no == parent_spelling_no` (always false, live-confirmed),
> so `self_reference` is now expected to be 0 and `child_no_unresolved` is replaced by
> `parent_spelling_unresolved`. Re-run `misspelling-of/misspelling.js` to regenerate real counts.

---

## 6. `replaced by` (5 pairs, 4,020 rows) → `name_opinions` concept edge (`reason='replaced by'`, `objective=NULL`)

### 6.1 `replaced by` / `original spelling` — 3,706 rows

```sql
SELECT * FROM opinions WHERE status = 'replaced by' AND spelling_reason = 'original spelling';
```

Single hardcoded backfill instance (opinion_no 955925, not CSV-driven like §1.1's 50-row worklist) —
`child_spelling_no`="Metatheria" and `child_no`="Metatheria", same name+rank, different `taxon_no`: a
duplicate-or-homonym case, mapped to the generic `'assignment'` token (`MISTAGGED_LINEAGE_REASON`
hardcode, per `DESIGN.md` §3).

Classic opinions | name_opinions (concept) | Notes
-- | -- | --
N/A | id | pk
N/A | permid | generated
authorizer_no | authorizer_person_id | FK to persons.legacyIDs.oldpbdbid = authorizer_no.
enterer_no | enterer_person_id | FK to persons.legacyIDs.oldpbdbid = enterer_no.
N/A | oldpbdb_taxon_no | NA
N/A | reason_id | 'replaced by'
child_spelling_no | subject_permid | permid of the name_opinions record with oldpbdb_taxon_no = child_spelling_no
parent_spelling_no | target_permid | permid of the name_opinions record with oldpbdb_taxon_no = parent_spelling_no
N/A | edge_class | 'concept'
N/A | objective | NULL
N/A | new_name / rank_id / authority_id | NA
reference_no | reference_id | fk to refs.legacyIDs.oldpbdbid = reference_no.
basis | evidence | 'stated with evidence' = TRUE, else FALSE
pubyr | publication_year | second-hand override only (same rule as §1.1)
author1last, author2last, otherauthors, ref_has_opinion | attribution | opinionAttribution.schema.js
N/A | removed | false

**Backfill (opinion_no 955925 only) →**

Classic opinions | name_opinions (lineage) | Notes
-- | -- | --
child_spelling_no | subject_permid | 39936 ("Metatheria")
child_no | target_permid | 183662 ("Metatheria", different taxon_no)
N/A | reason_id | 'assignment' (hardcoded, `MISTAGGED_LINEAGE_REASON`)
N/A | edge_class | 'lineage'

**Skip-and-log** (live-probed, `replaced-by/anomalies.csv`):

Skip bucket | Rows | Cause
-- | --: | --
parent_spelling_orphan | 1 | opinion_no 568292, parent_spelling_no = 319663 has no migrated permid
self_reference | 1 | opinion_no 411824, child_spelling_no == parent_spelling_no (same-taxon: child_no == parent_no too)

> concept: 3,706 − (child_spelling_unresolved + parent_spelling_zero + 1 parent_spelling_orphan + 1
> self_reference + orphan_reference) == inserted. Backfill emits successfully for opinion_no 955925
> (`warning`/`mislabeled_original_spelling`), orthogonal to the concept edge's own reconciliation.

### 6.2 `replaced by` / `correction` — 50 rows

```sql
SELECT * FROM opinions WHERE status = 'replaced by' AND spelling_reason = 'correction';
```

Contains the **"convergent correction"** pattern (`DESIGN.md` §3): of the pair's 50 rows, 21 hit the
concept-edge `self_reference` skip (`child_spelling_no == parent_spelling_no`) — 12 are genuine
same-taxon self-reference (bad data), and **9 are the convergent-correction subtype**: `child_no !=
parent_no`, but the corrected spelling and the replaced-by target converge onto the same identity (e.g.
opinion_no 311631, *Tianchiasaurus* → *Tianchisaurus*, exactly what the opinion says it's replaced by;
opinion_no 722434, *Propithecia*, with the curator's own comment confirming an unavailable-name
replacement). This is a real nomenclatural pattern, not an anomaly — the skipped concept edge would only
restate the identity the lineage edge already carries, since the lineage edge fires normally for all 9
(`child_spelling_no != child_no` in each). **9 is a subset of the 21 concept self_reference skips**, not
of the pair's 50 rows as a whole; 29 of the 50 rows are ordinary successful concept-edge inserts.

Classic opinions | name_opinions (concept) | Notes
-- | -- | --
(same as §6.1)

Classic opinions | name_opinions (lineage) | Notes
-- | -- | --
child_spelling_no | subject_permid | shared prerequisite
child_no | target_permid | permid of the name_opinions record with oldpbdb_taxon_no = child_no
N/A | reason_id | 'correction'
N/A | edge_class | 'lineage'
(same tail mapping)

**Skip-and-log** (live-probed, `replaced-by/anomalies.csv`):

Skip bucket | Table | Rows | Cause
-- | -- | --: | --
self_reference | concept | 21 | child_spelling_no == parent_spelling_no (12 same-taxon bad-data + 9 convergent-correction, both bucket-verdicted as needing no action)
self_reference | lineage | 1 | opinion_no 487302, child_spelling_no == child_no despite spelling_reason='correction'

> concept: 50 − 21 == 29 inserted. lineage: 50 − 1 == 49 inserted.

### 6.3 `replaced by` / `rank change` — 96 rows

```sql
SELECT * FROM opinions WHERE status = 'replaced by' AND spelling_reason = 'rank change';
```

Same dual-output template; lineage token `'reranked'`. No convergent-correction analog here — all
self-reference skips found are plain same-taxon self-reference.

Classic opinions | name_opinions (concept) | Notes
-- | -- | --
(same as §6.1)

Classic opinions | name_opinions (lineage) | Notes
-- | -- | --
child_spelling_no | subject_permid | shared prerequisite
child_no | target_permid | permid of the name_opinions record with oldpbdb_taxon_no = child_no
N/A | reason_id | 'reranked'
N/A | edge_class | 'lineage'
(same tail mapping)

**Skip-and-log** (live-probed): 4 concept self_reference rows (opinion_no 546229, 707335, 713693,
923131 — all same-taxon, `child_no == parent_no` in each); 0 lineage-side anomalies found.

> concept: 96 − 4 == 92 inserted. lineage: 96 inserted.

### 6.4 `replaced by` / `recombination` — 160 rows

```sql
SELECT * FROM opinions WHERE status = 'replaced by' AND spelling_reason = 'recombination';
```

Same dual-output template; lineage token `'recombination'`.

Classic opinions | name_opinions (concept) | Notes
-- | -- | --
(same as §6.1)

Classic opinions | name_opinions (lineage) | Notes
-- | -- | --
child_spelling_no | subject_permid | shared prerequisite
child_no | target_permid | permid of the name_opinions record with oldpbdb_taxon_no = child_no
N/A | reason_id | 'recombination'
N/A | edge_class | 'lineage'
(same tail mapping)

**Skip-and-log** (live-probed): 9 concept self_reference rows (opinion_no 461476, 501081, 624172, 624174,
673610, 686905, 810161, 949805, 978902 — all same-taxon); 0 lineage-side anomalies found.

> concept: 160 − 9 == 151 inserted. lineage: 160 inserted.

### 6.5 `replaced by` / `misspelling` — 8 rows

```sql
SELECT * FROM opinions WHERE status = 'replaced by' AND spelling_reason = 'misspelling';
```

Last of the five `replaced by` variants; smallest pair in the folder.

Classic opinions | name_opinions (concept) | Notes
-- | -- | --
(same as §6.1)

Classic opinions | name_opinions (lineage) | Notes
-- | -- | --
child_spelling_no | subject_permid | shared prerequisite
child_no | target_permid | permid of the name_opinions record with oldpbdb_taxon_no = child_no
N/A | reason_id | 'misspelling' (curatorial token)
N/A | edge_class | 'lineage'
(same tail mapping)

**Skip-and-log:** no rows for `misspelling.js` currently logged — structure only, likely near-clean given
the small row count.

> concept: inserted + skipped == 8. lineage: inserted + skipped == 8.

---

## 7. `nomen dubium` (5 pairs, 8,208 rows) → `validity_opinions` (`nomenclatural_status = 'nomen dubium'`, `bars_candidacy = false`)

Doubt about a name's quality/diagnosability, not an act of invalidation — recorded for the record, never
consulted by `derive_taxa()`. The legacy `parent_no`/`parent_spelling_no` target is read from source but
never consulted: `validity_opinions` carries no target column at all (7,245 of 8,208 legacy targets
dropped project-wide, per `create_new.sql`'s accepted-loss rationale).

### 7.1 `nomen dubium` / `original spelling` — 7,463 rows

```sql
SELECT * FROM opinions WHERE status = 'nomen dubium' AND spelling_reason = 'original spelling';
```

Single-output pair — no lineage edge.

Classic opinions | validity_opinions | Notes
-- | -- | --
N/A | id | pk
N/A | permid | generated
authorizer_no | authorizer_person_id | FK to persons.legacyIDs.oldpbdbid = authorizer_no.
enterer_no | enterer_person_id | FK to persons.legacyIDs.oldpbdbid = enterer_no.
child_spelling_no | subject_permid | permid of the name_opinions record with oldpbdb_taxon_no = child_spelling_no
N/A | nomenclatural_status_id | fk to dictionaries.nomenclatural_statuses = 'nomen dubium'
reference_no | reference_id | fk to refs.legacyIDs.oldpbdbid = reference_no.
basis | evidence | 'stated with evidence' = TRUE, else FALSE
pubyr | publication_year | second-hand override only (same rule as §1.1)
author1last, author2last, otherauthors, ref_has_opinion | attribution | opinionAttribution.schema.js
N/A | removed | false

**Skip-and-log:** live-validated, zero rows for `original-spelling.js` anywhere in
`nomen-dubium/anomalies.csv`.

> inserted (7,463) + skipped (0) == 7,463 — live-confirmed clean.

### 7.2 `nomen dubium` / `correction` — 73 rows

```sql
SELECT * FROM opinions WHERE status = 'nomen dubium' AND spelling_reason = 'correction';
```

Dual emission; `validity_opinions` and the lineage edge share only the reference/`child_spelling_no`
prerequisites, resolved/skipped independently otherwise.

Classic opinions | validity_opinions | Notes
-- | -- | --
(same as §7.1)

Classic opinions | name_opinions (lineage) | Notes
-- | -- | --
child_spelling_no | subject_permid | shared prerequisite
child_no | target_permid | permid of the name_opinions record with oldpbdb_taxon_no = child_no
N/A | reason_id | 'correction'
N/A | edge_class | 'lineage'
(same tail mapping)

**Skip-and-log** (live-probed, `nomen-dubium/anomalies.csv`): 4 lineage self_reference rows (opinion_no
46633, 46634, 46635, 46636 — all sharing child_no/child_spelling_no = 44389); 0 validity_opinions skips.

> validity: 73 inserted + 0 skipped == 73. lineage: 73 − 4 == 69 inserted + 4 skipped == 73.

### 7.3 `nomen dubium` / `rank change` — 8 rows

```sql
SELECT * FROM opinions WHERE status = 'nomen dubium' AND spelling_reason = 'rank change';
```

Last of the five `nomen dubium` variants. Lineage token `'reranked'`.

Classic opinions | validity_opinions | Notes
-- | -- | --
(same as §7.1)

Classic opinions | name_opinions (lineage) | Notes
-- | -- | --
child_spelling_no | subject_permid | shared prerequisite
child_no | target_permid | permid of the name_opinions record with oldpbdb_taxon_no = child_no
N/A | reason_id | 'reranked'
N/A | edge_class | 'lineage'
(same tail mapping)

**Skip-and-log:** live-validated, zero anomalies of any kind for `rank-change.js`.

> validity: 8 + 0 == 8. lineage: 8 + 0 == 8.

### 7.4 `nomen dubium` / `recombination` — 573 rows

```sql
SELECT * FROM opinions WHERE status = 'nomen dubium' AND spelling_reason = 'recombination';
```

Lineage token `'recombination'`.

Classic opinions | validity_opinions | Notes
-- | -- | --
(same as §7.1)

Classic opinions | name_opinions (lineage) | Notes
-- | -- | --
child_spelling_no | subject_permid | shared prerequisite
child_no | target_permid | permid of the name_opinions record with oldpbdb_taxon_no = child_no
N/A | reason_id | 'recombination'
N/A | edge_class | 'lineage'
(same tail mapping)

**Skip-and-log** (live-probed): 1 lineage self_reference (opinion_no 412032, taxon 201288); 0
validity_opinions skips.

> validity: 573 + 0 == 573. lineage: 573 − 1 == 572 inserted + 1 skipped == 573.

### 7.5 `nomen dubium` / `misspelling` — 91 rows

```sql
SELECT * FROM opinions WHERE status = 'nomen dubium' AND spelling_reason = 'misspelling';
```

Curatorial `'misspelling'` lineage token.

Classic opinions | validity_opinions | Notes
-- | -- | --
(same as §7.1)

Classic opinions | name_opinions (lineage) | Notes
-- | -- | --
child_spelling_no | subject_permid | shared prerequisite
child_no | target_permid | permid of the name_opinions record with oldpbdb_taxon_no = child_no
N/A | reason_id | 'misspelling'
N/A | edge_class | 'lineage'
(same tail mapping)

**Skip-and-log** (live-probed): 2 lineage self_reference rows (opinion_no 103239, 427169, both taxon
68309); 0 validity_opinions skips.

> validity: 91 + 0 == 91. lineage: 91 − 2 == 89 inserted + 2 skipped == 91.

---

## 8. `nomen nudum` (5 pairs, 2,533 rows) → `validity_opinions` (`nomenclatural_status = 'nomen nudum'`, `bars_candidacy = true`)

The only `nomenclatural_statuses` token with `bars_candidacy = true`: `derive_taxa()` computes the
winning validity opinion per `subject_permid` and, if it's `nomen nudum`, bars that permid from winning
its lineage's accepted-spelling contest — the sole `derive()` effect in this whole family. Legacy target
(`parent_no`/`parent_spelling_no`) dropped, same as §7 (2,430 of 2,533 legacy targets dropped
project-wide).

### 8.1 `nomen nudum` / `original spelling` — 2,393 rows

```sql
SELECT * FROM opinions WHERE status = 'nomen nudum' AND spelling_reason = 'original spelling';
```

Single-output pair.

Classic opinions | validity_opinions | Notes
-- | -- | --
N/A | id | pk
N/A | permid | generated
authorizer_no | authorizer_person_id | FK to persons.legacyIDs.oldpbdbid = authorizer_no.
enterer_no | enterer_person_id | FK to persons.legacyIDs.oldpbdbid = enterer_no.
child_spelling_no | subject_permid | permid of the name_opinions record with oldpbdb_taxon_no = child_spelling_no
N/A | nomenclatural_status_id | fk to dictionaries.nomenclatural_statuses = 'nomen nudum'
reference_no | reference_id | fk to refs.legacyIDs.oldpbdbid = reference_no.
basis | evidence | 'stated with evidence' = TRUE, else FALSE
pubyr | publication_year | second-hand override only (same rule as §1.1)
author1last, author2last, otherauthors, ref_has_opinion | attribution | opinionAttribution.schema.js
N/A | removed | false

**Skip-and-log:** live-validated, zero anomalies for `original-spelling.js`.

> inserted (2,393) + skipped (0) == 2,393 — live-confirmed clean.

### 8.2 `nomen nudum` / `correction` — 11 rows

```sql
SELECT * FROM opinions WHERE status = 'nomen nudum' AND spelling_reason = 'correction';
```

Classic opinions | validity_opinions | Notes
-- | -- | --
(same as §8.1)

Classic opinions | name_opinions (lineage) | Notes
-- | -- | --
child_spelling_no | subject_permid | shared prerequisite
child_no | target_permid | permid of the name_opinions record with oldpbdb_taxon_no = child_no
N/A | reason_id | 'correction'
N/A | edge_class | 'lineage'
(same tail mapping)

**Skip-and-log:** live-validated, zero anomalies for `correction.js`.

> validity: 11 + 0 == 11. lineage: 11 + 0 == 11.

### 8.3 `nomen nudum` / `rank change` — 2 rows

```sql
SELECT * FROM opinions WHERE status = 'nomen nudum' AND spelling_reason = 'rank change';
```

Smallest pair in the folder; last of the five `nomen nudum` variants.

Classic opinions | validity_opinions | Notes
-- | -- | --
(same as §8.1)

Classic opinions | name_opinions (lineage) | Notes
-- | -- | --
child_spelling_no | subject_permid | shared prerequisite
child_no | target_permid | permid of the name_opinions record with oldpbdb_taxon_no = child_no
N/A | reason_id | 'reranked'
N/A | edge_class | 'lineage'
(same tail mapping)

**Skip-and-log:** live-validated, zero anomalies.

> validity: 2 + 0 == 2. lineage: 2 + 0 == 2.

### 8.4 `nomen nudum` / `recombination` — 91 rows

```sql
SELECT * FROM opinions WHERE status = 'nomen nudum' AND spelling_reason = 'recombination';
```

Classic opinions | validity_opinions | Notes
-- | -- | --
(same as §8.1)

Classic opinions | name_opinions (lineage) | Notes
-- | -- | --
child_spelling_no | subject_permid | shared prerequisite
child_no | target_permid | permid of the name_opinions record with oldpbdb_taxon_no = child_no
N/A | reason_id | 'recombination'
N/A | edge_class | 'lineage'
(same tail mapping)

**Skip-and-log:** live-validated, zero anomalies for `recombination.js`.

> validity: 91 + 0 == 91. lineage: 91 + 0 == 91.

### 8.5 `nomen nudum` / `misspelling` — 36 rows

```sql
SELECT * FROM opinions WHERE status = 'nomen nudum' AND spelling_reason = 'misspelling';
```

Classic opinions | validity_opinions | Notes
-- | -- | --
(same as §8.1)

Classic opinions | name_opinions (lineage) | Notes
-- | -- | --
child_spelling_no | subject_permid | shared prerequisite
child_no | target_permid | permid of the name_opinions record with oldpbdb_taxon_no = child_no
N/A | reason_id | 'misspelling'
N/A | edge_class | 'lineage'
(same tail mapping)

**Skip-and-log** (live-probed): 2 lineage self_reference rows (opinion_no 93315 → taxon 65101, opinion_no
93316 → taxon 52995 — two distinct taxa, unlike the single-taxon clusters seen in §7.2/§7.5); 0
validity_opinions skips.

> validity: 36 + 0 == 36. lineage: 36 − 2 == 34 inserted + 2 skipped == 36.

---

## 9. `nomen oblitum` (4 pairs, 76 rows) → per-row branch: `name_opinions` concept fold (targeted) / `validity_opinions` (untargeted), + lineage backfill

`parent_no != 0` (targeted) → `name_opinions` concept fold (`reason='nomen oblitum'`, Classic's own
`getSeniorSynonym` folding the forgotten senior name into the protected junior name's concept, the same
senior-synonym chase as ordinary synonymy). `parent_no = 0` (untargeted, no recorded protectum) →
`validity_opinions` testimony (`bars_candidacy=false`, no `derive()` effect — treated like nomen
dubium/vanum). This branch is decided **per row**, orthogonal to whether the row also carries a
`spelling_reason != 'original spelling'` lineage edge (dual emission, independent of the branch).

### 9.1 `nomen oblitum` / `original spelling` — 66 rows

```sql
SELECT * FROM opinions WHERE status = 'nomen oblitum' AND spelling_reason = 'original spelling';
```

No lineage output at all (unlike the other 3 pairs in this folder) — `original spelling` carries no
spelling-deviation claim to record.

Classic opinions | name_opinions (concept, targeted only) | Notes
-- | -- | --
N/A | id | pk
N/A | permid | generated
authorizer_no | authorizer_person_id | FK to persons.legacyIDs.oldpbdbid = authorizer_no.
enterer_no | enterer_person_id | FK to persons.legacyIDs.oldpbdbid = enterer_no.
N/A | oldpbdb_taxon_no | NA
N/A | reason_id | 'nomen oblitum'
child_spelling_no | subject_permid | permid of the name_opinions record with oldpbdb_taxon_no = child_spelling_no
parent_spelling_no | target_permid | permid of the name_opinions record with oldpbdb_taxon_no = parent_spelling_no
N/A | edge_class | 'concept'
N/A | objective | NULL
reference_no | reference_id | fk to refs.legacyIDs.oldpbdbid = reference_no.
basis | evidence | 'stated with evidence' = TRUE, else FALSE
pubyr | publication_year | second-hand override only (same rule as §1.1)
author1last, author2last, otherauthors, ref_has_opinion | attribution | opinionAttribution.schema.js
N/A | removed | false

Classic opinions | validity_opinions (untargeted only) | Notes
-- | -- | --
child_spelling_no | subject_permid | permid of the name_opinions record with oldpbdb_taxon_no = child_spelling_no
N/A | nomenclatural_status_id | fk to dictionaries.nomenclatural_statuses = 'nomen oblitum'
(same reference/evidence/pubyr/attribution/removed tail mapping)

**Skip-and-log:** `nomen-oblitum/anomalies.csv` currently has zero data rows across the whole folder — no
anomaly has been logged for any of its 4 handlers. Skip buckets by branch: concept — `child_spelling_unresolved`,
`parent_spelling_orphan`, `self_reference`, `orphan_reference`; validity — `child_spelling_unresolved`,
`orphan_reference`.

> Three independent reconciliations enforced in code: concept inserted + concept skipped ==
> targetedCount; validity inserted + validity skipped == untargetedCount; targetedCount + untargetedCount
> == 66. The targeted/untargeted split of the 66 rows is not independently determinable without live
> execution beyond the (empty) probe csv.

### 9.2 `nomen oblitum` / `correction` — 3 rows

```sql
SELECT * FROM opinions WHERE status = 'nomen oblitum' AND spelling_reason = 'correction';
```

Same per-row branch as §9.1, PLUS an always-attempted lineage edge (dual emission, orthogonal to the
branch — every row tries the lineage edge regardless of which of concept/validity fired).

Classic opinions | name_opinions (concept, targeted) | Notes
-- | -- | --
(same as §9.1's concept table)

Classic opinions | validity_opinions (untargeted) | Notes
-- | -- | --
(same as §9.1's validity table)

Classic opinions | name_opinions (lineage, all rows) | Notes
-- | -- | --
child_spelling_no | subject_permid | permid of the name_opinions record with oldpbdb_taxon_no = child_spelling_no
child_no | target_permid | permid of the name_opinions record with oldpbdb_taxon_no = child_no
N/A | reason_id | 'correction'
N/A | edge_class | 'lineage'
(same tail mapping)

**Skip-and-log:** zero data rows in `nomen-oblitum/anomalies.csv` for `correction.js`.

> Three independent reconciliations, as in §9.1, plus a fourth for the lineage edge: lineage inserted +
> lineage skipped == 3 (all rows, regardless of branch).

### 9.3 `nomen oblitum` / `misspelling` — 1 row

```sql
SELECT * FROM opinions WHERE status = 'nomen oblitum' AND spelling_reason = 'misspelling';
```

Last of the four `nomen oblitum` variants — the smallest pair in the entire 48-pair migration alongside
§10.4. Same structure as §9.2; lineage token `'misspelling'` (curatorial).

Classic opinions | name_opinions (concept, targeted) | Notes
-- | -- | --
(same as §9.1's concept table)

Classic opinions | validity_opinions (untargeted) | Notes
-- | -- | --
(same as §9.1's validity table)

Classic opinions | name_opinions (lineage, all rows) | Notes
-- | -- | --
child_spelling_no | subject_permid | permid of the name_opinions record with oldpbdb_taxon_no = child_spelling_no
child_no | target_permid | permid of the name_opinions record with oldpbdb_taxon_no = child_no
N/A | reason_id | 'misspelling'
N/A | edge_class | 'lineage'
(same tail mapping)

**Skip-and-log:** zero data rows in `nomen-oblitum/anomalies.csv` for `misspelling.js`. With only 1
source row, every branch/emission resolves to either 0 or 1 in practice.

> Same four-way reconciliation shape as §9.2, against 1 source row.

### 9.4 `nomen oblitum` / `recombination` — 6 rows

```sql
SELECT * FROM opinions WHERE status = 'nomen oblitum' AND spelling_reason = 'recombination';
```

Combines both special cases of this folder: the targeted/untargeted `parent_no` branch AND the
dual-emission lineage edge.

Classic opinions | name_opinions (concept, targeted) | Notes
-- | -- | --
(same as §9.1's concept table)

Classic opinions | validity_opinions (untargeted) | Notes
-- | -- | --
(same as §9.1's validity table)

Classic opinions | name_opinions (lineage, all rows) | Notes
-- | -- | --
child_spelling_no | subject_permid | permid of the name_opinions record with oldpbdb_taxon_no = child_spelling_no
child_no | target_permid | permid of the name_opinions record with oldpbdb_taxon_no = child_no
N/A | reason_id | 'recombination'
N/A | edge_class | 'lineage'
(same tail mapping)

**Skip-and-log:** zero data rows in `nomen-oblitum/anomalies.csv` for `recombination.js`.

> Same four-way reconciliation shape as §9.2, against 6 source rows.

---

## 10. `nomen vanum` (5 pairs, 569 rows) → `validity_opinions` (`nomenclatural_status = 'nomen vanum'`, `bars_candidacy = false`)

Doubt about a name's quality, not invalidation — same treatment as `nomen dubium` (§7), never consulted
by `derive_taxa()`. No `rank change` variant exists for this status (only 5 files: original-spelling,
correction, misspelling, recombination, reassignment). Legacy target dropped (469 of 569 rows had one,
per `create_new.sql`'s accepted-loss rationale) — none of the 5 handlers in this folder reference
`parent_no`/`parent_spelling_no` downstream even though all select them.

### 10.1 `nomen vanum` / `original spelling` — 509 rows

```sql
SELECT * FROM opinions WHERE status = 'nomen vanum' AND spelling_reason = 'original spelling';
```

Single-output pair.

Classic opinions | validity_opinions | Notes
-- | -- | --
N/A | id | pk
N/A | permid | generated
authorizer_no | authorizer_person_id | FK to persons.legacyIDs.oldpbdbid = authorizer_no.
enterer_no | enterer_person_id | FK to persons.legacyIDs.oldpbdbid = enterer_no.
child_spelling_no | subject_permid | permid of the name_opinions record with oldpbdb_taxon_no = child_spelling_no
N/A | nomenclatural_status_id | fk to dictionaries.nomenclatural_statuses = 'nomen vanum'
reference_no | reference_id | fk to refs.legacyIDs.oldpbdbid = reference_no.
basis | evidence | 'stated with evidence' = TRUE, else FALSE
pubyr | publication_year | second-hand override only (same rule as §1.1)
author1last, author2last, otherauthors, ref_has_opinion | attribution | opinionAttribution.schema.js
N/A | removed | false

**Skip-and-log:** `nomen-vanum/anomalies.csv` is currently header-only (zero data rows for any of the
folder's 5 handlers) — structure only.

> inserted + skipped(child_spelling_unresolved, orphan_reference) == 509.

### 10.2 `nomen vanum` / `correction` — 4 rows

```sql
SELECT * FROM opinions WHERE status = 'nomen vanum' AND spelling_reason = 'correction';
```

Dual emission; `validity_opinions` and the lineage edge share only the reference/`child_spelling_no`
prerequisite gate.

Classic opinions | validity_opinions | Notes
-- | -- | --
(same as §10.1)

Classic opinions | name_opinions (lineage) | Notes
-- | -- | --
child_spelling_no | subject_permid | shared prerequisite
child_no | target_permid | permid of the name_opinions record with oldpbdb_taxon_no = child_no
N/A | reason_id | 'correction'
N/A | edge_class | 'lineage'
(same tail mapping)

**Skip-and-log:** zero data rows logged — structure only, against 4 source rows.

> validity: inserted + skipped == 4. lineage: inserted + skipped(child_no_unresolved, self_reference,
> shared gates) == 4.

### 10.3 `nomen vanum` / `misspelling` — 6 rows

```sql
SELECT * FROM opinions WHERE status = 'nomen vanum' AND spelling_reason = 'misspelling';
```

Curatorial `'misspelling'` lineage token.

Classic opinions | validity_opinions | Notes
-- | -- | --
(same as §10.1)

Classic opinions | name_opinions (lineage) | Notes
-- | -- | --
child_spelling_no | subject_permid | shared prerequisite
child_no | target_permid | permid of the name_opinions record with oldpbdb_taxon_no = child_no
N/A | reason_id | 'misspelling'
N/A | edge_class | 'lineage'
(same tail mapping)

**Skip-and-log:** zero data rows logged — structure only, against 6 source rows.

### 10.4 `nomen vanum` / `recombination` — 49 rows

```sql
SELECT * FROM opinions WHERE status = 'nomen vanum' AND spelling_reason = 'recombination';
```

Largest pair in the folder.

Classic opinions | validity_opinions | Notes
-- | -- | --
(same as §10.1)

Classic opinions | name_opinions (lineage) | Notes
-- | -- | --
child_spelling_no | subject_permid | shared prerequisite
child_no | target_permid | permid of the name_opinions record with oldpbdb_taxon_no = child_no
N/A | reason_id | 'recombination'
N/A | edge_class | 'lineage'
(same tail mapping)

**Skip-and-log:** zero data rows logged — structure only, against 49 source rows.

### 10.5 `nomen vanum` / `reassignment` — 1 row

```sql
SELECT * FROM opinions WHERE status = 'nomen vanum' AND spelling_reason = 'reassignment';
```

The smallest pair in the entire 48-pair migration alongside §9.3, and per its own header comment "the
last of all 48 pairs" implemented. Lineage token is the generic `'assignment'` (no `'reassignment'`
dictionary token exists anywhere in this migration).

Classic opinions | validity_opinions | Notes
-- | -- | --
(same as §10.1)

Classic opinions | name_opinions (lineage) | Notes
-- | -- | --
child_spelling_no | subject_permid | shared prerequisite
child_no | target_permid | permid of the name_opinions record with oldpbdb_taxon_no = child_no
N/A | reason_id | 'assignment'
N/A | edge_class | 'lineage'
(same tail mapping)

**Skip-and-log:** zero data rows logged — structure only, against the pair's single source row.

---

## Appendix: row-count reconciliation

Folder | Pairs | Rows
-- | --: | --:
belongs to | 6 | 927,512
subjective synonym of | 6 | 52,106
objective synonym of | 5 | 1,246
invalid subgroup of | 6 | 1,420
misspelling of | 1 | 875
replaced by | 5 | 4,020
nomen dubium | 5 | 8,208
nomen nudum | 5 | 2,533
nomen oblitum | 4 | 76
nomen vanum | 5 | 569
**Total** | **48** | **998,565**

Matches `DESIGN.md` §4's stated total exactly, and the nomen-family subtotals (8,208 / 2,533 / 76 / 569)
match `postgresql/create_new.sql`'s header-comment target-drop figures for `nomen dubium`/`nomen
nudum`/`nomen oblitum` (untargeted residue)/`nomen vanum` respectively — cross-checked here as a
consistency signal, not independently re-verified against a live query.

**A note on skip-bucket completeness.** Every pair's skip-bucket *structure* (which failure modes exist,
what table they block) is derived directly from each handler's own source code and is exact. Exact
*counts* are given wherever a folder's `anomalies.csv` currently carries live-probed rows for that
specific script; where a script has no rows in the current CSV, this document says so explicitly rather
than assuming zero — the CSV is a gitignored, per-script-rebuilt artifact (`DESIGN.md` §5), so an empty
result can mean either "clean" or "not re-probed since the last flush."
