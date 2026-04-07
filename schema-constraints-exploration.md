# Schema Constraints — Exploration Notes

Context for future work on [paleobot/pbdb2-dev#21](https://github.com/paleobot/pbdb2-dev/issues/21): "Can we add 'constraint' information into schemas?"

Status: **exploration only — no implementation, no committed design.** Several key decisions are still pinned.

---

## The problem

A PBDB2 schema is a tree of characters and states. When a specimen is described, states are assigned to characters. Issue #21 asks how we might express *constraints* on those state assignments. The issue gives three scenarios that, on closer reading, are actually three different kinds of constraint.

```
┌─────────────────────────────────────────────────────────────────┐
│  Three flavors of "constraint" hiding in issue #21              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  (A) Cross-character rules        ─── Scenario 1                │
│      "if height=short then size≠big"                            │
│      Lives on: the SCHEMA (spans multiple characters)           │
│      Runs at:  specimen-description time                        │
│                                                                 │
│  (B) Value-typed states           ─── Scenario 2                │
│      "this state holds a number, integer, < 20 cm"              │
│      Lives on: the STATE (per-state metadata)                   │
│      Runs at:  specimen-description time                        │
│                                                                 │
│  (C) Contextual / parent-gated    ─── Scenario 3 (ambiguous)    │
│      Possibly: "these sub-states apply only if parent chosen"   │
│      Possibly: just a worked example of scenario 2              │
│      Possibly: multi-select semantics for sibling sub-states    │
│      Deferred — revisit if a concrete case appears              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

The original issue comments already note confusion about scenario 3 ("I don't understand scenario 3"). We set it aside during exploration.

---

## What we decided

### Architecture

- **Three flavors are independent.** They can be designed and shipped separately.
- **The assembled schema object is the shared contract.** `server.js` assembles the schema (characters, states, rules, valueSpecs) into a single JSON object that both the client (for form generation) and the API (for description-payload validation) consume.
- **Rules are authored in a UI at schema-creation time** and uploaded with the schema.
- **No analogous feature existed in PBot** — this is greenfield; there's no legacy format to accommodate.
- **Description payload shape is TBD** — to be co-designed with whichever rule-language decision is made.

### Scenario 2 — value-typed states (valueSpec)

A state that carries a numeric or other typed value gets a `valueSpec` inside its existing jsonb blob:

```jsonc
// states.state jsonb
{
  "name": "length",
  "definition": "…",
  "valueSpec": {
    "type": "number",      // number | integer | string | boolean
    "minimum": 0,
    "maximum": 20,
    "unit": "cm"
  }
}
```

- `valueSpec` is a curated subset, not arbitrary JSON Schema (broader later if needed).
- At specimen-description time, a state with a `valueSpec` requires a `value`, which AJV can validate directly.
- No cross-entity references — this stays entirely self-contained in the state's own jsonb. No new tables.

### Scenario 1 — cross-character rules

The deeper design debate happened here. Summary of conclusions:

**Rules live in dedicated tables, not inside schema jsonb.**

The codebase has an established convention for cross-entity references: they live as real FK columns (on the containing row or a cross-ref table), never embedded inside jsonb. Explicit house-style comment at `payloadSchemas/collection.schema.js:399`:

> `//Reference links reside in the containing db record and a cross-ref table. The references property must be populated on create and will be generated on the fly for get.`

Existing precedents: `additional_collection_refs`, `additional_schema_refs`, and the primary `reference_id` / `early_age_id` / `late_age_id` columns on `collections`.

Proposed table shape for rules (not yet implemented):

```
schemas                      ◀── schema jsonb holds rule LOGIC (when/forbid
                                  structure), which is pure content
   │
   │  1 ──────── N
   ▼
schema_rules
   ├─ id           PK
   ├─ schema_id    FK → schemas(id)
   ├─ rule_id      text           (stable within schema)
   ├─ severity     text           ('error' | 'warn')
   ├─ message      text
   └─ logic        jsonb          (when/forbid tree — no raw IDs inside)
   │
   │  1 ──────── N
   ▼
schema_rule_refs
   ├─ id            PK
   ├─ rule_id       FK → schema_rules(id)
   ├─ character_id  FK → characters(id)    ◀── swings on re-version
   ├─ state_id      FK → states(id)        ◀── swings on re-version
   ├─ role          text            ('when' | 'forbid')
   └─ clause_token  text            (opaque token correlating to logic)
```

**Why tables, not permid-in-jsonb:**

- Existing version-swing triggers (`swing_fks_to_new_version`) walk `pg_constraint`. They can't see inside jsonb. Embedding character/state IDs in a jsonb rules array would silently rot every rule on every re-version.
- Using `permid` inside jsonb would sidestep that, but it would be the *only* place in the codebase embedding cross-entity references inside jsonb — directly contradicting the documented convention. Verified: no current jsonb blob in the repo contains cross-entity references.
- Real FK columns get version swinging for free, get postgres-enforced referential integrity, and match house style. The costs are one join in `server.js` assembly (which already assembles similar joined data for `references`).

### Other decisions

- **References are by `id` (real FKs), not by name and not by `permid`.** Swing triggers keep them fresh.
- **State references in rules: leaf states only.** If a rule needs to reference a non-leaf state, the answer is to restructure the schema so that state becomes a leaf. Keeps the UI picker flat and the rule semantics simple.
- **Unknown handling: three-valued logic, early.**
  - Missing character in the description payload = unknown (no sentinel needed).
  - A rule whose `when` clause evaluates to `unknown` is **dormant** — neither satisfied nor violated.
  - Consequence: rules never fire against a partially filled form during live client validation.
  - Evaluator returns `{status: "ok" | "violated" | "dormant", ruleId, message}` per rule.
- **Severity from day one: `"error" | "warn"`, default `"error"`.**
  - API rejects on any `error`.
  - Client surfaces `warn` inline but doesn't block submit.
  - No `"info"` until someone asks.
- **v1 rule vocabulary: `is` / `isNot` against state IDs only.** Numeric comparisons in rules are deliberately deferred (see open questions).

---

## What's still pinned

These are real decisions we paused on, not things we forgot.

### Rule language: JSON Logic + envelope vs. AJV if/then/else

The strawman shape we first sketched (`when`/`forbid`/`all`/`any`/`is`/`isNot`) is, honestly, a custom JSON DSL — six keywords and semantics we'd have to define, evaluate, and document ourselves. Acknowledging that reframed the question as "whose DSL?"

| | Custom JSON DSL | JSON Logic + envelope | AJV if/then |
|---|---|---|---|
| Evaluator | ours to write | library | AJV (already in repo) |
| Docs / semantics | ours to maintain | jsonlogic.com | JSON Schema spec |
| UI introspection (which chars touched?) | trivial | walk AST (or use `refs` sidecar) | walk AST |
| Form-builder authoring | easy | easy (compile to JSON Logic on save) | painful |
| Expressiveness ceiling | low (by design) | high | very high |
| Risk of scope creep | **high** | low | low |

Leaning toward **JSON Logic + structured envelope**:

```jsonc
{
  "id": "r1",
  "message": "A short specimen cannot also be big",
  "severity": "error",
  "refs": {                              // sidecar for form reactivity
    "characters": ["<id>", "<id>"]
  },
  "logic": {                             // JSON Logic for the evaluator
    "if": [
      { "==": [ { "var": "<char-token>.stateId" }, "<state-token>" ] },
      { "!=": [ { "var": "<char-token>.stateId" }, "<state-token>" ] },
      true
    ]
  }
}
```

Note that the `logic` blob uses opaque tokens, not raw IDs — the tokens resolve to real IDs via `schema_rule_refs` (see next pinned question).

Not committed. Doug wants to think about JSON Logic vs. AJV before deciding.

### Clause ↔ ref correlation

Two ways to correlate `schema_rule_refs` rows with positions in the `logic` jsonb:

1. **Positional index** — `clause_index` like `"when.all[0]"`. Simple, brittle to logic edits.
2. **Opaque clause tokens** — `logic` uses tokens like `"ref-1"`, `schema_rule_refs.clause_token` maps each token to a character/state. Robust to rewriting the logic tree.

Leaning toward **(2)**. One extra column, one dictionary lookup per clause, much more robust.

---

## What's still open

Questions we flagged during exploration but didn't resolve.

- **Description payload shape.** TBD. Should be co-designed with the rule-language decision, since the evaluator's input format is determined by both. Current sketch:
  ```jsonc
  {
    "schemaId": "…",
    "observations": {
      "<characterId>": { "stateId": "<stateId>" },
      "<characterId>": { "stateId": "<stateId>", "value": 12.5 }
    }
  }
  ```
- **Deletion semantics.** With real FKs this becomes postgres's problem (`ON DELETE RESTRICT` style), but the UX question remains: if someone tries to delete a character that's referenced by a rule, does it fail with "used by rule X," auto-remove the rule, or mark the rule invalid? Leaning toward hard-fail with a clear message.
- **Numeric comparisons in rules.** Deferred from v1. The real-world case would be something like "if length > 15 then width must be > 5" — combining scenarios 1 and 2. Adds `gt`/`lt`/`between` operators and opens a combinatorial design space. Revisit only when there's a concrete request.
- **Scenario 3.** Set aside. If it turns out to be about multi-select among sibling sub-states (reading C from exploration), the addition is a small per-character or per-parent-state flag like `"stateSelection": "one" | "many"`. Not urgent.
- **Rule language decision** (see pinned).
- **Clause↔ref correlation** (see pinned).

---

## Reference map

Relevant files touched during exploration:

- `payloadSchemas/schema.schema.js` — current schema payload validation; contains a commented-out `if name==="quantity" then require value` block that foreshadowed scenario 2.
- `payloadSchemas/state.schema.js`, `payloadSchemas/character.schema.js` — current character/state payload validation; both currently hold only display metadata (name, definition, legacyIDs).
- `payloadSchemas/collection.schema.js:399` — the canonical comment establishing the cross-entity-reference convention.
- `postgresql/create_new.sql`:
  - Lines 102–210 — version trigger machinery (`swing_fks_to_new_version`, `place_in_lineage`, `handle_new_version`, `install_version_triggers`).
  - Lines 279–323 — `collections`, `additional_collection_refs`, `schemas`, `additional_schema_refs` (precedents for the rules/refs table pattern).
  - Lines 325–366 — `characters` and `states` tables; note the `sort_order` comment already wishing for constraint expressions.
- Issue: [paleobot/pbdb2-dev#21](https://github.com/paleobot/pbdb2-dev/issues/21).
