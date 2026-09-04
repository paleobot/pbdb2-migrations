## MODIFIED Requirements

### Requirement: Set publication_year and attribution as second-hand fields gated on ref_has_opinion
The script SHALL treat `publication_year` and `attribution` as second-hand overrides driven by the same switch. When `ref_has_opinion = 'YES'` (first-hand: the reference is the source), `publication_year` SHALL be NULL and `attribution` SHALL be omitted — `derive_taxa()` reads the year from the reference via `COALESCE(publication_year, ref.publicationYear)`. When `ref_has_opinion IS NULL` (second-hand: attributed to an earlier author), `publication_year` SHALL be `pubyr` parsed as an integer and `attribution` SHALL be a jsonb object built per `payloadSchemas/opinionAttribution.schema.js` from `author1last`/`author2last`/`otherauthors` using the `buildCitationFromFields`/`buildDescriptorsFromFields` helpers from `src/lib/authorities-builders.js` with `publishedInReference = false`.

Second-hand rows with no discernible authorship (`author1last` blank/NULL — 7 in-scope rows) SHALL use the established "authority unknown" sentinel attribution `{ citation: 'authority unknown', descriptors: [], publishedInReference: false }` (mirroring the authorities scenario ④ convention), rather than an empty-citation object.

The helper citation above previously named `migrate-authorities.js`. It is corrected to
`src/lib/authorities-builders.js`, which is where the implementation reads them from
(`src/lib/attribution.js`) and where they are now solely defined — the relocated
`src/authorities-migration/migrate-authorities.js` imports them rather than declaring them. This is a
source-of-guarantee citation, so `migration-script-layout`'s citation-form rule requires it to be
path-qualified to the file that actually holds the helpers.

#### Scenario: First-hand opinion defers year to the reference
- **WHEN** an in-scope row has `ref_has_opinion = 'YES'`
- **THEN** `publication_year IS NULL` and `attribution` is omitted

#### Scenario: Second-hand opinion overrides with the attributed year
- **WHEN** an in-scope row has `ref_has_opinion IS NULL` and `pubyr = '1868'`
- **THEN** `publication_year = 1868` and `attribution` carries the parsed author citation

#### Scenario: No in-scope row loses ranking to NULLS LAST
- **WHEN** the year rule is applied across the in-scope set
- **THEN** every retained row either has a `publication_year` or resolves a reference year, so no row's derive-time `yr` is NULL solely due to this rule (verified: 0 retained rows have `COALESCE(publication_year, ref.publicationYear)` NULL)

#### Scenario: Unknown-authorship second-hand row uses the sentinel
- **WHEN** a second-hand in-scope row has a blank/NULL `author1last`
- **THEN** `attribution = { citation: 'authority unknown', descriptors: [], publishedInReference: false }`

#### Scenario: Helpers resolve to the shared library
- **WHEN** a reader follows this requirement to the implementation of `buildCitationFromFields` and `buildDescriptorsFromFields`
- **THEN** they arrive at `src/lib/authorities-builders.js`, the single definition shared by the authorities and opinions migrations, rather than at a migration entry point
