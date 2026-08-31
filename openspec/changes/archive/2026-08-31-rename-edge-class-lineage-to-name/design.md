## Context

`dictionaries.namechange_reasons.edge_class` is a three-valued discriminator — `'root'` |
`'lineage'` | `'concept'` — that tells `derive_taxa()` which of its two union-finds a
`name_opinions` edge feeds. It is denormalized onto every `name_opinions` row and FK-pinned via the
composite `(reason_id, edge_class) → namechange_reasons (id, edge_class)`, which is what lets the
`name_opinion_shape` rule be a plain same-row CHECK (Way 2 / A1, §10.6 D9).

The word "lineage" carries two distinct meanings in this codebase today:

```
  name_opinions rows                     derive_taxa()
  ┌────────────────────┐                 ┌──────────────────────────┐
  │ edge_class         │   feeds         │ _dt_lin union-find       │
  │  'lineage'  ───────┼────────────────▶│  → components            │
  │                    │                 │  → original_permid       │  ≈ orig_no
  └────────────────────┘                 └──────────────────────────┘
     MEANING 1                              MEANING 2
     "an edge relating two               "a name-lineage: the set of
      spellings of one name"              spellings grouped together"
     ── renamed to 'name' ──             ── stays "lineage" ──
```

Meaning 2 is correct and pervasive (`_dt_lin`, `_dtc_lineage`, `place_in_lineage()`, "a lineage's
accepted spelling", ~60 comment uses in `create_new.sql`). Only meaning 1 is being renamed. After
the change the relationship reads more clearly, not less: **name edges build name-lineages.**

The change lands while the opinions migration is still re-run from scratch, so no deployed data has
to be rewritten.

## Goals / Non-Goals

**Goals:**

- Rename the `edge_class` value `'lineage'` → `'name'` across the schema, the derive functions, the
  migration script, the live tests, and the normative specs.
- Keep behavior bit-for-bit identical: same rows written, same `derive_taxa()` output.
- Establish and apply one unambiguous rule for which prose occurrences of "lineage" move and which
  stay.
- Keep `reset-opinions.sql` and `postgresql/create_new.sql` in lockstep.

**Non-Goals:**

- Re-cutting the `edge_class` triple. `'root'` stays as-is (see Decision 2).
- Renaming the reason tokens (`correction`, `reranked`, `recombination`, `assignment`,
  `misspelling`, `historical misspelling`), `never_accepted`, or any column.
- Renaming derived-component identifiers: `_dt_lin*`, `_dtc_lineage`, `_dtc_permid_lineage`,
  `place_in_lineage()`, `original_permid`.
- An in-place data migration for environments that already hold `name_opinions` rows (sketched
  under Migration Plan, deliberately not implemented).
- Touching `migration_exploration/**`, `taxa-opinions-draft.sql`, or the
  `src/opinions-migration/tests/cross-check-*.js` routines and their reports.

## Decisions

### Decision 1: `'name'` over the alternatives

Chosen because it aligns with TDWG TCS, which splits **NameRelationship** from
**TaxonConceptRelationship** — precisely the distinction this column encodes. The resulting pair
`'name'` | `'concept'` maps onto that split one-to-one.

*Alternatives considered:* `'spelling'` — accurate for most rows (recombination, correction,
misspelling) but wrong for `reranked` and `assignment`, which change no spelling; also no standards
anchor. `'orthography'` — same defect, narrower. Keeping `'lineage'` — rejected: it collides with
the derived component, which is the whole problem. `'name'` is imprecise in its own way (a root row
is also about a name), and we accept that; it is more accurate than `'lineage'` and it is the
standards-aligned choice.

### Decision 2: `'root'` stays

`'root'` is arguably also a name-class row, which makes `WHERE edge_class IN ('root','name')`
(`create_new.sql` L5108) read like a category error even though it is correct. We keep it anyway:

- A root row **mints identity** (`new_name` + `rank_id` set, no target) rather than asserting a
  relationship. In TCS terms it is closer to a name-usage/protonym than to either relationship
  family, so no relationship-family token fits it.
- Re-cutting the triple would ripple into `name-opinions-migration` and
  `migrate-authorities-opinions.js`, which are currently untouched by this change, and would turn a
  mechanical rename into a model change.

Mitigation for the readability cost: the comment above L5108 already explains that root rows carry
no target and can never contribute a union-find edge. That comment is updated to make the
root-is-also-name-shaped point explicit, so the enum reads as `{mint, name-relationship,
concept-relationship}`.

### Decision 3: The vocabulary rule

One rule decides every prose occurrence:

| Occurrence means… | Example | Action |
|---|---|---|
| the **edge class** | "lineage edge", "lineage backfill", "lineage reason token", "`lineage`-class" | → **name** |
| the **derived component** | "name-lineage", "the lineage union-find", "a lineage's accepted spelling", `_dt_lin`, `place_in_lineage()` | **stays** |

Applied per-occurrence, not by find-and-replace. `create_new.sql`'s derive comments are
overwhelmingly the second kind and mostly stay; `openspec/specs/opinions-migration/spec.md` is
overwhelmingly the first kind and mostly moves.

### Decision 4: Reset-then-migrate, not an in-place UPDATE

Because `edge_class` is pinned onto every `name_opinions` row under a composite FK, changing the
dictionary alone breaks the FK for every affected row. Rather than write and test a constraint-
juggling migration nobody needs yet, this change takes the path already in use for opinions work:
`reset-opinions.sql` then `migrate-opinions.js`. See Migration Plan for the in-place sketch.

### Decision 5: Behavior-preservation is verified by comparison, not by assertion

The rename is only safe if `derive_taxa()` produces identical output. Rather than reason about it,
capture a baseline before touching anything and diff after. The rename touches two `derive_taxa()`
predicates and no logic, so any diff is a bug in the rename.

### Decision 6: Both SQL files change in the same task

`reset-opinions.sql` carries its own independent copy of the table definition, CHECK constraint,
and seed rows — it is not an include. Splitting them across tasks invites a half-applied rename
where the reset path seeds `'name'` and `create_new.sql` still checks for `'lineage'` (or the
reverse), which fails only at migration time with a confusing constraint violation. The tasks keep
them together and a verification step greps both for any surviving `'lineage'` literal.

## Risks / Trade-offs

- **A stray `'lineage'` literal survives in a CHECK or seed** → the composite FK or
  `name_opinion_shape` rejects every name-class insert at migration time. Mitigated by Decision 6's
  paired edits plus a repo-wide grep for `'lineage'` as a quoted literal, scoped to the live
  surface, as an explicit verification task.

- **Find-and-replace over-reach renames the derived component** → `_dt_lin`, `place_in_lineage()`,
  or "a lineage's accepted spelling" get mangled, breaking `derive_taxa()` or corrupting the
  vocabulary the design docs depend on. Mitigated by Decision 3's per-occurrence rule and by
  reviewing the `create_new.sql` diff specifically for changes outside the five value sites.

- **`derive_taxa()` output silently shifts** → taxonomy identity (`original_permid`,
  `accepted_spelling_permid`, `concept_permid`) changes for real taxa. Mitigated by Decision 5's
  before/after baseline diff, which is a blocking task, not an optional check.

- **`'root'` + `'name'` reads oddly to a future reader** (accepted trade-off, Decision 2) →
  mitigated by the updated comment, not by further renaming.

- **Docs and specs drift out of sync with the schema** → the design docs are the source of truth
  for this model and a half-renamed doc is worse than an unrenamed one. Mitigated by treating the
  spec deltas and doc updates as required tasks in the same change, not follow-ups.

- **The drive-by ten-vs-eleven token fix expands scope** → it is one line on a line already being
  edited, and leaving a known-wrong count in a spec being touched is worse. Bounded to that line.

## Migration Plan

**This change (dev/localhost):**

1. Capture the `derive_taxa()` baseline (per-`edge_class` counts; `original_permid` /
   `accepted_spelling_permid` / `concept_permid` per permid).
2. Apply the schema, code, test, spec, and doc edits.
3. Run `reset-opinions.sql`, then `migrate-opinions.js`.
4. Run `derive_taxa()` and diff against the baseline. Any difference blocks the change.

**Rollback:** revert the commit and re-run reset + migrate. No data is at risk — the opinions
tables are rebuilt from MariaDB on every run, so the rename is fully reversible at this stage.

**For a future environment holding real `name_opinions` data** (not implemented here). The
composite FK means the dictionary and the row copies must move together, in one transaction:

```sql
BEGIN;
ALTER TABLE name_opinions DROP CONSTRAINT name_opinions_reason_id_edge_class_fkey;
ALTER TABLE name_opinions DROP CONSTRAINT name_opinion_shape;
ALTER TABLE dictionaries.namechange_reasons
  DROP CONSTRAINT namechange_reasons_edge_class_check;

UPDATE dictionaries.namechange_reasons SET edge_class = 'name' WHERE edge_class = 'lineage';
UPDATE name_opinions                   SET edge_class = 'name' WHERE edge_class = 'lineage';

-- re-add all three constraints with 'name' in place of 'lineage'
COMMIT;
```

Note the ordering constraint: the `edge_class` CHECK on the dictionary must be dropped before its
`UPDATE`, and both `UPDATE`s must precede re-adding the FK. `derive_taxa()` must be redefined in
the same deployment, since its two predicates would otherwise match nothing and every permid would
fall out of its lineage.

## Open Questions

None blocking. One deferred: whether `'root'` should eventually be re-cut now that the enum reads
as `{mint, name-relationship, concept-relationship}` (Decision 2). Revisit only if a second
mint-shaped reason token ever appears; a single-member class is not yet a problem.
