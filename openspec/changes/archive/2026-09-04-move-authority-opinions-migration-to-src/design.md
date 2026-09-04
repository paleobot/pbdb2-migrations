## Context

Slice 6 of six. Five slices have landed; `migrate-collections.js` is the only script that will remain at the
repository root after this one.

Mechanically this is the smallest slice yet. The two properties that made `move-authorities-migration-to-src`
risky are both absent here:

```
                          authorities slice              this slice
                          ─────────────────              ──────────
duplicated code           3 byte-identical functions     none
                          shared with src/lib/
harness                   34 assertions in play/         none exists
exports consumed by        yes (the harness)             no — buildAttribution and
                                                         parsePublicationYear have zero importers
silent-failure path       yes: dedupKey is built from    none: no functions are being
                          the collapsed strings, so a    collapsed, so payloads cannot
                          bad collapse shifts payloads   drift while counts hold
                          while counts hold
```

What makes this slice interesting is not the move but the **naming**, and the fact that a rename behaves
differently from a relocation everywhere the specifications talk about citations.

## Goals / Non-Goals

**Goals:**

- Relocate the script under `src/` following the established one-directory-per-migration layout.
- Correct the script's name to `migrate-authority-opinions.js` and its runner step to `authority-opinions`,
  on grammatical grounds recorded below.
- Keep behaviour bit-for-bit identical: same root minting, same attribution, same rank collapse, same
  sentinels, same row count, same payloads.
- Record the rename/relocation distinction in `migration-script-layout`, since every prior slice's citation
  reasoning silently assumed a move.
- Give step names in `migration-runner` the same deliberate-decision protection directory names already have.

**Non-Goals:**

- Relocating `migrate-collections.js`, or the root-module deletion that waits on it.
- Promoting `parsePublicationYear` into `src/lib/` (decision 5).
- Renaming `payloadSchemas/mappings/authorities-opinions.md`.
- Repairing `reset-opinions.sql` beyond its one stale command comment.
- Any change to the MariaDB source schema, the PostgreSQL target schema, or the migrated data.

## Decisions

### 1. `authority` is attributive, so the singular is correct

This is the decision the whole change hangs on.

In *authority opinions* the head noun is **opinions**; *authority* modifies it. English attributive nouns
take the singular — *car park*, *book shelf*, *user account*, never *cars park*. So the subject is
`authority-opinions`, and the `<subject>-migration` ↔ `migrate-<subject>.js` pairing rule gives
`src/authority-opinions-migration/migrate-authority-opinions.js`.

**This does not conflict with the sibling `src/authorities-migration/`.** The two differ because they are
different grammatical constructions doing different jobs:

```
src/authorities-migration/          "migration of the authorities [table]"
                                     authorities = HEAD noun      → plural correct

src/authority-opinions-migration/   "migration of authority opinions"
                                     authority = ATTRIBUTIVE mod. → singular correct
                                     opinions  = head noun
```

Each is right under its own grammar, and the layout spec's inventory now says so explicitly so that a future
reader does not "fix" one to match the other — precisely the drive-by correction that spec already guards
against for directory names.

The new name is also a better description. `authorities-opinions` encoded the migration **path** (source
table → target table). `authority opinions` names the **thing produced**: root `name_opinions` rows carrying
an authority's attribution. This refines rather than reverses the 2026-08-26 rename
(`migrate-name-opinions.js` → `migrate-authorities-opinions.js`), whose recorded reason was that *"the name
now reflects what it does: it mints roots from classic `authorities` and reads no classic `opinions`."* That
reasoning stands; only its grammatical form is corrected.

*Alternative considered — `src/root-migrations/`,* the directory first proposed. Rejected on three counts: it
is plural, which the layout spec forbids and which `2026-09-02-singularize-pbot-migration-directories`
deliberately eliminated; it implies an entry point `migrate-root.js`, breaking the pairing the inventory
relies on; and *root* already means *the repository root* throughout every relocation change, so
`src/root-migrations/` would read as "the migrations that live at the root" — the opposite of what it is.

*Alternative considered — `src/authorities-opinions-migration/`,* keeping the current spelling and making
this a pure relocation with no rename. Rejected: it perpetuates a grammatical error at the moment the file is
being touched anyway, and the cost of correcting it is bounded and known.

### 2. The step rename is a separate rule from relocation stability, and must stay that way

`migration-runner` says *"A step name SHALL remain stable when the script it names is relocated."* Renaming a
step in the same change that relocates its script contradicts that as written, so the requirement gains the
same escape hatch `migration-script-layout` already gives directory names: **literal — changed only by a
deliberate decision recorded in the specification, never as incidental cleanup, and never as a side effect of
a move.**

The distinction has to survive, because otherwise this change appears to weaken a guarantee it does not
touch. The step name is **not** changing because the script moved. It is changing because *authority
opinions* is better English — a decision that merely lands in the same change.

Yesterday's scenario recording that `authorities` kept its name across its own relocation stays true and
unmodified, and the two now work as a matched pair that makes the rule legible:

```
authorities          moved,  name unchanged   → relocation does not rename
authority-opinions   moved,  name changed     → but only by a separately recorded decision
```

A scenario is added for the second case, and another for the consequence that `--only authorities-opinions`
now fails as an unknown step: step names are addresses, not aliases, and the runner keeps no historical
spellings.

*Why the rename is cheap here:* the stability rule exists to protect the CLI handle for its users, and the
sole user of these scripts is the maintainer. There is no other consumer to coordinate with.

### 3. Bundle the rename with the relocation

The step rename touches seven of `migration-runner`'s twelve requirements; the relocation touches two. Split
into separate changes, each would tell a cleaner story and a verification failure would be unambiguously
attributable.

Bundled anyway, on the maintainer's instruction and for a good reason: both are one decision about one
script's identity, and separating them would mean editing `migration-runner` twice inside a week for halves
of the same thought. The attribution risk is mitigated by the fact that this slice has no silent-failure
path — every failure mode here is loud (an unresolved import at module load, or an unknown step name at
spawn).

### 4. A rename invalidates every mention; a relocation invalidates only paths

Every prior slice leaned on `migration-script-layout`'s rule that *"a bare filename does not become
inaccurate when a file moves"* and left bare mentions untouched — the refs slice checked eight such mentions
and edited none of them.

That reasoning holds for a move and **fails for a rename**. `migrate-authorities-opinions.js` ceases to exist,
so every mention becomes false whether or not it carries a path. Read literally, the current rule would tell
an implementer to leave the bare ones alone and ship a specification citing a file that is not there.

The requirement is therefore extended to state the distinction: a relocation invalidates a citation's
**path**; a rename invalidates its **identity**. Two scenarios cover it, including the mixed-list case —
`permid-uuidv7`'s bare list stays unqualified (its members have not all moved) while the renamed member's
name is still corrected, because the mixed-list rule defers path qualification and says nothing about a name
that has stopped being correct.

This is the durable output of the slice: the next rename, whenever it comes, has a rule to follow.

### 5. `parsePublicationYear` stays where it is

It and `src/lib/attribution.js`'s `parseYear` look like twins and are not quite:

| | `parsePublicationYear` (this script) | `parseYear` (`src/lib/`) |
|---|---|---|
| blank test | `year === ''` | `String(year).trim() === ''` |
| source | `authority.year` — carries the scenario ④ `'0'` sentinel | `opinions.pubyr` |

They converge on the same outputs, but they are separate functions over separate inputs, neither imports the
other, and no file carries a "keep in sync" note. The shared-utility requirement compels promotion for *code
shared by more than one migration* — this is duplicated *logic*, not shared code, so the rule does not bite
as it did for `authorities-builders.js`, where one file literally declared itself a verbatim copy awaiting
this moment.

Declined for the reason the refs slice gave: a behavioral refactor wearing a relocation's clothes.

### 6. `name-opinions-migration`'s Purpose line has no delta mechanism

`name-opinions-migration:4` reads *"Implemented by `migrate-authorities-opinions.js`."* That sentence lives in
the spec's `## Purpose` section, not inside a `### Requirement:` block, and OpenSpec deltas operate only on
requirements. There is no `## MODIFIED Purpose` header.

Three options were weighed. Leaving it is unacceptable — it is a source-of-guarantee citation naming a file
that will not exist. Manufacturing a requirement delta merely to carry a Purpose edit would put text in the
requirements section that is not a requirement. So: **it is applied as a direct, non-delta edit to
`openspec/specs/name-opinions-migration/spec.md` at sync time**, called out in `tasks.md` so it is not
mistaken for the hand-editing of requirement text that the workflow forbids.

Recorded here as a genuine gap in the tooling rather than a quirk of this change: a spec's Purpose can become
false, and the delta system has no way to say so.

That spec's other two script mentions, at lines 18 and 96, name `migrate-authorities.js` — a **different**
script — and are comparative asides. They stay bare and unchanged.

### 7. Verify by reproducing output, with content checked as well as counts

The script is not idempotent (bare `INSERT`; the runner declares it `firstWriterOf: ['name_opinions']`), so a
re-run is unavailable. `reset-opinions.sql` is also unavailable — it is broken against the current schema,
its `DROP TABLE name_opinions` refused by three `winning_name_opinion_id` foreign keys on `taxa`,
`taxa_clades`, and `taxa_linnaean` (found during the previous slice, and left unrepaired as out of scope).

```
TRUNCATE name_opinions, assignment_opinions, validity_opinions RESTART IDENTITY CASCADE
    ── authorities (163,067) DELIBERATELY LEFT STANDING: it is this step's INPUT,
       not its output. persons, refs and collections likewise untouched, so the
       comparison carries zero live-PBot GraphQL nondeterminism.

--list                        → authority-opinions at position 7
--only authority-opinions     → name_opinions   517,284 root rows
--only opinions               → name_opinions   766,427
                                assignment_opinions 927,497
                                validity_opinions    11,327
--only authorities-opinions   → REJECTED, unknown step name
```

Counts alone would be weak evidence even here. Following the authorities slice's lesson, verification also
compares an md5 over the root rows' stable columns — excluding `permid` and `id`, which are regenerated each
run — so it proves content rather than cardinality. Nothing in this change should alter a payload; the check
is what makes that claim rather than assumes it.

*Alternative considered — `--from authority-opinions`.* Rejected for the reason established last slice:
preflight 4/5 requires every first-writer table across the selected steps to be empty, which would drag
`collections` and `additional_collection_refs` into the reset for no benefit.

## Risks / Trade-offs

**A missed executable path fails late, not early** → This is the slice's characteristic failure mode. Import
errors surface at module load, but the runner and the opinions test harness both *spawn* this script by name,
so a stale reference fails at spawn. `src/opinions-migration/tests/run-migration.js:26` is the easiest to
miss because it sits in another migration's `tests/` directory and builds the path with
`join(REPO_ROOT, 'migrate-authorities-opinions.js')`. Mitigated by enumerating all five paths as explicit
tasks and by a post-change grep for the old name.

**Seven requirements changed in one spec for a naming decision** → Review burden rather than technical risk.
None of the seven changes any behaviour; six are the same token substituted in tables, a graph, and two
scenarios. The seventh is the substantive one and is called out separately.

**The rename could be read as weakening the relocation-stability guarantee** → Mitigated in the spec text
itself, which states that relocation-stability and deliberate renaming are separate rules and keeps the
`authorities` scenario as the contrast case. If a future reader concludes "relocations rename steps," the
spec has failed; the wording is deliberately explicit on this point.

**Verification truncates three tables** → All are reproducible from steps 7 and 8, expected counts are known
in advance, and `authorities` — the expensive input layer — is not touched. The cascade reaches only
`taxa`, `taxa_clades`, `taxa_linnaean`, `taxa_attachments`, and `cycle_cuts`, all currently empty.

## Migration Plan

No deployment. Working-tree change verified against localhost `pbdb`.

**Rollback:** `git revert` restores the script to the repository root under its old name and restores the step
name; the database needs no rollback, since the verification sequence reproduces the same rows either way and
can be re-run against the reverted script to reproduce the identical baseline.

## Open Questions

None blocking. Decision 6 records a tooling gap (no delta mechanism for a spec's Purpose) that this change
works around explicitly rather than resolves; it will recur for any future change that invalidates a Purpose
line.
