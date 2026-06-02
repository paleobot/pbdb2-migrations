import {
  classifyScenario,
  buildDescriptorsFromFields,
  buildDescriptorsFromRef,
  buildCitationFromFields,
  buildCitationFromRef,
  buildAuthorityPayload,
  dedupKey,
} from '../migrate-authorities.js';

let pass = 0, fail = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}\n     expected ${e}\n     actual   ${a}`); }
}

console.log('classifyScenario');
check('① ria YES + author1last empty',  classifyScenario({ ref_is_authority: 'YES', author1last: '' }),     '1');
check('② ria YES + author1last present', classifyScenario({ ref_is_authority: 'YES', author1last: 'Smith' }), '2');
check('③ ¬ria + author1last present',    classifyScenario({ ref_is_authority: '',    author1last: 'Smith' }), '3');
check('④ ¬ria + author1last empty',      classifyScenario({ ref_is_authority: '',    author1last: '' }),     '4');
check('whitespace-only author1last → empty', classifyScenario({ ref_is_authority: '', author1last: '   ' }), '4');

console.log('\nbuildCitationFromFields (scenarios ②/③)');
check('1 author + year',
  buildCitationFromFields({ author1last:'Smith', author2last:'', otherauthors:'', pubyr:'1969' }),
  'Smith 1969');
check('2 authors via author2last',
  buildCitationFromFields({ author1last:'Smith', author2last:'Jones', otherauthors:'', pubyr:'1969' }),
  'Smith and Jones 1969');
check('3+ via otherauthors triggers et al.',
  buildCitationFromFields({ author1last:'Smith', author2last:'Jones', otherauthors:'Brown', pubyr:'1969' }),
  'Smith et al. 1969');
check('empty pubyr trims trailing space',
  buildCitationFromFields({ author1last:'Smith', author2last:'', otherauthors:'', pubyr:'' }),
  'Smith');
check('raw mess preserved verbatim',
  buildCitationFromFields({ author1last:'Kamptner 1948 ex Piviteau  1952', author2last:'', otherauthors:'', pubyr:'1952' }),
  'Kamptner 1948 ex Piviteau  1952 1952');

console.log('\nbuildCitationFromRef (scenario ①)');
check('1 author',
  buildCitationFromRef({ refAuthors:[{familyName:'Smith'}], publicationYear:'1969' }),
  'Smith 1969');
check('2 authors',
  buildCitationFromRef({ refAuthors:[{familyName:'Smith'},{familyName:'Jones'}], publicationYear:'1969' }),
  'Smith and Jones 1969');
check('3+ authors',
  buildCitationFromRef({ refAuthors:[{familyName:'Smith'},{familyName:'Jones'},{familyName:'Brown'}], publicationYear:'1969' }),
  'Smith et al. 1969');
check('empty year',
  buildCitationFromRef({ refAuthors:[{familyName:'Smith'}], publicationYear:'' }),
  'Smith');
check('zero authors → year only',
  buildCitationFromRef({ refAuthors:[], publicationYear:'1969' }),
  '1969');

console.log('\nbuildDescriptorsFromFields (scenarios ②/③)');
check('simple multi-author otherauthors',
  buildDescriptorsFromFields({ author1last:'Smith', author2last:'Jones', otherauthors:'Brown, Davis, Evans' }),
  ['Smith','Jones','Brown','Davis','Evans']);
check('HTML entity decoded before split',
  buildDescriptorsFromFields({ author1last:'Dvo&#345;ák', author2last:'', otherauthors:'' }),
  ['Dvořák']);
check('amp entity, no split fracture',
  buildDescriptorsFromFields({ author1last:'A&amp;M', author2last:'', otherauthors:'' }),
  ['A','M']);
check('empty fields produce no tokens',
  buildDescriptorsFromFields({ author1last:'Smith', author2last:'', otherauthors:'' }),
  ['Smith']);
check('et al. dropped',
  buildDescriptorsFromFields({ author1last:'Smith', author2last:'', otherauthors:'et al.' }),
  ['Smith']);
check('empty splits dropped',
  buildDescriptorsFromFields({ author1last:'', author2last:'', otherauthors:'Brown,,Davis,' }),
  ['Brown','Davis']);
check('whitespace trimmed',
  buildDescriptorsFromFields({ author1last:'', author2last:'', otherauthors:'Brown , Davis' }),
  ['Brown','Davis']);
check('long surname preserved as single token',
  buildDescriptorsFromFields({ author1last:'Lepeletier de Saint Fargeau', author2last:'', otherauthors:'' }),
  ['Lepeletier de Saint Fargeau']);
check('semicolon split',
  buildDescriptorsFromFields({ author1last:'', author2last:'', otherauthors:'Brown; Davis' }),
  ['Brown','Davis']);
check('colon split',
  buildDescriptorsFromFields({ author1last:'', author2last:'', otherauthors:'Brown:Davis' }),
  ['Brown','Davis']);
check('& splits raw ampersand',
  buildDescriptorsFromFields({ author1last:'', author2last:'', otherauthors:'Brown & Davis' }),
  ['Brown','Davis']);

console.log('\nbuildDescriptorsFromRef (scenario ①)');
check('multiple authors',
  buildDescriptorsFromRef([{familyName:'Smith'},{familyName:'Jones'},{familyName:'Brown'}]),
  ['Smith','Jones','Brown']);
check('zero-author ref → []',
  buildDescriptorsFromRef([]),
  []);
check('missing familyName filtered',
  buildDescriptorsFromRef([{familyName:'Smith'},{givenName:'J.'}]),
  ['Smith']);

console.log('\nbuildAuthorityPayload integration');
check('scenario ② with all fields',
  buildAuthorityPayload(
    { taxon_no: 42, author1last:'Smith', author2last:'', otherauthors:'', pubyr:'1969' },
    '2',
    null,
  ),
  {
    legacyIDs: { oldpbdbIDs: ['42'] },
    publishedInReference: true,
    citation: 'Smith 1969',
    descriptors: ['Smith'],
    year: '1969',
  });
check('scenario ③ omits year when pubyr empty',
  buildAuthorityPayload(
    { taxon_no: 99, author1last:'Smith', author2last:'', otherauthors:'', pubyr:'' },
    '3',
    null,
  ),
  {
    legacyIDs: { oldpbdbIDs: ['99'] },
    publishedInReference: false,
    citation: 'Smith',
    descriptors: ['Smith'],
  });
check('scenario ① with 0-author ref',
  buildAuthorityPayload(
    { taxon_no: 100 },
    '1',
    { refAuthors: [], publicationYear: '1969' },
  ),
  {
    legacyIDs: { oldpbdbIDs: ['100'] },
    publishedInReference: true,
    citation: '1969',
    descriptors: [],
    year: '1969',
  });

console.log('\ndedupKey determinism');
const k1 = dedupKey({ citation:'Smith 1969', year:'1969', descriptors:['Smith'] }, 42);
const k2 = dedupKey({ citation:'Smith 1969', year:'1969', descriptors:['Smith'] }, 42);
check('same input → same key', k1, k2);
check('different reference_id → different key',
  dedupKey({ citation:'Smith 1969', year:'1969', descriptors:['Smith'] }, 42) ===
  dedupKey({ citation:'Smith 1969', year:'1969', descriptors:['Smith'] }, 43),
  false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
