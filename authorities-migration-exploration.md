# Authorities Migration — Working Spec & Handoff

Migrating the legacy `authorities` table (MariaDB `pbdb_archive`) into the new
PostgreSQL `authorities` table. **Hard break in functionality:** the old table
was a mashup of citation data and taxon definitions; the new `authorities`
table holds **citation data only**. Taxon data is deferred to a future
iteration (new design TBD).

Status: **decisions locked except one** (the `in`/`ex` rule, see Open). No
migration script written yet. This doc is enough to resume cold.

---

## Resume here

**Schema + DDL are fixed and verified (2026-05-26).** `create_new.sql` authorities
table has no trailing comma; `authority.schema.js` `else` branch is
`properties:{authors:false,year:false}` (neither `authors` nor `year` when
`ria=true`). Both load/run clean. The next step is the migration script — blocked
only on the `in`/`ex` decision (see Open); everything else below is ready to
implement.

---

## Source & target

- **Source:** MariaDB `authorities`, **517,287 rows**, PK `taxon_no`.
  Relevant columns: `ref_is_authority` (varchar(4)), `refauth` (tinyint mirror),
  `author1last`, `author2last`, `otherauthors`, `author1init`/`author2init`
  (initials — **dropped**, last names only), `pubyr`, `reference_no`,
  `authorizer_no`, `enterer_no`.
- **Target:** `postgresql/create_new.sql` → `CREATE TABLE authorities`.
  - `permid` text — **generate a fresh uuid per row** (`randomUUID()`, as in `migrate-refs.js`).
  - `authority` jsonb — shape defined in `payloadSchemas/authority.schema.js`.
  - `reference_id` → `refs(id)` NOT NULL — map from old `reference_no` (see C).
  - `authorizer_person_id` / `enterer_person_id` → `persons(id)` NOT NULL.
  - `preceded_by_id`/`succeeded_by_id` self-ref + `install_version_triggers('authorities')` (versioning is wired).

### Contract (`authority.schema.js`)

| `referenceIsAuthority` | `authors` | `year` | enforced by |
|---|---|---|---|
| `false` (scenario ③) | present, non-empty `[string,…]` | optional | `then.required` + `type:"array"` + `minItems:1` |
| `true` (scenarios ①②) | **absent** | **absent** | `else.properties:{authors:false,year:false}` |

`authors` items are **last-name strings** (not `{familyName,givenName}` — diverges
from `reference.schema.js`, intentional). `legacyIDs.oldpbdbID` = old `taxon_no`.

---

## Migration scenarios (drive everything; counts verified against live data)

`ref_is_authority` is a clean binary: exactly `'YES'` (258,972) or `''` (258,315).
`refauth` mirrors it perfectly. `author1last=''` is a clean test (no whitespace-only).

| | `author1last = ''` | `author1last` = string |
|---|---|---|
| **`ref_is_authority='YES'`** | ① 258,965 → `referenceIsAuthority:true`, **no authors/year** | ② 7 → same as ①, **ignore the authors, log it** |
| **`ref_is_authority != 'YES'`** | ④ 16,606 → **do NOT migrate, log it** | ③ 241,709 → `referenceIsAuthority:false`, **populate authors** |

- ④ silently drops **3.2%** of the table (no discernible authority). Intended.
- ② discards real author+year data for 7 rows (all have clean surname+pubyr+ref). Intended.

---

## A. Author-name parsing (scenario ③ only)

Authors array is assembled from `author1last` + `author2last` + `otherauthors`.
Approved rules:

1. **Split** on `,` `;` `&` and the word `and`.
2. **Strip leading initials** (`'T. Barnard'` → `Barnard`; last names only).
3. **`et al.`**: normalize all variants (`et al`, `et al.`, `et alii`, `and others`)
   to one token, force it **last** in the array; also split it out of the
   `*last` fields when embedded (`'Williams et al'` → `['Williams','et al.']`).
4. **Decode HTML entities** (`&#345;` → ř, `&amp;` → &).

### Two parser requirements surfaced from the residue (NEW — fold these in)

5. **Decode HTML entities BEFORE splitting on `&`.** Otherwise `'Dvo&#345;ák'`
   gets torn into a `#345;…` digit fragment. (Decode → then split.)
6. **Apply the `, ; & and` splitting to `author1last`/`author2last` too**, not
   just `otherauthors`. Multiple authors are sometimes crammed into the first
   field: `'Milne-Edwards,Milne-Edwards'`, `'Liu Jialong & Zhen Shuonan'`,
   `'Bibron and Bory de Saint-Vincent'`. Low risk — standalone `and`/`&` is rare
   in a genuine single surname.

### Residue (after rules + the pending in/ex rule)

Of 241,709 scenario-③ rows, only **~420 (0.17%)** don't parse to clean surnames,
and **~400 are the single `"X in Y"` attribution pattern** (see Open). After the
`in`/`ex` → first-author rule, **true residue = 19 rows / 16 distinct strings**;
~6 of those are false positives fixed by rules 5–6 above, leaving **~8–10 rows**
for genuine manual triage. Full list at the bottom (with `taxon_no`).

Policy for residue: **best-effort parse + log the row** (matching the existing
`console.warn` + counts style in `migrate-refs.js`).

---

## B. Year handling

- Parse a **discernible year** out of `otherauthors`/surname tokens into the
  `year` field (`'Giusti 1989'` → year 1989; bare `'1936'` → year, not an author).
- **Empty years are fine** — 1,193 scenario-③ rows have authors but no `pubyr`;
  `year` is optional when `ria=false`.
- When **`referenceIsAuthority` is true, do NOT store `year`** (derive from the
  reference). 7 scenario-① rows have a `pubyr` that we deliberately drop. Schema
  enforces year-absent in the `else` branch (see fix #2 above).

---

## C. FK / NOT NULL handling (a handful of rows, will hard-fail inserts otherwise)

- **3 rows**: `reference_no` orphaned (not in `refs`) → **skip + log**.
- **`reference_id` mapping**: old `reference_no` → new ref. Refs carry
  `reference->'legacyIDs'->>'oldpbdbID'` = the old `reference_no` (`migrate-refs.js:205`),
  and were inserted with `id = reference_no` (`migrate-refs.js:300`). Resolve to
  the **current version head** (`succeeded_by_id IS NULL`) in case a ref was
  re-versioned.
- **1 row `authorizer_no=0`, 1 row `enterer_no=0`**: reuse the
  `migrate-refs.js` fallback (use the other when one is 0).
- **Person mapping**: resolve `authorizer_no`/`enterer_no` (person_no) → `persons(id)`
  via the same path `migrate-refs.js` uses. **Nathan Jud (id 414 & 911) is NOT a
  blocker** — confirmed both records are valid and coexist (2026-05-26).

---

## Open (the only undecided item)

**The `in`/`ex` attribution rule** (~400 rows, e.g. `'Sars in Carpenter'`).
These are nomenclatural: *X named the taxon in a publication by Y*. Candidate
rule: **split on ` in `/` ex `, keep the first part as the author** (`'Sars in
Carpenter'` → `Sars`), still log the row. `ex` has its own botanical convention
(which side to keep) — **Doug confirming offline.** Until decided, the parser
should treat these rows as residue + log; no data is lost by waiting.

---

## True-residue rows for offline triage (`taxon_no` = legacy PK)

| taxon_no | author1last | author2last | otherauthors | note |
|---|---|---|---|---|
| 22115 | `Milne-Edwards,Milne-Edwards` | | | 2 authors in field → fixed by rule 6 |
| 162366 | `Liu Jialong & Zhen Shuonan` | | | 2 authors in field → fixed by rule 6 |
| 423328 | `Bibron and Bory de Saint-Vincent` | | | 2 authors in field → fixed by rule 6 |
| 213909 | `Mikulas` | `Cadlecova` | `Fejfar, Dvo&#345;ák` | clean → fixed by rule 5 (decode-first) |
| 294322 | `Lepeletier de Saint Fargeau` | | | legit long surname (false positive) |
| 384974 | `Godfrey` | `Sutherland` | `R.R. Paine, … Vuillaume-Randriamanantena` | legit (false positive) |
| 39246 | `American Ornithologists' Union` | | | corporate author — keep as-is? |
| 466272 | `The Angiosperm Phylogeny Group` | | | corporate author — keep as-is? |
| 12739 | `Shimizu` | `Obata` | `1936` | year as 3rd author → year-extract |
| 171232 | `Vrsansky` | `Ren` | `3` | junk token → drop + log |
| 337750 | `van Aartsen` | `Bogi` | `Giusti 1989` | surname+year → strip trailing year |
| 73809 | `Rozanov` | `Missarzhevsky` | `N.A. Volkova … & A.D. Sidorov 1969` | author list + trailing year |
| 54007 / 54009 | `Lesquereux` | | `in A.H. Worthen, 1866, Paleontology: …` | citation fragment → skip + log |
| 87690 | `Kamptner 1948 ex Piviteau  1952` | | | ex + years → manual |
| 443351 | `Mochtyellidae Kielan-Jaworowska` | | | taxon name fused with author → manual |

---

## Reference map

- `payloadSchemas/authority.schema.js` — the contract (fixed + verified).
- `postgresql/create_new.sql` ~340–351 — `CREATE TABLE authorities` (fixed + verified).
- `migrate-refs.js` — reuse patterns: `randomUUID()` permid (:301), person
  resolution + authorizer/enterer 0-fallback (:175–181), `oldpbdbID` legacy id (:205).
- `migrate-pbot-refs.js` — permid unique-constraint bootstrap pattern (:216–231).
- Legacy column reference: `mariadb/PBDBLegacy-DeepAnalysis/schema-catalog.md` (authorities at line 20).

Once the `in`/`ex` rule lands, this converts cleanly to an OpenSpec change
(`/opsx:new` or `/opsx:ff`) and then the migration script.
