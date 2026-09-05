import { mariadb, pg, closeAll } from '../lib/db.js';
import { uuidv7 } from '../lib/uuidv7.js';
import Ajv from 'ajv/dist/2019.js';
import { collectionMigrationSchema } from '../../payloadSchemas/collection.schema.js';

const INSERT_BATCH_SIZE = 1000;
const LOG_SAMPLE_LIMIT = 20;
const SOURCE_TABLE = 'collections';

// ---------- Pure helpers ----------
function trimStr(s) {
  // Strip NUL bytes: PostgreSQL jsonb cannot store \u0000, and some legacy
  // free-text fields carry embedded NULs that would otherwise sink the insert.
  return s == null ? '' : String(s).replace(/\u0000/g, '').trim();
}

function splitCsv(s) {
  return trimStr(s).split(',').map((x) => x.trim()).filter(Boolean);
}

// Casefold, strip diacritics (NFD + combining-mark removal), collapse
// punctuation/whitespace to single spaces. Applied to both legacy values and
// dictionary names so accented/punctuated variants match.
export function normalizeName(s) {
  if (s == null) return '';
  return String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// ---------- Alias maps (normalized legacy value → code / name) ----------
// Country name variants that don't normalize to a dictionary entry (D5).
export const COUNTRY_ALIASES = new Map([
  ['russian federation', 'RU'],
  ['turkiye', 'TR'],
  ['netherlands', 'NL'],
  ['cape verde', 'CV'],
  ['timor leste', 'TL'],
  ['congo kinshasa', 'CD'],
  ['congo brazzaville', 'CG'],
  ['brunei darussalam', 'BN'],
  ['micronesia federated states of', 'FM'],
  ['falkland islands malvinas', 'FK'],
  ['holy see vatican city state', 'VA'],
  ['palestine', 'PS'],
  ['bonaire sint eustatius and saba', 'BQ'],
  ['virgin islands us', 'VI'],
  ['virgin islands british', 'VG'],
  ['cocos keeling islands', 'CC'],
  ['aland islands', 'AX'],
  ['saint barthelemy', 'BL'],
  ['curacao', 'CW'],
  ['virgin islands u s', 'VI'],
  ['cote d ivoire', 'CI'],
]);

// State/province variants (extension point; seeded empty). Key: `${admin0iso}|${norm}`.
export const STATE_ALIASES = new Map();

// Ocean/marine values whose legacy string is shorter than the IHO name (D11).
export const MARITIME_ALIASES = new Map([
  ['north pacific', 'North Pacific Ocean'],
  ['south pacific', 'South Pacific Ocean'],
  ['north atlantic', 'North Atlantic Ocean'],
  ['south atlantic', 'South Atlantic Ocean'],
]);

// ---------- Pure transforms (no DB; unit-testable) ----------
export function buildContext(src) {
  const ctx = {};
  const collectors = trimStr(src.collectors);
  if (collectors) ctx.collectors = collectors;
  const methods = splitCsv(src.coll_meth);
  if (methods.length) ctx.collectionMethods = methods;
  const dates = trimStr(src.collection_dates);
  if (dates) ctx.dates = dates;
  const comments = trimStr(src.collection_comments);
  if (comments) ctx.comments = comments;
  return Object.keys(ctx).length ? ctx : null;
}

// Resolve the toponym: land (administrativeArea) first, maritime fallback.
// dicts: { admin0ByNorm, admin0ByIso, admin1ByKey, maritimeByNorm }
export function resolveToponym(src, dicts) {
  const country = trimStr(src.country);
  const state = trimStr(src.state);
  const county = trimStr(src.county);
  if (!country) return { skip: true, flagReason: 'no country' };

  const cnorm = normalizeName(country);

  // Land: normalized dictionary match, then COUNTRY_ALIASES.
  let a0 = dicts.admin0ByNorm.get(cnorm);
  const aliasIso = COUNTRY_ALIASES.get(cnorm);
  if (!a0 && aliasIso) a0 = dicts.admin0ByIso.get(aliasIso);

  if (a0) {
    const administrativeArea = { admin0: a0.iso };
    let unresolvedAdmin1;
    if (state) {
      const snorm = normalizeName(state);
      const admin1iso = dicts.admin1ByKey.get(`${a0.id}|${snorm}`)
        ?? STATE_ALIASES.get(`${a0.iso}|${snorm}`);
      if (admin1iso) administrativeArea.admin1 = admin1iso;
      // admin1 is no longer required (schema relaxed): a present-but-unmatched
      // state migrates country-only, flagged for later STATE_ALIASES curation.
      else unresolvedAdmin1 = state;
    }
    if (county) administrativeArea.admin2 = county;
    return unresolvedAdmin1
      ? { administrativeArea, unresolvedAdmin1 }
      : { administrativeArea };
  }

  // Maritime fallback: normalized iho_name match, then MARITIME_ALIASES.
  const iho = dicts.maritimeByNorm.get(cnorm) ?? MARITIME_ALIASES.get(cnorm);
  if (iho) return { maritimeArea: iho };

  return { skip: true, flagReason: `unresolved country '${country}'` };
}

export function datumToSrid(gps_datum) {
  const d = trimStr(gps_datum);
  switch (d) {
    case 'NAD27 CONUS': return 4267;
    case 'NAD83': return 4269;
    case 'WGS72': return 4322;
    case '':
    case 'WGS84':
    default: return 4326;
  }
}

// Returns { value, unit:'meters' }, { drop:true } (flag), or null (nothing to migrate).
export function buildAltitude({ altitude_value, altitude_unit }) {
  if (altitude_value == null || String(altitude_value).trim() === '') return null;
  const num = Number(altitude_value);
  if (!Number.isFinite(num)) return { drop: true };
  const unit = trimStr(altitude_unit);
  if (unit === 'feet') return { value: Math.round(num * 0.3048), unit: 'meters' };
  if (unit === 'meters') return { value: Math.round(num), unit: 'meters' };
  return { drop: true }; // blank/null/unknown unit → flag, do not migrate altitude
}

// Returns { coordinates: {...}|null, altitudeDropped: boolean }. Never lat/lng.
export function buildCoordinates(src) {
  const coordinates = {};
  const basis = trimStr(src.latlng_basis);
  if (basis) coordinates.basis = basis;
  let altitudeDropped = false;
  const alt = buildAltitude(src);
  if (alt) {
    if (alt.drop) altitudeDropped = true;
    else coordinates.altitude = { value: alt.value, unit: alt.unit };
  }
  return {
    coordinates: Object.keys(coordinates).length ? coordinates : null,
    altitudeDropped,
  };
}

export function buildLocation(src, toponym, coordinates) {
  const location = {};
  if (toponym && (toponym.administrativeArea || toponym.maritimeArea)) {
    const t = {};
    if (toponym.administrativeArea) t.administrativeArea = toponym.administrativeArea;
    if (toponym.maritimeArea) t.maritimeArea = toponym.maritimeArea;
    location.toponym = t;
  }
  if (coordinates) location.coordinates = coordinates;
  // scale is required: coerce blank/null geogscale to "unspecified".
  location.scale = trimStr(src.geogscale) || 'unspecified';
  // comments = geogcomments, plus a migration marker preserving a present-but-
  // unmatched legacy state string that could not resolve to an admin1 ISO code
  // (newline-joined, marker last). Keeps the raw string in the record rather
  // than dropping it; a later STATE_ALIASES pass can resolve it on re-run.
  const commentParts = [];
  const comments = trimStr(src.geogcomments);
  if (comments) commentParts.push(comments);
  if (toponym && toponym.unresolvedAdmin1) {
    commentParts.push(`[migration] Unrecognized admin1 name: ${toponym.unresolvedAdmin1}`);
  }
  if (commentParts.length) location.comments = commentParts.join('\n');
  const museum = trimStr(src.museum);
  if (museum) location.repository = { institution: museum };
  return location;
}

export function buildStratigraphy(src) {
  const stratonyms = {};
  // Only group/formation/member have source columns; supergroup/subgroup/bed
  // do not exist in the legacy table (see D-stratonym note).
  const group = trimStr(src.geological_group);
  if (group) stratonyms.group = group;
  const formation = trimStr(src.formation);
  if (formation) stratonyms.formation = formation;
  const member = trimStr(src.member);
  if (member) stratonyms.member = member;

  const measuredSections = {};
  const section = trimStr(src.localsection);
  if (section) measuredSections.section = section;
  const bed = trimStr(src.localbed);
  if (bed) measuredSections.bed = bed;
  const unit = trimStr(src.localbedunit);
  if (unit) measuredSections.unit = unit;
  const order = trimStr(src.localorder);
  if (order) measuredSections.order = order;

  const strat = {};
  if (Object.keys(stratonyms).length) strat.stratonyms = stratonyms;
  const scale = trimStr(src.stratscale);
  if (scale) strat.scale = scale;
  const comments = trimStr(src.stratcomments);
  if (comments) strat.comments = comments;
  if (Object.keys(measuredSections).length) strat.measuredSections = measuredSections;
  return Object.keys(strat).length ? strat : null;
}

function mergeAdjectives(a, b) {
  const seen = new Set();
  const out = [];
  for (const tok of [...splitCsv(a), ...splitCsv(b)]) {
    if (!seen.has(tok)) { seen.add(tok); out.push(tok); }
  }
  return out;
}

export function buildLithofacies(src) {
  const out = [];
  const sets = [
    { lith: src.lithology1, adj: src.lithadj, minor: src.minor_lithology, fossils: src.fossilsfrom1, lithif: src.lithification },
    { lith: src.lithology2, adj: src.lithadj2, minor: src.minor_lithology2, fossils: src.fossilsfrom2, lithif: src.lithification2 },
  ];
  for (const s of sets) {
    const lithology = trimStr(s.lith);
    if (!lithology) continue;
    const obj = { lithology };
    const adjectives = mergeAdjectives(s.adj, s.minor);
    if (adjectives.length) obj.adjectives = adjectives;
    obj.fossils = s.fossils === 'Y';
    const lithification = trimStr(s.lithif);
    if (lithification) obj.lithification = lithification;
    out.push(obj);
  }
  return out;
}

export function buildAgesMeasurements(src) {
  const out = [];
  const groups = [
    { type: 'direct', ma: src.direct_ma, error: src.direct_ma_error, unit: src.direct_ma_unit, method: src.direct_ma_method },
    { type: 'max', ma: src.max_ma, error: src.max_ma_error, unit: src.max_ma_unit, method: src.max_ma_method },
    { type: 'min', ma: src.min_ma, error: src.min_ma_error, unit: src.min_ma_unit, method: src.min_ma_method },
  ];
  for (const g of groups) {
    const age = trimStr(g.ma);
    if (!age) continue;
    const unit = trimStr(g.unit);
    if (!unit) continue; // unit is required + enum-constrained; omit group without it
    const m = { age, unit, measurementType: g.type };
    const error = trimStr(g.error);
    if (error) m.error = error;
    const method = trimStr(g.method);
    if (method) m.method = method;
    out.push(m);
  }
  return out;
}

export function buildCollectionPayload(src, toponym) {
  const payload = {};
  payload.name = trimStr(src.collection_name);
  const aka = trimStr(src.collection_aka);
  if (aka) payload.akaName = aka;
  payload.legacyIDs = { oldpbdbID: String(src.collection_no) };

  const context = buildContext(src);
  if (context) payload.context = context;

  const { coordinates } = buildCoordinates(src);
  payload.location = buildLocation(src, toponym, coordinates);

  const lithofacies = buildLithofacies(src);
  if (lithofacies.length) payload.lithofacies = lithofacies;

  const stratigraphy = buildStratigraphy(src);
  if (stratigraphy) payload.stratigraphy = stratigraphy;

  const measurements = buildAgesMeasurements(src);
  if (measurements.length) payload.ages = { measurements };

  return payload;
}

// ---------- Sample logger (bucketed to avoid log flooding) ----------
function makeSampleLogger(label) {
  let n = 0;
  return (msg) => {
    n++;
    if (n <= LOG_SAMPLE_LIMIT) {
      console.warn(`  [${label}] ${msg}`);
    } else if (n === LOG_SAMPLE_LIMIT + 1) {
      console.warn(`  [${label}] ... (further occurrences suppressed; final count at end of run)`);
    }
  };
}

// ---------- Dictionary pre-load + schema hydration ----------
export async function loadDicts() {
  const admin0ByNorm = new Map();
  const admin0ByIso = new Map();
  const admin0Isos = [];
  const { rows: a0 } = await pg.query('SELECT id, iso, iso3, name FROM dictionaries.admin0');
  for (const r of a0) {
    const entry = { iso: r.iso, id: r.id };
    admin0ByIso.set(r.iso, entry);
    admin0Isos.push(r.iso);
    if (r.name) admin0ByNorm.set(normalizeName(r.name), entry);
    if (r.iso) admin0ByNorm.set(normalizeName(r.iso), entry);
    if (r.iso3) admin0ByNorm.set(normalizeName(r.iso3), entry);
  }

  const admin1ByKey = new Map();
  const admin1Isos = [];
  const { rows: a1 } = await pg.query('SELECT id, iso, name, alternate_name, admin0_id FROM dictionaries.admin1');
  for (const r of a1) {
    admin1Isos.push(r.iso);
    if (r.name) admin1ByKey.set(`${r.admin0_id}|${normalizeName(r.name)}`, r.iso);
    if (r.alternate_name) admin1ByKey.set(`${r.admin0_id}|${normalizeName(r.alternate_name)}`, r.iso);
    if (r.iso) admin1ByKey.set(`${r.admin0_id}|${normalizeName(r.iso)}`, r.iso);
  }

  const maritimeByNorm = new Map();
  const maritimeNames = [];
  const { rows: mar } = await pg.query('SELECT iho_name FROM dictionaries.maritime');
  for (const r of mar) {
    maritimeNames.push(r.iho_name);
    maritimeByNorm.set(normalizeName(r.iho_name), r.iho_name);
  }

  return {
    admin0ByNorm, admin0ByIso, admin1ByKey, maritimeByNorm,
    admin0Isos, admin1Isos, maritimeNames,
  };
}

export function hydrateSchema(dicts) {
  const props = collectionMigrationSchema.properties.collection.properties;
  const aa = props.location.properties.toponym.properties.administrativeArea;
  aa.properties.admin0.enum = dicts.admin0Isos;
  aa.properties.admin1.enum = dicts.admin1Isos;
  // Note: the admin1-required if/then was removed from the schema (migration
  // relaxation), so there is no if-condition enum to hydrate.
  props.location.properties.toponym.properties.maritimeArea.enum = dicts.maritimeNames;

  for (const [name, arr] of [
    ['admin0', dicts.admin0Isos],
    ['admin1', dicts.admin1Isos],
    ['maritime', dicts.maritimeNames],
  ]) {
    if (!arr.length) throw new Error(`Enum hydration failed: ${name} is empty (aborting before reading source rows)`);
  }
}

// ---------- Main ----------
async function main() {
  const startTime = new Date();
  const dryRun = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';
  console.log(`[${startTime.toISOString()}] Starting collections migration${dryRun ? ' (DRY RUN — will ROLLBACK, no data written)' : ''}...`);

  // Pre-load: refs head map (legacy reference_no → new refs.id)
  const { rows: refRows } = await pg.query(`
    SELECT id, reference->'legacyIDs'->>'oldpbdbID' AS legacy
    FROM refs
    WHERE succeeded_by_id IS NULL
      AND reference->'legacyIDs'->>'oldpbdbID' IS NOT NULL
  `);
  const refMap = new Map();
  for (const r of refRows) refMap.set(r.legacy, r.id);
  console.log(`  Loaded ${refMap.size} refs (current head versions)`);

  // Pre-load: dictionaries + hydrate/compile schema
  const dicts = await loadDicts();
  console.log(`  Loaded dictionaries: admin0=${dicts.admin0Isos.length} admin1=${dicts.admin1Isos.length} maritime=${dicts.maritimeNames.length}`);
  hydrateSchema(dicts);
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(collectionMigrationSchema);
  console.log('  Migration schema hydrated and compiled');

  // Pre-load: secondary_refs grouped by collection_no
  const secondaryRefs = new Map();
  {
    const conn = await mariadb.getConnection();
    const stream = conn.connection.query('SELECT collection_no, reference_no FROM secondary_refs').stream();
    try {
      for await (const r of stream) {
        const key = String(r.collection_no);
        if (!secondaryRefs.has(key)) secondaryRefs.set(key, []);
        secondaryRefs.get(key).push(r.reference_no);
      }
    } finally {
      conn.release();
    }
  }
  let secondaryRefRows = 0;
  for (const arr of secondaryRefs.values()) secondaryRefRows += arr.length;
  console.log(`  Loaded ${secondaryRefRows} secondary_refs across ${secondaryRefs.size} collections`);

  // Counters
  let sourceRows = 0;
  let insertedLand = 0, insertedMaritime = 0;
  let orphanRefSkipped = 0;
  let noToponymSkipped = 0;
  let altitudeDropped = 0;
  let admin1Unresolved = 0;
  let bothPersonsZero = 0;

  const logOrphanRef = makeSampleLogger('orphan primary ref');
  const logNoToponym = makeSampleLogger('no toponym match');
  const logAltitudeDropped = makeSampleLogger('altitude dropped');
  const logAdmin1Unresolved = makeSampleLogger('admin1 unresolved (country-only)');
  const logBothZero = makeSampleLogger('both auth/ent 0');

  // Stream source, build + validate, stage
  const staged = [];
  const conn = await mariadb.getConnection();
  const stream = conn.connection.query(`
    SELECT collection_no, reference_no, authorizer_no, enterer_no,
           collection_name, collection_aka,
           collectors, coll_meth, collection_dates, collection_comments,
           country, state, county, lat, lng, gps_datum, latlng_basis,
           altitude_value, altitude_unit, geogscale, geogcomments, museum,
           geological_group, formation, member, stratscale, stratcomments,
           localsection, localbed, localbedunit, localorder,
           lithology1, lithology2, lithadj, lithadj2,
           minor_lithology, minor_lithology2, fossilsfrom1, fossilsfrom2,
           lithification, lithification2,
           direct_ma, direct_ma_error, direct_ma_unit, direct_ma_method,
           max_ma, max_ma_error, max_ma_unit, max_ma_method,
           min_ma, min_ma_error, min_ma_unit, min_ma_method
    FROM ${SOURCE_TABLE}
    ORDER BY collection_no ASC
  `).stream();

  try {
    for await (const src of stream) {
      sourceRows++;
      if (sourceRows % 50000 === 0) {
        console.log(`  Processed ${sourceRows} source rows, ${staged.length} staged so far...`);
      }

      // Primary reference (skip collection on orphan)
      const reference_id = refMap.get(String(src.reference_no));
      if (!reference_id) {
        orphanRefSkipped++;
        logOrphanRef(`collection_no=${src.collection_no} reference_no=${src.reference_no}`);
        continue;
      }

      // Persons (0-sentinel fallback, mirrors migrate-authorities.js)
      let authNo = src.authorizer_no || 0;
      let entNo = src.enterer_no || 0;
      if (authNo === 0 && entNo !== 0) authNo = entNo;
      else if (entNo === 0 && authNo !== 0) entNo = authNo;
      else if (authNo === 0 && entNo === 0) {
        bothPersonsZero++;
        logBothZero(`collection_no=${src.collection_no} both 0, using person_no=1 fallback`);
        authNo = 1; entNo = 1;
      }

      // Toponym (skip collection on no match)
      const toponym = resolveToponym(src, dicts);
      if (toponym.skip) {
        noToponymSkipped++;
        logNoToponym(`collection_no=${src.collection_no} country=${JSON.stringify(src.country)} state=${JSON.stringify(src.state)} (${toponym.flagReason})`);
        continue;
      }
      if (toponym.unresolvedAdmin1) {
        admin1Unresolved++;
        logAdmin1Unresolved(`collection_no=${src.collection_no} admin0=${toponym.administrativeArea.admin0} state=${JSON.stringify(toponym.unresolvedAdmin1)}`);
      }

      // Altitude-dropped flag (does not skip)
      const alt = buildAltitude(src);
      if (alt && alt.drop) {
        altitudeDropped++;
        logAltitudeDropped(`collection_no=${src.collection_no} altitude_value=${JSON.stringify(src.altitude_value)} unit=${JSON.stringify(src.altitude_unit)}`);
      }

      const payload = buildCollectionPayload(src, toponym);

      if (!validate({ collection: payload })) {
        console.error(`\n  VALIDATION FAILED for collection_no=${src.collection_no}`);
        console.error('  errors:', JSON.stringify(validate.errors, null, 2));
        console.error('  payload:', JSON.stringify(payload, null, 2));
        conn.release();
        process.exit(1);
      }

      const srid = datumToSrid(src.gps_datum);
      const hasGeo = src.lat != null && src.lng != null;
      if (toponym.administrativeArea) insertedLand++; else insertedMaritime++;

      staged.push({
        permid: uuidv7(),
        authorizerPersonId: authNo,
        entererPersonId: entNo,
        collectionJson: JSON.stringify(payload),
        reference_id,
        geo: hasGeo ? { lng: Number(src.lng), lat: Number(src.lat), srid } : null,
        collection_no: String(src.collection_no),
      });
    }
  } finally {
    conn.release();
  }

  // Report pre-insert counters
  console.log('');
  console.log(`  Source rows read:          ${sourceRows}`);
  console.log(`  Staged (land):             ${insertedLand}`);
  console.log(`  Staged (maritime):         ${insertedMaritime}`);
  console.log(`  Skipped orphan primary ref:${orphanRefSkipped}`);
  console.log(`  Skipped no toponym match:  ${noToponymSkipped}`);
  console.log(`  admin1 unresolved (flag):  ${admin1Unresolved}`);
  console.log(`  Altitude dropped (flag):   ${altitudeDropped}`);
  console.log(`  Both auth/ent = 0:         ${bothPersonsZero}`);

  const accounted = staged.length + orphanRefSkipped + noToponymSkipped;
  if (accounted !== sourceRows) {
    console.warn(`  WARNING: counter mismatch! accounted ${accounted} != sourceRows ${sourceRows}`);
  } else {
    console.log(`  Counter check: ${accounted} == ${sourceRows} ✓`);
  }

  // ---------- Transaction-wrapped insert ----------
  const client = await pg.connect();
  let collectionsInserted = 0;
  let secondaryInserted = 0;
  let orphanSecondaryRef = 0;
  const logOrphanSecondary = makeSampleLogger('orphan secondary ref');
  // collection_no → { id, authorizerPersonId, entererPersonId }
  const collectionMeta = new Map();

  try {
    await client.query('BEGIN');

    // Collections
    for (let i = 0; i < staged.length; i += INSERT_BATCH_SIZE) {
      const batch = staged.slice(i, i + INSERT_BATCH_SIZE);
      const rowsSql = [];
      const params = [];
      let p = 1;
      for (const s of batch) {
        const geoSql = s.geo
          ? `ST_Transform(ST_SetSRID(ST_MakePoint($${p + 4}, $${p + 5}), $${p + 6}), 4326)::geography`
          : 'NULL';
        rowsSql.push(`($${p}, $${p + 1}, $${p + 2}, $${p + 3}, ${geoSql}, $${s.geo ? p + 7 : p + 4})`);
        params.push(s.permid, s.authorizerPersonId, s.entererPersonId, s.collectionJson);
        if (s.geo) {
          params.push(s.geo.lng, s.geo.lat, s.geo.srid, s.reference_id);
          p += 8;
        } else {
          params.push(s.reference_id);
          p += 5;
        }
      }
      const { rows } = await client.query(
        `INSERT INTO collections (permid, authorizer_person_id, enterer_person_id, collection, location, reference_id)
         VALUES ${rowsSql.join(', ')}
         RETURNING id, permid`,
        params,
      );
      // Map returned id back to collection_no via permid (order-independent).
      const permidToStaged = new Map(batch.map((s) => [s.permid, s]));
      for (const r of rows) {
        const s = permidToStaged.get(r.permid);
        collectionMeta.set(s.collection_no, {
          id: r.id,
          authorizerPersonId: s.authorizerPersonId,
          entererPersonId: s.entererPersonId,
        });
      }
      collectionsInserted += batch.length;
      if ((i / INSERT_BATCH_SIZE) % 20 === 0) {
        console.log(`  Inserted ${collectionsInserted}/${staged.length} collections...`);
      }
    }
    console.log(`  Inserted ${collectionsInserted} collections`);

    // additional_collection_refs
    const acrRows = [];
    for (const [collection_no, meta] of collectionMeta) {
      const secRefs = secondaryRefs.get(collection_no);
      if (!secRefs) continue;
      for (const reference_no of secRefs) {
        const reference_id = refMap.get(String(reference_no));
        if (!reference_id) {
          orphanSecondaryRef++;
          logOrphanSecondary(`collection_no=${collection_no} reference_no=${reference_no}`);
          continue;
        }
        acrRows.push({
          authorizerPersonId: meta.authorizerPersonId,
          entererPersonId: meta.entererPersonId,
          collection_id: meta.id,
          reference_id,
        });
      }
    }
    for (let i = 0; i < acrRows.length; i += INSERT_BATCH_SIZE) {
      const batch = acrRows.slice(i, i + INSERT_BATCH_SIZE);
      const rowsSql = [];
      const params = [];
      let p = 1;
      for (const r of batch) {
        rowsSql.push(`($${p}, $${p + 1}, $${p + 2}, $${p + 3})`);
        params.push(r.authorizerPersonId, r.entererPersonId, r.collection_id, r.reference_id);
        p += 4;
      }
      await client.query(
        `INSERT INTO additional_collection_refs (authorizer_person_id, enterer_person_id, collection_id, reference_id)
         VALUES ${rowsSql.join(', ')}`,
        params,
      );
      secondaryInserted += batch.length;
    }
    console.log(`  Inserted ${secondaryInserted} additional_collection_refs`);

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

  // Reset identity sequences (skip on dry run — nothing was committed, and
  // setval over an empty table's NULL MAX(id) would error)
  if (!dryRun) {
    await pg.query(`SELECT setval(pg_get_serial_sequence('collections','id'), (SELECT MAX(id) FROM collections))`);
    await pg.query(`SELECT setval(pg_get_serial_sequence('additional_collection_refs','id'), (SELECT MAX(id) FROM additional_collection_refs))`);
  }

  // Final report
  console.log('');
  console.log(`  Collections inserted:      ${collectionsInserted} (land ${insertedLand}, maritime ${insertedMaritime})`);
  console.log(`  Secondary refs inserted:   ${secondaryInserted}`);
  console.log(`  Skipped orphan primary ref:${orphanRefSkipped}`);
  console.log(`  Skipped no toponym match:  ${noToponymSkipped}`);
  console.log(`  admin1 unresolved (flag):  ${admin1Unresolved}`);
  console.log(`  Altitude dropped (flag):   ${altitudeDropped}`);
  console.log(`  Orphan secondary ref:      ${orphanSecondaryRef}`);

  const { rows: c1 } = await pg.query('SELECT COUNT(*)::int AS n FROM collections');
  const { rows: c2 } = await pg.query('SELECT COUNT(*)::int AS n FROM additional_collection_refs');
  console.log(`  Final row counts — collections: ${c1[0].n}, additional_collection_refs: ${c2[0].n}`);

  const elapsed = ((new Date() - startTime) / 1000).toFixed(1);
  console.log(`[${new Date().toISOString()}] Collections migration complete in ${elapsed}s`);
}

// Only run main() when invoked directly, so pure transforms can be imported for unit tests.
const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((err) => {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  }).finally(() => closeAll());
}
