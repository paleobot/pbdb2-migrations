## Context

The three relocation slices that populated `src/` each *extended* `migration-script-layout`. This change is
the first to **reverse** one of its requirements: the spec presently states that
`src/pbot-persons-migrations/`'s trailing `s` "is deliberate and SHALL be preserved," and this change
removes it. That difference in kind is what most of this design is about — the two `git mv`s are trivial.

Current state, verified by grep and inspection:

```
src/pbot-persons-migrations/migrate-pbot-persons.js     ← only file in the directory
src/pbot-refs-migrations/migrate-pbot-refs.js           ← only file in the directory
        │
        ├── imports: '../lib/pg-pool.js', '../lib/uuidv7.js'   (unaffected by the rename)
        └── no tests/ subdirectory, no run artifacts

mentions of either directory name, outside openspec/changes/archive/:
    .claude/settings.local.json          2   executable paths (gitignored)
    migration-script-layout/spec.md      6   across 3 requirements
    *.js                                 0
```

Zero code sites is not luck. The layout spec's own `src/lib/` rule — a migration directory SHALL NOT import
from another migration's directory — means a directory name can only ever appear in a script that imports a
sibling, which is exactly what that rule forbids. The rename is safe *because* an earlier requirement made
it safe.

## Goals / Non-Goals

**Goals:**

- Rename both directories to `<subject>-migration`, matching the other four.
- Leave the spec internally consistent — no requirement forbidding what another requirement mandates.
- Preserve the protection the removed rule provided, without preserving the specific quirk it protected.
- State the naming convention positively, so the three remaining relocation slices inherit a rule rather
  than two competing examples.

**Non-Goals:**

- Renaming OpenSpec capabilities to match directory names.
- Touching the archive's 32 references.
- Relocating or renaming the three remaining root-level scripts.
- Running either migration. A directory rename cannot change a script's behavior when its only imports
  resolve through `..`.

## Decisions

### 1. Both directories, not one

Renaming only `pbot-persons-migrations` would leave `pbot-refs-migrations` as the sole plural — strictly
worse than today, because a lone exception reads as significant in a way that a pair reads as convention.
The two were introduced by the same reasoning one slice apart and are removed together.

### 2. Reframe the literal-names rule; do not delete it

This is the decision that keeps the spec coherent, and it needs stating carefully because the rule is
*simultaneously* what this change violates and what protects the change's own outcome.

```
"Directory names are literal and SHALL NOT be normalized
 for consistency with one another."
        │
        ├── this change normalizes for consistency  ────────── violates it
        └── it is what let pbot-schemas-migration stay        depends on it
            singular beside two plurals, one slice ago
```

Delete it and nothing sanctions a deliberately unusual name later. Keep it verbatim and the spec forbids
the change that just landed. The way out is to notice that the rule was aimed at a specific failure mode
and over-stated to reach it: it exists to stop a contributor *tidying away a name they misread as a typo* —
which is exactly the risk `move-persons-migrations-to-src` named when it introduced the plural, and exactly
the risk `move-pbot-schemas-migration-to-src` named again, in the opposite direction, when it worried its
singular would be "corrected" to match its plural neighbours.

Reframed to that actual purpose, the rule becomes: **a name changes only by a deliberate decision recorded
in this specification, never as incidental cleanup.** That permits this change, forbids drive-by
correction, and — unlike the original — protects every directory rather than one quirk. It is a better rule
than the one it replaces, and this change is the evidence for why.

**Alternative rejected:** delete the rule and rely solely on the positive naming convention. Simpler, but a
convention says what a *conforming* name looks like; it says nothing about a name that deliberately does not
conform. The repo has already wanted such a name twice in three slices.

### 3. State the convention positively

`<subject>-migration`, singular, regardless of source system. Two migrations writing the same table are
distinguished by `<subject>` (`persons-migration` vs. `pbot-persons-migration`), never by the trailing noun.

This narrows the three remaining slices: they inherit a naming rule where the last three exercised a naming
judgement. That is the intended trade. The plural propagated in the first place precisely because slice 2
derived its convention by looking at slice 1's neighbour rather than at a stated rule, and three more
opportunities for that remain.

### 4. The pbot-schemas scenario is removed because it won, not because it was wrong

`move-pbot-schemas-migration-to-src` added a scenario justifying its singular directory against two plural
neighbours. Its premise — "the two existing PBot directories both carry a trailing `s`" — is false after
this change, so it goes.

Worth recording *why* it goes, because "we deleted the scenario we added last slice" reads badly without it:
that scenario argued the plural was a pair-contrast device rather than a PBot marker, and named singular as
the right answer where no pair existed. This change applies that same reasoning to the pair itself. The
scenario is not being reversed; it is being generalised into the naming convention in decision 3, which
covers its case and every other case uniformly. A carve-out is unnecessary once the rule it carved out of
says the same thing.

### 5. The archive keeps its 32 stale paths

Consistent with `move-refs-migrations-to-src`, which scoped itself to "no stale path reference outside
`openspec/changes/archive/`". An archived change is a record of what was true when it landed; rewriting it
would make it a worse record, not a better one. The inventory in `migration-script-layout` is the single
authority on where a script lives today — which is precisely the role the refs slice's citation-form rule
assigned it.

Note this differs from the citation-form rule's usual logic. That rule leaves *bare filenames* alone because
a filename stays accurate when a file moves. These are *paths*, and they do become inaccurate. The archive
is exempt for a different reason: not because the references remain true, but because they are dated.

### 6. No verification run is possible or needed

The relocation slices each ended with a database exercise. There is nothing analogous here: the change
alters no import, so there is no import to re-resolve beyond confirming Node still finds `../lib/`. The
meaningful verification is textual — that no stale path survives outside the archive, and that the spec no
longer contradicts itself. Both are reads.

Running either migration would be *possible* but would prove nothing about the rename while carrying real
cost: `migrate-pbot-persons.js` and `migrate-pbot-refs.js` are idempotent, but the previous change
established that this repo's live PBot source drifts, so a run would import upstream changes unrelated to
this work and muddy the record. Explicitly out of scope.

## Risks / Trade-offs

- **[Risk] A stale path survives somewhere the grep missed.** → Surfaces as `MODULE_NOT_FOUND` or a
  permission prompt — loud, immediate, and a one-line fix. No silent failure mode exists, because a
  directory name is either resolved by the filesystem or it is not. Contrast the previous change, whose
  characteristic failure was a clean exit 0 hiding a two-thirds under-migration.

- **[Risk] The reframed rule is read as licence to rename freely.** → The reframing is narrower than the
  original in the dimension that matters: it requires a *recorded decision*, where the original simply said
  names are literal. A contributor who wants to rename must now write a change, which is the bar this change
  itself cleared.

- **[Trade-off] The naming convention narrows the remaining slices.** → Accepted and intended, per decision
  3. If a future migration genuinely needs a non-conforming name, decision 2's reframed rule is the
  mechanism for granting it — that is what it is for.

- **[Trade-off] The archive accumulates paths that no longer resolve.** → 32 today, and any future rename
  adds more. Accepted; the alternative is rewriting history to preserve an illusion of currency. Mitigated
  by the inventory being the stated authority.

- **[Risk] `.claude/settings.local.json` is gitignored, so the fix does not travel.** → Real but harmless:
  a fresh clone has no entries to be stale. Only this working copy needs the edit, and the failure mode is
  an extra permission prompt.

- **[Trade-off] This change spends a slice's worth of ceremony on two `git mv`s.** → The ceremony is not for
  the renames; it is for reversing a SHALL. A spec that forbids what the repo does is worse than either
  state on its own, and the reasoning in decision 2 is the durable output here.

## Migration Plan

1. `git mv src/pbot-persons-migrations src/pbot-persons-migration`.
2. `git mv src/pbot-refs-migrations src/pbot-refs-migration`.
3. Update the two `.claude/settings.local.json` permission entries.
4. Confirm both scripts still resolve `../lib/pg-pool.js` and `../lib/uuidv7.js` from the new paths.
5. Confirm no reference to either old directory name survives outside `openspec/changes/archive/`.
6. Confirm `git status` records two renames, not two deletes plus two adds.

**Rollback:** `git revert`. Nothing is destructive, no data is touched, and the two scripts are byte-for-byte
unchanged throughout — only their parent directory's name differs.

## Open Questions

- **Should the runner change come before the remaining three slices?** Carried forward from
  `move-pbot-schemas-migration-to-src`, which recommended it after its run-order hazard fired live during
  verification. Unaffected by this change except that the runner will now be written against six uniformly
  named directories, which makes it marginally simpler.

- **Do the capability names get reconciled with the directory names?** Still tolerated, still out of scope,
  and slightly less pressing now: `pbot-person-migration` and `pbot-refs-migration` were always singular, so
  this change moves the directories toward the capabilities rather than away. The residual mismatches are
  `person-migration` vs. `persons-migration` and `pbot-person-migration` vs. `pbot-persons-migration` —
  plural on the subject, not on the trailing noun, which is a separate question from the one settled here.
