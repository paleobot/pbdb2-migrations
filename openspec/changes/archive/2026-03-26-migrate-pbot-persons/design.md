## Context

The current `migrate-pbot-refs.js` embeds ~120 lines of person resolution logic: it collects enterer persons from `enteredBy` relationships on references, matches them to PG `persons` by name, inserts new persons with defaults, and backfills ORCIDs. This logic references a `dictionaries.countries` table and `country_id` column that no longer exist (the schema now uses `country_code text`), making it broken as-is.

The PBDB person migration (`migrate-persons.js`) handles MariaDB persons. PBot persons have no equivalent dedicated script. The new `migrate-pbot-persons.js` fills this gap and decouples person handling from entity-specific migrations.

The PBot GraphQL API exposes Person nodes with: `pbotID`, `given`, `surname`, `email`, `orcid`, `registered`. There is no gender, country, institution, or role data.

## Goals / Non-Goals

**Goals:**
- Create `migrate-pbot-persons.js` that fetches PBot Person nodes and upserts them into `persons`
- Match PBot persons to existing PG records via a robust cascade (ORCID → email → name)
- Backfill ORCID and email on matched records
- Remove person handling from `migrate-pbot-refs.js`

**Non-Goals:**
- Migrating PBot persons without an email address (these are excluded by design)
- Enriching PBot person records with gender, country, or institution data (not available from PBot)
- Changing the `migrate-persons.js` script itself (only its spec is updated to remove PBot-related requirements)
- Resolving the `notes` vs `description` field mapping question in `migrate-pbot-refs.js` (pinned for later)

## Decisions

### 1. PG-only connection (no MariaDB)

PBot data comes from the GraphQL API, not MariaDB. The script uses a standalone `pg.Pool` connection (same pattern as `migrate-pbot-refs.js`) rather than importing from `db.js`, which bundles both MariaDB and PG connections.

**Alternative considered**: Import from `db.js` and ignore the MariaDB pool. Rejected because it would require MariaDB env vars to be set even though they're unused, creating a confusing dependency.

### 2. Match cascade order: ORCID → email → name

ORCID is the most reliable identifier (globally unique, institution-independent). Email is next (case-insensitive, but can change over time). Name is the weakest signal (ambiguity risk with common names).

The cascade short-circuits: once a match is found, later steps are skipped. This prevents a scenario where an ORCID match and a name match point to different PG records.

**Alternative considered**: Match on all three simultaneously and require agreement. Rejected as overly complex — the cascade is simple, predictable, and handles the common cases well.

### 3. Ambiguous name matches: warn and skip

If `lower(given_name) = lower(given) AND lower(family_name) = lower(surname)` returns multiple PG rows, the PBot person is skipped entirely. This is conservative but safe — a wrong match could corrupt FK relationships downstream.

**Alternative considered**: Pick the first match or prompt interactively. First-match is arbitrary and risky. Interactive prompting doesn't fit a batch migration script.

### 4. Authorizer defaults to Douglas Meredith (id=1106)

Same approach as the existing `migrate-pbot-refs.js`. PBot has no concept of an authorizer chain, so all PBot-sourced persons get a fixed authorizer. This is a known simplification — authorizer assignments can be corrected after migration.

### 5. Sequential person processing (no batching)

Each PBot person is processed one at a time: match query → backfill update → or insert. This is simpler than batching and the person count from PBot is small (likely dozens to low hundreds with email addresses). Performance is not a concern.

**Alternative considered**: Batch all inserts. Rejected because the match cascade requires per-person queries anyway, so batching only the inserts adds complexity for minimal gain.

### 6. Enterer lookup in migrate-pbot-refs.js after cleanup

After removing person handling, `migrate-pbot-refs.js` will look up each enterer by name against the `persons` table. This is the same query the current code uses, but now it's a read-only lookup rather than a match-then-possibly-insert flow.

If a person isn't found (e.g., they had no email and were filtered out by `migrate-pbot-persons.js`), the reference is skipped with a warning. This is an acceptable tradeoff — refs without a resolvable enterer are a small minority and can be investigated manually.

## Risks / Trade-offs

**[PBot persons without email are excluded]** → By design. These are likely incomplete or test records. If legitimate persons are missed, they'll surface as warnings in `migrate-pbot-refs.js` when their references can't resolve an enterer. These can be addressed case-by-case.

**[Name matching can produce false negatives]** → Two people with slightly different name forms (e.g., "Bob" vs "Robert") won't match on name. ORCID and email matching mitigate this for most active researchers. Remaining mismatches are logged as new inserts.

**[No deduplication within PBot]** → If PBot has duplicate Person nodes for the same real person (same name, different pbotIDs), both will be processed. If one matches and the other doesn't, a duplicate PG record may be created. The risk is low given the small dataset size.

**[Run order is now critical]** → `migrate-pbot-persons.js` MUST run after `migrate-persons.js` (so PBDB persons exist for matching) and before `migrate-pbot-refs.js` (so PBot persons exist for enterer lookups). This dependency is documented but not enforced programmatically.

## Open Questions

- **Notes vs description mapping in PBot refs**: Pinned for later discussion. Does not affect person migration.
- **Nathan Jud hardcode**: The current `migrate-pbot-refs.js` hardcodes Nathan Jud → PG id=414 for duplicate resolution. Should this hardcode move into `migrate-pbot-persons.js`, or is it no longer needed once the match cascade is in place? (If Nathan Jud has a unique ORCID or email, the cascade handles it automatically.)
