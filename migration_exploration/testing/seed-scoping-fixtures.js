// Battery of test seed permids for openspec/changes/optimize-derive-taxa-seed.
//
// Chosen from a live dump of derive_taxa(NULL)'s _dtu_excluded_opinions on
// pg_play (2026-09-03), which found 53 cycle cuts clustering into distinct
// concept neighborhoods of varying size (2- through 8-node). Each cluster
// entry's permid is the cut's own `concept_permid` (== that lineage's
// accepted_spelling_permid, itself a valid _dtu_identity permid, i.e. a
// legal `seed` element) from that dump. See design.md's Context for the full
// methodology (instrumented DO-block timing + a `public._cycle_dump` table
// dump, both since dropped/cleaned up).
//
// Used by task 2.5/3.3/4.3's correctness checks (diff-derive-taxa-seed.js)
// against each of derive_taxa()/derive_linnaean()/derive_taxa_clades()'s
// seed-scoped rewrite: every entry here must produce output byte-identical
// to the corresponding row of a full, un-seeded derive.

const SEED_BATTERY = [
  {
    label: 'cycle-free',
    permid: '019ff8c0-900b-712f-a356-9d460596e2b4',
    name: 'Eukaryota',
    notes:
      "First root-class name_opinions row by id -- not present in any of the " +
      '53 cycle_members/concept_permid entries from the live dump. Exercises ' +
      'the plain walk-to-root path with zero local cuts.',
  },
  {
    label: 'cluster-2node',
    permid: '019ff8c0-a0a3-70dd-91b9-7badde9e7582',
    name: 'Iguanodontoidae',
    notes:
      'Cut 3 times (opinions 50978, 118421, 217890) as part of a stable ' +
      '2-node cycle with 019ff8c0-91fb-721b-b44c-2b21332f6a3b.',
  },
  {
    label: 'cluster-3node',
    permid: '019ff8c0-91fb-721b-b44c-5057070506f9',
    name: 'Coronosauria',
    notes:
      'The heaviest cluster found: cut 14 separate times (opinions 50988, ' +
      '53237, 69398, 81239, 81330, 81572, 100901, 192782, 200202, 321014, ' +
      '405037, 431494, 545473, 551569) against a stable 3-node cycle with ' +
      '019ff8c0-a0a3-70dd-91ba-7e11581d9502 and 019ff8c0-a21e-737b-8280-98fbbe4cb0fd. ' +
      'Exercises the local cut-and-restart loop (design.md Decision 1, step 3) ' +
      'the hardest of any fixture here.',
  },
  {
    label: 'cluster-4node',
    permid: '019ff8c0-93df-7718-b6dd-8c472be499cb',
    name: 'Neoselenodontia',
    notes:
      'Cut once (opinion 119460) as part of a 4-node cycle with ' +
      '019ff8c0-91a2-7101-be41-ad94772e93c5, 019ff8c0-9446-757b-a74e-5c9c4261e18b, ' +
      '019ff8c0-9d8c-73d7-8d57-2662169256a2.',
  },
  {
    label: 'cluster-5node',
    permid: '019ff8c0-9446-757b-a74e-5c9c4261e18b',
    name: 'Tylopoda',
    notes:
      'Cut 5 times total; opinion 909798 is the one 5-node-cycle cut (with ' +
      '019ff8c0-91a2-7101-be41-ad94772e93c5, 019ff8c0-95ea-70f8-896b-7ab858d2e3f4, ' +
      '019ff8c0-96a8-726e-ae7b-d582370496d8, 019ff8c0-9d8c-73d7-8d57-2662169256a2) -- ' +
      'the other 4 cuts on this same permid are 3-node-cycle cuts, so this ' +
      'fixture also exercises the same permid recurring in differently-shaped ' +
      'cycles across successive local resolutions.',
  },
  {
    label: 'cluster-6node',
    permid: '019ff8c0-a21e-737b-827f-331542c64ad8',
    name: 'Artisoptera',
    notes: 'Cut once (opinion 662248) as part of a 6-node cycle.',
  },
  {
    label: 'cluster-8node',
    permid: '019ff8c0-96e6-748a-ad61-d479f5fa0283',
    name: 'Notoplacentalia',
    notes:
      'Cut twice: first (opinion 275761) as part of a 2-node cycle with ' +
      '019ff8c0-95e4-74fa-8691-2db50a2c3dfd, then -- once its next-ranked ' +
      'candidate takes over -- (opinion 275767) as part of an unrelated ' +
      '8-node cycle sharing none of those nodes. This is the key overlapping- ' +
      "cycles case design.md's Risks section calls out: the walk MUST restart " +
      'from the seed after every cut, not resume from the cut point, or it ' +
      'will miss the second cycle.',
  },
  {
    label: 'rhombotrypella-dvinensis-reassignment',
    permid: '019ff8c0-972e-72df-8059-bbc93c61fc8f',
    name: 'Rhombotrypella dvinensis',
    notes:
      "Rhombotrypella dvinensis's own permid. Confirmed live (2026-09-03) " +
      'against the current name_opinions data: genus Rhombotrypella is ' +
      '019ff8c0-916c-742a-89a6-dfcf622fb31a, sibling genus Stereotoechus is ' +
      '019ff8c0-916c-742a-89a7-1114bd4c4e95. Matches the scenario from the ' +
      "earlier seed-parameter-benchmark session (see project memory " +
      "project_seed-parameter-benchmark.md): reassigning this species from " +
      'Rhombotrypella to Stereotoechus (a hypothetical new assignment_opinions ' +
      'row, evidence=true, high enough pubyr to win) inside a rolled-back ' +
      'transaction previously confirmed derive_taxa(seed)/derive_linnaean(seed) ' +
      'both correctly follow the new assignment. Re-run the same scenario ' +
      'against the seed-scoped rewrite to confirm it still does.',
  },
];

export { SEED_BATTERY };
