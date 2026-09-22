## Why

A collection cites its references by `refs.id`. Every other identifier this project hands to a client is a
permid — `permid-uuidv7` exists to make internal ids non-exposable, and `personPermid` established the pattern
for a payload field backed by an id column. `collectionReferences` was converted by `payload-schema-variants`
and kept the id, which `convert-person-payload-schema` recorded as its own next change:

> Converting `collectionReferences` to expose a ref's permid instead of `refs.id`. That is a separate change;
> this one builds the rails it will run on (D3).

It goes now, before the remaining schema conversions, because two of those conversions depend on the answer:
`refs` and `authorities` both carry `reference_id NOT NULL`, and neither should be written while the id↔permid
contract underneath them is still unsettled.

Doing it also retires the risk `convert-person-payload-schema` accepted in D3 — a contract designed for a
caller that did not exist yet — while only two codecs are written against it. That risk has already paid out
twice, and both findings are why this change is more than a copy of `personPermid`:

- **`refs.permid` has no `UNIQUE` constraint.** `persons.permid` does, and the `personPermid` requirement
  leans on it. On a versioned table every version shares one permid, so `permid → id` is not a function;
  only `place_in_lineage()` guarantees one *head* per permid. The context loader builds its reverse map with
  a plain `Map.set` over whatever rows return, so a versioned source silently resolves to whichever version
  sorted last. Latent today — 93,944 refs, 93,944 distinct permids, 93,944 heads, because no reference has
  ever been versioned — and wrong the first time one is edited.
- **The per-batch selection does not fit this codec, and does not need to.** D3 justified batching by "93,863
  refs cited by 275,554 collections and 167,150 specimens," but the large number there is the *citations*.
  The thing actually loaded is the lookup table: 93,944 rows of `(bigint, uuid)`, a few MB. Batching it would
  issue 56 queries to avoid holding something that was never big.

## What Changes

- **`collectionReferences` carries permids.** It declares a source on `refs` and resolves `permid → head id`
  on split, `id → permid` on merge. The storage topology is untouched: order 1 still goes to
  `collections.reference_id`, the rest still become `additional_collection_refs` rows, and those rows' order
  is still discarded and re-derived on merge by ascending id.
- **A source can declare that it reads lineage heads only.** `{ table, key, value }` has nowhere to say it,
  and a versioned source needs it for the `value → key` direction. The shape is a design decision; the
  requirement is that resolving a permid on a versioned table yields the head id and never a superseded one.
- **`refs` is read once per run, in full.** The rule that only `dictionaries` sources may be read whole is
  replaced by one that lets a caller pre-load any source it judges small enough, with `dictionaries` still
  read whole unconditionally. The audit pre-loads `refs` beside the dictionaries.
- **No annotation change.** `x-storage` keeps its three forms; `collectionReferences` keeps
  `{ table: "additional_collection_refs", codec: "collectionReferences" }`. Following D2, the lookup stays a
  property of the codec.
- **No migration change.** `migrate-collections.js` never builds a `references` array — it writes
  `collections.reference_id` and the child rows straight from its legacy `reference_no → refs.id` map. Those
  are FK columns and hold ids by definition, and `references` never reaches the jsonb, which the `db`
  variant strips. The permid exists only in the API shape, which no migration constructs (D9).
- **No DDL change and no stored-data change.** Every column and child row keeps the value it holds today.

## Capabilities

### New Capabilities

None. Both behaviours belong to capabilities that already own behaviour of the same kind.

### Modified Capabilities

- `payload-schema-variants`: the `collectionReferences` requirement — `referenceID` becomes a ref's permid
  rather than `refs.id`, in both directions; a codec source gains the ability to declare that it resolves
  against lineage heads only, with the correctness note on `personPermid` corrected to distinguish what
  `UNIQUE` buys on an unversioned table from what `swing_fks_to_new_version()` buys on a versioned one; and
  the "every other source SHALL be read per selection" rule widens to let a caller pre-load a source it
  judges small.
- `payload-audit`: round-trip mode pre-loads `refs` once for the run, alongside the dictionary sources,
  rather than selecting it per batch.

## Impact

**Payload schemas** — `payloadSchemas/lib/codecs.js` (`collectionReferences` gains a source and two lookups);
`payloadSchemas/lib/storage.js` (`loadCodecContext` learns the heads-only restriction);
`payloadSchemas/collection.schema.js` (the `referenceID` description, which currently says "Reference unique
identifier" and should say what kind); `payloadSchemas/tests/` (codec coverage from a fixture map, both
directions, plus the superseded-version case).

**Audit** — `src/audit-payloads.js`: `refs` moves into the per-run context. `codecKeyColumns` stays as it is,
still used by person's `persons` source; it is simply not on this codec's path.

**Migrations** — none.

**Database** — none. No DDL, no backfill, no rewritten rows. `refs.permid` stays without a `UNIQUE`
constraint, which is correct for a versioned table; the fix is in how the lookup is written, not in the
schema.

**Verification** — `node src/audit-payloads.js --round-trip` clean across all three entities, with each of the
275,554 collections rebuilding the same `reference_id` and the same child rows it holds now; the permid a
collection resolves to identifies the ref it cites today; and a constructed two-version ref resolves to the
head, which is the case no amount of current data can exercise.

**Risk** — the heads-only defect is invisible in every test the current data can produce, since no ref has
more than one version. The check has to be a constructed fixture, not a query against migrated rows.
