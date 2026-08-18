// Shared identity-resolution helpers reused across pair handlers. Ported from the
// existing migrate-assignment-opinions.js / migrate-synonymy-opinions.js pure logic
// so every pair handler resolves permids, references, and persons identically.

// oldpbdb_taxon_no is carried only by root/original name_opinions rows, where
// permid === subject_permid (the "original-only resolution" invariant) — so a
// lookup by oldpbdb_taxon_no is unambiguous even after lineage/concept rows exist.
export async function loadNamePermidMap(pg) {
  const { rows } = await pg.query(`
    SELECT oldpbdb_taxon_no, permid
    FROM name_opinions
    WHERE succeeded_by_id IS NULL AND oldpbdb_taxon_no IS NOT NULL
  `);
  const map = new Map();
  for (const r of rows) map.set(Number(r.oldpbdb_taxon_no), r.permid);
  return map;
}

export async function loadReferenceIdMap(pg) {
  const { rows } = await pg.query(`
    SELECT id, (reference->'legacyIDs'->>'oldpbdbID')::int AS rn
    FROM refs
    WHERE succeeded_by_id IS NULL
  `);
  const map = new Map();
  for (const r of rows) if (r.rn !== null) map.set(r.rn, r.id);
  return map;
}

// 0-sentinel fallback: persons were inserted with id = legacy person_no.
export function resolvePersons(src) {
  let authorizerPersonId = src.authorizer_no || 0;
  let entererPersonId = src.enterer_no || 0;
  if (authorizerPersonId === 0 && entererPersonId !== 0) authorizerPersonId = entererPersonId;
  else if (entererPersonId === 0 && authorizerPersonId !== 0) entererPersonId = authorizerPersonId;
  else if (authorizerPersonId === 0 && entererPersonId === 0) {
    authorizerPersonId = 1;
    entererPersonId = 1;
  }
  return { authorizerPersonId, entererPersonId };
}
