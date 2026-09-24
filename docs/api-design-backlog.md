# API design backlog

Decisions the payload-schema conversions deliberately left for the API design, collected in one
place. Each was deferred because the answer depends on how the API behaves, not on the stored
data. Every entry records what is decided, what is open, and where the reasoning lives.

*Started 2026-09-24, after all eight entity payload schemas were converted.*

---

## What already exists

Eight entities have an annotated source in `payloadSchemas/`: person, reference, authority,
collection, specimen, schema, character and state. For each, `deriveVariant` already yields every
schema a route needs:

| Variant | Route use |
|---|---|
| `out` | GET response, built from storage by `merge()` |
| `in-create` | POST body, split into storage by `split()` |
| `patch-guard` | first check on a PATCH body; the stored row is merged with the patch and the whole result validated (see `payloadSchemas/DESIGN_NOTES.md`, "Edit route pattern") |
| `db` | the jsonb at rest; migrations and `src/audit-payloads.js` validate against it |

So create and edit for these eight need route work and the decisions below, not new schemas.
Everything else the API exposes has no source yet (see [Opinions](#opinions) and
[Derived and reference tables](#derived-and-reference-tables)).

---

## Schema, character and state: separate routes or one-call tree

**Reads decided; writes open.** `pbdb2-api` already returns a schema as an aggregate tree: its
`schema-tree.js` read nests the characters and states, keyed by permid. For writes, two shapes
remain:

```
separate routes                         one-call tree
POST /schemas    { title, … }           POST /schemas { title, …, characters: [
POST /characters { parent…, order, … }      { name, …, states: [ … ] } ] }
POST /states     { parent…, order, … }
```

- Separate routes need parent and order in each body, and no `$defs`.
- A one-call tree implies parent and order by nesting and array position. It needs `$defs`/`$ref`
  support in `deriveVariant`, which does not exist, and a `split()` that writes a tree across three
  tables.

PBot's client entered one character or state at a time.

The sketch for the one-call option is kept as a comment at the end of `schema.schema.js`.

*Reasoning:* `openspec/changes/archive/2026-09-23-convert-schema-payload-schema/design.md` (Non-Goals,
D7).

## Parents and sibling order as payload fields

**Deferred; follows from the question above.** `characters.parent_schema_id` /
`parent_character_id`, `states.parent_character_id` / `parent_state_id` and `sort_order` are
columns only. No payload field maps to them.

- With separate routes they become fields: two either/or parent fields per entity, each a permid
  over a versioned table (`schemas`, `characters`, `states`), plus `order`.
- With a one-call tree they may never be fields.

Adding fields later is compatible; removing them would break clients. That asymmetry is why they
were left out.

Also note: 4 character sibling groups share a `sort_order`. The DDL comment points at a database
constraint as the place to enforce sibling order.

*Reasoning:*
`openspec/changes/archive/2026-09-24-convert-character-state-payload-schemas/design.md` (Non-Goals).

## Descriptions and quantitative values

**Open; a new entity.** In PBot, a Description has CharacterInstances, each pointing to a State in a
Schema. A quantitative state's measured value is a property of that link (`value` on the
`characterInstances` relationship), not of the state. `states.quantitative` is exposed and writable
so that such an observation knows it needs a value. The observation entity itself is not modelled.

The `if name = "quantity" then value` rule in the `schema.schema.js` sketch predates the flag and
should not be revived as a state rule.

*Reasoning:* the character/state design (Context, D5).

## Which variant validates a merged PATCH document

**Open.** The edit pattern is settled: guard the body with `patch-guard`, merge the stored row with
the patch, remove read-only fields, validate the whole result, then split and commit. *Which* variant
validates that merged result is left to the API; the `payload-schema-variants` spec says so
explicitly. `in-create` is the obvious candidate. It would also apply create-only rules, such as the
four-digit `year` and the non-empty `name`, to edits of migrated rows that predate those rules. For
example, editing only the `citation` of an authority whose stored year is the sentinel `"0"` would
be rejected.

The options, including a ratchet (always validate against `db`, and against `in-create` only if the
stored row already passed it), are compared in `payloadSchemas/DESIGN_NOTES.md`, "Edit route
pattern".

*Reasoning:* `openspec/specs/payload-schema-variants/spec.md` (`patch-guard` requirement).

## Fields the server supplies

**Decided in principle; the route rules are open.** `readOnly` marks only server-*assigned* values
(`permid`, `legacyIDs`, person `totalHours`). Fields that only a privileged caller may set are
writable in the schema, and privilege is left to the route:

- person `role`, `authorizer` and `active` are writable. `role_id` and `authorizer_person_id` are
  NOT NULL but not required on create, so the route must supply them (the caller's authorizer, the
  default role `Person`).
- `authorizer_person_id` and `enterer_person_id` on every other entity are not exposed at all. They
  are provenance, and the route sets them from the authenticated caller.

Open: which roles may set which fields, and whether provenance is ever shown in a response.

*Reasoning:* `openspec/changes/archive/2026-09-22-convert-person-payload-schema/design.md`.

## The authority's copy of its reference's data

**Open; a modelling question.** On 43,351 authorities `publishedInReference` is true. For those,
`citation`, `descriptors` and `year` were copied from the reference at migration time, and they go
stale if the reference's authors or year are edited. Options include deriving them when read, or
checking that they agree with the reference.

*Reasoning:* `openspec/changes/archive/2026-09-23-convert-authority-payload-schema/design.md`
(Non-Goals).

## Specimen links

**Open.** `specimens.reference_id`, `collection_id` and `name_opinions_permid` have no payload
fields yet. The `referencePermid` codec was written so that specimen can reuse it for its reference.
`name_opinions_permid` is NULL on 144,690 rows by design.

*Reasoning:* `payloadSchemas/specimen.schema.js` header; the specimens migration.

## Collection placeholders

**Open; waits on a combined pass.** `ages.intervals`, `environment` and `paleontology` in
`collection.schema.js` are placeholders awaiting the intervals/environment redesign. The age foreign
keys to `intervals` are also deferred.

Collection requires `references` only on create, while schema and authority require their
reference(s) in the base. That difference was noted and not revisited.

*Reasoning:* `collection.schema.js` header.

## Opinions

**Open; no source yet.** The three opinion tables (`name_opinions`, `assignment_opinions`,
`validity_opinions`) are the reverse of the converted entities: mostly columns, with a single jsonb
fragment (`attribution`, validated by `opinionAttribution.schema.js`). For example, `name_opinions`
has 22 columns.

- **Shape.** The annotated-source framework may already fit: every property an `x-storage` column,
  and `attribution` as `{ column: "attribution" }`, mapped one-to-one. That leaves an empty jsonb
  part. The audit registry would have to allow an entity with no payload column. Unverified.
- **Codecs.** Most columns are foreign keys: `authority_id`, `reference_id` and the persons need
  id→permid codecs, and `rank_id` and `reason_id` need dictionary-name codecs like `roleName`. With
  `referencePermid` and the tree parents, this is where a generic "permid over a table" codec would
  earn its keep (the second-caller rule).
- **Create.** Which columns a client supplies and which are derived depends on the taxa/opinions
  redesign: append-only ledgers, with derivation at the taxa build. Settle that first.

*Reasoning:* `docs/classic-taxa-opinions.md` §9; the taxa/opinions changes.

## Derived and reference tables

**Open; small once needed.** `taxa`, `taxa_linnaean`, `taxa_clades`, `taxon_annotations`,
`homonyms` and the like are built from opinions and are read-only. They need only an `out` shape
for GET. `intervals` and `timescales` are reference data whose editability is undecided. None has
a jsonb payload.

## Database-level validation

**Deferred.** Payloads are validated in the application (migrations, and later routes) and after the
fact by `src/audit-payloads.js`. A database `CHECK` that runs JSON Schema was deferred:

- Aurora supports `plv8`, not `pg_jsonschema`.
- The audit stands in for it meanwhile.

Revisit if writes will come from anywhere other than the API.

*Reasoning:* the `payload-schema-variants` change (archived 2026-09-18).

---

## API responses vs. the `out` variants

**Open; decide before API writes.** The API was built before the payload conversions, and its GET
responses have diverged from the `out` variants. It reads the jsonb directly
(`{ permid, ...row.payload }`) and adds relationships through its own link enrichment
(`pbdb2-api/src/lib/resource-tables.js`):

```
our `out` (referenceList codec)            pbdb2-api GET today
references: [                              primaryReference: { title, permid, href }
  { referenceID: <permid>, order: "1" },   additionalReferences: [ { title, permid, href }, … ]
  { referenceID: <permid>, order: "2" } ]
```

The intent is to move the API to the variant approach: build responses with `merge()`, describe them
with `out`, and validate writes with `in-create` / `patch-guard`. What remains open is how the API's
enrichment relates to `out`:
- adopt the API's shape in the sources, which changes `referenceList`;
- adopt `references[]` in the API;
- keep both, with enrichment as a presentation layer over `out`. That is plausible, since `title`
  and `href` are conveniences that `out` deliberately leaves out.

Whichever is chosen, a create body has to be consistent with what GET returns.

The API is about 2,000 lines. Its transport layer (envelope, pagination, discovery, filters,
405 handling; about 950 lines, specified and tested) doesn't depend on payload shape. About
580 lines of data layer (`repository.js`, `resource-tables.js` links, `link-hydration.js`, parts of
`schema-tree.js`) would change. That argues for refactoring the API rather than rewriting it. The
`taxa` reads have no payload and are unaffected.

## Serving the schemas to clients

**Proposed.** The API could serve the derived variants as JSON Schema documents, for example
`GET /api/v1/schemas/{entity}/{in-create|out|patch-guard}`, beside its existing discovery routes.
Clients would get the API contract over HTTP instead of depending on backend code:
- The frontend validates forms against exactly what the *deployed* API enforces, not against a
  pinned package version.
- Served schemas can have dictionary enums already resolved (`x-enumFrom` filled in), so dropdowns
  carry the current vocabulary from the database. A compiled-in package cannot do that.
- Clients need no backend access, not even read access (see the next entry).

Open: whether to serve `db` (probably not: it describes storage, not the contract), and caching,
since resolved enums change only when a dictionary does.

## Repository boundary: backend monorepo vs. frontend

**Proposed; depends on one question.** The plan is to merge `pbdb2-migrations` and `pbdb2-api` into a
new monorepo with both histories:
- `apps/migrations`, `apps/api`, `packages/payload-schemas`, and `packages/db` for
  `create_new.sql`;
- histories rewritten into their subdirectories with `git filter-repo`;
- first, merge `main` into `ddm-dev` in the migrations repo. They have diverged since 2026-09-04,
  and the merge is clean.

The DDL, payload sources, migrations and API would then change together. For example, the
character/state conversion silently changed a GET response in the separate API repo.

Including the client (`pbdb_frontend`) depends on what a colleague's concern means. The concern is
that third-party contributors might be invited to work on the frontend code but explicitly not the
backend:
- **If it means they may not *change* backend code:** a full monorepo works. `CODEOWNERS` plus
  branch protection require backend-team approval for any PR touching `apps/api/**`,
  `apps/migrations/**` or `packages/**`. Contributors can still read everything.
- **If it means they may not *see* backend code:** the frontend must stay in its own repo. Git hosts
  grant access per repository, never per directory. A mirrored public frontend repo (subtree split,
  Copybara, josh-proxy) is possible but means permanent two-way sync, and is not recommended for a
  small team.

Leaning: a backend monorepo plus a separate frontend repo, with the frontend consuming the served
schemas (previous entry). Before any code becomes public, scan the *history* for credentials, for
example with `gitleaks`.

Nothing deploys from these repos yet, so nothing needs re-pointing. Project memory for Claude Code is
keyed to the directory path and must be copied to the new location.

## Known data issues that affect the API

- **PBot self-parent state.** One PBot state (`ed088383…`, "other") is its own parent and is skipped
  as an orphan on every run. Fix it in PBot.
- **PBot person pbotID collision.** Two PBot persons match one PostgreSQL row, so
  `legacyIDs.pbotID` alternates between runs. Pre-existing and unfixed.
