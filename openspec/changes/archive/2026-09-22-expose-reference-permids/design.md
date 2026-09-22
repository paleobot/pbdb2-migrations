## Context

`collectionReferences` is the one converted codec still exposing an internal id. It splits a collection's
`references[]` into `collections.reference_id` (the primary) and `additional_collection_refs` rows (the rest),
carrying `refs.id` in both directions. `proposal.md` gives the reasons it changes now.

The mechanism it needs already exists: `convert-person-payload-schema` built the codec context, and
`personPermid` does the same id↔permid resolution for `persons.authorizer_person_id`. What does not carry
over is the reason `personPermid` is exact:

```
persons:  permid uuid NOT NULL UNIQUE CHECK (...)      ← create_new.sql:4813
refs:     permid uuid NOT NULL        CHECK (...)      ← create_new.sql:4825
```

`persons` is unversioned and its permid is unique, so `permid → id` is a function. `refs` is versioned: every
version of a reference shares one permid, and only `place_in_lineage()` guarantees one *head* per permid.
`loadCodecContext` builds its reverse map with `byValue.set(r.v, r.k)` over whatever rows return, so a
versioned source resolves a permid to whichever version happened to sort last, with no error raised.

The live data hides this completely — 93,944 refs, 93,944 distinct permids, 93,944 heads, because no reference
has ever been edited. Every test written against migrated rows would pass.

## Goals / Non-Goals

**Goals:**

- A collection's `references[]` carries permids, in both directions, with the stored columns and child rows
  unchanged.
- Resolving a permid on a versioned table yields the lineage head and never a superseded version, provably
  rather than incidentally.
- `refs` read once per run rather than once per batch, without pretending it is a dictionary.

**Non-Goals:**

- Converting `reference.schema.js`. That is the next change, and it is why this one goes first.
- Exposing `authorities.reference_id` or `specimens.reference_id` in their payloads. Each belongs to its own
  entity's conversion; this change settles the contract they will use.
- Any change to `migrate-collections.js`, to the `refs` DDL, or to stored data. See D4.
- Adding a `UNIQUE` constraint to `refs.permid`. It would be wrong — a versioned table holds many rows per
  permid by design. The fix belongs in the lookup, not the schema.
- Revisiting whether `persons` should also be pre-loaded whole. It is 1,375 rows in a single batch; nothing
  is wrong with how it reads today.

## Decisions

### D1 — A source declares that its table is versioned; the loader restricts to heads

```js
sources: [{ table: 'refs', key: 'id', value: 'permid', versioned: true }]
```

`loadCodecContext` adds `AND succeeded_by_id IS NULL` when it reads such a source, so both `byKey` and
`byValue` are built from head rows only.

The flag states a fact about the table and lets the loader derive the consequence, rather than having the
codec carry a SQL fragment. It also reuses the vocabulary `payload-audit`'s `REGISTRY` already introduced for
exactly this distinction, so the codebase has one word for it.

Restricting the whole read — not just the reverse direction — is correct and slightly stronger than needed.
`swing_fks_to_new_version()` UPDATEs every FK referencing an old row id to the new one, so a stored
`reference_id` always denotes a head and `byKey` would find it either way. Building `byKey` from heads only
means that if a `reference_id` ever does point at a superseded row, the codec throws naming the id instead of
quietly resolving it. That is a violated invariant, and it should be loud.

*Alternative considered: a `where` clause on the source.* Rejected — it puts SQL in a codec and invites
arbitrary predicates the loader would have to trust.

*Alternative considered: restrict selections to the `key` direction only, so `permid → id` never happens.*
The audit only ever needs `byKey`, so this would work today. Rejected because it hollows out the requirement
`convert-person-payload-schema` just established: the `value` direction exists for the API create path, which
starts from a permid and must find the head id to store.

### D2 — The caller batches what it can address and pre-loads what it cannot

The current rule is that a `dictionaries` source is read whole and *every other source* is read per selection.
That rule cannot accommodate `refs`, and the reason is not its size:

```
what D3 counted        275,554 collections + 167,150 specimens   ← citations
what is actually loaded    93,944 rows of (bigint, uuid)         ← the lookup table
```

The lookup table is a few MB. Batching it would issue 56 queries to avoid holding something that was never
big.

So the rule becomes: `dictionaries` sources are always read whole; for any other source, a caller that can
build a selection restricts per batch, and a caller that cannot pre-loads the source once for the run.
`loadCodecContext` already reads a source in full when it is omitted from `selection`, so this is a change to
which sources the audit pre-loads, not to the loader's contract.

The audit decides by asking whether it has key columns for the source. `codecKeyColumns` returns
`authorizer_person_id` for `persons`, so person batches. It returns nothing for `refs`, because
`collectionReferences` uses the `{ table, codec }` form and the refs a batch cites live both in
`row.reference_id` and in the child rows. That absence is the signal to pre-load.

This is why `codecKeyColumns` needs no extension and `x-storage` needs no new key. The alternative — teaching
the selection machinery to union row columns with pre-loaded child rows, and reordering the audit's batch loop
so children load first — is real work in service of splitting a 2 MB table into 56 pieces.

*Alternative considered: treat `refs` as a dictionary.* Rejected — the schema-based rule is the only thing
making "read whole" unambiguous, and a curated vocabulary of six roles is not the same kind of thing as 94,000
bibliographic references.

### D3 — The codec's topology does not change; only the values do

Order 1 still goes to `collections.reference_id`; the rest still become `additional_collection_refs` rows;
those rows still have no order column, so `merge` still re-derives order as `"1"` for the primary and
`"2","3",…` for children by ascending id. The round trip is exactly as lossy on order as it is today, and the
audit already compares after that normalization.

The only new behaviour is a lookup at each end: `permid → head id` on split, `id → permid` on merge. An
unresolvable value throws naming the codec and the value, as `roleName` and `personPermid` do.

### D4 — No migration changes, because no migration builds this array

`buildCollectionPayload` never emits `references`. `migrate-collections.js` writes
`collections.reference_id` and the child rows directly from its legacy `reference_no → refs.id` map. Both are
`bigint REFERENCES refs("id")` columns and hold ids by definition, and `references` never reaches the jsonb —
the `db` variant strips it, and with `unevaluatedProperties: false` a payload carrying one would fail
validation.

The permid therefore exists only in the API shape, which no migration constructs, consistent with D9 of
`convert-person-payload-schema`. This is worth stating because "the migration should emit permids" is the
natural assumption and it has nowhere to land.

### D5 — The correctness note on `personPermid` is corrected, not extended

The synced requirement reads as one argument:

> `persons.permid` is `NOT NULL UNIQUE`, and on versioned tables `swing_fks_to_new_version()` keeps every
> foreign key pointing at the lineage head, so an id and a permid name the same row in both directions.

It is two arguments doing different work, and only the first applies to `persons`. Left as written, it reads
as licence to resolve a permid on any table, which is how this defect would be written a second time. The
requirement is amended to separate them: `UNIQUE` is what makes the reverse direction a function on an
unversioned table; on a versioned table it is the head restriction that does, and `swing_fks_to_new_version()`
is what makes the forward direction safe.

## Risks / Trade-offs

**The defect being fixed cannot be reproduced from migrated data** → No ref has a second version, so every
query against the database agrees with the broken behaviour. The heads-only guarantee has to be tested from a
constructed fixture: a source whose rows include a superseded version sharing a permid with its head, asserted
to resolve to the head. A round-trip run over 275,554 collections proves the change is not a regression; it
proves nothing about the thing the change is for.

**`versioned: true` is a third flavour of "versioned" in the codebase** → `payload-audit`'s `REGISTRY` already
has one, and the DDL has `install_version_triggers`. Using the same word for the same fact is the point, but
they are set independently and could disagree. Nothing enforces that a source marked `versioned` names a table
with succession columns; a wrong flag surfaces as a SQL error on first read, which is acceptable.

**Pre-loading is decided by an absence** → The audit pre-loads a source precisely when `codecKeyColumns` gives
it nothing to select on. That is a sound rule, but it is implicit: a future codec that gains a `column` would
silently switch from pre-loaded to batched. The mitigation is that the loader supports both correctly, so the
switch changes performance and not results.

**A dangling permid in a create body is now possible** → Today a client sends `refs.id` and the FK rejects a
bad one. A permid resolves through the codec first, so an unknown permid throws there instead. The error is
better, but it moves the check from the database into application code for that one field. The FK still
guards what is finally written.
