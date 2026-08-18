## Context

`name_opinions` and `validity_opinions` exist (schema from the `taxa-opinions` change) but are empty. Classic PBDB stores every taxonomic name-as-spelled in the legacy `authorities` table (517,287 rows). Per the identity inversion settled in `docs/classic-taxa-opinions.md` §9.8, each such name becomes a **root** `name_opinions` edge — a minting record that carries the permid's immutable identity (`new_name`, `rank_id`, authority provenance) and is the anchor from which lineage/concept/assignment edges will later be derived.

The authorities migration already ran (163,067 deduped rows in the new `authorities` table); it recorded every legacy `taxon_no` it absorbed in `authority.legacyIDs.oldpbdbIDs`. This change reads that back to attach naming-act provenance to each name_opinion. This is a deliberately **basic, experimental** pass on the `taxa-opinions-revise` branch — only `authorities → name_opinions` (+ the informal → `validity_opinions` subset), not the opinions table.

The authoritative field-by-field mapping is `payloadSchemas/mappings/authorities-opinions.md`, "Classic authorities to name_opinions migration" section.

## Goals / Non-Goals

**Goals:**
- Load one root `name_opinions` edge per legacy `authorities` row (517,284, minus 3 dangling-ref skips).
- Additionally emit a `validity_opinions` row for each of the 18 `informal`-rank rows.
- Reuse established migration conventions (streaming source read, in-memory resolution Map, 0-sentinel person fallback, schema validation before insert, single transaction-wrapped bulk insert).

**Non-Goals:**
- Migrating the legacy `opinions` table (lineage/concept/assignment/validity beyond informal) — later work.
- Running `derive_taxa()` / populating the Layer-3 ledger — out of scope; this only writes Layer-1 assertions.
- Re-deriving citation/attribution from legacy author fields — attribution comes from the already-built new `authorities` record.
- Repairing the dangling `reference_no = 42348` or any other legacy data anomaly.

## Decisions

### D1 — subject_permid is the row's own minted permid
Root records are self-anchoring: mint one `uuidv7()` and write it to both `permid` and `subject_permid`, with `target_permid = NULL`. Alternative (a separate registry/self-FK) is rejected — permids are deliberately not SQL FKs (§9.5.1), and the minting shape CHECK already enforces `target_permid IS NULL` for `edge_class = 'root'`.

### D2 — Resolve provenance through the new authority, not legacy fields
`authority_id`, `reference_id`, `attribution`, `publication_year` all come from the new `authorities` record whose `oldpbdbIDs` contains the row's `taxon_no`. Because the authorities dedup key already included `reference_id`, every legacy row that merged into an authority shares that authority's `reference_id` — so using the authority's `reference_id` equals resolving the row's own `reference_no`, with no discrepancy, and it lets attribution reuse the cleaned/decoded citation already computed. Resolution is an in-memory `Map<taxon_no(str) → {authority_id, reference_id, citation, descriptors, publishedInReference, year}>` built from one preload query (the `refMap` pattern), avoiding 517K per-row GIN lookups.

### D3 — publication_year is parseInt(authority.year)
The mapping labels the source `authority.year` (a string, e.g. `'1969'`, sentinel `'0'`). `publication_year` is an integer column, so parse it; treat `'0'`/absent as `NULL` (scenario ④ authorities carry the `'0'` sentinel and have no real year).

### D4 — attribution built via opinionAttribution.schema.js
`attribution` is `{citation, descriptors, publishedInReference}` copied from the resolved authority, validated against `opinionAttribution.schema.js` (the wrapper `{attribution: …}` for validation; the inner object stored in the column, mirroring how `migrate-authorities.js` validates a wrapper but stores the inner payload).

### D5 — informal rows: rank 'unranked' on the name_opinion + a validity_opinions row
The 18 `informal` rows are not a real rank. Set the name_opinion's `rank_id` to `'unranked'` and additionally insert a `validity_opinions` row (`status='informal'`, `targeted=false`, `target_permid=NULL`) sharing the name_opinion's `permid` as `subject_permid`. Persons, reference, attribution, year on the validity row mirror the name_opinion; `evidence=false` (legacy `authorities` has no `basis` column). Insert order must place the name_opinion first so its `permid` is known when the validity row is built (both are minted in-process, so ordering is a code concern, not a DB FK — `subject_permid` is a soft pointer).

### D6 — Skip the 3 dangling-ref rows, consistent with authorities
Three rows (`taxon_no` 242140/242141/242243) point at `reference_no = 42348`, which exists in neither old nor new `refs`; the authorities migration already skipped them, so they have no new authority and thus no `reference_id` (a NOT NULL column). Skip-and-log rather than fabricate a reference. Accounting invariant: `nameOpinionsInserted + skipped == sourceRows`.

### D7 — No version triggers; plain head inserts in one transaction
The opinion tables are versioned but deliberately do **not** install version triggers (§9.5.2.1); they carry hand-made partial head indexes only. So the migration inserts plain heads (`preceded_by_id`/`succeeded_by_id` NULL, `removed=false`) — no trigger fan-out — wrapped in a single `BEGIN…COMMIT` for atomic rollback, matching `migrate-authorities.js`.

## Risks / Trade-offs

- **[Memory footprint of the resolution Map]** ~517K string keys + small value objects held in memory alongside the survivor array. → Same order as the authorities migration's `refMap`; acceptable. Source rows are still streamed, not buffered.
- **[Attribution stored shape ambiguity]** Whether the column holds the inner `{citation,…}` or the `{attribution:{…}}` wrapper. → Follow `migrate-authorities.js` precedent: validate the wrapper, store the inner object; a task verifies against `opinionAttribution.schema.js`.
- **[rank_id drift]** A legacy `taxon_rank` value not present in `taxonomy_ranks` would break resolution. → Verified: all 25 distinct values resolve directly except `informal` (handled). A build-time guard aborts on any unmapped rank rather than inserting NULL.
- **[Silent over/under-count]** → The reconciliation assert (`inserted + skipped == source`) and fixed expected counts (517,284 / 18 / 3) catch drift; the run logs all counters.

## Migration Plan

1. Confirm prerequisites present: persons, refs, authorities migrated; `create_new.sql` opinion tables + dictionary seeds (`namechange_reasons.'original'`, `nomenclatural_statuses.'informal'`, `taxonomy_ranks`).
2. Preload new authorities → resolution Map; resolve dictionary ids (`original`/`root`, `informal`, rank map).
3. Stream `authorities`; per row resolve provenance, persons, rank; build + validate attribution; accumulate name_opinion (and validity row for informal) in memory; skip-and-log unresolved.
4. Single transaction: bulk-insert name_opinions, then the 18 validity_opinions; `COMMIT`.
5. Reset the identity sequences; log final counts; assert reconciliation.
6. **Rollback**: pre-commit failure rolls back atomically (no cleanup). To redo a committed run in this experimental branch, `TRUNCATE name_opinions, validity_opinions` and re-run.

## Open Questions

None outstanding — the four items surfaced during exploration (validity block source columns, publication_year path, validity NOT NULL columns, the 3 orphans) were resolved in the mapping and the decisions above.
