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

**Decided 2026-09-25: grow `pbdb2-migrations` into `pbdb2-backend` (option B), with migrations as a
leaf.** The DDL, payload sources, migrations and API change together in one repo. For example, the
character/state conversion silently changed a GET response in the separate API repo. Today the API
imports nothing from migrations. Its only hard link is the integration harness loading
`create_new.sql` from a sibling checkout. Everything else is code that was copied and "mirrors" the
original, and copies like that drift.

**How the repo is formed.** Rename `pbdb2-migrations` to `pbdb2-backend` on GitHub and graft the API
in. A new repo with both histories rewritten by `git filter-repo` (option A) was rejected:

| | A. New repo, rewrite both | **B. Rename migrations, graft the API (chosen)** |
|---|---|---|
| Migrations history (234 commits) | every SHA rewritten | SHAs kept; one "move into `migrations/`" commit |
| API history (15 commits, one author) | rewritten into `api/` | rewritten into `api/`, merged with `--allow-unrelated-histories` |
| Issues/PRs (e.g. #16, #30) | left in the old repo | stay; GitHub redirects the old name |
| Collaborators' clones | re-clone | `git pull` still works |
| Commit hashes cited in docs and memory | all dangle | all stay valid |
| Log/blame across the move | seamless | per file with `--follow` |

`pbdb2-api` is then archived on GitHub, read-only, with a README pointing to the new home.

**The leaf rule.** Migrations will fade once PBDB Classic and PBot are shut down (perhaps a couple of
years out). Migrations may depend on everything, and nothing may depend on migrations:

```
pbdb2-backend/
├── package.json        npm workspaces
├── openspec/           one root (see below)
├── db/create_new.sql          ◀──────┐
├── payloadSchemas/            ◀──┐   │    durable
├── api/  ───────────────────────┼───┤
└── migrations/  ────────────────┴───┘    leaf: src/, mariadb/, play/, pg-*.js,
                                          payloadSchemas' mappings/*.md
```

When migrations retires, a `retire-migrations` change removes `migrations/`, its workspace entry and
its specs in one commit. What remains is the API with the DDL and payload schemas. The migration code
stays in history for provenance. The `apps/` + `packages/` layout from the earlier proposal was
dropped as structure built ahead of need.

*Rejected alternative:* moving the DDL and the payloadSchemas lib into `pbdb2-api` and having
migrations depend on it through a GitHub URL in `package.json`. That targets the end state, but for
the next two years most DDL and schema changes start in migrations. Every such change would span two
repos and require `npm update` (the lockfile pins a SHA), or `npm link`, which leaves the lockfile
out of step with what was tested. Separate repos would win only if the API might go public while
migrations stays private, or if write access differs. Neither applies.

**One OpenSpec root, not one per app.** 7 of the 24 migrations specs describe durable parts
(`entity-versioning-triggers`, `payload-schema-variants`, `payload-schema-enums`, `taxa-unified`,
`taxa-clades`, `taxa-opinions`, `clade-attachments`). 2 more are mixed (`permid-uuidv7`: the API will
mint permids too; `payload-audit`). The other 15 are migration-only. With two roots, the durable specs
would either go when migrations goes, or live under `api/` where migrations changes can't touch them.
Delta specs apply only within their own root, so a change spanning DDL, schemas, a migration and the
API would have to be split into two coordinated changes. No spec names collide between the repos.

The cost is one shared `config.yaml` context. Rules are keyed by artifact type, not by area, so the
MariaDB-specific rules must be made conditional ("for changes that read legacy data: …"). A rule
also enforces the leaf rule on every proposal ("nothing outside `migrations/` may import from or
spec against it"). Run `openspec init` once at the root with the expanded workflow profile
(`new`/`ff`/`continue`/`verify`), not the API's core profile.

**Order of work:**
1. *Prerequisite change: split `payloadSchemas/`* into durable and migration-only parts. Needed under
   any option. `tests/enums.test.js` and `tests/dictionary-seeds.test.js` import the migrations pool
   (`src/lib/pg-pool.js`). `mappings/*.md` belong to migrations. `legacyIDs` stays durable, since it
   is persisted data.
2. Housekeeping: decide `graph-visuals`; delete merged/stale branches (`patch-derive-taxa`,
   `backup/ddm-dev-pre-merge`, …); finish or park `clade-hierarchy-user-guide`; clear the untracked
   root files.
3. Tell collaborators; confirm no unpushed work on the old paths.
4. *Monorepo change:* one `git mv` commit into `migrations/`, `create_new.sql` → `db/`, then fix
   relative imports. `npm test` and a full `run-migrations` must reproduce the totals.
5. Graft the API (`filter-repo --to-subdirectory-filter api` on a fresh clone, merge unrelated
   histories). Move its specs and archive into the root `openspec/`. Point the integration harness
   at `db/create_new.sql`.
6. Root `package.json` with workspaces and one lockfile; root `npm test` runs both.
7. Tooling: merge the `CLAUDE.md` files and `config.yaml` contexts (the API's `CLAUDE.md` says
   "separate repos"). Fix the Purposes of `opinions-migration` and `taxa-opinions` (still "TBD").
   Generalize `permid-uuidv7` to the backend. Copy the Claude Code memory directory to the new path.
8. Rename on GitHub; archive `pbdb2-api`. Run `gitleaks` over the history.

**Frontend.** Including the client (`pbdb_frontend`) depends on what a colleague's concern means. The
concern is that third-party contributors might be invited to work on the frontend code but explicitly
not the backend:
- **If it means they may not *change* backend code:** a monorepo with `CODEOWNERS` and branch
  protection would work.
- **If it means they may not *see* backend code:** the frontend must stay in its own repo. Git hosts
  grant access per repository, never per directory.

The name `pbdb2-backend` assumes a separate frontend repo that consumes the served schemas (previous
entry). That is the leaning, not yet confirmed. Before any code becomes public, scan the *history*
for credentials, for example with `gitleaks`.

Nothing deploys from these repos yet, so nothing needs re-pointing.

## Known data issues that affect the API

- **PBot self-parent state.** One PBot state (`ed088383…`, "other") is its own parent and is skipped
  as an orphan on every run. Fix it in PBot.
- **PBot person pbotID collision.** Two PBot persons match one PostgreSQL row, so
  `legacyIDs.pbotID` alternates between runs. Pre-existing and unfixed.
