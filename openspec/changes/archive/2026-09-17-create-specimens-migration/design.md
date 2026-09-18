## Context

Classic `specimens` (167,150 rows, MyISAM) is the last large core entity with a target table defined in
`postgresql/create_new.sql` and no migration behind it. Its mapping in
`payloadSchemas/mappings/specimens.md` was settled over an exploration pass that also profiled the source
data; this design records what that profiling found and the decisions it forced.

Three properties of the source drive nearly every decision here.

**The table is bimodal.** Every row hangs off either an occurrence or a taxon, almost never both:

```
                       167,150 classic specimens
                                  │
       ┌──────────────────────────┴──────────────────────────┐
       │                                                     │
 occurrence-mode                                        taxon-mode
 occurrence_no set, taxon_no unset              taxon_no set, occurrence_no unset
       144,690  (86.6%)                             21,392  (12.8%)
       │                                                     │
  ┌────┴────┐                                          ┌─────┴─────┐
  ▼         ▼                                          ▼           ▼
collection_id  name_opinions_permid              collection_id  name_opinions_permid
  RESOLVES        NULL                              NULL           RESOLVES
  ▼                                                    ▼
museum → institutionCode                        nothing to inherit
pres_mode → preservationModes                   (no collection at all)

       └────────── 1,068 rows have both ───────────┘
             (59 of them disagree with their
              occurrence's taxon_no — so
              specimens.taxon_no is an
              independent fact, not redundancy)
```

**"Unset" is spelled two ways, unevenly.** MyISAM zero-defaults and SQL NULL are both in use, and the split
is different on every column:

| Column | `IS NULL` | `= 0` | Total unset |
|---|---|---|---|
| `reference_no` | 0 | 11 | 11 |
| `occurrence_no` | 8,995 | 12,397 | 21,392 |
| `taxon_no` | 140,525 | 4,165 | 144,690 |
| `authorizer_no` / `enterer_no` | 0 | 2 | 2 |

**The vocabulary is already exact.** All seven enums the payload touches — `is_type`, `specimen_coverage`,
`specimen_side`, `sex`, `measurement_source`, and collections' `pres_mode` and `museum` — were compared
value-for-value against the schema enums. They are identical in both directions, with no gaps. Every
foreign key resolves against migrated PostgreSQL data: 10,245 distinct `taxon_no` → `name_opinions` with
0 missing, 12,620 `reference_no` → `refs` with 0 missing, 157 `person_no` → `persons` with 0 missing, and
21,580 `collection_no` → `collections` with exactly 1 missing.

## Goals / Non-Goals

**Goals:**
- Migrate all 167,150 rows into PostgreSQL `specimens`, losing nothing that has a home in the target.
- Preserve `oldpbdb_occurrence_no` as the join key the later occurrences and measurements migrations need.
- Reuse the repository's existing resolution helpers rather than growing a second set.
- Append `specimens` to the runner as a tenth step under the same precondition/postcondition discipline as
  the other nine.

**Non-Goals:**
- Deriving a specimen's taxon from its occurrence.
- Migrating `measurements` or the `specelt_*` element hierarchy.
- Relocating `museum` / `pres_mode` into the `collections` payload.
- Repairing source data: malformed `magnification` values, non-catalog `specimen_id` strings, and the one
  orphaned collection reference all pass through as they are.

## Decisions

### D1 — `name_opinions_permid` comes from `taxon_no` alone, leaving 86.6% NULL

`specimens.taxon_no` is the only taxon link the script reads. The consequence is stark: 144,690 rows get
NULL, and their only surviving taxonomic handle is `oldpbdb_occurrence_no`.

*Alternative considered:* resolve occurrence-mode rows through `occurrences.taxon_no`, which is available
for 144,207 of the 144,690 and would take coverage to 99.9%.

*Why not:* 5,764 of those specimens sit on occurrences that carry reidentifications. Choosing which taxon
wins for a reidentified occurrence is precisely the question the occurrences migration exists to answer, so
resolving it here would smuggle a reidentification policy into a migration that claims not to touch
occurrences. A hybrid — resolve only where no reidentification exists — was also considered and rejected for
producing a column whose meaning varies by row.

*Reinforcing evidence:* of the 1,068 rows carrying both links, 59 disagree with their occurrence's
`taxon_no`. `specimens.taxon_no` is therefore an independent assertion, not a denormalised copy, which
argues against treating the two as interchangeable sources.

`taxon_no` as such has no meaning in 2.0; `name_opinions_permid` is the 2.0 carrier, and it is populated
from the one source that unambiguously maps to it.

### D2 — Every unset test covers both `0` and NULL

Given the table above, a test written against one form silently mis-buckets thousands of rows. The concrete
failure the exploration caught: an earlier draft of the mapping said the reference fallback fires "if
`reference_no` is null." `reference_no` is `int(10) unsigned NOT NULL DEFAULT 0` and is never null, so that
test matches nothing, all 11 rows fall through to the `NOT NULL` target column, and the run aborts.

The spec states this as a standalone requirement rather than repeating "or 0" at each use site, so that the
rule is checkable once.

### D3 — `institutionCode` gets a sentinel; `preservationModes` gets omission

Two fields derive from the same joined collection but resolve differently when absent:

| | `institutionCode` | `preservationModes` |
|---|---|---|
| Source | `collections.museum` (SET) | `collections.pres_mode` (SET) |
| Multi-valued | take first member | split to array |
| Absent | `'none specified'` | key omitted |
| Rows affected by "absent" | 118,877 (71%) | 23,942 (14%) |

The asymmetry is deliberate. `'none specified'` was added to the schema enum specifically so
`institutionCode` is never absent; `preservationModes` has no such sentinel and follows ordinary omission.

Two consequences worth naming. First, the sentinel collapses two distinguishable states: *the collection
exists and records no museum* (97,485 rows) and *there is no collection to ask* (21,392 rows). That
distinction remains recoverable while `oldpbdb_occurrence_no` survives, and only while it does. Second,
"first member" of a MySQL SET means first in the **set's declaration order**, not the order anyone typed —
so for the 1,100 multi-valued rows, `'BMNH,USNM'` yields `BMNH` deterministically but with no implication
that BMNH is the primary repository.

*Alternative considered:* making `institutionCode` an array, mirroring `preservationModes`. Rejected: these
are acknowledged placeholders pending PBot's specimen-level institution data, and an array would imply a
fidelity the source does not have.

### D4 — Absent keys are omitted, and `''` counts as absent for exactly one column

Every payload-bearing column uses NULL for "no value" except `is_type`, which is `''` on 8,453 rows and NULL
on 85,857. Since `''` is not in `specimen.type`'s enum, writing it through fails validation.

An earlier draft of the mapping carried a blanket rule ("if blank or null, omit key") and then removed it as
more trouble than it was worth — it collided with D3's sentinel. Profiling confirmed the removal cost almost
nothing: NULL maps to omission naturally, so only `is_type` needs an explicit statement.

| Column | NULL | `''` |
|---|---|---|
| `is_type` | 85,857 | **8,453** |
| `specimen_coverage` | 167,085 | 0 |
| `specimen_side` | 141,606 | 0 |
| `sex` | 153,619 | 0 |
| `measurement_source` | 34,064 | 0 |
| `specimen_id` | 31,572 | 0 |
| `specimen_part` | 5,351 | 0 |
| `magnification` | 146,810 | 0 |
| `comments` | 145,964 | 0 |

### D5 — `specimen.name` is generated, not taken from `specimen_id`

`name` is the schema's only required payload field and has no classic counterpart. `specimen_id` cannot
serve: it is blank on 31,572 rows and not unique — 11,929 `(occurrence_no, specimen_id)` pairs are
duplicated. The generated `pbdb_classic:${specimen_no}` is unique by construction and self-describing about
its provenance.

`specimen_id` instead becomes `identifiers.catalogNumber`, verbatim. Classic values are frequently not
catalog numbers at all (`"P. tricostata Oeningen type"`, `"Museum of Cagli P707"`, and many embedding their
institution as in `"USNM 550991a"`). Parsing them is out of scope and would be lossy guesswork.

### D6 — One source query with two LEFT JOINs, streamed

The script issues a single streaming query joining `specimens` → `occurrences` → `collections`, rather than
loading lookup maps for the MariaDB side. Both joins must be outer: 21,392 rows have no occurrence, and
occurrence 926337 names collection 3122352, which does not exist.

PostgreSQL-side resolution keeps the existing map-loading pattern — `loadReferenceIdMap`,
`loadNamePermidMap`, and `resolvePersons`, all from `src/lib/identity.js`, all used unchanged. No new shared
helper is needed, which is itself a signal the mapping landed inside the established shape.

### D7 — Runner step is appended, and nothing before it moves

`specimens` becomes step 10. Its dependency edges (`refs`, `collections`, `name_opinions`, `persons`) are all
satisfied by steps 1–9, so it appends cleanly with no reordering. It is last because it is the only step
reading three other steps' output at once while nothing reads from it.

Its preconditions are `specimens` empty, `collections` non-empty, `name_opinions` non-empty, and at least one
`refs` row carrying `oldpbdbID`. The `name_opinions` precondition is the one that earns its place: without
it the step would run happily against an empty opinions table and leave `name_opinions_permid` NULL on
every row it could have resolved — a silent under-migration of exactly the kind the runner exists to catch.

## Risks / Trade-offs

**86.6% of rows carry no taxonomic identity until occurrences migrate** → Accepted deliberately (D1). The
mitigation is `oldpbdb_occurrence_no`, which makes the backfill a straightforward join later. The risk is
that the interim table reads as broken to anyone who does not know why; the spec states the expected NULL
count so a reader can confirm it is intentional.

**The `institutionCode` sentinel is 71% of the column** → A field that is "none specified" on nearly three
quarters of rows carries little query value, and collapses two distinct states (D3). Mitigation: the
distinction stays recoverable through `oldpbdb_occurrence_no` for as long as that column survives. If it is
dropped before the distinction is captured elsewhere, the information is gone.

**A one-sided null test silently mis-buckets rows** → The highest-likelihood implementation bug, because
the wrong test still produces plausible output for most rows (D2). Mitigation: the run summary reports the
bimodal split (144,690 / 21,392 / 1,068) and the fallback counts, so a mis-bucketing shows up as a wrong
total rather than passing unnoticed.

**Collection-level data lands first on specimens** → `museum` and `pres_mode` are collection facts, and the
collections migration has not yet migrated its `paleontology` block, so this migration is their first home
in pbdb2 — duplicated across 145,758 payloads. Accepted: collections will be revisited separately, and
blocking specimens on it would trade a known cost for an unknown schedule.

**Re-running duplicates rows** → The script has no upsert path, matching the five existing scripts with the
same property. Mitigation: the runner's `specimens is empty` precondition is the guard, and a re-run outside
the runner is the operator's responsibility.

## Migration Plan

1. Apply the `specimens` DDL to the target database. It exists in `create_new.sql` but not in the localhost
   database; the applied form must carry the four recently corrected foreign keys (`collection_id` →
   `collections`, `preceded_by_id` / `succeeded_by_id` → `specimens`) rather than the earlier `refs` copies.
2. Run `node src/specimens-migration/migrate-specimens.js` standalone against localhost and check the run
   summary against the expected counts.
3. Add the step to `src/run-migrations.js` and verify `--only specimens` and `--from specimens` both address
   it.
4. Verify a full clean run reproduces 167,150 and does not disturb the nine preceding steps' totals.

Rollback is `TRUNCATE specimens`: no other table is written, and nothing yet reads from it.

## Open Questions

- Should the `institutionCode` sentinel distinguish "collection records no museum" from "no collection
  exists"? Deferred as a schema question rather than a migration one; today both are `'none specified'`.
- When `oldpbdb_occurrence_no` is eventually dropped, what carries the specimen→occurrence link, and does
  the taxon backfill have to precede that drop? Belongs to the occurrences migration, noted here so the
  dependency is not discovered late.
