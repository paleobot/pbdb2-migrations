## Why

A `pg_play` full-rebuild sanity check against `pg_classic`'s own `taxon_trees` found that Triceratops
horridus's `containing_concept_permid` resolves to **Tatankaceratops** instead of Triceratops.
`derive_taxa()`'s concept-senior selection (`_dtu_con_winner`/`_dtu_conmeta` in `postgresql/create_new.sql`)
picks a synonymy group's senior representative by (1) preferring a lineage with no winning outgoing
"junior synonym" edge, then (2) tiebreaking on `evidence DESC, yr DESC, opinion_id DESC` — fields that
measure a lineage's own accepted-spelling confidence, not group seniority. Triceratops fails (1) only
because of a stale, unevidenced two-way 19th-century dispute with Agathaumas; with no clean winner, (2)
rewards the *youngest* name in the group. Measured against a real `pg_play` rebuild (~22,203 multi-member
concept groups), 395 groups (1,914 taxa) hit this fallback, and 256 of those pick a non-oldest senior.

Agathaumas — and every other name genuinely older than Triceratops in this synonymy group — is already
tagged `nomen dubium` in the ledger, and `nomen dubium` currently has zero effect anywhere in `derive_taxa()`
(`dictionaries.nomenclatural_statuses.bars_candidacy` is `false` for it, grouped with inert `nomen vanum`).
But the fix is not as simple as flipping that flag to disqualifying: **the deeper root cause is that
`validity_opinions` has no way to positively express a reversal.** When a name's dubious/nomen-vanum/nomen-nudum
status is later resolved by further study, nobody typically files a fresh validity opinion saying "not dubious
anymore" — they just keep using the name normally in later name, concept, and assignment opinions, and the
old invalidating opinion sits unresolved in the ledger forever. Confirmed live: Majungasaurus carries two
1998-era, unevidenced `nomen dubium` opinions that were never formally reversed, even though a 2007 evidenced
concept-class opinion (synonymizing the misidentified "Majungatholus" material into it) and two decades of
continued classification activity clearly show modern consensus treats it as valid. A pre-filter that treats
any winning invalidating opinion as absolute — the first fix attempted here — makes Majungasaurus (and
Coelophysis, Fabrosaurus, and dozens of similar well-known, actively-studied genera) lose to their own
historical synonyms, which is a worse regression than the bug being fixed.

## What Changes

- `dictionaries.nomenclatural_statuses` gains a single `invalidates boolean` column (replacing the narrower
  `bars_candidacy`), `true` for `nomen dubium`, `nomen nudum`, **and `nomen vanum`** — confirmed against the
  ICZN, which does not recognize `nomen vanum` as a distinct category at all; both describe the same
  "doubt about diagnosability, not an act of invalidation" situation, so they get identical treatment.
  `nomen oblitum` (untargeted) stays uninvolved, as it is today. `nomen nudum` also moves into this unified
  mechanism (see below) rather than keeping its separate absolute pre-filter — Classic's curatorial process
  had no way to enforce that a "nomen nudum" tag was applied strictly per the Code's own availability
  criteria, so treating it as a revisable judgment, like the other two, matches how the data actually was
  entered.
- **Validity is checked once, at the end of each selection, not as a pre-filter** — for both the
  lineage-level accepted-spelling contest and the concept-level senior-representative contest:
  1. Rank candidates by the existing evidence/priority rules, completely ignoring validity status.
  2. If the provisional winner's current winning validity opinion has `invalidates = true`, compare that
     opinion's own rating (`evidence DESC, yr DESC, id DESC`) against the best rating among (a) the
     candidate's own current root/name-class opinion and (b) any current, non-negating concept-class
     opinion where the candidate is the **target** (something else defers to it) — i.e. any sign, anywhere
     else in the ledger, that this name kept being treated as legitimate after the invalidating ruling.
     Assignment (classification) opinions are deliberately excluded from this comparison: placing a taxon
     in a hierarchy doesn't imply an opinion on whether it's dubious — nomina dubia get classified
     routinely without anyone resolving their status.
  3. If the invalidating opinion outranks that best counter-signal, the candidate is evicted from the pool
     for the rest of this `derive_taxa()` run, and selection reruns among what remains — except a concept
     is never evicted down to zero candidates: once one remains, it wins regardless of its own status.
- **Two simpler fixes were tried live against `pg_play` and rejected; recorded here so they aren't
  re-attempted:**
  - Reordering the tiebreak to prefer `original_yr ASC` whenever no true sink exists fixes Triceratops but
    directly overturns 65 other groups where a real evidenced opinion legitimately asserts the older name
    is junior to a younger one (e.g. Cathartidae correctly beats the 1811 name Vulturidae today).
  - A validity **pre-filter** (excluding nomen-dubium/nomen-nudum candidates from winning outright, edges to
    them treated as non-disqualifying) does fix Triceratops, and is monotonically safe against the evidenced
    cases above — but makes Majungasaurus, Coelophysis, Fabrosaurus, and dozens of other well-known genera
    lose to their own obsolete junior synonyms, because their invalidating opinions are decades old and
    never technically "reversed" in `validity_opinions` itself. This is what motivated moving the check to
    the end of derive() and comparing against other tables instead of trusting the flag absolutely.
- The inline comment in `postgresql/create_new.sql` documenting `nomen dubium`/`nomen vanum` as inert must
  be rewritten to state the new rule plainly, not layered with a "this supersedes an earlier decision" note.
- **BREAKING** (data, not schema): re-running `rebuild_taxa_full()` after this change alters
  `accepted_spelling_permid`/`containing_concept_permid`/`concept_permid` for every taxon whose winning
  candidate today is an invalidated-but-never-superseded name, or defers to one.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `taxa-opinions`: the accepted-spelling requirement and the concept-senior-selection requirement both
  change from validity being an absolute pre-filter to an end-of-selection, evictable veto compared against
  other ledger activity. The `nomenclatural_statuses` dictionary's shape changes (`bars_candidacy` →
  `invalidates`), and `nomen vanum`/`nomen nudum` both move to the same treatment as `nomen dubium`.

## Impact

- `postgresql/create_new.sql` — `dictionaries.nomenclatural_statuses` seed data; `derive_taxa()`'s
  lineage-level accepted-spelling selection (`_dtu_linmeta`) and concept-level senior selection
  (`_dtu_con_winner`/`_dtu_conmeta`), both gaining an iterative provisional-winner/evict/retry loop in place
  of a static pre-filter.
- `pg_play` — redeploy `derive_taxa()` and re-run `rebuild_taxa_full()` after the fix.
- Performance: the existing containment-cycle-breaking loop is the only precedent for this kind of
  iterative, whole-dataset loop inside `derive_taxa()`; both prior fixes that added similar machinery
  measurably slowed the function (see `derive-taxa-performance-fix`/`fix-eukarya-eumetazoa-containment-cycle`
  memories) — this needs the same measure-don't-assume treatment.
- No other repo code (migration scripts, `src/`, `payloadSchemas/`) reads `bars_candidacy` or the concept
  union-find directly — the blast radius is contained to `derive_taxa()`'s own output and anything that
  reads `taxa`/`taxa_linnaean`.
