## 1. Validate and finalize the spec

- [ ] 1.1 Cross-check each requirement in `specs/opinions-pair-handlers/spec.md` against
      `opinions-pair-mapping.md`'s per-pair sections to confirm no pair's rule or exception was dropped in
      translation from 48 files down to 3 dispositions + the named exceptions
- [ ] 1.2 Run `openspec validate consolidate-opinions-pair-handlers --strict` and resolve any issues
- [ ] 1.3 Get the change reviewed and accepted

## 2. Update cross-references to the superseded docs

- [ ] 2.1 Update `docs/taxa-opinions-migration-mapping.md`'s references to
      `migration_exploration/DESIGN.md` (its "parallel rewrite" pointer, and its §3 citations for
      anomaly write-ups) to point at the new `opinions-pair-handlers` spec instead
- [ ] 2.2 Update `migration_exploration/testing/pairs.js`'s header comment (currently "See ../DESIGN.md
      §5") to point at the new spec
- [ ] 2.3 Leave `migration_exploration/opinions/nomen-oblitum/original-spelling.js`'s "Resolves DESIGN.md
      Q4" comment as-is — it lives in one of the 48 files this change doesn't touch, and will be rewritten
      naturally when a future change implements this spec

## 3. Archive the superseded documents

- [ ] 3.1 Archive/remove `migration_exploration/DESIGN.md` now that its rules live in the accepted spec
      (content remains reachable in git history)
- [ ] 3.2 Archive/remove `migration_exploration/opinions-pair-mapping.md` now that its rules live in the
      accepted spec (content remains reachable in git history)

## 4. Archive the OpenSpec change

- [ ] 4.1 Run `openspec archive consolidate-opinions-pair-handlers` to promote
      `specs/opinions-pair-handlers/spec.md` into `openspec/specs/` as the canonical reference

## 5. Hand off implementation

- [ ] 5.1 Open a new, separate OpenSpec change to refactor `migration_exploration/opinions/*.js` against
      the archived `opinions-pair-handlers` spec — out of scope for this change, tracked only as a
      follow-up pointer
