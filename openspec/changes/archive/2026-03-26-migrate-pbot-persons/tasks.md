## 1. Create migrate-pbot-persons.js

- [x] 1.1 Scaffold `migrate-pbot-persons.js` with PG-only connection setup (env var validation for `PG_HOST`, `PG_USER`, `PG_PASSWORD`, `PG_DATABASE`), main function structure, and error handling with `process.exitCode = 1`
- [x] 1.2 Implement `fetchPbotPersons()` — GraphQL query to fetch all Person nodes (`pbotID`, `given`, `surname`, `email`, `orcid`, `registered`) from `https://pbot.paleobiodb.org/graphql`
- [x] 1.3 Implement email filter — skip persons with null/empty email, log counts (total fetched, filtered, to process)
- [x] 1.4 Implement `normalizeOrcid()` — strip `https://orcid.org/` or `http://orcid.org/` prefix, return NULL for empty/whitespace-only values
- [x] 1.5 Load dictionary lookups at startup — `dictionaries.genders` (need Anonymous id)
- [x] 1.6 Implement match cascade: ORCID match (`WHERE orcid = $1`), then email match (`WHERE lower(email) = lower($1)`), then name match (`WHERE lower(given_name) = lower($1) AND lower(family_name) = lower($2)`). Short-circuit on first match. Warn and skip on ambiguous name match (multiple rows).
- [x] 1.7 Implement backfill on match — update ORCID on PG record if PG value is NULL/empty and PBot has one. Update email on PG record if PG value is NULL/empty and PBot has one (applies to ORCID and name matches).
- [x] 1.8 Implement new person insertion for unmatched persons — `given_name`, `family_name`, `email`, `orcid` from PBot; defaults: `role_id=6`, `gender_id=Anonymous`, `country_code=NULL`, `authorizer_person_id=1106`, `active=true`, remaining fields NULL. Auto-generated ID.
- [x] 1.9 Reset `persons` identity sequence to `MAX(id)` after inserts (only if inserts occurred)
- [x] 1.10 Implement summary logging — start/end timestamps, elapsed time, counts for: ORCID matches, email matches, name matches, ambiguous skips, new inserts, ORCIDs backfilled, emails backfilled

## 2. Update migrate-pbot-refs.js

- [x] 2.1 Remove the person resolution block (lines ~263-381): enterer collection, name matching, person insertion, ORCID updates, gender/country dictionary lookups, identity sequence reset
- [x] 2.2 Remove the `dictionaries.countries` insert and lookup (lines ~237-246)
- [x] 2.3 Remove the `dictionaries.genders` lookup (lines ~228-233) — no longer needed
- [x] 2.4 Replace enterer resolution with a persons table lookup: for each reference's resolved enterer (from `enteredBy`), query `WHERE lower(given_name) = lower($1) AND lower(family_name) = lower($2)` to get `enterer_person_id`. Skip reference with warning if not found.
- [x] 2.5 Update verification logging to remove person match/insert/update counts

## 3. Verify

- [x] 3.1 Run `migrate-pbot-persons.js` against a test PG database (after `migrate-persons.js` has run) and verify: persons with email are processed, match cascade works correctly, backfill updates apply, new persons are inserted with correct defaults
- [x] 3.2 Run `migrate-pbot-refs.js` after `migrate-pbot-persons.js` and verify: enterer lookups resolve correctly, references are upserted, no person insertion occurs in the refs script
- [x] 3.3 Verify idempotency — re-run both scripts and confirm no duplicates, no errors, and backfill updates are no-ops on second run
