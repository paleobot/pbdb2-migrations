# Baseline before payload-schema-variants

Captured 2026-09-18 on localhost `pbdb`, from the full `--createdb` run started 2026-09-18T00:34:11Z (`src/run-migrations.log`). Outcome: success, 10 steps.

## Step deltas

| Table | Rows |
|---|---|
| persons | 1,304 + 71 = 1,375 |
| refs | 93,705 + 237 = 93,942 |
| schemas / characters / states / additional_schema_refs | 8 / 336 / 1,325 / 1 |
| authorities | 163,067 |
| name_opinions | 517,284 + 249,143 = 766,427 |
| assignment_opinions | 927,497 |
| validity_opinions | 11,327 |
| collections | 275,554 |
| additional_collection_refs | 371,774 |
| specimens | 167,150 |

## jsonb fingerprints

Keyed by legacy id, so regenerated permids don't affect them:

```sql
SELECT count(*), md5(string_agg(collection::text, '|' ORDER BY (collection->'legacyIDs'->>'oldpbdbID')::int)) FROM collections;
SELECT count(*), md5(string_agg(specimen::text,  '|' ORDER BY (specimen->'legacyIDs'->>'oldpbdbID')::int))  FROM specimens;
```

| Table | Rows | md5 |
|---|---|---|
| collections | 275,554 | `1e60b277e526a28c5dd1cb1ce8381f2d` |
| specimens | 167,150 | `edf90614bd8b8f7b6c86c3aa9c080a43` |

This change must reproduce both hashes after a rebuild: it doesn't alter stored payloads.

## Rollback

Revert the change's commits and rebuild with `dropdb`/`createdb` + `node src/run-migrations.js --createdb`. The stored jsonb is unchanged by this change, and the new dictionary tables are purely additive, so the rebuilt database matches this baseline.

## Verification after the change (2026-09-18)

Rebuilt with `dropdb`/`createdb` + `node src/run-migrations.js --createdb` (run started 2026-09-18T22:54:17Z):

- Success, 10 steps. Preflight checked 22 dictionary tables. The runner audited `collection` and `specimen`: 275,554 and 167,150 rows, 0 violations.
- Every step delta equals the baseline except `pbot-refs`: +238 vs. +237. That step reads the live PBot API, so upstream growth is the likely cause; this change doesn't touch it.
- jsonb fingerprints are identical to the baseline:
  - collections: `1e60b277e526a28c5dd1cb1ce8381f2d`
  - specimens: `edf90614bd8b8f7b6c86c3aa9c080a43`
- `npm test`: 55/55. `test-collections-transforms.js`: 42/42.
- `node src/audit-payloads.js --round-trip`: 0 differences across all head rows.
- Negative check: renaming `dictionaries.lithologies` 'sandstone' flagged exactly the 34,728 collections using it (exit 1). After restoring the name, the audit was clean (exit 0).
- Rollback: see above. Reverting and rebuilding restores the prior state, because stored payloads were verified unchanged.
