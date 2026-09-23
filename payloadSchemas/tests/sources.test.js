// The real collection, specimen, person, reference, authority and schema sources: every variant resolves and
// compiles in strict mode, and the variant rules hold on them. DB-free (fixture
// enums).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as collectionModule from '../collection.schema.js';
import * as specimenModule from '../specimen.schema.js';
import * as personModule from '../person.schema.js';
import * as referenceModule from '../reference.schema.js';
import * as authorityModule from '../authority.schema.js';
import * as schemaModule from '../schema.schema.js';
import { applyEnums } from '../lib/enums.js';
import { deriveVariant, VARIANTS } from '../lib/variants.js';
import { createAjv } from '../lib/ajv.js';
import { collectCodecSources } from '../lib/storage.js';

const legacy = JSON.parse(readFileSync(new URL('./fixtures/legacy-enums.json', import.meta.url), 'utf8'));
const specimenExample = JSON.parse(readFileSync(new URL('./fixtures/specimen-example.json', import.meta.url), 'utf8'));
const enums = new Map(Object.entries(legacy));
enums.set('admin0.iso', ['US', 'CN', 'RU', 'AU', 'CA', 'FR']);
enums.set('admin1.iso', ['US-MT', 'CA-AB']);
enums.set('maritime.iho_name', ['Arctic Ocean']);
enums.set('roles.name', ['Superadmin', 'Admin', 'Authorizer', 'Enterer', 'Student', 'Person']);
enums.set('book_types.name', ['monograph', 'compendium', 'Ph.D. thesis', 'M.S. thesis', 'guidebook', 'other']);
enums.set('languages.name', ['Chinese', 'English', 'French', 'German', 'Italian', 'Japanese', 'Portuguese', 'Russian', 'Spanish', 'other', 'unknown']);

const sources = {
  collection: collectionModule.collectionSource,
  specimen: specimenModule.specimenSource,
  person: personModule.personSource,
  reference: referenceModule.referenceSource,
  authority: authorityModule.authoritySource,
  schema: schemaModule.schemaSource,
};
const compile = (entity, variant) => createAjv().compile(deriveVariant(applyEnums(sources[entity], enums), variant));

test('modules export only the annotated source', () => {
  assert.deepEqual(Object.keys(collectionModule).sort(), ['collectionSource', 'default']);
  assert.deepEqual(Object.keys(specimenModule).sort(), ['default', 'specimenSource']);
  assert.deepEqual(Object.keys(personModule).sort(), ['default', 'personSource']);
  assert.deepEqual(Object.keys(authorityModule).sort(), ['authoritySource', 'default']);
  assert.deepEqual(Object.keys(schemaModule).sort(), ['default', 'schemaSource']);
  // Plus the publication type table, which the PBot refs migration filters fields by.
  assert.deepEqual(Object.keys(referenceModule).sort(), ['PUBLICATION_TYPES', 'SHARED_FIELDS', 'default', 'referenceSource']);
});

test('every variant of every entity compiles in strict mode', () => {
  for (const entity of Object.keys(sources)) for (const v of VARIANTS) assert.ok(compile(entity, v), `${entity}.${v}`);
});

const createCollection = (administrativeArea) => ({
  name: 'c',
  context: {},
  references: [{ referenceID: '1', order: '1' }],
  location: {
    toponym: { administrativeArea },
    coordinates: { latitude: 1, longitude: 2 },
    scale: 'outcrop',
  },
});

test('in-create: admin1 required for listed countries only', () => {
  const validate = compile('collection', 'in-create');
  assert.equal(validate(createCollection({ admin0: 'CA' })), false);
  assert.ok(validate.errors.some((e) => e.params?.missingProperty === 'admin1'));
  assert.equal(validate(createCollection({ admin0: 'CA', admin1: 'CA-AB' })), true, JSON.stringify(validate.errors));
  assert.equal(validate(createCollection({ admin0: 'FR' })), true, JSON.stringify(validate.errors));
});

test('in-create: coordinates, references and context required', () => {
  const validate = compile('collection', 'in-create');
  const c = createCollection({ admin0: 'FR' });
  delete c.location.coordinates.longitude;
  assert.equal(validate(c), false);
  const { references, ...noRefs } = createCollection({ admin0: 'FR' });
  assert.equal(validate(noRefs), false);
});

test('in-create rejects read-only fields', () => {
  const validate = compile('collection', 'in-create');
  assert.equal(validate({ ...createCollection({ admin0: 'FR' }), permid: 'x' }), false);
  assert.equal(validate({ ...createCollection({ admin0: 'FR' }), legacyIDs: { oldpbdbID: '1' } }), false);
});

test('db: legacy-shaped row passes; top-level permid fails; admin1 rule absent', () => {
  const validate = compile('collection', 'db');
  const row = {
    name: 'c',
    legacyIDs: { oldpbdbID: '1' },
    location: { toponym: { administrativeArea: { admin0: 'US' } }, coordinates: { basis: 'estimated from map' }, scale: 'unspecified' },
  };
  assert.equal(validate(row), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...row, permid: 'x' }), false);
  // Nested objects don't reject unknown keys yet (design non-goal), so check the
  // stored-elsewhere coordinates are absent from the db schema itself.
  const coords = deriveVariant(applyEnums(sources.collection, enums), 'db').properties.location.properties.coordinates;
  assert.deepEqual(Object.keys(coords.properties), ['basis', 'altitude']);
  assert.equal('allOf' in coords, false, 'x-create not merged into db');
});

test('patch-guard on the real sources', () => {
  for (const entity of Object.keys(sources)) {
    const validate = compile(entity, 'patch-guard');
    assert.equal(validate({ notes: null, name: 'x' }), true);
    assert.equal(validate({ legacyIDs: { oldpbdbID: '1' } }), false);
    assert.equal(validate({ permid: 'x' }), false);
    assert.equal(validate([]), false);
  }
  assert.equal(compile('collection', 'patch-guard')({ location: { coordinates: { latitude: 10, longitude: 20 } } }), true);
});

test('specimen example is a valid stored payload', () => {
  const validate = compile('specimen', 'db');
  assert.equal(validate(specimenExample), true, JSON.stringify(validate.errors));
});

// ---------- person ----------

const PERSON_STORED_ELSEWHERE = ['permid', 'role', 'authorizer', 'active', 'totalHours'];
const PERSON_READ_ONLY = ['permid', 'legacyIDs', 'totalHours'];

const createPerson = () => ({ givenName: 'g', familyName: 'f', gender: 'Other', email: 'g@example.com' });

test('person db drops every stored-elsewhere property and keeps the rest', () => {
  const db = deriveVariant(applyEnums(sources.person, enums), 'db');
  for (const name of PERSON_STORED_ELSEWHERE) assert.equal(name in db.properties, false, name);
  assert.deepEqual(Object.keys(db.properties), [
    'legacyIDs', 'givenName', 'familyName', 'middle', 'email', 'orcid', 'countryCode', 'institution', 'gender',
  ]);
  assert.deepEqual(db.required, ['familyName', 'givenName', 'gender']);
  assert.equal('allOf' in db, false, 'x-create not merged into db');
});

test('person in-create requires email and rejects the server-assigned fields', () => {
  const validate = compile('person', 'in-create');
  assert.equal(validate(createPerson()), true, JSON.stringify(validate.errors));
  const { email, ...noEmail } = createPerson();
  assert.equal(validate(noEmail), false);
  for (const name of PERSON_READ_ONLY) {
    const value = name === 'legacyIDs' ? { oldpbdbID: '1' } : name === 'totalHours' ? 3 : 'x';
    assert.equal(validate({ ...createPerson(), [name]: value }), false, name);
  }
  // Privileged but writable: settable on create, unlike the read-only three.
  assert.equal(validate({ ...createPerson(), role: 'Authorizer', authorizer: 'p', active: true }), true, JSON.stringify(validate.errors));
});

test('person patch-guard blocks exactly the read-only three', () => {
  const guard = deriveVariant(applyEnums(sources.person, enums), 'patch-guard');
  assert.deepEqual(guard.propertyNames.not.enum, PERSON_READ_ONLY);
  const validate = compile('person', 'patch-guard');
  assert.equal(validate({ role: 'Student', authorizer: 'p', active: false }), true);
  for (const name of PERSON_READ_ONLY) assert.equal(validate({ [name]: null }), false, name);
});

test('person carries no inline enum and no credentials field', () => {
  const { properties } = sources.person;
  for (const [name, prop] of Object.entries(properties)) assert.equal('enum' in prop, false, name);
  assert.equal(properties.gender['x-enumFrom'].table, 'genders');
  assert.equal(properties.role['x-enumFrom'].table, 'roles');
  assert.equal(properties.countryCode['x-enumFrom'].table, 'admin0');
  assert.equal('password' in properties, false);
  assert.equal('createdAt' in properties, false);
});

test('person annotations carry no lookup detail; the codecs declare it', () => {
  assert.deepEqual(sources.person.properties.role['x-storage'], { column: 'role_id', codec: 'roleName' });
  assert.deepEqual(collectCodecSources(sources.person), [
    { table: 'dictionaries.roles', key: 'id', value: 'name' },
    { table: 'persons', key: 'id', value: 'permid' },
  ]);
});

test('person and collection share one country vocabulary', () => {
  const resolved = applyEnums(sources.person, enums);
  const collection = applyEnums(sources.collection, enums);
  assert.deepEqual(
    resolved.properties.countryCode.enum,
    collection.properties.location.properties.toponym.properties.administrativeArea.properties.admin0.enum,
  );
});

// ---------- reference ----------

const { PUBLICATION_TYPES, SHARED_FIELDS } = referenceModule;

const createJournalArticle = () => ({
  publicationType: 'journal article',
  title: 't',
  publicationYear: '2021',
  journalTitle: 'Nature',
  journalVolume: '5',
});
const createSerialMonograph = () => ({
  publicationType: 'serial monograph',
  title: 't',
  publicationYear: '1998',
  authors: [{ familyName: 'Lucas', givenName: 'S. G.' }],
  pages: { first: 1, last: 20 },
  seriesTitle: 'NMMNH Bulletin',
  seriesVolume: '12',
  publisher: 'NMMNH',
});
const createStandaloneBook = () => ({
  publicationType: 'standalone book',
  title: 't',
  publicationYear: '1990',
  authors: [{ familyName: 'f' }],
  pages: { first: 1, last: 300 },
  publisher: 'p',
});
const propertyNamesErrorFor = (errors, field) =>
  errors.some((e) => e.keyword === 'propertyNames' && e.params?.propertyName === field);

test('reference publicationType is inline and generated from the type table', () => {
  const { properties } = sources.reference;
  assert.deepEqual(properties.publicationType.enum, Object.keys(PUBLICATION_TYPES));
  assert.equal('x-enumFrom' in properties.publicationType, false);
  assert.equal(properties.bookType['x-enumFrom'].table, 'book_types');
  assert.equal(properties.language['x-enumFrom'].table, 'languages');
  for (const [name, prop] of Object.entries(properties)) {
    if (name !== 'publicationType') assert.equal('enum' in prop, false, name);
  }
});

test('reference declares every type field at the top level, and nothing inside a conditional', () => {
  const declared = Object.keys(sources.reference.properties);
  for (const name of SHARED_FIELDS) assert.ok(declared.includes(name), name);
  for (const [type, { fields = [] }] of Object.entries(PUBLICATION_TYPES)) {
    for (const name of fields) assert.ok(declared.includes(name), `${type}: ${name}`);
  }
  for (const rule of sources.reference['x-create'].allOf) assert.equal('properties' in rule.then, false);
});

test('reference db accepts legacy extras; in-create rejects them by name', () => {
  const db = compile('reference', 'db');
  const inCreate = compile('reference', 'in-create');
  const withPublisher = { ...createJournalArticle(), publisher: 'Elsevier BV' };
  assert.equal(db(withPublisher), true, JSON.stringify(db.errors));
  assert.equal(inCreate(createJournalArticle()), true, JSON.stringify(inCreate.errors));
  assert.equal(inCreate(withPublisher), false);
  assert.ok(propertyNamesErrorFor(inCreate.errors, 'publisher'), JSON.stringify(inCreate.errors));
});

test('reference create-time required fields apply per type, not at rest', () => {
  const { seriesVolume, ...noVolume } = createSerialMonograph();
  const inCreate = compile('reference', 'in-create');
  assert.equal(inCreate(noVolume), false);
  assert.ok(inCreate.errors.some((e) => e.params?.missingProperty === 'seriesVolume'));
  assert.equal(compile('reference', 'db')(noVolume), true);
});

test('serial monograph may name editors', () => {
  const inCreate = compile('reference', 'in-create');
  const withEditors = { ...createSerialMonograph(), editors: 'S. G. Lucas and M. Morales' };
  assert.equal(inCreate(withEditors), true, JSON.stringify(inCreate.errors));
});

test('other allows every declared field and still rejects an undeclared one', () => {
  const inCreate = compile('reference', 'in-create');
  const other = {
    publicationType: 'other', title: 't', publicationYear: '2001',
    publisher: 'GSA', publicationCity: 'Boulder', editors: 'e', journalTitle: 'j', bookType: 'other',
  };
  assert.equal(inCreate(other), true, JSON.stringify(inCreate.errors));
  assert.equal(inCreate({ ...other, bogus: 1 }), false);
});

test('a missing publicationType applies no type rule', () => {
  const inCreate = compile('reference', 'in-create');
  assert.equal(inCreate({ title: 't', publicationYear: '2001' }), false);
  assert.deepEqual(
    inCreate.errors.map((e) => e.params?.missingProperty).filter(Boolean),
    ['publicationType'],
  );
});

test('reference title is required on create only', () => {
  const { title, ...untitled } = createJournalArticle();
  assert.equal(compile('reference', 'db')(untitled), true);
  const inCreate = compile('reference', 'in-create');
  assert.equal(inCreate(untitled), false);
  assert.ok(inCreate.errors.some((e) => e.params?.missingProperty === 'title'));
});

test('bookType belongs to standalone books', () => {
  const inCreate = compile('reference', 'in-create');
  assert.equal(inCreate({ ...createStandaloneBook(), bookType: 'Ph.D. thesis' }), true, JSON.stringify(inCreate.errors));
  assert.equal(inCreate({ ...createJournalArticle(), bookType: 'Ph.D. thesis' }), false);
  assert.ok(propertyNamesErrorFor(inCreate.errors, 'bookType'));
});

test('reference patch-guard blocks exactly permid and legacyIDs', () => {
  const guard = deriveVariant(applyEnums(sources.reference, enums), 'patch-guard');
  assert.deepEqual(guard.propertyNames.not.enum, ['permid', 'legacyIDs']);
});

test('reference exposes no provenance columns and declares no codec', () => {
  const { properties } = sources.reference;
  for (const name of ['authorizer', 'enterer', 'authorizerPersonID', 'entererPersonID']) assert.equal(name in properties, false, name);
  assert.deepEqual(properties.permid['x-storage'], { column: 'permid' });
  assert.deepEqual(collectCodecSources(sources.reference), []);
});

// ---------- authority ----------

const storedAuthority = () => ({
  legacyIDs: { oldpbdbIDs: ['478544', '478546'] },
  citation: 'Brazidec and Perrichot 2022',
  descriptors: ['Brazidec', 'Perrichot'],
  year: '2022',
  publishedInReference: true,
});
const createAuthority = () => ({ reference: 'r-1', citation: 'Gaudry 1865', descriptors: ['Gaudry'], year: '1865', publishedInReference: false });

test('authority db declares neither permid nor reference and requires only the legacy two', () => {
  const db = deriveVariant(sources.authority, 'db');
  assert.deepEqual(Object.keys(db.properties), ['legacyIDs', 'citation', 'descriptors', 'year', 'publishedInReference']);
  assert.deepEqual(db.required, ['citation', 'publishedInReference']);
  assert.equal('allOf' in db, false, 'x-create not merged into db');
});

test('authority db: stored and sentinel payloads pass; legacy rules still hold', () => {
  const validate = compile('authority', 'db');
  assert.equal(validate(storedAuthority()), true, JSON.stringify(validate.errors));
  const sentinel = { legacyIDs: { oldpbdbIDs: ['12'] }, citation: 'authority unknown', descriptors: [], year: '0', publishedInReference: false };
  assert.equal(validate(sentinel), true, JSON.stringify(validate.errors));
  const { year, ...noYear } = storedAuthority();
  assert.equal(validate(noYear), true);
  const { citation, ...noCitation } = storedAuthority();
  const { publishedInReference, ...noPir } = storedAuthority();
  assert.equal(validate(noCitation), false);
  assert.equal(validate(noPir), false);
  assert.equal(validate({ ...storedAuthority(), year: '19690' }), false);
  assert.equal(validate({ ...storedAuthority(), extinct: true }), false);
  assert.equal(validate({ ...storedAuthority(), reference: 'r-1' }), false, 'reference lives in a column');
  assert.equal(validate({ ...storedAuthority(), descriptors: [1] }), false);
});

test('authority in-create requires reference and a four-digit year when one is given', () => {
  const validate = compile('authority', 'in-create');
  assert.equal(validate(createAuthority()), true, JSON.stringify(validate.errors));
  const { reference, ...noReference } = createAuthority();
  assert.equal(validate(noReference), false);
  assert.ok(validate.errors.some((e) => e.params?.missingProperty === 'reference'));
  assert.equal(validate({ ...createAuthority(), year: '0' }), false);
  assert.equal(validate({ ...createAuthority(), year: 'abc' }), false);
  assert.equal(validate({ ...createAuthority(), year: '1969' }), true);
  // The sentinel stays enterable, without a year.
  assert.equal(validate({ reference: 'r-1', citation: 'authority unknown', descriptors: [], publishedInReference: false }), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...createAuthority(), permid: 'x' }), false);
  assert.equal(validate({ ...createAuthority(), legacyIDs: { oldpbdbIDs: ['1'] } }), false);
});

test('authority patch-guard blocks exactly permid and legacyIDs', () => {
  const guard = deriveVariant(sources.authority, 'patch-guard');
  assert.deepEqual(guard.propertyNames.not.enum, ['permid', 'legacyIDs']);
  assert.equal(compile('authority', 'patch-guard')({ reference: 'r-2', year: '1999' }), true);
});

test('authority out requires reference', () => {
  const validate = compile('authority', 'out');
  assert.equal(validate({ ...storedAuthority(), permid: 'a-1', reference: 'r-1' }), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...storedAuthority(), permid: 'a-1' }), false);
});

// ---------- schema ----------

const storedSchema = () => ({
  legacyIDs: { pbotID: '565ba802-d652-4116-a895-56ebe06ed17b' },
  title: 'Fungi Morphology',
  year: '2023',
  purpose: 'Describe fungal remains',
  authors: [{ order: 1, givenName: 'Claire', familyName: 'Cleveland' }],
  partsPreserved: ['leaf'],
  notableFeatures: ['trace fossils (e.g., insect damage)'],
});
const createSchema = () => ({ ...storedSchema(), legacyIDs: undefined, references: [{ referenceID: 'r-1', order: '1' }] });
const withoutUndefined = (o) => JSON.parse(JSON.stringify(o));

test('schema db declares neither permid nor references and requires only title and year', () => {
  const db = deriveVariant(sources.schema, 'db');
  assert.deepEqual(Object.keys(db.properties), ['legacyIDs', 'title', 'year', 'purpose', 'authors', 'acknowledgments', 'partsPreserved', 'notableFeatures']);
  assert.deepEqual(db.required, ['title', 'year']);
  assert.equal('allOf' in db, false, 'x-create not merged into db');
});

test('schema source declares no character/state tree', () => {
  for (const key of ['characters', 'states', 'schemaDefinition']) assert.equal(key in sources.schema.properties, false, key);
  assert.equal('$defs' in sources.schema, false);
});

test('schema db: a stored payload passes; legacy rules still hold', () => {
  const validate = compile('schema', 'db');
  assert.equal(validate(storedSchema()), true, JSON.stringify(validate.errors));
  assert.equal(validate({ legacyIDs: { pbotID: 'p' }, title: 't', year: '2009' }), true, 'minimal payload');
  const { title, ...noTitle } = storedSchema();
  const { year, ...noYear } = storedSchema();
  assert.equal(validate(noTitle), false);
  assert.equal(validate(noYear), false);
  assert.equal(validate({ ...storedSchema(), year: '20230' }), false);
  assert.equal(validate({ ...storedSchema(), year: 'abc' }), true, 'db is loose on year beyond its length');
  assert.equal(validate({ ...storedSchema(), authors: [] }), false);
  assert.equal(validate({ ...storedSchema(), authors: [{ order: 0, givenName: 'a', familyName: 'b' }] }), false);
  assert.equal(validate({ ...storedSchema(), characters: [] }), false);
  assert.equal(validate({ ...storedSchema(), references: [{ referenceID: 'r-1', order: '1' }] }), false, 'references live in a column and child rows');
});

test('schema db: dictionary values are enforced', () => {
  const validate = compile('schema', 'db');
  assert.equal(validate({ ...storedSchema(), partsPreserved: ['bark'] }), false);
  assert.equal(validate({ ...storedSchema(), notableFeatures: ['pith structure'] }), false);
});

test('schema in-create requires references with permids and a four-digit year', () => {
  const validate = compile('schema', 'in-create');
  const body = withoutUndefined(createSchema());
  assert.equal(validate(body), true, JSON.stringify(validate.errors));
  const { references, ...noReferences } = body;
  assert.equal(validate(noReferences), false);
  assert.ok(validate.errors.some((e) => e.params?.missingProperty === 'references'));
  assert.equal(validate({ ...body, references: [] }), false);
  assert.equal(validate({ ...body, references: [{ order: '1' }] }), false);
  assert.ok(validate.errors.some((e) => e.params?.missingProperty === 'referenceID'));
  assert.equal(validate({ ...body, year: '0' }), false);
  assert.equal(validate({ ...body, year: 'abc' }), false);
  assert.equal(validate({ ...body, year: '2023' }), true);
  assert.equal(validate({ ...body, permid: 'x' }), false);
  assert.equal(validate({ ...body, legacyIDs: { pbotID: 'p' } }), false);
});

test('schema patch-guard blocks exactly permid and legacyIDs', () => {
  const guard = deriveVariant(sources.schema, 'patch-guard');
  assert.deepEqual(guard.propertyNames.not.enum, ['permid', 'legacyIDs']);
});

test('schema out requires references', () => {
  const validate = compile('schema', 'out');
  const references = [{ referenceID: 'r-1', order: '1' }];
  assert.equal(validate({ ...storedSchema(), permid: 's-1', references }), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...storedSchema(), permid: 's-1' }), false);
});
