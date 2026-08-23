## Why

`taxa` (the Layer 3 ledger materializing `derive_taxa()`'s output) is currently versioned —
`install_version_triggers('taxa')`, `preceded_by_id`/`succeeded_by_id`, an append-only history of
every prior derived state — per D8 in `docs/classic-taxa-opinions.md` ("point-in-time
reconstruction is a real requirement"). On reflection this no longer holds: nothing reads a
superseded `taxa` row, the table is 100% rebuildable from Layer 1 opinions at any time via
`derive_taxa()`, and the version machinery buys only cost (a `pg_constraint` FK-swing scan on
every write, `rebuild_taxa()`/`assert_taxa_invariant()` both having to reason about "current
heads" instead of just "the rows"). `taxa` should be a plain rebuildable cache: one row per
permid, updated in place.

## What Changes

- Remove `preceded_by_id` / `succeeded_by_id` from `taxa` and the `SELECT
  install_version_triggers('taxa');` call — `taxa` is no longer versioned.
- Add `UNIQUE (permid)` to `taxa` (one row per permid, period — not "one live head per permid"
  among several historical rows).
- Drop the `WHERE succeeded_by_id IS NULL` predicate from the six `taxa_head_*_idx` indexes
  (rename away from `_head_`, which is now meaningless).
- Rewrite `rebuild_taxa()` from append-only diff-insert (relying on the version trigger to close
  out the old head automatically) to an explicit `UPDATE` (changed permids) + `INSERT` (new
  permids) upsert.
- Rewrite `assert_taxa_invariant()` to compare `derive_taxa(NULL)` against all of `taxa` directly,
  instead of `taxa WHERE succeeded_by_id IS NULL`.
- **BREAKING**: `taxa` no longer retains historical derived states. Per-version provenance /
  point-in-time reconstruction of *what the ledger looked like at time T* is no longer supported
  by this table — only the current derivation is stored. (Layer 1 opinions remain fully versioned
  and are themselves the durable history of what was asserted, when.) This reverses D8; a new,
  forward-pointing decision entry is added to `docs/classic-taxa-opinions.md` rather than editing
  D8 in place, per that document's own supersession convention.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `taxa-opinions`: the "Versioning regimes are applied correctly per table" requirement changes —
  `taxa` moves from the versioned-via-`install_version_triggers()` group to a plain,
  non-versioned, `UNIQUE (permid)` ledger. The `rebuild_taxa()` requirement's "append a new
  version only where derived output differs from the current head" behavior changes to "upsert in
  place: update where output differs, insert where the permid is new."

## Impact

- `postgresql/create_new.sql`: `taxa` table DDL, its six `taxa_head_*_idx` indexes,
  `rebuild_taxa()`, `assert_taxa_invariant()`.
- `docs/classic-taxa-opinions.md`: new decision entry superseding D8 (append-only; D8's own text
  is left in place with a forward pointer, per the document's existing convention).
- `openspec/specs/taxa-opinions/spec.md`: spec delta for the two requirements above.
- No other table's versioning changes (`name_opinions`, `assignment_opinions`,
  `validity_opinions`, `taxon_annotations`, and all non-opinion versioned entities are unaffected).
  Nothing currently references `taxa.preceded_by_id` / `taxa.succeeded_by_id` outside
  `create_new.sql` itself (verified by repo-wide search), so no migration scripts need changes.
