## Context

The PBot system (pbot.paleobiodb.org) is a Neo4j-backed GraphQL application where paleobotanists enter Reference and Person data independently of the legacy PBDB MariaDB database. The existing `migrate-refs.js` script migrates ~94K references from MariaDB → PostgreSQL. This design covers a new, separate script (`migrate-pbot-refs.js`) that fetches the ~136 PBot-only references via HTTP/GraphQL and inserts them into the same PostgreSQL `references` table, along with any new Person records needed.

Current state:
- 167 Reference nodes in PBot, 31 of which have a `pbdbid` (already in PG from MariaDB migration)
- 26 unique enterer Persons across all PBot references; 9 match existing PG persons by name, 17 are new
- PBot exposes `ENTERED_BY` and `AUTHORED_BY` relationships on References, with `type` (CREATE/EDIT) and `timestamp` properties on `ENTERED_BY`
- PG `persons.orcid` is NULL for all records; 19 of 26 PBot enterers have ORCID values

## Goals / Non-Goals

**Goals:**
- Migrate all PBot-only References (those without `pbdbid`) into PostgreSQL `references`
- Insert new Person records for PBot enterers not already in PostgreSQL
- Update ORCID on matched existing persons
- Produce a standalone script with no MariaDB dependency
- Follow existing migration conventions (idempotent upserts, logging, verification)

**Non-Goals:**
- Re-migrating references that already came from MariaDB (those with `pbdbid`)
- Migrating PBot data beyond References and their enterer Persons (e.g., Collections, Specimens, OTUs)
- Modifying the PostgreSQL schema (no DDL changes)
- Handling `AUTHORED_BY` persons as separate person records — they are stored as structured data in the JSONB column only

## Decisions

### 1. Data source: GraphQL over HTTP (not direct Neo4j access)
Fetch data via `POST https://pbot.paleobiodb.org/graphql` using a single query that retrieves all Reference fields plus nested `enteredBy` and `authoredBy` relationships. This avoids needing Neo4j credentials and uses the existing public API.

**Alternative considered**: Direct Cypher queries against Neo4j — rejected because it requires database credentials and network access to the Neo4j instance.

### 2. Enterer resolution: `type='CREATE'` with earliest-timestamp fallback
Each Reference has one or more `ENTERED_BY` relationships with a `type` property (`CREATE`, `EDIT`, or `null`) and a `timestamp`. The script selects the relationship with `type='CREATE'`. If none has `type='CREATE'`, it falls back to the entry with the earliest `timestamp`.

**Alternative considered**: Using the most recent entry, or deduplicating by person — rejected because the original creator is the most meaningful enterer for the `enterer_person_id` field.

### 3. Person matching: exact name match
Match PBot enterer persons to existing PG persons by `(lower(given_name), lower(family_name))`. ORCID matching was considered but is not viable because all PG `orcid` values are currently NULL.

For the known duplicate (Nathan Jud, PG ids 414 and 911), the script hardcodes the match to id=414 (higher-privilege role).

Unmatched persons are inserted with auto-generated IDs, `role_id=6` (Person), `gender_id` for Anonymous, `country_id` for Unknown, and `authorizer_person_id` self-referencing.

### 4. `authorizer_person_id`: Douglas Meredith (id=1106)
All PBot-sourced references use id=1106 as `authorizer_person_id`. PBot has no authorizer concept, and Douglas Meredith is the administrator overseeing this migration.

### 5. `permid`: use PBot `pbotID` directly
PBot's `pbotID` is already a UUID. Using it as `permid` creates a stable, traceable link between the PBot source and the PostgreSQL record.

### 6. Reference JSONB field mapping

| PBot GraphQL field | JSONB field | Transform |
|---|---|---|
| `title` | `title` | Direct |
| `year` | `publicationYear` | Rename |
| `publicationType` | `publicationType` | Direct (values align with target enum) |
| `journal` | `journalTitle` | Rename; only for journal articles |
| `publicationVolume` | `journalVolume` / `seriesVolume` | Depends on publicationType |
| `publicationNumber` | `journalNumber` | Only for journal articles |
| `publisher` | `publisher` | Direct |
| `bookTitle` | `bookTitle` | Direct |
| `bookType` | `bookType` | Direct |
| `editors` | `editors` | Direct |
| `doi` | `doi` | Direct |
| `firstPage` / `lastPage` | `pages: {first, last}` | Parse to integers |
| `description` | `notes` | Rename |
| `authoredBy` | `authors: [{familyName, givenName}]` | Restructure from relationship; respect `order` property |
| (none) | `language` | Default to `'unknown'` |
| `pbotID` | `pbotID` | Preserve source ID in JSONB for traceability |

### 7. `reference_type_id` mapping
PBot `publicationType` values map to `dictionaries.reference_types` using the same type names. The script loads the dictionary at startup and looks up IDs by name. Two PBot-specific publication types require aliasing:

| PBot `publicationType` | PG `reference_type` |
|---|---|
| `contributed article in edited book` | `article in edited collection` |
| `edited book of contributed articles` | `edited collection` |

Unmapped values default to "other".

### 8. ID generation for references
New reference IDs are auto-generated by the PG identity sequence. The script does not set explicit IDs for PBot references (unlike the MariaDB migration which preserves `reference_no`). After insertion, the sequence is reset to `MAX(id)`.

## Risks / Trade-offs

- **[Network dependency]** → The script requires HTTPS access to pbot.paleobiodb.org. If the API is down, the script fails. Mitigation: the dataset is small (167 nodes) and can be cached/retried.
- **[Name matching false positives]** → Two different people could share the same given+family name. Mitigation: with only 26 enterers and 1,304 PG persons, manual review of the 9 matches confirms they are correct.
- **[Name matching false negatives]** → A person could exist in PG under a different name variant (e.g., "Camila Martinez" vs "Camila Martinez Aguillon"). Mitigation: these are treated as new persons; future ORCID-based dedup can merge them later.
- **[PBot API schema changes]** → If PBot's GraphQL schema changes, the query may break. Mitigation: the query uses explicit field names and the PBot API is stable.
- **[Two refs lack `type='CREATE'`]** → Refs `f5758b43` and `0d18fad4` have only `null`/`EDIT` entries. Mitigation: fallback to earliest timestamp selects the most likely original enterer.
