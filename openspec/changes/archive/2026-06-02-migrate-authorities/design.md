## Context

The legacy MariaDB `authorities` table (517,287 rows) is a mashup: each row is a taxon name with attached citation info. The new PostgreSQL `authorities` table separates concerns — it holds citation data only, with taxa moving to a future table. This migration populates the new table from legacy citation columns; taxon data is deferred.

A prior design attempted heavy parser-driven cleanup of author-name fields (`et al.` normalization, initial-stripping, `in`/`ex` attribution rules, HTML entity decoding before splits). That approach stalled on the `in`/`ex` rule and surfaced enough irregular cases that a different stance emerged: **don't clean — preserve and dedup**. This document captures the technical decisions behind that pivot.

Source columns in scope: `ref_is_authority`, `author1last`, `author2last`, `otherauthors`, `pubyr`, `reference_no`, `authorizer_no`, `enterer_no`, `taxon_no` (PK). Everything else — `taxon_name`, `taxon_rank`, `orig_no`, `extant_old`, classification fields — is deferred.

Target: `postgresql/create_new.sql` ~L340. Schema contract in `payloadSchemas/authority.schema.js` (already updated, no further edits needed).

## Goals / Non-Goals

**Goals:**
- Populate the new `authorities` table with citation data for every legacy row where authorship is discernible.
- Preserve the raw author/year information verbatim in the `citation` string — display fidelity matters more than parsing correctness for this field.
- Make legacy author fragments searchable via a `descriptors` keyword array, with minimal-but-safe normalization (HTML entity decoding, structural splitting, empty/`et al.` filtering).
- Deduplicate: distinct legacy `taxon_no`s sharing the same citation+reference collapse to one authority row, with all absorbed `taxon_no`s preserved in `authority.legacyIDs.oldpbdbIDs`.
- Leave a forward bridge for the taxa migration: every legacy `taxon_no` must be recoverable to its surviving `authority.id`.

**Non-Goals:**
- Cleaning, normalizing, or canonicalizing author names. `in`/`ex` attributions, embedded years, corporate authors, fused taxon+author strings — all preserved as-is.
- Migrating taxon data (name, rank, parent, classification, status, `_old` columns). Deferred to a future taxa migration which will likely re-run this script combined.
- Building a separate `taxon_no → authority.id` mapping table. The information lives on the authority row.
- Backfilling `publishedInReference: true` rows with an `authors` or `year` field — those are derivable from the linked reference.
- Building search indexes on `descriptors` or `oldpbdbIDs`. Index DDL is documented in `authorities-migration-exploration.md` for the taxa migration to add when needed.

## Decisions

### D1. Preserve raw author data; build `citation` by formula

The legacy author fields are dirty (HTML entities, embedded years, `in`/`ex` attributions, corporate authors, fused taxon+author strings). The prior plan attempted to parse them into clean structured authors; that effort produced diminishing returns and stalled on edge cases. The new stance: do not parse for cleanup. Build a display string per scenario formula, store it as `authority.citation`, accept whatever the source contains.

**Rationale:** display fidelity is the actual goal; downstream consumers want to render the same citation the legacy system rendered. Parsing introduces interpretation, and interpretation is where the bugs hide. The unparsed string is a lossless representation.

**Alternative considered:** parse into structured authors with cleanup rules. Rejected — too much edge-case logic, too much risk of silent data corruption, no clear win for end users.

### D2. Four-scenario classifier drives everything

Source rows are partitioned by `(ref_is_authority='YES', author1last='')`:

| | `author1last = ''` | `author1last = something` |
|---|---|---|
| `ref_is_authority='YES'` | ① 258,965 — cite from ref | ② 7 — cite from `*last` fields |
| `ref_is_authority != 'YES'` | ④ 16,606 — log + skip | ③ 241,709 — cite from `*last` fields |

`ref_is_authority` is a clean binary (`'YES'` or `''`). `author1last=''` is a clean test (no whitespace-only forms confirmed in source).

Citation/descriptors construction is identical for ② and ③; they differ only by `publishedInReference`. Scenario ① pulls from the linked reference. Scenario ④ is logged but not inserted.

### D3. Citation formula — symmetric "and" join for two authors

For all three migrated scenarios, two-author citations use "and":

```
Scenario ①  (publishedInReference: true, from ref):
  citation = (1 author    → ref.authors[0].familyName
              2 authors   → ref.authors[0].familyName + ' and ' + ref.authors[1].familyName
              3+ authors  → ref.authors[0].familyName + ' et al.')
           + ' ' + ref.publicationYear

Scenario ②/③ (from *last fields):
  citation = author1last
           + (otherauthors != ''     ? ' et al.'
              : author2last != ''    ? ' and ' + author2last
              : '')
           + ' ' + pubyr
```

**Edge cases:**
- Empty `pubyr` (or `ref.publicationYear`): trim trailing space, accept name-only citation. ~1,193 scenario-③ rows are in this state.
- Zero-author reference (scenario ①): citation becomes just the trimmed year (`'1969'`). Descriptors will be `[]` for these rows. Schema allows this.

**Alternative considered:** keep the asymmetric formula (no "and" between two `*last` fields). Rejected for consistency — same data shape, same display.

### D4. Descriptors: HTML-decode → split on `[,;:&]` → trim → drop empties → drop `et al.`

`authority.descriptors` is an array of last-name keyword strings used for downstream search. Built from:

- **Scenario ①:** `ref.reference.authors.map(a => a.familyName)`. Already-structured data, no splitting needed.
- **Scenario ②/③:** `[author1last, author2last, otherauthors].flatMap(decode then split on /[,;:&]/)`. Then `trim`, drop empties, drop literal `et al.`.

**HTML entity decode before split, not after.** Source contains `Dvo&#345;ák` (a U+0159 ř). Splitting on `&` first yields `['Dvo', '#345;ák']` — non-keywords that pollute search forever. Decoding first yields `['Dvořák']`. This is the one piece of "normalization" we keep, and it's about rendering bytes correctly, not interpreting content.

**Why this is not "cleanup"**: citation preserves the raw string verbatim. Descriptors are a derived search aid; for them to be useful, structural noise (HTML entities, `et al.`, empty splits) has to be filtered. The substance (every surname that appears in any form, including `in`/`ex` attributions, corporate authors, and fused names) is preserved.

**Alternative considered:** also split on `and` keyword and strip leading initials (the prior plan). Rejected — too interpretive, fragile around long surnames (`Lepeletier de Saint Fargeau`, `American Ornithologists' Union`), and the survivors-of-mess (`Smith Jones` as a single descriptor from `author1last='Smith Jones'`) just become unusual search terms, not wrong ones.

### D5. Year: stored as-is, optional, never derived

`authority.year` mirrors `pubyr` for ②/③ and `ref.publicationYear` for ①. Empty stays empty (no schema enforcement). No parsing of embedded years out of author fields — that was old-plan cleanup logic that no longer applies.

### D6. `publishedInReference` (renamed from `referenceIsAuthority`)

The new field name better describes the relationship: the authority is published *in* the linked reference, vs. having its own citation data. Schema, contract, and migration all use the new name. No backward-compat alias.

### D7. Dedup key and tiebreaker

Two legacy rows produce the same authority when they share `(reference_id, citation, year, descriptors)`. The same parser+formula runs on both, so jsonb canonicalization of `descriptors` is deterministic — direct array equality suffices.

**Tiebreaker:** the row with the smallest legacy `taxon_no` is the survivor. Achieved by sorting the source query by `taxon_no ASC` and taking first occurrence per dedup key.

**Survivor's `oldpbdbIDs` array:** starts with the survivor's own `taxon_no`. Each absorbed row appends its `taxon_no` to the array. Resulting array is sorted ascending (because source was iterated in ASC order). Logged at merge time.

### D8. Pre-aggregate in JS, single bulk insert (no dedup-after)

Two viable paths:

- **A.** Insert all ~500K rows, then run a SQL dedup pass with window functions, `jsonb_set` to merge `oldpbdbIDs`, and `DELETE` of losers. Triggers must be disabled to avoid history-row bloat for the ~360K deletes.
- **B.** Pre-aggregate in JavaScript: build a `Map` keyed by the dedup tuple while iterating source rows in `taxon_no ASC` order. First row per key becomes the survivor; subsequent rows append their `taxon_no` to `survivor.authority.legacyIDs.oldpbdbIDs` and emit a merge log. One bulk insert of ~140K survivors at the end.

**Chosen: B.**

**Rationale:**
- Per-merge logging is free (one line of code at the merge point); A requires a separate `RETURNING` query.
- Dedup-key construction happens once in JS rather than being mirrored between insert-time JS and dedup-time SQL — no canonicalization drift risk.
- Pure-function dedup logic is testable on rows-in/rows-out without a real database.
- Mid-debug re-run is just "re-run the script" — no truncate-and-redo of two phases.
- Memory cost: ~140K survivors × ~500 bytes ≈ 70 MB peak; well within limits. (Source rows themselves are streamed, not buffered.)

**Trade-offs against A:**
- A with triggers disabled is probably only minutes slower — the speed argument is not the dominant one.
- A keeps logic closer to the data (familiar territory for DBAs). Acknowledged; not enough to outweigh the code-shape wins.

### D9. `legacyIDs.oldpbdbIDs` as array, supersedes mapping table

Earlier discussion considered a separate `taxon_no → authority.id` mapping table for the taxa migration to consume. Decided against: the same information fits naturally on the authority row as an array of legacy ids.

**Why array beats mapping table here:**
- Self-describing: row carries its own legacy provenance.
- Survives versioning: jsonb payload copies forward via `install_version_triggers`. A side mapping table needs FK update logic if rows are re-versioned.
- Survives re-migration: when the taxa migration combines and re-runs this script, the array rebuilds naturally; the mapping table would need separate rebuild logic.
- Trivially indexable when needed: `CREATE INDEX ... USING gin ((authority->'legacyIDs'->'oldpbdbIDs') jsonb_path_ops)`.

**Naming:** plural `oldpbdbIDs` everywhere, even for length-1 cases (every row has at least its own `taxon_no`). No singular `oldpbdbID` alias. The schema in `payloadSchemas/authority.schema.js` already reflects this.

### D10. FK and zero-sentinel handling — reuse `migrate-refs.js` patterns

- **`reference_id` mapping:** old `reference_no` → new `refs.id` via `refs.reference->'legacyIDs'->>'oldpbdbID'`. Take the current head (`succeeded_by_id IS NULL`). Same as `migrate-refs.js`.
- **Orphan refs (3 rows):** `reference_no` not present in `refs`. Skip + log; no authority can exist without a reference per the NOT NULL FK.
- **`authorizer_no=0` / `enterer_no=0` (1 row each):** use the other when one is 0. Same fallback as `migrate-refs.js:175-181`.
- **`permid`:** fresh `randomUUID()` per inserted authority (same pattern as `migrate-refs.js:301`).
- **`id`:** generated by Postgres (`GENERATED BY DEFAULT AS IDENTITY`). Not pinned to legacy `taxon_no`.

## Risks / Trade-offs

- **Dirty citation strings persist forever.** Preserving raw means rows like `'Kamptner 1948 ex Piviteau  1952'` go into the new system unchanged. Mitigation: this is the explicit design choice; downstream consumers either render or normalize as needed. The descriptors array provides the search surface.

- **Descriptors can be empty.** Scenario ① with a zero-author reference produces `descriptors: []`. Schema allows this (no `minItems`). Searching by surname won't find these rows, but `citation` still renders correctly. Acceptable; very rare in practice.

- **Dedup is "lossy" at the row level but bridged by `oldpbdbIDs`.** If the taxa migration ever needs per-taxon metadata that we discard here (e.g. distinguishing two taxa attributed to the same authority by a column we're not migrating), we have to re-run. Mitigation: this is the working assumption — the taxa migration will likely re-run this script combined.

- **Dedup-key canonicalization drift.** If the descriptors array is built differently on two passes (e.g. order of fields), dedup misses. Mitigation: descriptors are built by a single function called once per source row; same input always produces same output. Unit-testable.

- **Memory pressure on Map.** ~140K entries × ~500 bytes ≈ 70 MB peak. Comfortable. If it ever became a concern, partition by `reference_no` (dedup never crosses reference boundaries) and aggregate per-partition.

- **Re-run safety after abort.** Schema validation runs during the in-memory build phase, before any DB write — most failure modes (bugs in citation/descriptor construction) abort with the table untouched, requiring zero cleanup. The bulk insert itself is wrapped in a single transaction, so any failure during the insert phase rolls back atomically along with version-trigger history rows. The combination means **abort = zero cleanup**, regardless of cause. The script remains non-idempotent for *successful* runs — running twice in a row double-inserts; if intentional re-run is needed, `TRUNCATE authorities` first. (A `permid` unique-constraint bootstrap, as in `migrate-pbot-refs.js:216-231`, is an option for self-healing re-runs but adds complexity for limited benefit here.)

- **`et al.` only matched as the literal string `et al.` (case-sensitive, lowercased, period included).** Source variants (`et al`, `et alii`, `and others`) will pass through as descriptors. Mitigation: the prior parser tried to normalize all of these; the new policy is preserve-with-minimal-filtering. Variants are rare and don't break search — they just produce extra non-surname tokens. Acceptable.

- **The `taxon_no` ASC tiebreaker is meaningful but arbitrary.** "Smallest legacy id wins" doesn't reflect data quality, just insertion order in the old system. Mitigation: tiebreaker is documented; the surviving row's `oldpbdbIDs` array carries every absorbed id, so no information is lost.
