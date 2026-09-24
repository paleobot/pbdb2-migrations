## 1. The sources

- [x] 1.1 Rewrite `payloadSchemas/character.schema.js` as `characterSource` (and `default`): no envelope, `$id .../character.json`, `unevaluatedProperties: false`, the four properties and annotations in the `payload-schema-variants` spec, base `required: ["name"]`, `x-create: { properties: { name: { type: "string", minLength: 1 } } }`, and a header comment in the style of `schema.schema.js` covering the optional `definition` and the parents and order left in columns (D1)
- [x] 1.2 Rewrite `payloadSchemas/state.schema.js` as `stateSource` the same way, plus writable, optional `quantitative` with `x-storage: { column: "quantitative" }`; the header covers why it is writable and that a quantitative value belongs to an observation (D1)
- [x] 1.3 Add a comment line to the `$defs` sketch in `payloadSchemas/schema.schema.js`: its `name = "quantity" → value` rule predates `states.quantitative`, and a value belongs to a description's link to the state (D5)
- [x] 1.4 Add `character` and `state` to `payloadSchemas/tests/sources.test.js`: each module exports only its source and `default`; every variant compiles in strict mode; `patch-guard` blocks exactly `permid` and `legacyIDs`; `db` declares `legacyIDs`, `name`, `definition` only and requires only `name`
- [x] 1.5 Unit-test the spec scenarios: stored payloads with and without `definition` pass `db`; `definition: null`, a missing `name`, and undeclared `order` / `parentCharacter` / `quantitative` keys fail `db`; `in-create` rejects `name: ""` and accepts a non-empty name; state `in-create` accepts bodies with and without `quantitative`; `split`/`merge` carry `quantitative` through its column and emit no column when it is absent

## 2. PBot schemas migration

- [x] 2.1 In `src/pbot-schemas-migration/migrate-pbot-schemas.js`, resolve and compile the `db` variants of `characterSource` and `stateSource` alongside `schemaSource`, before any fetch (D2)
- [x] 2.2 Move the Character and State fetches up, next to the Schema fetch, keeping their fetch counts and log lines
- [x] 2.3 Change `buildCharacterJsonb` and `buildStateJsonb` to write `definition` only when PBot's value is non-null; no trimming (D3)
- [x] 2.4 Build and validate every character and state payload, with the schema payloads, before Phase 1; log kind, `pbotID`, payload and errors for each failure; throw after logging all of them, before any insert. The Phase 2 and 3 loops read the built payloads from maps keyed by `pbotID`
- [x] 2.5 Confirm `src/tests/pbot-schemas-summary.test.js` still passes and the summary lines are unchanged

## 3. Audit and runner

- [x] 3.1 Add `character` and `state` entries to `REGISTRY` in `src/audit-payloads.js`, after `schema`: versioned, no children, columns `['permid']` and `['permid', 'quantitative']` (D4)
- [x] 3.2 Update `src/tests/audit-payloads.test.js`: default entity list, the unknown-entity case (use `opinion`), `parseArgs` accepts `character` and `state`, and the registry's versioned flags
- [x] 3.3 Update `src/tests/run-migrations-audit.test.js`: the full run audits eight entities; `--only pbot-schemas` audits `schema`, `character`, `state`
- [x] 3.4 Confirm `src/run-migrations.js` needs no code change; update the audited-entity list in `src/README.txt`

## 4. Verification

- [x] 4.1 `npm test`: all suites pass
- [x] 4.2 With `PBOT_TOKEN` set, create `pbdb_charstate_verify` (with PostGIS) and run `PG_DATABASE=pbdb_charstate_verify node src/run-migrations.js --createdb`. Every step's postconditions pass, `pbot-schemas` validates every schema, character and state payload, and the runner's audit is clean for all eight entities. If a live PBot record fails validation, stop and bring it to the user rather than loosening `db`
- [x] 4.3 On the side database, `node src/audit-payloads.js --round-trip`: zero violations and zero differences for all eight entities
- [x] 4.4 Compare `characters` and `states` between the side database and localhost `pbdb`, matched on `legacyIDs.pbotID`: counts; jsonb equal after removing a null `definition` from the localhost row; the side rows have no `definition: null`; and parent (by the parent's `pbotID`), `sort_order` and `quantitative` equal. Confirm `schemas` is unchanged too. Report any difference and whether PBot edits explain it
- [x] 4.5 Bring localhost `pbdb` up to date, by the method the user chooses: a pipeline rebuild, or `jsonb - 'definition'` on exactly the rows holding `definition: null`. Then run `node src/audit-payloads.js --round-trip` on localhost: zero violations and differences
- [x] 4.6 With the user's go-ahead, drop `pbdb_charstate_verify`

## 5. Specs

- [x] 5.1 Confirm the four delta specs match what was implemented, amending them if implementation revealed anything different
- [x] 5.2 Run `openspec validate convert-character-state-payload-schemas --strict`
- [x] 5.3 Sync deltas into `openspec/specs/` via `/opsx:sync` or at archive time
