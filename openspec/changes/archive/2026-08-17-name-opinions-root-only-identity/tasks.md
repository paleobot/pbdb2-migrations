## 1. Schema — name_opinion_shape CHECK

- [x] 1.1 In `postgresql/create_new.sql` (~L4710-4718), change the `'lineage'` branch of `name_opinion_shape` from `new_name IS NOT NULL AND rank_id IS NOT NULL` to `new_name IS NULL AND rank_id IS NULL`; keep `target_permid IS NOT NULL`.
- [x] 1.2 Update the CHECK comment (~L4711-4713) so it reads "identity (`new_name`, `rank_id`) set ⇔ `root`; `lineage` and `concept` carry a target and no identity."
- [x] 1.3 Apply the identical CHECK + comment change in `postgresql/taxa-opinions-draft.sql` (~L356-361).

## 2. Mapping doc — belongs-to/misspelling

- [x] 2.1 In `payloadSchemas/mappings/authorities-opinions.md` (misspelling section, `new_name` and `rank_id` rows, ~L160-161), set both to `NA` (NULL), replacing "from the record with permid = target_permid"; add a one-line note pointing to mapping-doc §3.2.

## 3. Spec sync

- [x] 3.1 Sync the `taxa-opinions` delta into `openspec/specs/taxa-opinions/spec.md`: replace the "name_opinions models typed edges with a minting shape" requirement text (`'lineage'` now carries neither `new_name` nor `rank_id`) and add the two lineage scenarios (NULL-identity accepted; identity rejected).

## 4. Verify

- [x] 4.1 Confirm no existing `name_opinions` rows violate the tightened CHECK: `SELECT count(*) FROM name_opinions WHERE (edge_class <> 'root') AND (new_name IS NOT NULL OR rank_id IS NOT NULL);` returns 0.
- [x] 4.2 Sanity-check the CHECK by attempting an insert of a `lineage` row with a non-NULL `new_name` (expect rejection) and one with NULL identity (expect success), then roll back.
