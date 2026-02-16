## 1. Setup and DB Connection

- [x] 1.1 Create `migrate-pbot-refs.js` with PG-only database connection (no MariaDB dependency). Use `pg` Pool from `db.js` or create a standalone PG connection using the same `.env` variables.
- [x] 1.2 Load dictionary lookups at startup: `dictionaries.reference_types`, `dictionaries.genders` (for Anonymous id), `dictionaries.countries` (for Unknown id), and `dictionaries.roles` (for Person id=6).

## 2. Fetch PBot Data

- [x] 2.1 Implement GraphQL fetch function using Node.js `fetch` (or `https` module) to POST to `https://pbot.paleobiodb.org/graphql`. Query all Reference fields plus nested `enteredBy { type timestamp { formatted } Person { pbotID given surname email orcid registered } }` and `authoredBy { order Person { pbotID given surname } }`.
- [x] 2.2 Filter out References with non-null, non-empty `pbdbid` field. Log the count of skipped references.

## 3. Person Resolution

- [x] 3.1 Collect all unique enterer Persons from the filtered References. Deduplicate by `pbotID`.
- [x] 3.2 For each unique enterer, query PG `persons` by `lower(given_name) = lower(given)` AND `lower(family_name) = lower(surname)`. Hardcode Nathan Jud to id=414.
- [x] 3.3 For unmatched enterers, INSERT new person records with auto-generated IDs, `role_id=6`, `gender_id` for Anonymous, `country_id` for Unknown, `authorizer_person_id` self-referencing, `active=true`. Normalize ORCID (strip `https://orcid.org/` prefix; treat empty string as NULL).
- [x] 3.4 For matched enterers with a non-empty PBot ORCID where PG `orcid` is NULL or empty, UPDATE the PG person's `orcid` with the normalized value.
- [x] 3.5 Reset the `persons` identity sequence to `MAX(id)` after any inserts.
- [x] 3.6 Build a `pbotID → pgPersonId` lookup map for use in reference insertion.

## 4. Reference Transformation

- [x] 4.1 Implement enterer resolution: for each Reference, select the `enteredBy` entry with `type = 'CREATE'`; fall back to earliest `timestamp` if no CREATE exists. Log a warning for fallback cases.
- [x] 4.2 Implement `reference_type_id` mapping from PBot `publicationType` string to `dictionaries.reference_types` id. Default to "other" for unrecognized or null values.
- [x] 4.3 Build the `reference` JSONB object from PBot fields: map `title`, `year` → `publicationYear`, type-dependent fields (`journalTitle`, `journalVolume`, `journalNumber`, `seriesVolume`, `bookTitle`, `bookType`), `publisher`, `editors`, `doi`, `description` → `notes`, `pages` (parsed to `{first, last}` integers), `language` = `'unknown'`, `pbotID` for traceability.
- [x] 4.4 Build the `authors` array from `authoredBy` relationship, sorted by `order` property, with `{ familyName: Person.surname, givenName: Person.given }`.

## 5. Reference Insertion

- [x] 5.1 Insert/upsert references into PG `"references"` table using `INSERT ... ON CONFLICT (permid) DO UPDATE`. Set `permid` = PBot `pbotID`, `authorizer_person_id` = 1106, `enterer_person_id` from the pbotID→pgPersonId lookup, `preceded_by_id` = NULL, `succeeded_by_id` = NULL, `removed` = false. Let `id` auto-generate.
- [x] 5.2 Reset the `references` identity sequence to `MAX(id)` after all inserts.

## 6. Verification and Logging

- [x] 6.1 Log start time, fetch count, skip count, person match/insert/update counts, reference upsert count, and elapsed time.
- [x] 6.2 Verify final count: query PG for references with `permid` matching PBot UUIDs and compare to expected count. Log PASSED or WARNING.
- [x] 6.3 Add `permid` unique constraint to `"references"` table if not already present (required for `ON CONFLICT (permid)` upsert).
