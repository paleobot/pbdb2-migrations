## 1. The codec

- [x] 1.1 Add `referencePermid` to `payloadSchemas/lib/codecs.js`: `sources: [REFS_SOURCE]` (the existing constant), split `reference` permid → head `refs.id` as a string in the `x-storage` column, merge the column back to `reference`; absent in, nothing out; unresolved values throw through `lookup` naming `referencePermid` (D2). Leave `collectionReferences` and `personPermid` unchanged
- [x] 1.2 Register it in `codecs`
- [x] 1.3 In `payloadSchemas/tests/storage.test.js`, cover the spec scenarios with a hand-built context: permid → id, id → permid, a superseded ref resolves to the head (the context holds heads only), unknown permid throws naming the codec, and `codecKeyColumns(authoritySource)` maps `refs` → `reference_id`

## 2. The authority source

- [x] 2.1 Rewrite `payloadSchemas/authority.schema.js` as `authoritySource` (and `default`): no envelope, `$id .../authority.json`, `unevaluatedProperties: false`, and a header comment in the style of `person.schema.js` covering the `reference` codec and the `publishedInReference` duplication left out of scope (D1)
- [x] 2.2 Declare the seven properties with the annotations in the `payload-schema-variants` spec, carrying the legacy constraints over unchanged (`year` `maxLength: 4`, `descriptors` and `oldpbdbIDs` arrays of strings)
- [x] 2.3 Set base `required` to `citation`, `publishedInReference`, `reference`; add `x-create: { properties: { year: { type: "string", pattern: "^[0-9]{4}$" } } }` (D3)
- [x] 2.4 Add `authority` to `payloadSchemas/tests/sources.test.js`: the module exports only `authoritySource` and `default`; every variant compiles in strict mode; `patch-guard` blocks exactly `permid` and `legacyIDs`; `db` declares neither `permid` nor `reference` and requires only `citation` and `publishedInReference`
- [x] 2.5 Unit-test the spec scenarios: stored and sentinel payloads pass `db`; missing `citation`, missing `publishedInReference`, `year: "19690"` and an undeclared key fail `db`; `in-create` requires `reference`, rejects `year` `"0"` and `"abc"`, accepts `"1969"`, and accepts an `"authority unknown"` body with no `year`
- [x] 2.6 Update the stale `authoritySchema` mention in `payloadSchemas/opinionAttribution.schema.js` to `authoritySource`

## 3. Authorities migration

- [x] 3.1 In `src/authorities-migration/migrate-authorities.js`, drop the bare `Ajv` import and module-level compile; compile `deriveVariant(await resolveEnums(pg, authoritySource), 'db')` with `createAjv()` before the MariaDB read (D4)
- [x] 3.2 Validate `payload` itself rather than `{ authority: payload }`; keep the validation point, the logged `taxon_no` and payload, and the abort unchanged
- [x] 3.3 Run `src/authorities-migration/tests/test-authorities-transforms.js` and confirm it still passes (it is outside `npm test`)

## 4. Audit and runner

- [x] 4.1 Add an `authority` entry to `REGISTRY` in `src/audit-payloads.js`: table `authorities`, column `authority`, source `authoritySource`, `versioned: true`, columns `['permid', 'reference_id']`, no children (D5)
- [x] 4.2 Update `src/tests/audit-payloads.test.js`: default entity list, the unknown-entity message, `parseArgs` accepts `authority`, and the registry's versioned flags
- [x] 4.3 Update `src/tests/run-migrations-audit.test.js`: the full run audits `collection`, `specimen`, `person`, `reference`, `authority`; `--only authorities` audits `authority`; the no-audited-table case uses `authority-opinions`
- [x] 4.4 Confirm `src/run-migrations.js` needs no code change: audited entities follow from `REGISTRY` and each step's `writes`

## 5. Verification

- [x] 5.1 `npm test`: all suites pass
- [x] 5.2 Run the full pipeline into a side database: `PG_DATABASE=pbdb_authority_verify node src/run-migrations.js --createdb`. Every step's postconditions pass, the `authorities` step validates every payload, and the runner's audit is clean for all five entities
- [x] 5.3 On the side database, `node src/audit-payloads.js --round-trip`: zero violations and zero differences for collection, specimen, person, reference and authority; authority reports 163,067 rows checked
- [x] 5.4 Compare `authorities` between the side database and localhost `pbdb`, matched on `legacyIDs.oldpbdbIDs`: the jsonb is identical on every row, the counts match (163,067), and each row's reference resolves to the same ref (compared by the ref's `legacyIDs`, since `refs.id` and permids are regenerated)
- [x] 5.5 With the user's go-ahead, drop `pbdb_authority_verify`. Localhost `pbdb` is left as it is: no DDL or stored jsonb changed

## 6. Specs

- [x] 6.1 Confirm the four delta specs match what was implemented, amending them if implementation revealed anything different
- [x] 6.2 Run `openspec validate convert-authority-payload-schema`
- [x] 6.3 Sync deltas into `openspec/specs/` via `/opsx:sync` or at archive time
