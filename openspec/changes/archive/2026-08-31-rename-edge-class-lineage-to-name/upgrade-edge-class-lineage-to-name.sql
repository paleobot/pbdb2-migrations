-- Rename dictionaries.namechange_reasons.edge_class value 'lineage' -> 'name'.
-- In-place upgrade for a database that is otherwise current.
-- Safe to re-run: it is a no-op once applied.
BEGIN;

-- edge_class is denormalized onto every name_opinions row and FK-pinned to the
-- dictionary's composite key, so the dictionary and the row copies must move
-- together, inside one transaction, with the constraints dropped first.
ALTER TABLE name_opinions DROP CONSTRAINT IF EXISTS name_opinions_reason_id_edge_class_fkey;
ALTER TABLE name_opinions DROP CONSTRAINT IF EXISTS name_opinion_shape;
ALTER TABLE dictionaries.namechange_reasons
    DROP CONSTRAINT IF EXISTS namechange_reasons_edge_class_check;

UPDATE dictionaries.namechange_reasons SET edge_class = 'name' WHERE edge_class = 'lineage';
UPDATE name_opinions                   SET edge_class = 'name' WHERE edge_class = 'lineage';

ALTER TABLE dictionaries.namechange_reasons
    ADD CONSTRAINT namechange_reasons_edge_class_check
    CHECK (edge_class IN ('root', 'name', 'concept'));

ALTER TABLE name_opinions
    ADD CONSTRAINT name_opinions_reason_id_edge_class_fkey
    FOREIGN KEY (reason_id, edge_class)
    REFERENCES dictionaries.namechange_reasons (id, edge_class);

ALTER TABLE name_opinions
    ADD CONSTRAINT name_opinion_shape CHECK (
           (edge_class = 'root'    AND target_permid IS NULL     AND new_name IS NOT NULL AND rank_id IS NOT NULL AND negates = false)
        OR (edge_class = 'name'    AND target_permid IS NOT NULL AND new_name IS NULL     AND rank_id IS NULL)
        OR (edge_class = 'concept' AND target_permid IS NOT NULL AND new_name IS NULL     AND rank_id IS NULL)
    );

COMMIT;
