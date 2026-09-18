// Migrates the classic MariaDB `specimens` table (167,150 rows) into the new
// PostgreSQL `specimens` table. Specimens only: occurrences, measurements, and the
// revised collections pass each land separately. See
// openspec/specs/specimen-migration/spec.md and payloadSchemas/mappings/specimens.md.
//
// Two properties of the source shape nearly everything below.
//
// 1. The table is bimodal. Every row hangs off either an occurrence or a taxon,
//    almost never both: 144,690 carry an occurrence and no taxon, 21,392 carry a
//    taxon and no occurrence, 1,068 carry both, none carry neither. Columns reached
//    through a link are simply absent for rows lacking that link — so collection_id
//    is NULL for taxon-mode rows and name_opinions_permid is NULL for the 144,690
//    occurrence-mode ones. That NULL is expected, not a gap: taxon_no has no meaning
//    in 2.0, and deriving a taxon from an occurrence means resolving reidentifications,
//    which belongs to the occurrences migration.
//
// 2. "Unset" is spelled two ways, unevenly per column — occurrence_no is 8,995 NULL
//    plus 12,397 zero, taxon_no is 140,525 NULL plus 4,165 zero, reference_no is 0
//    NULL plus 11 zero. Hence isUnset() below, used for every legacy FK test. A
//    one-sided check still produces plausible output for most rows, which is what
//    makes it dangerous.
import { mariadb, pg, closeAll } from '../lib/db.js';
import { uuidv7 } from '../lib/uuidv7.js';
import { resolvePersons, loadReferenceIdMap, loadNamePermidMap } from '../lib/identity.js';
import { createAnomalyLog } from '../lib/anomaly-log.js';
import Ajv from 'ajv/dist/2019.js';
import { specimenSchema } from '../../payloadSchemas/specimen.schema.js';

const INSERT_BATCH_SIZE = 1000;
const LOG_SAMPLE_LIMIT = 20;
const SOURCE_TABLE = 'specimens';

// Written to identifiers.institutionCode when the row's collection records no museum,
// or when the row has no collection at all. Added to the schema enum for this purpose,
// so the key is never absent (mapping doc, institutionCode row).
const NO_INSTITUTION = 'none specified';

// ---------- Pure helpers ----------

// Classic uses 0 and SQL NULL interchangeably for "no value". Every legacy
// foreign-key test goes through here so neither spelling is missed.
export function isUnset(v) {
  return v == null || Number(v) === 0;
}

function trimStr(s) {
  // Strip NUL bytes: PostgreSQL jsonb cannot store \u0000, and some legacy
  // free-text fields carry embedded NULs that would otherwise sink the insert.
  return s == null ? '' : String(s).replace(/\u0000/g, '').trim();
}

// Splits a MySQL SET value. Member order is the SET's declaration order, not the
// order anyone entered — so "first member" is deterministic but carries no
// precedence meaning (design.md D3).
export function splitSet(s) {
  return trimStr(s).split(',').map((x) => x.trim()).filter(Boolean);
}

// Assigns key only when the value survives trimming. '' and null are both absent;
// is_type is the one column where '' actually occurs (8,453 rows), and '' is not a
// member of specimen.type's enum, so writing it through would fail validation.
function setIfPresent(obj, key, value) {
  const s = trimStr(value);
  if (s !== '') obj[key] = s;
}

export function buildSpecimenPayload(src) {
  const specimen = {
    // No classic counterpart: `name` is a PBot concept that becomes required going
    // forward. specimen_id cannot serve — blank on 31,572 rows and not unique
    // (11,929 duplicated (occurrence_no, specimen_id) pairs).
    name: `pbdb_classic:${src.specimen_no}`,
    legacyIDs: { oldpbdbID: String(src.specimen_no) },
  };

  setIfPresent(specimen, 'type', src.is_type);

  const identifiers = {};
  // Collection-level datum standing in for specimen-level institution data that
  // classic does not have. First SET member when multi-valued (1,100 such rows).
  const museums = splitSet(src.museum);
  identifiers.institutionCode = museums.length > 0 ? museums[0] : NO_INSTITUTION;
  // Verbatim: classic values are frequently not catalog numbers at all
  // ("P. tricostata Oeningen type"), and parsing them would be lossy guesswork.
  setIfPresent(identifiers, 'catalogNumber', src.specimen_id);
  specimen.identifiers = identifiers;

  const paleontology = {};
  const presModes = splitSet(src.pres_mode);
  // Absent on the 23,942 rows with no collection (21,392) or a blank pres_mode (2,550).
  if (presModes.length > 0) paleontology.preservationModes = presModes;
  if (src.specimens_measured != null) paleontology.numberMeasured = Number(src.specimens_measured);
  setIfPresent(paleontology, 'coverage', src.specimen_coverage);
  setIfPresent(paleontology, 'side', src.specimen_side);
  setIfPresent(paleontology, 'sex', src.sex);
  setIfPresent(paleontology, 'part', src.specimen_part);
  setIfPresent(paleontology, 'measurementSource', src.measurement_source);
  // Passed through unrepaired, including the two malformed values ('x 0.0', '312/50'):
  // the target field is an unconstrained string and a migration is not the place to fix them.
  setIfPresent(paleontology, 'magnification', src.magnification);
  if (Object.keys(paleontology).length > 0) specimen.paleontology = paleontology;

  setIfPresent(specimen, 'notes', src.comments);

  return specimen;
}

// ---------- Main ----------

async function main() {
  const startTime = new Date();
  const dryRun = process.argv.includes('--dry-run');
  console.log(`[${startTime.toISOString()}] Specimens migration starting${dryRun ? ' (DRY RUN)' : ''}`);

  const anomalyLog = createAnomalyLog(import.meta.url, 'specimen_no');

  const ajv = new Ajv({ strict: false, allErrors: true });
  const { $schema, $id, examples, response, ...core } = specimenSchema;
  const validate = ajv.compile(core);

  // ---- PostgreSQL lookup maps ----
  const refMap = await loadReferenceIdMap(pg);
  const namePermidMap = await loadNamePermidMap(pg);
  const { rows: collRows } = await pg.query(`
    SELECT id, (collection->'legacyIDs'->>'oldpbdbID')::int AS cn
    FROM collections
    WHERE succeeded_by_id IS NULL
  `);
  const collMap = new Map();
  for (const r of collRows) if (r.cn !== null) collMap.set(Number(r.cn), r.id);
  console.log(`  Loaded ${refMap.size} refs, ${namePermidMap.size} name permids, ${collMap.size} collections`);

  let sourceRows = 0;
  // Reported as an exclusive three-way split so the counts sum to the source total.
  let occurrenceOnly = 0;
  let taxonOnly = 0;
  let bothLinks = 0;
  let refFallback = 0;
  let personSentinel = 0;
  let noInstitution = 0;
  let nullNamePermid = 0;
  let orphanCollection = 0;

  const makeSampleLogger = (label) => {
    let n = 0;
    return (msg) => {
      if (n < LOG_SAMPLE_LIMIT) console.log(`    [${label}] ${msg}`);
      else if (n === LOG_SAMPLE_LIMIT) console.log(`    [${label}] ... further occurrences suppressed`);
      n++;
    };
  };
  const logOrphanCollection = makeSampleLogger('orphan collection');
  const logRefFallback = makeSampleLogger('reference inherited from occurrence');
  const logPersonSentinel = makeSampleLogger('auth/ent 0-sentinel');

  // ---- Stream source, build + validate, stage ----
  // Both joins are outer: 21,392 rows have no occurrence, and occurrence 926337
  // names collection 3122352, which does not exist in classic collections.
  const staged = [];
  const conn = await mariadb.getConnection();
  const stream = conn.connection.query(`
    SELECT s.specimen_no, s.authorizer_no, s.enterer_no,
           s.occurrence_no, s.taxon_no, s.reference_no,
           s.specimens_measured, s.specimen_coverage, s.specimen_id,
           s.specimen_side, s.sex, s.specimen_part,
           s.measurement_source, s.magnification, s.is_type, s.comments,
           o.collection_no AS occ_collection_no,
           o.reference_no  AS occ_reference_no,
           c.museum, c.pres_mode
    FROM ${SOURCE_TABLE} s
    LEFT JOIN occurrences o ON s.occurrence_no = o.occurrence_no
    LEFT JOIN collections c ON o.collection_no = c.collection_no
    ORDER BY s.specimen_no ASC
  `).stream();

  try {
    for await (const src of stream) {
      sourceRows++;
      if (sourceRows % 50000 === 0) {
        console.log(`  Processed ${sourceRows} source rows, ${staged.length} staged so far...`);
      }

      const hasOccurrence = !isUnset(src.occurrence_no);
      const hasTaxon = !isUnset(src.taxon_no);
      if (hasOccurrence && hasTaxon) bothLinks++;
      else if (hasOccurrence) occurrenceOnly++;
      else taxonOnly++;

      // Persons: 0-sentinel fallback, the repository's shared rule. Both columns are
      // NOT NULL DEFAULT 0, so the unset value is 0 and never NULL.
      const zeroPersons = isUnset(src.authorizer_no) || isUnset(src.enterer_no);
      const { authorizerPersonId, entererPersonId } = resolvePersons(src);
      if (zeroPersons) {
        personSentinel++;
        logPersonSentinel(`specimen_no=${src.specimen_no} authorizer_no=${src.authorizer_no} enterer_no=${src.enterer_no}`);
      }

      // Reference: NOT NULL in the target. 11 rows carry reference_no = 0 and inherit
      // from their occurrence (the DDL comment anticipates this).
      let reference_id = isUnset(src.reference_no) ? undefined : refMap.get(Number(src.reference_no));
      if (!reference_id && !isUnset(src.occ_reference_no)) {
        reference_id = refMap.get(Number(src.occ_reference_no));
        if (reference_id) {
          refFallback++;
          logRefFallback(`specimen_no=${src.specimen_no} reference_no=${src.reference_no} → occurrence reference_no=${src.occ_reference_no}`);
        }
      }
      if (!reference_id) {
        console.error(`  Unresolvable reference: specimen_no=${src.specimen_no} reference_no=${src.reference_no} occurrence reference_no=${src.occ_reference_no}`);
        throw new Error('reference_id is NOT NULL and resolved through neither the specimen nor its occurrence');
      }

      // Collection: nullable. An occurrence naming a collection that does not exist is
      // a source defect, recorded and survivable, not fatal.
      let collection_id = null;
      if (!isUnset(src.occ_collection_no)) {
        collection_id = collMap.get(Number(src.occ_collection_no)) ?? null;
        if (collection_id === null) {
          orphanCollection++;
          logOrphanCollection(`specimen_no=${src.specimen_no} occurrence_no=${src.occurrence_no} collection_no=${src.occ_collection_no}`);
          anomalyLog.log(src.specimen_no, 'specimens', 'warning', 'orphan collection',
            `occurrence ${src.occurrence_no} names collection_no ${src.occ_collection_no}, which does not exist in classic collections; collection_id left NULL`);
        }
      }

      // Taxon: from specimens.taxon_no only. occurrences.taxon_no is deliberately not
      // consulted — see the header note.
      let name_opinions_permid = null;
      if (hasTaxon) {
        name_opinions_permid = namePermidMap.get(Number(src.taxon_no)) ?? null;
        if (name_opinions_permid === null) {
          console.error(`  Unresolvable taxon: specimen_no=${src.specimen_no} taxon_no=${src.taxon_no}`);
          throw new Error('taxon_no did not resolve to a name_opinions permid');
        }
      } else {
        nullNamePermid++;
      }

      const specimen = buildSpecimenPayload(src);
      if (specimen.identifiers.institutionCode === NO_INSTITUTION) noInstitution++;

      if (!validate({ specimen })) {
        console.error(`  Validation failed for specimen_no=${src.specimen_no}`);
        console.error(JSON.stringify(validate.errors, null, 2));
        console.error(JSON.stringify(specimen, null, 2));
        throw new Error('payload failed specimenSchema validation');
      }

      staged.push({
        specimen_no: src.specimen_no,
        permid: uuidv7(),
        authorizerPersonId,
        entererPersonId,
        specimenJson: JSON.stringify(specimen),
        name_opinions_permid,
        oldpbdb_occurrence_no: isUnset(src.occurrence_no) ? null : Number(src.occurrence_no),
        collection_id,
        reference_id,
      });
    }
  } finally {
    conn.release();
  }

  console.log(`  Read ${sourceRows} source rows, staged ${staged.length}`);

  // ---- Insert ----
  let inserted = 0;
  const client = await pg.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < staged.length; i += INSERT_BATCH_SIZE) {
      const batch = staged.slice(i, i + INSERT_BATCH_SIZE);
      const rowsSql = [];
      const params = [];
      let p = 1;
      for (const s of batch) {
        rowsSql.push(`($${p}, $${p + 1}, $${p + 2}, $${p + 3}, $${p + 4}, $${p + 5}, $${p + 6}, $${p + 7})`);
        params.push(s.permid, s.authorizerPersonId, s.entererPersonId, s.specimenJson,
          s.name_opinions_permid, s.oldpbdb_occurrence_no, s.collection_id, s.reference_id);
        p += 8;
      }
      await client.query(
        `INSERT INTO specimens (permid, authorizer_person_id, enterer_person_id, specimen,
                                name_opinions_permid, oldpbdb_occurrence_no, collection_id, reference_id)
         VALUES ${rowsSql.join(', ')}`,
        params,
      );
      inserted += batch.length;
      if ((i / INSERT_BATCH_SIZE) % 20 === 0) {
        console.log(`  Inserted ${inserted}/${staged.length} specimens...`);
      }
    }
    if (dryRun) {
      await client.query('ROLLBACK');
      console.log('  DRY RUN — transaction rolled back (no data written)');
    } else {
      await client.query('COMMIT');
      console.log('  Transaction committed');
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('  Insert failed, transaction rolled back:', err.message);
    client.release();
    process.exit(1);
  }
  client.release();

  if (!dryRun) {
    await pg.query(`SELECT setval(pg_get_serial_sequence('specimens','id'), (SELECT MAX(id) FROM specimens))`);
  }

  const anomalyCount = anomalyLog.flush();

  // ---- Final report ----
  console.log('');
  console.log(`  Source rows:                 ${sourceRows}`);
  console.log(`  Specimens inserted:          ${inserted}`);
  console.log(`  Occurrence-linked only:      ${occurrenceOnly}`);
  console.log(`  Taxon-linked only:           ${taxonOnly}`);
  console.log(`  Carrying both links:         ${bothLinks}`);
  console.log(`  Null name_opinions_permid:   ${nullNamePermid}`);
  console.log(`  Reference from occurrence:   ${refFallback}`);
  console.log(`  Person 0-sentinel applied:   ${personSentinel}`);
  console.log(`  institutionCode sentinel:    ${noInstitution}`);
  console.log(`  Orphan collection (flag):    ${orphanCollection}`);
  console.log(`  Anomalies recorded:          ${anomalyCount}`);

  const { rows: c1 } = await pg.query('SELECT COUNT(*)::int AS n FROM specimens');
  console.log(`  Final row count — specimens: ${c1[0].n}`);

  const elapsed = ((new Date() - startTime) / 1000).toFixed(1);
  console.log(`[${new Date().toISOString()}] Specimens migration complete in ${elapsed}s`);
}

// Only run main() when invoked directly, so pure transforms can be imported for unit tests.
const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((err) => {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  }).finally(() => closeAll());
}
