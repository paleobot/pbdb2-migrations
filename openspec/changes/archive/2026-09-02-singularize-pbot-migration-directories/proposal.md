## Why

`src/pbot-persons-migrations/` and `src/pbot-refs-migrations/` carry a trailing `s` on `migrations` that
none of the other four migration directories has. The plural was introduced by
`move-persons-migrations-to-src` as a deliberate *asymmetry within a pair* — a PBot-sourced script named
differently from the PBDB-sourced sibling beside it — and `move-refs-migrations-to-src` copied it by
analogy. Neither design ever claimed the `s` meant "PBot-sourced"; both justified it solely by the singular
sibling it sat next to.

`move-pbot-schemas-migration-to-src` tested that reading. The schemas migration has no PBDB sibling, so
there was no pair to be asymmetric with, and it was named `src/pbot-schemas-migration/` — singular — on the
grounds that the plural was a contrast device rather than a marker. This change applies the same judgment
to the two directories that established the pattern. The result is six directories that all read
`<subject>-migration`:

```
BEFORE                             AFTER
opinions-migration                 opinions-migration
persons-migration                  persons-migration
pbot-persons-migrations   ←plural  pbot-persons-migration
refs-migration                     refs-migration
pbot-refs-migrations      ←plural  pbot-refs-migration
pbot-schemas-migration             pbot-schemas-migration
```

This is worth doing now rather than later because the cost only grows: three relocation slices remain
(`migrate-authorities.js`, `migrate-authorities-opinions.js`, `migrate-collections.js`), and each one is
another opportunity for a contributor to read the two plurals as a convention and propagate them. Doing it
before those slices means they inherit one rule instead of two competing examples.

## What Changes

- Rename `src/pbot-persons-migrations/` → `src/pbot-persons-migration/`.
- Rename `src/pbot-refs-migrations/` → `src/pbot-refs-migration/`.
- Update the two `.claude/settings.local.json` permission entries that name these paths as executables.
- Rewrite the `migration-script-layout` requirements that the rename invalidates (see Capabilities).

**No code changes at all.** The `src/lib/` rule — a migration directory SHALL NOT import from another
migration's directory — guarantees that no script ever names a sibling directory. A repo-wide grep confirms
it: outside the archive, these two directory names appear in exactly two files, and neither is a `.js`.
The scripts themselves import only `../lib/…`, which is unaffected by their own directory's name.

**BREAKING for anyone with the old paths memorised or scripted**, in the narrow sense that
`node src/pbot-refs-migrations/migrate-pbot-refs.js` stops resolving. There is no programmatic consumer to
break, and no run script yet exists to update — the deferred `src/` runner change will be written against
the new names.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `migration-script-layout`: three requirement changes, only one of which is about paths.

  - **Modified** — "One directory per migration under `src/`". Two things happen here. The requirement
    currently names `src/pbot-persons-migrations/` as the worked example of a deliberate asymmetry and
    states that asymmetry SHALL be preserved; that sentence and its companion scenario
    ("Deliberate name asymmetry preserved") describe a state that will no longer exist, and go. In their
    place the requirement gains a **positive naming convention**: each migration directory SHALL be named
    `<subject>-migration`, singular. That is what stops the plural drifting back in on the three remaining
    relocation slices.

  - **Modified** — the literal-names rule is **reframed rather than deleted**. As written it says directory
    names "SHALL NOT be normalized for consistency with one another" — which this change contradicts
    directly, since normalizing for mutual consistency is precisely what it does. Deleting the rule outright
    would be worse: it is the rule that protected `pbot-schemas-migration`'s singular against the two
    plurals beside it, and without it nothing sanctions a deliberately unusual name in future. The rule was
    written to stop a contributor tidying away a name they had misread as a typo; it was never meant to
    freeze a name against its owner's decision. Reframed, it draws that line explicitly: a directory name
    changes only by a deliberate decision recorded in this specification, never as incidental cleanup.

  - **Modified** — "Inventory of migrated and not-yet-migrated scripts". Two rows in the `src/` table take
    their new names. The root list is unchanged; no script moves in or out of `src/` here. The scenario
    "A PBot-sourced migration without a PBDB sibling is named in the singular", added by
    `move-pbot-schemas-migration-to-src`, is removed — its premise is that "the two existing PBot
    directories both carry a trailing `s`", which this change makes false. It is not being removed because
    it was wrong; it is being removed because the positive naming convention now covers every directory
    uniformly and the case it carved out no longer needs carving.

  - **Modified** — "Related migrations stay in separate directories with documented run order" contains one
    path citation, in the numbered persons run-order list. Mechanical update.

**Deliberately not modified.**

| Location | Mentions | Why no change |
|---|---|---|
| `openspec/changes/archive/` | 32 | The archive is a historical record of what was true when each change landed. The refs slice scoped itself to "no stale path reference outside `openspec/changes/archive/`", and that convention holds here. The inventory in `migration-script-layout` is the authority on where a script lives today. |
| `pbot-person-migration`, `pbot-refs-migration` specs | 0 path citations | Neither names a directory; both read "The script SHALL …". Note these two *capability* names are already singular and always were — the divergence being fixed is between directories and each other, not between directories and capabilities. |
| `permid-uuidv7`, `authorities-migration` | bare filenames only | Script filenames, not directory paths. Unaffected by a directory rename, and covered by the citation-form rule. |

## Impact

**Directories renamed:** 2. **Files moved:** 2 (one entry-point script each; neither directory contains
anything else — no `tests/` subdirectory, no run artifacts).

**Code edited:** none.

**Configuration edited:** `.claude/settings.local.json`, two permission entries. The file is gitignored, so
this edit is real but uncommitted — worth stating because it means a fresh clone has nothing to fix, while
this working copy does.

**Databases:** none. This change runs no migration, reads no source, and writes no target. The MariaDB and
PostgreSQL sides are untouched, and no anomaly class from `anomaly-report.md` is in play. The two scripts
being moved are not run as part of this change — a directory rename cannot alter their behavior, since
their only imports are `../lib/…` and the `..` resolves identically from either name.

**Data-integrity risk:** none. There is no failure mode in which this change corrupts data, because it
touches no data path. The realistic failure is a stale path in a place the grep missed, which surfaces as a
`MODULE_NOT_FOUND` or a permission prompt, both loud and both trivially fixable.

**Verification:** confirm both scripts still resolve their imports from the new locations, confirm no path
reference to the old names survives outside the archive, and confirm `git` recorded both as renames rather
than as delete-plus-add. Unlike the relocation slices, there is no database state to compare — the useful
check here is that the spec no longer contradicts itself, which is a read rather than a run.

**Not in scope:**

- Renaming the remaining three root-level scripts or relocating them; that is the work of later slices,
  which will now inherit the naming convention this change states.
- Renaming OpenSpec capabilities to match directory names. The capability/directory divergence has been
  tolerated since slice 1 and is unaffected here — if anything this change narrows it, since
  `pbot-person-migration` and `pbot-refs-migration` were already singular.
- The deferred `src/` runner script, which will be written against the new directory names. Its three
  inherited findings are untouched by this change.
