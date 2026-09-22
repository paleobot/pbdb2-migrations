// The country-resolution pipeline shared by the collections and persons
// migrations: normalize a legacy free-text country, match it against
// dictionaries.admin0 by name/iso/iso3, then fall back to a curated alias map.
//
// It lives here because two migrations under src/ use it, which
// migration-script-layout requires of any shared helper. migrate-collections.js
// resolves a collection's toponym with it; migrate-persons.js resolves a
// person's countryCode with it, replacing @countrystatecity/countries, whose
// spellings disagree with admin0's ('The Netherlands', 'Czechia', 'South Korea',
// 'Russia').
// See openspec/specs/collection-migration/spec.md and
// openspec/specs/person-migration/spec.md.

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

// Country name variants that don't normalize to a dictionary entry.
// Keys are normalizeName output; values are ISO alpha-2 codes.
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
  // Carried over from migrate-persons.js's own COUNTRY_NORMALIZE map when its
  // resolution moved onto this pipeline.
  ['untied states', 'US'],
  ['england', 'GB'],
]);

// dictionaries.admin0 indexed by normalized name/iso/iso3 and by iso.
export async function loadAdmin0(pg) {
  const admin0ByNorm = new Map();
  const admin0ByIso = new Map();
  const admin0Isos = [];
  const { rows } = await pg.query('SELECT id, iso, iso3, name FROM dictionaries.admin0');
  for (const r of rows) {
    const entry = { iso: r.iso, id: r.id };
    admin0ByIso.set(r.iso, entry);
    admin0Isos.push(r.iso);
    if (r.name) admin0ByNorm.set(normalizeName(r.name), entry);
    if (r.iso) admin0ByNorm.set(normalizeName(r.iso), entry);
    if (r.iso3) admin0ByNorm.set(normalizeName(r.iso3), entry);
  }
  return { admin0ByNorm, admin0ByIso, admin0Isos };
}

// A legacy country string -> { iso, id } from admin0, or undefined.
// `dicts` needs only admin0ByNorm and admin0ByIso, so a caller may pass the
// wider dictionary bundle loadDicts() builds.
export function resolveCountry(normalized, dicts) {
  const direct = dicts.admin0ByNorm.get(normalized);
  if (direct) return direct;
  const aliasIso = COUNTRY_ALIASES.get(normalized);
  return aliasIso ? dicts.admin0ByIso.get(aliasIso) : undefined;
}
