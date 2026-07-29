-- ============================================================================
-- taxa & opinions — DRAFT DDL
-- ============================================================================
--
-- STATUS: draft for discussion, NOT committed schema. Nothing here has been
-- run. Fold into postgresql/create_new.sql by hand once settled.
--
-- Supersedes the taxa/rank_opinions/assignment_opinions/rename_opinions/
-- homonyms block currently in create_new.sql, which predates the design work
-- in docs/classic-taxa-opinions.md §9.
--
-- THIS REVISION implements the IDENTITY INVERSION settled in §9.8:
--   * permid = a name-AS-SPELLED (legacy authorities.taxon_no), NOT the
--     original combination (legacy orig_no). orig_no is deliberately ignored
--     by the migration; the name-lineage and the concept are both DERIVED.
--   * name + rank are IMMUTABLE attributes of a permid, minted with it. There
--     is therefore NO rank_opinions table and NO rank fan-out (old open call
--     B is moot): rank_id rides the minting name_opinion.
--   * name_opinions are typed EDGES between permids (subject → target), whose
--     reason's edge_class ('lineage' | 'concept') tells derive() which of its
--     two union-finds the edge feeds.
--   * There is NO `synthesized` column anywhere (§9.8 / correction 2): an
--     authorities-sourced opinion is a real opinion carrying the row's real
--     reference / attribution / pubyr and evidence = false, which already
--     places it correctly. Nothing needs an artificial floor.
--
-- Design rationale: docs/classic-taxa-opinions.md
--   §9.5   truth vs. materialization; the three layers
--   §9.5.2.1  Layer 1 versioning — with permid, without the version triggers
--   §9.6   column vocabulary (succession / concept / classification)
--   §9.7   performance seams that must not be foreclosed
--   §9.8   THE IDENTITY INVERSION — permid = name-as-spelled (the committed model)
--   §10    legacy field disposition + migration strategy
--
-- Two conventions inherited from create_new.sql:
--   * permid uuid + CHECK ((get_byte(uuid_send(permid), 6) >> 4) = 7).
--     CHECK only, matching create_new.sql as it stands: permids are minted by
--     the application. The PG16-compatible get_byte form may become
--     uuid_extract_version(permid) = 7, and gain a DEFAULT uuidv7(), once the
--     database is on PG18 (see openspec/specs/permid-uuidv7/spec.md).
--   * SELECT install_version_triggers('t') installs place_in_lineage() /
--     handle_new_version() AND a partial index t_permid_head_idx on
--     (permid) WHERE succeeded_by_id IS NULL. Do not hand-create that index.
--
--     EXCEPTION: the five opinion tables are versioned but deliberately do NOT
--     call install_version_triggers() — see the Layer 1 header for why. They
--     therefore DO hand-create their own permid head indexes, at the bottom of
--     this file. `taxa` and `taxon_annotations` still use the helper normally.
--
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS ltree;


-- ============================================================================
-- DICTIONARIES
-- ----------------------------------------------------------------------------
-- Expressed as ALTER/INSERT against the existing create_new.sql dictionaries;
-- fold into the original CREATE statements when merging.
-- ============================================================================

-- dictionaries.taxonomy_ranks has two problems:
--   1. 'order' is missing entirely (the list jumps infraorder → suborder →
--      superorder). The legacy MySQL enum has 26 values; this list has 24.
--   2. derive() must enforce Classic's rule that a containing taxon's rank is
--      strictly higher (Opinion.pm:1163). Relying on id order breaks as soon as
--      'unranked clade'/'unranked' sit at the end of the list, so rank ordering
--      needs to be explicit rather than positional. NULL height = unranked,
--      which is the correct semantics: no comparison is possible.
ALTER TABLE dictionaries.taxonomy_ranks ADD COLUMN height integer;

INSERT INTO dictionaries.taxonomy_ranks (taxonomy_rank) VALUES ('order');

UPDATE dictionaries.taxonomy_ranks t SET height = v.height
FROM (VALUES
    ('subspecies', 10), ('species', 20), ('subgenus', 30), ('genus', 40),
    ('subtribe', 50), ('tribe', 60), ('subfamily', 70), ('family', 80),
    ('superfamily', 90), ('infraorder', 100), ('suborder', 110), ('order', 120),
    ('superorder', 130), ('infraclass', 140), ('subclass', 150), ('class', 160),
    ('superclass', 170), ('subphylum', 180), ('phylum', 190),
    ('superphylum', 200), ('subkingdom', 210), ('kingdom', 220),
    ('superkingdom', 230)
    -- 'unranked clade' and 'unranked' deliberately keep height NULL
) AS v(taxonomy_rank, height)
WHERE t.taxonomy_rank = v.taxonomy_rank;


-- NOTE: there is deliberately NO dictionary table for evidence. Legacy
-- `opinions.basis` is a 5-value enum, but pbdb2 collapses it to a boolean:
-- `stated with evidence` → true, everything else (including NULL) → false.
-- Each opinion table therefore carries a plain `evidence boolean NOT NULL`,
-- as create_new.sql already had. The 30% of legacy opinions with
-- `basis IS NULL` are resolved against the reference's basis AT MIGRATION
-- TIME, not at read time — pbdb2's `refs` has no basis field at all, so
-- there is nothing for derive() to fall back to. See §10.5.
--
-- derive()'s winner selection is consequently a single ORDER BY, applied per
-- dimension (accepted spelling, classification, validity, type, traits):
--
--     ORDER BY <grouping key>,
--              evidence DESC,     -- stated with evidence (true) before false
--              COALESCE(pubyr, reference publication year) DESC,
--              id DESC
--
-- This is Classic's `reliability_index DESC, pubyr DESC, opinion_no DESC`
-- (TaxonInfo.pm getMostRecentClassification) collapsed to a boolean — one
-- canonical definition, in one place. There is NO `synthesized` first key:
-- an authorities-sourced opinion carries a real (usually old) pubyr and
-- evidence = false, so it lands near the bottom by construction and wins only
-- when nothing else exists — which is exactly what a genesis assertion should
-- do (§9.8 / §10.5).


-- Sources taxa.nomenclatural_status_id. These are the legacy `opinions.status`
-- values that are neither an assignment nor a name change — 12,806 rows that
-- have no home in the other opinion tables.
CREATE TABLE dictionaries.nomenclatural_statuses (
    id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    status text NOT NULL,
    targeted boolean NOT NULL   -- whether target_permid is required
);
INSERT INTO dictionaries.nomenclatural_statuses (status, targeted) VALUES
    ('nomen dubium',        false),   -- legacy: 8,208
    ('nomen nudum',         false),   -- legacy: 2,533
    ('nomen vanum',         false),   -- legacy:   569
    ('nomen oblitum',       false),   -- legacy:    76
    ('invalid subgroup of', true);    -- legacy: 1,420


-- dictionaries.namechange_reasons must cover legacy `spelling_reason` ∪ the
-- synonymy half of legacy `status`. Existing rows (after the create_new.sql
-- fix): original, misspelling, assignment, reranked, code, junior synonym.
--
-- RESOLVED (open call A): 'nomen oblitum' has been removed from
-- namechange_reasons and lives only in dictionaries.nomenclatural_statuses
-- above. It is a validity/priority status — the name itself is unaltered — not
-- a spelling act, so it never belonged among the name-change reasons. The row
-- was deleted from the create_new.sql seed directly.
--
-- INVERSION (§9.8): every non-'original' reason now links two DISTINCT permids
-- (subject_permid → target_permid), because a permid is a single name-as-
-- spelled. `edge_class` tells derive() which union-find the edge feeds:
--   * 'lineage' — subject is a spelling/rank/recombination FORM of target;
--     collapses two name-as-spelled permids into one name-lineage (≈ orig_no).
--   * 'concept' — subject's name is judged the SAME TAXON as target's (a
--     synonym / replacement); collapses two lineages into one concept
--     (≈ synonym_no).
-- 'original' is the root reason: it mints a permid and has no target, so its
-- edge_class is NULL. (This replaces the earlier `merges_concept` boolean,
-- which conflated the two union-finds.)
--
-- `never_accepted` marks reasons whose subject can never be the accepted
-- spelling of a lineage (a misspelling is folded in for lookup but is never
-- the valid form). derive() step 3 excludes these.
ALTER TABLE dictionaries.namechange_reasons ADD COLUMN edge_class text
    CHECK (edge_class IN ('lineage', 'concept'));   -- NULL only for 'original'
ALTER TABLE dictionaries.namechange_reasons ADD COLUMN never_accepted boolean NOT NULL DEFAULT false;

INSERT INTO dictionaries.namechange_reasons (reason, description) VALUES
    ('recombination',        'Species moved to a different genus'),
    ('correction',           'Grammatical/orthographic correction'),
    ('subjective synonym',   'Junior subjective synonym of another taxon'),
    ('objective synonym',    'Junior objective synonym of another taxon'),
    ('replaced by',          'Name replaced (e.g. homonymy)');

UPDATE dictionaries.namechange_reasons SET edge_class = v.edge_class, never_accepted = v.never_accepted
FROM (VALUES
    ('original',           NULL,        false),   -- root: mints a permid, no target
    ('correction',         'lineage',   false),
    ('reranked',           'lineage',   false),   -- legacy spelling_reason 'rank change'
    ('recombination',      'lineage',   false),
    ('assignment',         'lineage',   false),   -- legacy spelling_reason 'reassignment'
    ('code',               'lineage',   false),   -- ICZN-code-mandated spelling change
    ('misspelling',        'lineage',   true),    -- folded in, never the accepted spelling
    ('junior synonym',     'concept',   false),
    ('subjective synonym', 'concept',   false),
    ('objective synonym',  'concept',   false),
    ('replaced by',        'concept',   false)
) AS v(reason, edge_class, never_accepted)
WHERE dictionaries.namechange_reasons.reason = v.reason;


-- ============================================================================
-- LAYER 1 — ASSERTIONS (input to derive())
-- ----------------------------------------------------------------------------
-- Append-only. These tables ARE versioned — permid + preceded_by_id /
-- succeeded_by_id — but WITHOUT install_version_triggers(). See §9.5.2.1.
--
-- The succession chain here records TRANSCRIPTION CORRECTIONS, not changes of
-- belief. A curator who mistypes a pubyr appends a corrected version of that
-- opinion; a curator who *disagrees* with an opinion enters a NEW opinion and
-- lets derive()'s ranking settle it. The schema distinguishes the two: same
-- permid = the record was wrong, new permid = the literature moved.
--
-- WHY NO TRIGGERS. install_version_triggers() would be actively harmful here,
-- for one specific reason: handle_new_version() swings inbound FKs, and every
-- inbound FK to an opinion is one of taxa.winning_*_opinion_id. Those are
-- DERIVED provenance, not assertions — they must be whatever derive()
-- computed. Swinging them would (a) UPDATE the ledger in place, outside
-- derive(), breaking its append-only property, and (b) falsify history, by
-- making every past taxa version cite the corrected opinion as though the
-- system had always held the right data. Not swinging is correct: an old
-- ledger version keeps pointing at the opinion row AS IT THEN READ.
--
-- So the write path sets preceded_by_id / succeeded_by_id directly, and the
-- ordinary AFTER STATEMENT trigger takes it from there — a correction is an
-- INSERT of a new version, so it flows through dependency_closure → derive()
-- → append, exactly like a brand-new opinion. No separate correction path.
--
-- Bonus: bulk migration inserts skip place_in_lineage() entirely (every
-- migrated opinion is version 1, both pointers NULL), avoiding the per-row
-- head lookup that stalled the collections migration.
--
-- derive() reads `WHERE removed IS NOT TRUE AND succeeded_by_id IS NULL`.
--
-- All *_permid columns are name-as-spelled pointers, NOT SQL foreign keys.
-- There is deliberately no permid registry table (§9.5.1); integrity is by
-- construction and re-checked by the derive(all) ≡ heads invariant.
--
-- A permid is MINTED by the name_opinions row that first introduces it as
-- subject: reason = 'original' for a root name, or a 'lineage'-class reason
-- (reranked / recombination / …) for a spelling introduced as a form of an
-- earlier one. That minting row is the birth certificate and carries the
-- permid's IMMUTABLE identity — new_name + rank_id + authority provenance.
-- Nothing else creates a taxon, and nothing ever changes a minted name/rank:
-- a respelling or rank change introduces a DIFFERENT permid (§9.8).
-- ============================================================================

-- Name, spelling, synonymy — the naming act AND every later edge about a name.
--
-- A name_opinions row is a typed EDGE: subject_permid defers to target_permid
-- in the manner given by reason_id (whose edge_class selects lineage vs concept
-- grouping in derive()). Two row shapes share the table:
--
--   * MINTING rows (reason = 'original', or a 'lineage' reason that introduces
--     a new spelling): carry new_name / rank_id / authority_id / pages /
--     figures — the immutable identity of subject_permid. 'original' has
--     target_permid NULL (it is the lineage root); a lineage-reason minting row
--     points target_permid at the earlier spelling it is a form of.
--   * NON-MINTING rows (a later synonymy/replacement assertion about an
--     already-minted permid): new_name / rank_id are NULL — subject already has
--     its identity. These are the 'concept'-class edges.
--
-- 'original' is a reason value rather than a separate table so that competing
-- claims about what the original combination was become an ordinary ranking
-- contest instead of a constraint violation. Classic needed a bad-data branch
-- in getOriginalCombination (TaxonInfo.pm:2043) precisely because it had no way
-- to express two candidate originals; here derive() ranks them and the loser is
-- just a non-root spelling. This is also what HEALS the 81 legacy orig_no rows
-- that point at the wrong original — the migration ignores orig_no and rebuilds
-- the lineage from these edges (§9.8 / §10.5).
CREATE TABLE name_opinions (
    id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    permid uuid NOT NULL CHECK ((get_byte(uuid_send(permid), 6) >> 4) = 7),  -- opinion identity across transcription corrections
    authorizer_person_id integer REFERENCES persons("id") NOT NULL,
    enterer_person_id integer REFERENCES persons("id") NOT NULL,

    subject_permid uuid NOT NULL,          -- the name-as-spelled this opinion is about
    target_permid uuid,                    -- what subject defers to; NULL only for reason = 'original'
    reason_id integer REFERENCES dictionaries.namechange_reasons("id") NOT NULL,
    objective boolean,                     -- synonymy only: objective vs subjective

    -- IMMUTABLE identity of subject_permid, populated ONLY on the minting row
    -- (see header). NULL on non-minting (concept-class) edges. rank_id here is
    -- where legacy authorities.taxon_rank lands — the definitive rank of this
    -- name-as-spelled (correction 1). There is no separate rank_opinions table.
    new_name text,
    rank_id integer REFERENCES dictionaries.taxonomy_ranks("id"),

    -- Present on the 'original' minting row: the naming act's own provenance.
    -- Legacy authorities.pages/figures record where in the reference the name
    -- was erected — per-name data that could not survive the authorities
    -- dedup (517,287 legacy rows → 161,768 authority rows).
    authority_id bigint REFERENCES authorities("id"),
    pages text,
    figures text,

    reference_id bigint REFERENCES refs("id") NOT NULL,
    pubyr integer,       -- second-hand: the attributed year, overriding the reference's
    attribution jsonb,   -- second-hand: WHO, authors only; payloadSchemas/opinionAttribution.schema.js
    evidence boolean NOT NULL,   -- stated with evidence (true) vs. everything else

    created_at timestamptz NOT NULL DEFAULT NOW(),
    removed boolean,
    preceded_by_id bigint REFERENCES name_opinions("id"),
    succeeded_by_id bigint REFERENCES name_opinions("id"),

    CONSTRAINT name_opinion_not_self CHECK (subject_permid IS DISTINCT FROM target_permid)
    -- INVARIANT (enforced by the write path / derive(), not a CHECK, because it
    -- needs the reason's edge_class): reason 'original' ⇒ target_permid IS NULL
    -- and new_name/rank_id NOT NULL; every other minting reason ⇒ target_permid
    -- NOT NULL and new_name/rank_id NOT NULL; concept-class edges ⇒ new_name/
    -- rank_id NULL.
);

-- Classification / containment. NOT "parent": rank containment is not
-- evolutionary ancestry (§9.6.1). A family contains a genus; it is not its
-- ancestor.
--
-- subject_permid is the name-AS-SPELLED the opinion classifies (legacy
-- child_spelling_no), and containing_permid the spelling of the higher taxon
-- (legacy parent_spelling_no). derive() resolves both to concepts and, per
-- §9.8 step 5, pools these opinions across the WHOLE concept (junior-synonym
-- borrowing) — the opposite scope from accepted-spelling selection.
CREATE TABLE assignment_opinions (
    id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    permid uuid NOT NULL CHECK ((get_byte(uuid_send(permid), 6) >> 4) = 7),  -- opinion identity across transcription corrections
    authorizer_person_id integer REFERENCES persons("id") NOT NULL,
    enterer_person_id integer REFERENCES persons("id") NOT NULL,

    subject_permid uuid NOT NULL,
    containing_permid uuid NOT NULL,
    questioned boolean NOT NULL DEFAULT false,   -- incertae sedis

    reference_id bigint REFERENCES refs("id") NOT NULL,
    pubyr integer,       -- second-hand: the attributed year, overriding the reference's
    attribution jsonb,   -- second-hand: WHO, authors only; payloadSchemas/opinionAttribution.schema.js
    evidence boolean NOT NULL,   -- stated with evidence (true) vs. everything else

    created_at timestamptz NOT NULL DEFAULT NOW(),
    removed boolean,
    preceded_by_id bigint REFERENCES assignment_opinions("id"),
    succeeded_by_id bigint REFERENCES assignment_opinions("id"),

    CONSTRAINT assignment_not_self CHECK (subject_permid <> containing_permid)
);

-- Nomenclatural validity. A nomen dubium is NOT a name change (the name is
-- unaltered) and NOT an assignment (nothing moves), so it fits neither of the
-- tables above — hence its own. This is also what replaces the second job of
-- the old `taxa.accepted` boolean; see §10.4.
--
-- Tree-affecting: sinking a genus as nomen dubium changes what its species can
-- be assigned to, so dependency_closure must chase these.
CREATE TABLE validity_opinions (
    id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    permid uuid NOT NULL CHECK ((get_byte(uuid_send(permid), 6) >> 4) = 7),  -- opinion identity across transcription corrections
    authorizer_person_id integer REFERENCES persons("id") NOT NULL,
    enterer_person_id integer REFERENCES persons("id") NOT NULL,

    subject_permid uuid NOT NULL,
    status_id integer REFERENCES dictionaries.nomenclatural_statuses("id") NOT NULL,
    target_permid uuid,          -- required iff the status is `targeted`

    reference_id bigint REFERENCES refs("id") NOT NULL,
    pubyr integer,       -- second-hand: the attributed year, overriding the reference's
    attribution jsonb,   -- second-hand: WHO, authors only; payloadSchemas/opinionAttribution.schema.js
    evidence boolean NOT NULL,   -- stated with evidence (true) vs. everything else

    created_at timestamptz NOT NULL DEFAULT NOW(),
    removed boolean,
    preceded_by_id bigint REFERENCES validity_opinions("id"),
    succeeded_by_id bigint REFERENCES validity_opinions("id")
);

-- ---------------------------------------------------------------------------
-- Attribute opinions: winner-selection only, NO tree propagation.
-- dependency_closure ignores these entirely — an edit here dirties exactly one
-- permid and never ripples laterally or downward.
-- ---------------------------------------------------------------------------

-- Type material. Modelled as an opinion because type designation is a dated,
-- contestable published act: the original description fixes a type, but a
-- later paper designates a lectotype or neotype when the original material is
-- lost or ambiguous. Absorbs the legacy authorities type block.
--
-- OPEN: one row asserts the whole type block, so a later lectotype
-- designation that says nothing about type locality would drop the locality on
-- winning. May need splitting per dimension. See §10.6.
CREATE TABLE type_opinions (
    id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    permid uuid NOT NULL CHECK ((get_byte(uuid_send(permid), 6) >> 4) = 7),  -- opinion identity across transcription corrections
    authorizer_person_id integer REFERENCES persons("id") NOT NULL,
    enterer_person_id integer REFERENCES persons("id") NOT NULL,

    subject_permid uuid NOT NULL,
    type_taxon_permid uuid,      -- type species / type genus
    type_specimen text,
    museum text,
    catalog_number text,
    body_part text,
    part_details text,
    type_locality_collection_id bigint REFERENCES collections("id"),

    reference_id bigint REFERENCES refs("id") NOT NULL,
    pubyr integer,       -- second-hand: the attributed year, overriding the reference's
    attribution jsonb,   -- second-hand: WHO, authors only; payloadSchemas/opinionAttribution.schema.js
    evidence boolean NOT NULL,   -- stated with evidence (true) vs. everything else

    created_at timestamptz NOT NULL DEFAULT NOW(),
    removed boolean,
    preceded_by_id bigint REFERENCES type_opinions("id"),
    succeeded_by_id bigint REFERENCES type_opinions("id")
);

-- Biological traits: legacy authorities.extant, preservation, form_taxon.
--
-- PLACEHOLDER. This is the boundary where PBOT's description system takes
-- over, so the payload is jsonb rather than typed columns pending that
-- decision. This table may end up being — or being absorbed by — the
-- `descriptions` table referenced but left undefined in create_new.sql.
-- See §10.6.
CREATE TABLE trait_opinions (
    id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    permid uuid NOT NULL CHECK ((get_byte(uuid_send(permid), 6) >> 4) = 7),  -- opinion identity across transcription corrections
    authorizer_person_id integer REFERENCES persons("id") NOT NULL,
    enterer_person_id integer REFERENCES persons("id") NOT NULL,

    subject_permid uuid NOT NULL,
    traits jsonb NOT NULL,       -- { extant, preservation, formTaxon, ... }

    reference_id bigint REFERENCES refs("id") NOT NULL,
    pubyr integer,       -- second-hand: the attributed year, overriding the reference's
    attribution jsonb,   -- second-hand: WHO, authors only; payloadSchemas/opinionAttribution.schema.js
    evidence boolean NOT NULL,   -- stated with evidence (true) vs. everything else

    created_at timestamptz NOT NULL DEFAULT NOW(),
    removed boolean,
    preceded_by_id bigint REFERENCES trait_opinions("id"),
    succeeded_by_id bigint REFERENCES trait_opinions("id")
);

-- NOTE: there is no rank_opinions table. Under the inversion (§9.8) rank is an
-- immutable attribute of a name-as-spelled, carried by name_opinions.rank_id on
-- the minting row. The old ~998K rank fan-out (open call B) is therefore moot:
-- the accepted rank is simply the rank of the accepted spelling, exactly as
-- Classic reads it off the winning spelling's authorities row.


-- ============================================================================
-- LAYER 2 — THE DERIVATION
-- ----------------------------------------------------------------------------
-- No DDL. Layer 2 is taxonomy.derive(permids), a pure function over Layer 1
-- and the single definition of truth (§9.5.2, revised by §9.8). Under the
-- inversion it runs TWO union-finds and an ordered ranking:
--
--   1. LINEAGE union-find over 'lineage'-class name edges  → name-lineages
--      (≈ orig_no); the root ('original') is original_permid.
--   2. CONCEPT  union-find over 'concept'-class name edges  → concepts
--      (≈ synonym_no); pick the SENIOR lineage per concept.
--   3. ACCEPTED SPELLING per lineage: the subject of the lineage's top-ranked
--      opinion (excluding never_accepted misspellings), by the canonical
--      ORDER BY. Scoped to the SENIOR lineage — a junior synonym's spelling
--      can never be the concept's accepted name (§9.8 ordering rule). Rank
--      rides along: accepted rank = that permid's rank_id.
--   4. concept_permid := accepted spelling of the concept's senior lineage.
--   5. CLASSIFICATION: winning assignment pooled across the WHOLE concept
--      (junior-synonym borrowing, equal-rank, species excluded — §9.8 scope
--      rule), then classification_path.
--
-- It is called by both the hot path (statement trigger over dependency_closure)
-- and the cold path (rebuild() / migration / CI), which is what makes the
-- invariant
--
--     derive(all) ≡ { current ledger heads }
--
-- checkable. This heading is a deliberate placeholder so the gap between
-- Layer 1 and Layer 3 reads as intentional.
-- ============================================================================


-- ============================================================================
-- LAYER 3 — THE LEDGER (materialized output of derive())
-- ============================================================================

-- Pure materialized output. Nothing here is hand-entered, which is why there
-- is no authorizer_person_id / enterer_person_id: every value traces to a
-- winning opinion, and attributing a derived row to a person would be a lie.
--
-- ONE ROW PER PERMID = per name-as-spelled (§9.8), so this table is 1:1 with
-- Classic's taxa_tree_cache (also keyed per taxon_no) and the §10.5 step-5
-- validation is a row-for-row diff.
--
-- Rebuilding this table from Layer 1 must be lossless. Anything that cannot be
-- reconstructed by derive() does not belong here — see "OUTSIDE THE STACK".
CREATE TABLE taxa (
    id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    permid uuid NOT NULL CHECK ((get_byte(uuid_send(permid), 6) >> 4) = 7),  -- this name-as-spelled; replaces legacy taxon_no (NOT orig_no)

    -- IMMUTABLE identity, denormalized from this permid's minting name_opinion
    -- for read convenience. Never changes on re-derivation: a respelling or
    -- rank change is a DIFFERENT permid (§9.8).
    name text NOT NULL,                    -- this spelling's name string
    rank_id integer REFERENCES dictionaries.taxonomy_ranks("id"),
    authority_id bigint REFERENCES authorities("id"),

    -- The derived identity triad. All three are succession-head pointers, not
    -- SQL foreign keys, and all members of a grouping share equal values:
    --   original_permid          groups the name-lineage (GROUP BY it = all
    --                            spellings of one name); stable   ≈ orig_no
    --   accepted_spelling_permid the accepted spelling of THIS lineage;
    --                            self <=> this is the accepted spelling
    --                                                              ≈ spelling_no
    --   concept_permid           the accepted spelling of the SENIOR synonym;
    --                            self <=> this is the concept's accepted name;
    --                            = accepted_spelling_permid unless a junior
    --                            synonym                          ≈ synonym_no
    -- These three equalities replace the old `accepted` boolean's jobs (§10.4)
    -- with no extra column.
    original_permid uuid NOT NULL,
    accepted_spelling_permid uuid NOT NULL,
    concept_permid uuid NOT NULL,

    -- Classification. Adjacency is PRIMARY and classification_path is an
    -- explicitly derived materialization that can be reshaped or dropped as a
    -- cache change (§9.7.4 invariant 4). Making the path primary would be the
    -- nested-set trap again.
    containing_concept_permid uuid,        -- NULL = root
    classification_path ltree,             -- ltree of concept permids, root → node

    -- Nomenclatural validity: NULL = valid. Replaces the old `accepted`
    -- boolean's second job, as an enum rather than a boolean, because
    -- "invalid" and "is a junior synonym" are independent conditions.
    nomenclatural_status_id integer REFERENCES dictionaries.nomenclatural_statuses("id"),

    -- Provenance: which opinion won each dimension. Auditability was one of
    -- Classic's genuine virtues (§7) and is preserved explicitly here. There is
    -- no winning_rank_opinion_id — rank came from winning_name_opinion (§9.8).
    winning_name_opinion_id       bigint REFERENCES name_opinions("id"),
    winning_assignment_opinion_id bigint REFERENCES assignment_opinions("id"),
    winning_validity_opinion_id   bigint REFERENCES validity_opinions("id"),
    winning_type_opinion_id       bigint REFERENCES type_opinions("id"),
    winning_trait_opinion_id      bigint REFERENCES trait_opinions("id"),

    preceded_by_id bigint REFERENCES taxa("id"),
    succeeded_by_id bigint REFERENCES taxa("id"),
    removed boolean,
    created_at timestamptz DEFAULT NOW()
);

-- WHY THIS TABLE IS VERSIONED — even though it is pure derive() output.
-- Split taxa in two. The current heads (succeeded_by_id IS NULL) ARE just a
-- rebuildable cache of the present belief — that is the §9.5.5 invariant
-- derive(all) ≡ {heads}. The superseded versions behind each head are the part
-- that is NOT a cache: an append-only, transaction-time archive of WHAT WAS
-- BELIEVED, WHEN, and WHICH OPINIONS WON (the winning_*_opinion_id pinned on
-- each version). Classic's taxa_tree_cache, mutated in place, threw that away.
--
-- This is also what lets derive() stay a PRESENT-TENSE function. Past beliefs
-- are in principle re-derivable from the versioned opinions, but only by
-- cross-layer time travel (re-derive over the opinion set as it read on date
-- D) — the fragile bi-temporal path §9.5.2.1 avoids. Materializing belief-
-- history here makes historical questions READS against the chain, not
-- re-derivations, so derive() only ever runs over CURRENT opinion heads.
-- Consequence worth stating: a from-scratch rebuild() reproduces only the
-- current heads (the migration's step 4); the version chain is genuine
-- operational history, not derived redundancy. The versioning earns its keep
-- specifically for §9.2's "reconstruct the tree at any past instant" — if that
-- requirement is ever dropped, taxa could become a plain rebuildable
-- materialized table with no versioning.
--
-- WHAT SWINGS ON A NEW VERSION: nothing external, by design. This is the one
-- place install_version_triggers() is called normally, so it installs both
-- place_in_lineage() (chain + head-index maintenance) AND handle_new_version()
-- (swing inbound FKs to the new head). Here the swing half is INERT: every
-- cross-reference in this subsystem is a *_permid uuid — a logical pointer
-- resolved to the current head via the partial head index — NOT an FK to
-- taxa("id"). The only FKs to taxa("id") are this table's own preceded_by_id /
-- succeeded_by_id, and those are EXTENDED as the chain, not swung. So appending
-- a belief version touches no referencing row.
--
-- That zero-swing property IS the payoff of pointing at permid instead of row
-- id. Contrast the SUPERSEDED create_new.sql block, whose opinion tables
-- carried taxon_id / parent_taxon_id integer REFERENCES taxa("id"): under
-- versioning every new taxa version would have to repoint all of those — write
-- amplification on every belief change. The inversion deletes exactly those
-- FKs. Membership changes (a concept's accepted spelling moving, a reparent)
-- likewise never swing: derive() appends NEW heads for the affected permids
-- (via dependency_closure), and permid→head resolution does the rest.
SELECT install_version_triggers('taxa');

-- taxa_permid_head_idx is created by install_version_triggers(). These are the
-- additional head-only indexes derive() and the read path need — one per
-- grouping pointer in the triad, plus classification and name.
CREATE INDEX taxa_head_original_idx
    ON taxa (original_permid) WHERE succeeded_by_id IS NULL;
CREATE INDEX taxa_head_accepted_spelling_idx
    ON taxa (accepted_spelling_permid) WHERE succeeded_by_id IS NULL;
CREATE INDEX taxa_head_concept_idx
    ON taxa (concept_permid) WHERE succeeded_by_id IS NULL;
CREATE INDEX taxa_head_containing_idx
    ON taxa (containing_concept_permid) WHERE succeeded_by_id IS NULL;
CREATE INDEX taxa_head_path_idx
    ON taxa USING gist (classification_path) WHERE succeeded_by_id IS NULL;
CREATE INDEX taxa_head_name_idx
    ON taxa (name) WHERE succeeded_by_id IS NULL;


-- ============================================================================
-- OUTSIDE THE STACK — non-derived data
-- ----------------------------------------------------------------------------
-- Neither input to derive() nor output of it. Hand-entered, never
-- reconstructed by rebuild(), and invisible to dependency_closure. These sit
-- beside the Layer 1/2/3 stack, not above it.
-- ============================================================================

-- Curatorial annotation has no opinion behind it — nobody published a paper
-- asserting a comment. It therefore CANNOT live in `taxa`: a rebuild() would
-- blank it. Versioned, because unlike an opinion this is authored content
-- whose edits are genuine changes of content.
CREATE TABLE taxon_annotations (
    id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    permid uuid NOT NULL CHECK ((get_byte(uuid_send(permid), 6) >> 4) = 7),
    authorizer_person_id integer REFERENCES persons("id") NOT NULL,
    enterer_person_id integer REFERENCES persons("id") NOT NULL,

    subject_permid uuid NOT NULL,          -- the taxon being annotated
    common_name text,
    comments text,
    discussion text,
    discussed_by_reference_id bigint REFERENCES refs("id"),

    preceded_by_id bigint REFERENCES taxon_annotations("id"),
    succeeded_by_id bigint REFERENCES taxon_annotations("id"),
    removed boolean,
    created_at timestamptz DEFAULT NOW()
);
SELECT install_version_triggers('taxon_annotations');

CREATE INDEX taxon_annotations_head_subject_idx
    ON taxon_annotations (subject_permid) WHERE succeeded_by_id IS NULL;

-- Homonymy is a fact about our data, not a published assertion: the legacy
-- `opinions.status` enum has ten values and none of them is 'homonym of'.
-- Grouped rather than pairwise so that n > 2 homonyms are representable
-- (n rows sharing a homonym_group_id), which an A/B pair table could not do.
--
-- Note there is no has_homonym flag on `taxa`: that would make a derived table
-- depend on a non-opinion source. Read-path LEFT JOIN instead.
CREATE TABLE homonyms (
    id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    homonym_group_id bigint NOT NULL,
    permid uuid NOT NULL,
    created_at timestamptz DEFAULT NOW(),
    UNIQUE (homonym_group_id, permid)
);
CREATE INDEX homonyms_permid_idx ON homonyms (permid);


-- ============================================================================
-- LAYER 1 INDEXES
-- ----------------------------------------------------------------------------
-- derive() gathers opinions by subject, and dependency_closure walks the
-- lineage (name target), lateral (concept) and downward (containment) edges.
-- ============================================================================

-- Every one of these is HEAD-ONLY. derive() reads only current versions, so a
-- superseded (corrected) opinion must never be gathered — and there is no
-- reason to index rows it will never look at.
CREATE INDEX name_opinions_subject_idx       ON name_opinions (subject_permid)       WHERE succeeded_by_id IS NULL;
CREATE INDEX name_opinions_target_idx        ON name_opinions (target_permid)        WHERE succeeded_by_id IS NULL;
CREATE INDEX assignment_opinions_subject_idx ON assignment_opinions (subject_permid) WHERE succeeded_by_id IS NULL;
CREATE INDEX assignment_opinions_containing_idx ON assignment_opinions (containing_permid) WHERE succeeded_by_id IS NULL;
CREATE INDEX validity_opinions_subject_idx   ON validity_opinions (subject_permid)   WHERE succeeded_by_id IS NULL;
CREATE INDEX type_opinions_subject_idx       ON type_opinions (subject_permid)       WHERE succeeded_by_id IS NULL;
CREATE INDEX trait_opinions_subject_idx      ON trait_opinions (subject_permid)      WHERE succeeded_by_id IS NULL;

-- Head lookup by permid. On the versioned tables elsewhere in the schema this
-- index is created by install_version_triggers(); because the opinion tables
-- deliberately do not call it, these must be created BY HAND. They are not
-- optional — the write path resolves "current version of this opinion" through
-- them, which is exactly the lookup whose absence degraded the collections
-- migration to O(n²).
CREATE INDEX name_opinions_permid_head_idx       ON name_opinions (permid)       WHERE succeeded_by_id IS NULL;
CREATE INDEX assignment_opinions_permid_head_idx ON assignment_opinions (permid) WHERE succeeded_by_id IS NULL;
CREATE INDEX validity_opinions_permid_head_idx   ON validity_opinions (permid)   WHERE succeeded_by_id IS NULL;
CREATE INDEX type_opinions_permid_head_idx       ON type_opinions (permid)       WHERE succeeded_by_id IS NULL;
CREATE INDEX trait_opinions_permid_head_idx      ON trait_opinions (permid)      WHERE succeeded_by_id IS NULL;


-- ============================================================================
-- OPEN QUESTIONS (see §10.6)
-- ============================================================================
--
-- 1. trait_opinions: jsonb payload vs typed columns — blocked on the PBOT
--    descriptions decision. May not survive as its own table.
--
-- 2. type_opinions: one row per whole type block, or split per dimension so a
--    lectotype designation cannot silently drop the type locality?
--
-- 3. RESOLVED (open call A): 'nomen oblitum' is a nomenclatural validity/
--    priority status, not a name-change reason. Removed from
--    namechange_reasons (create_new.sql); it lives only in
--    dictionaries.nomenclatural_statuses.
--
-- 4. SUPERSEDED (open call B) by the inversion (§9.8). The rank fan-out
--    question is moot: there is no rank_opinions table. Rank is an immutable
--    attribute of a name-as-spelled, carried by name_opinions.rank_id on the
--    minting row, and the accepted rank is the rank of the accepted spelling
--    (§10.5). Neither the ~998K fan-out nor the lean variant applies.
--
-- 5. RESOLVED. Both `attribution` and `pubyr` STAY (decision, 2026-07-27).
--    create_new.sql's opinion tables carry neither, holding only `evidence`
--    and `reference_id`; the draft's addition of both is confirmed, and the
--    "reference_id is sufficient, drop them" direction is rejected, not
--    merely deferred. Do not reopen.
--
--    attribution no longer borrows authority.schema.js. That
--    schema describes an authority record — it carries legacyIDs.oldpbdbIDs and
--    publishedInReference (meaningless on an opinion) and sets
--    unevaluatedProperties: false, so it cannot be reused without them.
--    attribution now has its own authors-only schema,
--    payloadSchemas/opinionAttribution.schema.js, and the duplicated `year`
--    field is gone: the year lives ONLY in the `pubyr` column, because
--    derive() sorts on it. The rule is that every derive() input is a typed,
--    constrained, indexable column and everything else is payload.
--
--    `pubyr` is integer, not text: it is a sort key, and text ordering matches
--    numeric ordering only while every value is exactly 4 digits. Verified
--    safe to cast — all 128,722 populated legacy values are 4-digit numerics,
--    zero non-conforming.
--
--    DECIDED (2026-07-27): derive() ranks on `pubyr` — it is a derive() INPUT,
--    not payload, so a second-hand opinion competes at the year it was stated
--    rather than the year it was reported. This is Classic's behaviour and it
--    is what the ORDER BY at the top of this file already encodes.
--
--    Note the fallback is load-bearing, not incidental: `pubyr` is populated
--    only for the second-hand case (869,843 of 998,565 legacy opinions leave
--    it empty), so the key is COALESCE(pubyr, reference publication year) —
--    pubyr takes precedence WHERE PRESENT, and the reference's year carries
--    the other 87%. `pubyr` alone would leave most opinions undated.
--
-- 6. No permid registry table means nothing prevents an opinion referencing a
--    permid that was never minted. Accepted by decision (§9.5.1); the
--    derive(all) invariant is the backstop. Revisit only if it bites.
--
-- 7. name_opinions two row-shapes (§9.8): minting rows carry new_name/rank_id/
--    authority provenance; concept-class edges leave them NULL. The invariant
--    can't be a plain CHECK (needs the reason's edge_class) — confirm it lands
--    in the write path + a derive(all) assertion, or whether a generated
--    is_minting column is worth it.
