// The 48 (status, spelling_reason) pairs and their handler files, shared by
// every test/migration runner in this directory. See ../DESIGN.md §5 for the
// folder structure this mirrors.
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

const RAW_PAIRS = [
  ['belongs-to', 'original-spelling', 'belongs to', 'original spelling'],
  ['belongs-to', 'recombination', 'belongs to', 'recombination'],
  ['belongs-to', 'correction', 'belongs to', 'correction'],
  ['belongs-to', 'misspelling', 'belongs to', 'misspelling'],
  ['belongs-to', 'rank-change', 'belongs to', 'rank change'],
  ['belongs-to', 'reassignment', 'belongs to', 'reassignment'],
  ['subjective-synonym-of', 'original-spelling', 'subjective synonym of', 'original spelling'],
  ['subjective-synonym-of', 'correction', 'subjective synonym of', 'correction'],
  ['subjective-synonym-of', 'rank-change', 'subjective synonym of', 'rank change'],
  ['subjective-synonym-of', 'recombination', 'subjective synonym of', 'recombination'],
  ['subjective-synonym-of', 'misspelling', 'subjective synonym of', 'misspelling'],
  ['subjective-synonym-of', 'reassignment', 'subjective synonym of', 'reassignment'],
  ['objective-synonym-of', 'original-spelling', 'objective synonym of', 'original spelling'],
  ['objective-synonym-of', 'correction', 'objective synonym of', 'correction'],
  ['objective-synonym-of', 'rank-change', 'objective synonym of', 'rank change'],
  ['objective-synonym-of', 'recombination', 'objective synonym of', 'recombination'],
  ['objective-synonym-of', 'misspelling', 'objective synonym of', 'misspelling'],
  ['invalid-subgroup-of', 'original-spelling', 'invalid subgroup of', 'original spelling'],
  ['invalid-subgroup-of', 'correction', 'invalid subgroup of', 'correction'],
  ['invalid-subgroup-of', 'rank-change', 'invalid subgroup of', 'rank change'],
  ['invalid-subgroup-of', 'recombination', 'invalid subgroup of', 'recombination'],
  ['invalid-subgroup-of', 'misspelling', 'invalid subgroup of', 'misspelling'],
  ['invalid-subgroup-of', 'reassignment', 'invalid subgroup of', 'reassignment'],
  ['misspelling-of', 'misspelling', 'misspelling of', 'misspelling'],
  ['replaced-by', 'original-spelling', 'replaced by', 'original spelling'],
  ['replaced-by', 'correction', 'replaced by', 'correction'],
  ['replaced-by', 'rank-change', 'replaced by', 'rank change'],
  ['replaced-by', 'recombination', 'replaced by', 'recombination'],
  ['replaced-by', 'misspelling', 'replaced by', 'misspelling'],
  ['nomen-dubium', 'original-spelling', 'nomen dubium', 'original spelling'],
  ['nomen-dubium', 'correction', 'nomen dubium', 'correction'],
  ['nomen-dubium', 'rank-change', 'nomen dubium', 'rank change'],
  ['nomen-dubium', 'recombination', 'nomen dubium', 'recombination'],
  ['nomen-dubium', 'misspelling', 'nomen dubium', 'misspelling'],
  ['nomen-nudum', 'original-spelling', 'nomen nudum', 'original spelling'],
  ['nomen-nudum', 'correction', 'nomen nudum', 'correction'],
  ['nomen-nudum', 'rank-change', 'nomen nudum', 'rank change'],
  ['nomen-nudum', 'recombination', 'nomen nudum', 'recombination'],
  ['nomen-nudum', 'misspelling', 'nomen nudum', 'misspelling'],
  ['nomen-oblitum', 'original-spelling', 'nomen oblitum', 'original spelling'],
  ['nomen-oblitum', 'correction', 'nomen oblitum', 'correction'],
  ['nomen-oblitum', 'misspelling', 'nomen oblitum', 'misspelling'],
  ['nomen-oblitum', 'recombination', 'nomen oblitum', 'recombination'],
  ['nomen-vanum', 'original-spelling', 'nomen vanum', 'original spelling'],
  ['nomen-vanum', 'correction', 'nomen vanum', 'correction'],
  ['nomen-vanum', 'misspelling', 'nomen vanum', 'misspelling'],
  ['nomen-vanum', 'recombination', 'nomen vanum', 'recombination'],
  ['nomen-vanum', 'reassignment', 'nomen vanum', 'reassignment'],
];

export const PAIRS = RAW_PAIRS.map(([folder, file, status, spellingReason]) => ({
  folder,
  file,
  status,
  spellingReason,
  path: path.join(REPO_ROOT, 'migration_exploration', 'opinions', folder, `${file}.js`),
}));

export { REPO_ROOT };
