import Ajv from 'ajv/dist/2019.js';
import { collectionMigrationSchema } from '../../../payloadSchemas/collection.schema.js';
import {
  normalizeName,
  buildContext,
  resolveToponym,
  datumToSrid,
  buildAltitude,
  buildLocation,
  buildStratigraphy,
  buildLithofacies,
  buildAgesMeasurements,
  buildCollectionPayload,
} from '../migrate-collections.js';

let pass = 0, fail = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}\n     expected ${e}\n     actual   ${a}`); }
}
function checkTrue(label, cond) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label} (expected truthy)`); }
}

// Small dictionary fixture for resolveToponym
const dicts = {
  admin0ByNorm: new Map([
    [normalizeName('United States'), { iso: 'US', id: 840 }],
    [normalizeName('Curaçao'), { iso: 'CW', id: 531 }],
    [normalizeName('France'), { iso: 'FR', id: 250 }],
  ]),
  admin0ByIso: new Map([
    ['US', { iso: 'US', id: 840 }],
    ['RU', { iso: 'RU', id: 643 }],
  ]),
  admin1ByKey: new Map([
    [`840|${normalizeName('California')}`, 'US-CA'],
    [`643|${normalizeName('Moscow')}`, 'RU-MOW'],
  ]),
  maritimeByNorm: new Map([
    [normalizeName('Indian Ocean'), 'Indian Ocean'],
    [normalizeName('Southern Ocean'), 'Southern Ocean'],
  ]),
};

console.log('normalizeName');
check('diacritics stripped (Curaçao)', normalizeName('Curaçao'), 'curacao');
check("punctuation collapsed (Côte d'Ivoire)", normalizeName("Côte d'Ivoire"), 'cote d ivoire');
check('whitespace collapsed + trimmed', normalizeName('  United   States  '), 'united states');
check('null → empty', normalizeName(null), '');

console.log('\nbuildContext (coll_meth split)');
check('CSV split into array',
  buildContext({ coll_meth: 'sieve,surface (float)' }),
  { collectionMethods: ['sieve', 'surface (float)'] });
check('trims + drops empty tokens',
  buildContext({ coll_meth: ' sieve , , core ' }),
  { collectionMethods: ['sieve', 'core'] });
check('all-empty context → null',
  buildContext({ collectors: '', coll_meth: '', collection_dates: null }),
  null);

console.log('\nresolveToponym');
check('admin exact match + admin1',
  resolveToponym({ country: 'United States', state: 'California' }, dicts),
  { administrativeArea: { admin0: 'US', admin1: 'US-CA' } });
check('diacritic variant (Curaçao→CW), no admin1 required',
  resolveToponym({ country: 'Curaçao' }, dicts),
  { administrativeArea: { admin0: 'CW' } });
check('country alias hit (Russian Federation→RU) with state',
  resolveToponym({ country: 'Russian Federation', state: 'Moscow' }, dicts),
  { administrativeArea: { admin0: 'RU', admin1: 'RU-MOW' } });
check('maritime exact match (Indian Ocean)',
  resolveToponym({ country: 'Indian Ocean' }, dicts),
  { maritimeArea: 'Indian Ocean' });
check('maritime alias hit (North Pacific→North Pacific Ocean)',
  resolveToponym({ country: 'North Pacific' }, dicts),
  { maritimeArea: 'North Pacific Ocean' });
checkTrue('no-match country → skip',
  resolveToponym({ country: 'Neverland' }, dicts).skip === true);
check('present-but-unmatched state → country-only + unresolvedAdmin1 flag',
  resolveToponym({ country: 'United States', state: 'Nowhere' }, dicts),
  { administrativeArea: { admin0: 'US' }, unresolvedAdmin1: 'Nowhere' });
check('country with no state → country-only, no flag',
  resolveToponym({ country: 'United States' }, dicts),
  { administrativeArea: { admin0: 'US' } });
check('county passes through to admin2',
  resolveToponym({ country: 'France', county: 'Somewhere' }, dicts),
  { administrativeArea: { admin0: 'FR', admin2: 'Somewhere' } });

console.log('\ndatumToSrid');
check('blank → 4326', datumToSrid(''), 4326);
check('null → 4326', datumToSrid(null), 4326);
check('WGS84 → 4326', datumToSrid('WGS84'), 4326);
check('NAD27 CONUS → 4267', datumToSrid('NAD27 CONUS'), 4267);
check('NAD83 → 4269', datumToSrid('NAD83'), 4269);
check('WGS72 → 4322', datumToSrid('WGS72'), 4322);

console.log('\nbuildAltitude');
check('feet → meters (rounded)', buildAltitude({ altitude_value: 100, altitude_unit: 'feet' }), { value: 30, unit: 'meters' });
check('meters kept', buildAltitude({ altitude_value: 100, altitude_unit: 'meters' }), { value: 100, unit: 'meters' });
check('blank unit → drop flag', buildAltitude({ altitude_value: 100, altitude_unit: '' }), { drop: true });
check('null unit → drop flag', buildAltitude({ altitude_value: 100, altitude_unit: null }), { drop: true });
check('no value → null (omit, no flag)', buildAltitude({ altitude_value: null, altitude_unit: 'feet' }), null);

console.log('\nbuildLocation (scale coercion)');
check('blank geogscale → "unspecified"',
  buildLocation({ geogscale: '' }, { administrativeArea: { admin0: 'US' } }, null).scale,
  'unspecified');
check('present geogscale preserved',
  buildLocation({ geogscale: 'outcrop' }, { administrativeArea: { admin0: 'US' } }, null).scale,
  'outcrop');
check('maritime toponym assembled',
  buildLocation({ geogscale: 'basin', museum: 'AMNH' }, { maritimeArea: 'Indian Ocean' }, null),
  { toponym: { maritimeArea: 'Indian Ocean' }, scale: 'basin', repository: { institution: 'AMNH' } });

console.log('\nbuildLocation (unresolved admin1 → comments marker)');
check('unresolved admin1, no prior comment → marker only',
  buildLocation({ geogscale: 'outcrop' },
    { administrativeArea: { admin0: 'DE' }, unresolvedAdmin1: 'Bayern' }, null).comments,
  '[migration] Unrecognized admin1 name: Bayern');
check('unresolved admin1 with prior geogcomment → newline-appended, marker last',
  buildLocation({ geogscale: 'outcrop', geogcomments: 'Outcrop near river.' },
    { administrativeArea: { admin0: 'DE' }, unresolvedAdmin1: 'Bayern' }, null).comments,
  'Outcrop near river.\n[migration] Unrecognized admin1 name: Bayern');
check('resolved admin1 → no marker, geogcomment preserved',
  buildLocation({ geogscale: 'outcrop', geogcomments: 'Outcrop near river.' },
    { administrativeArea: { admin0: 'US', admin1: 'US-MT' } }, null).comments,
  'Outcrop near river.');
checkTrue('no state, no geogcomment → comments omitted',
  buildLocation({ geogscale: 'outcrop' }, { administrativeArea: { admin0: 'US' } }, null).comments === undefined);

console.log('\nbuildLithofacies (merged adjectives)');
check('lithadj + minor_lithology merged, fossils=true',
  buildLithofacies({ lithology1: 'sandstone', lithadj: 'red', minor_lithology: 'silty', fossilsfrom1: 'Y' }),
  [{ lithology: 'sandstone', adjectives: ['red', 'silty'], fossils: true }]);
check('adjectives deduped preserving order',
  buildLithofacies({ lithology1: 'sandstone', lithadj: 'red,silty', minor_lithology: 'silty' }),
  [{ lithology: 'sandstone', adjectives: ['red', 'silty'], fossils: false }]);
check('object without lithology omitted → empty array',
  buildLithofacies({ lithology1: '', lithology2: '' }),
  []);

console.log('\nbuildAgesMeasurements (prefix → measurementType)');
check('max group full',
  buildAgesMeasurements({ max_ma: '66', max_ma_error: '0.1', max_ma_unit: 'Ma', max_ma_method: 'U/Pb' }),
  [{ age: '66', unit: 'Ma', measurementType: 'max', error: '0.1', method: 'U/Pb' }]);
check('direct group with no error (relaxed schema)',
  buildAgesMeasurements({ direct_ma: '10', direct_ma_unit: 'Ma' }),
  [{ age: '10', unit: 'Ma', measurementType: 'direct' }]);
check('group without unit omitted',
  buildAgesMeasurements({ direct_ma: '10', direct_ma_unit: '' }),
  []);

// ---------- Validation smoke test (10.2) ----------
console.log('\nvalidation smoke test');
// Fill the empty-enum stubs the migration hydrates from the DB at runtime, so ajv
// can compile (ajv rejects `enum: []`). DB-free minimal fixtures here.
{
  const toponym = collectionMigrationSchema.properties.collection.properties
    .location.properties.toponym.properties;
  toponym.maritimeArea.enum = ['Indian Ocean', 'Southern Ocean', 'North Pacific Ocean'];
}
const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(collectionMigrationSchema);

const representative = buildCollectionPayload(
  {
    collection_no: 123,
    collection_name: 'Foo Quarry',
    collection_aka: 'Bar Pit',
    collectors: 'Smith',
    coll_meth: 'sieve,surface (float)',
    country: 'United States', state: 'California',
    geogscale: 'outcrop', museum: 'AMNH',
    latlng_basis: 'stated in text', altitude_value: 100, altitude_unit: 'feet',
    geological_group: 'Foo Group', formation: 'Hell Creek', stratscale: 'formation',
    localsection: 'A', localorder: 'bottom to top',
    lithology1: 'sandstone', lithadj: 'red', minor_lithology: 'silty', fossilsfrom1: 'Y', lithification: 'lithified',
    max_ma: '66', max_ma_unit: 'Ma', max_ma_method: 'U/Pb',
  },
  { administrativeArea: { admin0: 'US', admin1: 'US-CA', admin2: 'Somewhere' } },
);
checkTrue('representative built payload passes migration schema',
  validate({ collection: representative }) === true || (console.log('    ', JSON.stringify(validate.errors)), false));

const minimal = {
  name: 'Bare Collection',
  legacyIDs: { oldpbdbID: '1' },
  location: { toponym: { maritimeArea: 'Indian Ocean' }, scale: 'unspecified' },
};
checkTrue('coordinate-less / reference-less payload passes',
  validate({ collection: minimal }) === true || (console.log('    ', JSON.stringify(validate.errors)), false));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
