## Why

`migrate-name-opinions.js` mints the root `name_opinions` rows from classic `authorities` — the identity layer every later opinion resolves against — but it is out of sync with the current schema authority, `postgresql/create_new.sql`. Its `validity_opinions` write path still targets the older draft schema: it looks up a `nomenclatural_statuses` status `'informal'` that the current seed no longer contains (the script fatally exits on the missing lookup), and inserts `targeted` / `target_permid` columns that no longer exist on `validity_opinions`. Per updated instructions, the special handling that produced those rows is itself wrong: the 18 `taxon_rank = 'informal'` authorities should migrate as ordinary root `name_opinions` rows at rank `'unranked'`, with **no** `validity_opinions` entry at all. This script must run correctly against the reset `create_new.sql` tables **before** `create-opinions-migration`, whose opinion migration reads the root permids this script produces.

## What Changes

- **Rename** `migrate-name-opinions.js` → `migrate-authorities-opinions.js`. The name now reflects what it does: it mints roots from classic `authorities` and reads no classic `opinions`. (The two `opinions`-reading scripts — `migrate-assignment-opinions.js`, `migrate-synonymy-opinions.js` — are the ones `create-opinions-migration` supersedes; this one is kept as their upstream prerequisite.)
- **Remove all `validity_opinions` emission** from the script: the `'informal'` status lookup, the `validityOpinions` accumulator, the per-informal-row emission, the validity insert block, and its identity-sequence reset. The 18 `taxon_rank = 'informal'` rows now produce **only** their root `name_opinions` row. After this change the script writes exclusively to `name_opinions`; `validity_opinions` becomes purely `create-opinions-migration`-derived.
- **Retain** the `informal → 'unranked'` rank collapse on the root `name_opinions` row (unchanged), matching the updated `payloadSchemas/mappings/authorities-opinions.md`.
- **BREAKING (spec):** removes the `name-opinions-migration` capability's requirement to emit a `validity_opinions` row per informal-rank source row. No running system consumes the opinion-migration output yet, so there is no runtime consumer to break.

Deliberately out of scope: no change to `postgresql/create_new.sql` (the `name_opinions` insert path is already compatible with it; `negates` correctly defaults to `false`), and therefore no regeneration of `reset-opinions.sql`. The `informal`/`nomen vanum` status question is moot — no status is written for these rows.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `name-opinions-migration`: the migrating script is renamed to `migrate-authorities-opinions.js`, and the requirement "Emit a `validity_opinions` row for each informal-rank source row" is **removed** — informal-rank sources now migrate as root `name_opinions` rows at rank `'unranked'` with no validity record. All other requirements (root minting, permid reuse, rank resolution, authority/reference/attribution/year resolution, orphan skip-and-log, person zero-sentinel fallback, attribution validation, transaction wrapping) are unchanged except that the transaction and reconciliation no longer reference `validity_opinions`.

## Impact

- **Renamed:** `migrate-name-opinions.js` → `migrate-authorities-opinions.js` (update any references — e.g. `db.js`/harness callers, package scripts).
- **Modified:** the renamed script (remove the `validity_opinions` path); `openspec/specs/name-opinions-migration/spec.md` (delta removing the informal-validity requirement and reflecting the rename).
- **Unchanged:** `postgresql/create_new.sql`, `reset-opinions.sql`, `payloadSchemas/mappings/authorities-opinions.md` (already updated by the maintainer to describe the no-validity behavior).
- **Source → target:** MariaDB `authorities` (read via `mariadb`) → PostgreSQL `name_opinions` root rows only (written via `pg`), reading migrated `authorities`, `refs`, `persons`, and the `dictionaries.namechange_reasons` / `dictionaries.taxonomy_ranks` seeds for id resolution.
- **Ordering:** lands **before** `create-opinions-migration`; that change's root-permid reads depend on this script running correctly against the reset tables.
- **Cross-check note:** the Aurora `pbdb2_migration_test` reference may still carry the 18 informal `validity_opinions` rows (old design); `create-opinions-migration`'s Aurora cross-check (task 5.5) must treat their absence in the new run as a known-intentional difference.
- **Dependencies:** Node ESM; `mariadb`/`pg` pools, `uuid`, `ajv` (all already in use). Runs against the localhost `MARIADB_*` / `PG_*` connections in `.env`.
