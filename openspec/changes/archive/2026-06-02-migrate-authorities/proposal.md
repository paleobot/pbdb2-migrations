## Why

The legacy `authorities` table in MariaDB (`pbdb_archive`, 517,287 rows) conflates two unrelated concerns: citation data (who attributed a taxon, in which publication) and taxon definitions. The new PostgreSQL `authorities` table separates these — it holds citation data only, and taxa are deferred to a later migration with a new design. We need to populate the new table from the legacy one, preserving the citation information that downstream taxonomy work depends on.

## What Changes

- **BREAKING** — the new `authorities` table has a different shape and purpose than the legacy one; this is a structural break, not an in-place migration. Taxon data in the legacy `authorities` row is **not** migrated here (deferred).
- Migrate scenarios ①, ②, and ③ (~500K of 517K rows) into the new `authorities` table, populating the `authority` jsonb payload per `payloadSchemas/authority.schema.js`. Scenario classification is a clean partition on `(ref_is_authority, author1last)`; no row-level judgment involved.
- **Preserve raw author data**, do not clean it. The `authority.citation` field is a fabricated display string built by formula from either the linked reference (when `ref_is_authority='YES'`) or from `author1last`/`author2last`/`otherauthors`/`pubyr`. Mess in the source (`in`/`ex` attributions, HTML entities, embedded years, fused names) is preserved verbatim.
- Populate `authority.descriptors` (array of last-name keyword strings) by splitting the legacy author fields on `[,;:&]` after HTML entity decoding; trim, drop empties, drop literal `et al.`. This becomes the search-keyword surface.
- Set `authority.publishedInReference` (boolean) — renamed from the legacy `ref_is_authority` flag.
- **Dedup the result**: many legacy rows produce identical authorities once the taxon is stripped out. Group by `(reference_id, citation, year, descriptors)`; the row with the smallest legacy `taxon_no` survives; absorbed `taxon_no`s are appended to the survivor's `authority.legacyIDs.oldpbdbIDs` array. Expected output ~140K rows (down from ~500K). Pre-aggregate in JS, single bulk insert — no post-insert deletes.
- **Log + don't migrate** scenario ④ (~16,606 rows with no discernible authority): no reference-as-authority, no `author1last`. 3.2% of the source.
- The migration script is one-shot and will likely be re-run when the taxa migration lands (combined into a single script at that point). The `oldpbdbIDs` array is the bridge that lets future taxa rows find their authority.

## Capabilities

### New Capabilities

- `authorities-migration`: Migration of legacy MariaDB `authorities` rows (citation data only) into the new PostgreSQL `authorities` table, including citation-string fabrication, descriptor extraction, scenario classification, dedup with legacy-ID preservation, and orphan/zero-FK handling.

### Modified Capabilities

None. The new `authorities` table has no prior spec.

## Impact

- **Source (read):** MariaDB `pbdb_archive.authorities` (517,287 rows, PK `taxon_no`). Relevant columns: `ref_is_authority`, `author1last`, `author2last`, `otherauthors`, `pubyr`, `reference_no`, `authorizer_no`, `enterer_no`.
- **Target (write):** PostgreSQL `authorities` table (defined in `postgresql/create_new.sql` ~L340). Expected ~140K rows after dedup.
- **Schema:** `payloadSchemas/authority.schema.js` — already updated to the new shape (`citation`, `descriptors`, `year`, `publishedInReference`, `legacyIDs.oldpbdbIDs`). No further schema edits needed.
- **New script:** `migrate-authorities.js` (new), patterned on `migrate-refs.js` for permid generation (`randomUUID()`), person resolution, authorizer/enterer 0-fallback, and `oldpbdbID` legacy-id wiring. Resolves `reference_id` via the existing `refs.reference.legacyIDs.oldpbdbID` → `refs.id` lookup, taking the current version head (`succeeded_by_id IS NULL`).
- **Versioning:** `install_version_triggers('authorities')` is wired on the target table. No special handling required since we insert finished, deduped rows in one pass (no post-insert deletes/updates).
- **Future-coupling:** When the taxa migration lands, it will need to resolve legacy `taxon_no` → new `authority.id`. A recommended GIN index (`jsonb_path_ops` on `authority->'legacyIDs'->'oldpbdbIDs'`) and lookup pattern are documented in `authorities-migration-exploration.md` (~L174). Index is not part of this change.
- **Relevant anomalies** (from `mariadb/PBDBLegacy-DeepAnalysis/anomaly-report.md`):
  - `authorities.extant_old` (108K rows) — irrelevant here, that's taxon data, deferred.
  - 0-as-NULL sentinel in `authorizer_no`/`enterer_no` (1 row each) — handled via the same fallback pattern as `migrate-refs.js`.
  - 3 rows with `reference_no` orphaned from `refs` — skip + log.
- **Out of scope:** taxon name, parent linkage, classification, ranks, status flags, `extant_old`, and every other column on the legacy table that isn't citation-related. All deferred to the future taxa migration.
