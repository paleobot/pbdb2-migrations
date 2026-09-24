## Context

`character.schema.js` and `state.schema.js` are 46 lines each and identical but for the names: an envelope
around `legacyIDs.pbotID`, `name` and `definition`, with `name` and `definition` required and a commented-out
`order`. Nothing imports either. `migrate-pbot-schemas.js` fetches characters and states only after it has
inserted every schema, builds each payload, and inserts it without validation.

Measured on localhost `pbdb` (2026-09-23):

```
schemas (8)
 └─ characters (336)      parent: schema 89 · character 247      depth ≤ 5
     └─ states (1,325)    parent: character 1,001 · state 324    depth ≤ 4

                           characters     states
definition = null          249            284
name empty                 0              0
sort_order NULL            22             449
quantitative               —              73 (all named "quantity")
```

No table has a foreign key to `characters` or `states`. The DDL keeps `--definition text` commented out with
no NOT NULL, the original intent that a definition is optional. PBot now returns 1,326 states, one of which has
an unresolved parent and is skipped as an orphan. That predates this change.

In PBot, a Description has CharacterInstances, each pointing to a State in a Schema, and a quantitative
state's measured value is a property of that link. `states.quantitative` is what tells such an observation
that it needs a value.

## Goals / Non-Goals

**Goals:**

- `characterSource` and `stateSource`, unenveloped, with every variant derived and every stored row valid
  against `db`.
- `definition` optional, and absent rather than null at rest.
- `quantitative` visible and settable through the state payload.
- Every schema, character and state payload validated before the step writes anything; `characters` and
  `states` audited, round trip included.

**Non-Goals:**

- **Parents and sibling order in the payload.** They depend on the API choice between separate routes (a
  character body names its parent and order) and one call that creates the tree (parent and order are implied
  by nesting and array position). Adding fields later is compatible; removing them would break clients. The
  columns are unchanged.
- **A quantitative value.** It belongs to a future description/observation entity, not to the state.
- **Validating siblings' `sort_order`.** The DDL comment points at a database constraint; 4 character sibling
  groups share an order today.
- **The PBot orphan state.** Separate from this change.
- Exposing `authorizer_person_id` / `enterer_person_id`.

## Decisions

### D1 — The two sources

```js
// character.schema.js
characterProperties = {
  permid:     { type: "string", readOnly: true, "x-storage": { column: "permid" } },
  legacyIDs:  { type: "object", readOnly: true, properties: { pbotID: { type: "string" } } },
  name:       { type: "string" },
  definition: { type: "string" },
};
characterSource = { …, required: ["name"],
  "x-create": { properties: { name: { type: "string", minLength: 1 } } },
  unevaluatedProperties: false };

// state.schema.js: the same, plus
  quantitative: { type: "boolean", "x-storage": { column: "quantitative" } },
```

Two files, not one shared module. They agree today, but state already has a field character does not, and
each will gain its own when the API decides how the tree is exposed.

**`definition` is `{ type: "string" }` and not required**, in every variant. It is not `["string", "null"]`:
absence is how every converted entity says "none", and the builders stop writing the null (D3).

**`name` is non-empty only on create.** `x-create` adds `minLength: 1`, with `type` for strict mode, as the
`year` pattern does on authority and schema. `db` keeps the legacy rule, a required string.

**`quantitative` has no `readOnly` and is not required.** It is data a client sets: other names may become
quantitative, which is why the column exists. Like person's `role` and `active`, it backs a column with a
server-side default (`NOT NULL DEFAULT false`), so a create body may omit it. `out` always carries it, because
merge always has the column.

### D2 — Fetch everything, validate everything, then insert

The script is reordered so that nothing is written until every payload is known to be valid:

```
resolve + compile db variants (schema, character, state)
fetch Schema, Character, State from PBot
build + validate every schema, character and state payload   ← any failure: log, exit non-zero, nothing written
Phase 1: insert schemas (+ additional refs)
Phase 2: insert characters level by level
Phase 3: insert states level by level
```

Today the Character and State fetches sit between the insert phases. Moving them up changes when requests go
out and nothing else: the queries, parent resolution, level-by-level insertion, orphan handling, `sort_order`,
`quantitative` and the summary lines the runner parses are unchanged. The built payloads are kept in maps
keyed by `pbotID`, as the schema payloads already are, and the insert loops read from them.

As for schemas, every fetched character and state is validated, including one later skipped for a missing
enterer or left as an orphan. A malformed payload is a defect either way.

*Alternative considered: validate each character and state just before its insert.* Rejected: the step has no
transaction, so a failure in Phase 3 would leave schemas and characters written, and the runner's remedy for a
failed step is a fresh database.

### D3 — The builders omit a null definition

`buildCharacterJsonb` and `buildStateJsonb` write `definition` only when PBot's value is a non-null string, as
`buildSchemaJsonb` does for `purpose`. Unlike `purpose`, it is not trimmed or dropped when empty: the builders
keep today's values exactly, except for the nulls.

This is the only stored-data change: 533 rows on localhost lose a key whose value is null.

### D4 — The audit registers `character` and `state`

Two `REGISTRY` entries after `schema`, both `versioned: true`, no children:

| entity | table | column | columns |
|---|---|---|---|
| `character` | `characters` | `character` | `['permid']` |
| `state` | `states` | `state` | `['permid', 'quantitative']` |

Neither source declares a codec, so the round trip loads no codec context. `roundTripDifferences` compares
`quantitative` as a column value (`String(true) === String(true)`), with no change. The runner derives audited
entities from `REGISTRY` and each step's `writes`; `pbot-schemas` writes both tables, so it starts auditing them
with no runner code change. A full run audits eight entities.

The `payload-audit` unknown-entity scenario, which currently uses `--entity character`, moves to
`--entity opinion`.

### D5 — The `$defs` sketch gets a note

In `schema.schema.js`, the kept sketch's state `if name = "quantity" then value required` rule predates
`states.quantitative`. One comment line says so, and that a quantitative value belongs to a description's link
to the state. The sketch is otherwise left alone.

## Risks / Trade-offs

- **[Live PBot data fails the new validation]** → Possible, since the migration has never validated characters
  or states. The likely failure is a null `name` (the old schemas required it, but nothing checked). The side-DB
  run shows it; a failure is brought to the user rather than loosening `db`.
- **[Localhost `pbdb` drifts]** → It keeps `definition: null` on 533 rows until it catches up. The side-DB
  comparison must show that those null keys are the *only* difference, and localhost is then either rebuilt by
  the pipeline or updated with `jsonb - 'definition'` on exactly those rows. The user chooses at that point.
- **[Fetching before inserting]** → Two more requests before the first write, and three result sets held in
  memory together (1,670 small objects). Neither matters at this size.

## Migration Plan

No DDL change. Verification runs the full pipeline, with `PBOT_TOKEN`, into a side database:
`PG_DATABASE=pbdb_charstate_verify node src/run-migrations.js --createdb`. It checks:

- every schema, character and state payload validates in the step;
- the runner's audit is clean for all eight entities, and `--round-trip` reports zero differences;
- matched on `legacyIDs.pbotID`, `characters` and `states` equal localhost `pbdb`'s, except that exactly the
  rows with `definition: null` on localhost lack the key on the side, together with the same parent,
  `sort_order` and `quantitative` (parents compared by their `pbotID`s, since ids are regenerated).

Localhost then catches up, with the user's choice of method, and the side database is dropped with the user's
go-ahead.

Rollback is `git revert` plus rebuilding localhost; no DDL is involved.

## Open Questions

- How localhost catches up: rebuild or targeted update. Decided at verification.
