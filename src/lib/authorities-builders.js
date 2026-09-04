// Citation/descriptor builders shared by the two migrations that need them:
// src/authorities-migration/migrate-authorities.js builds an authority's citation
// and descriptors from the legacy author1last/author2last/otherauthors fields, and
// src/lib/attribution.js builds an opinion's second-hand attribution from the same
// fields. This file is their single definition — it was briefly a verbatim copy of
// the then-root-level migrate-authorities.js, and that duplication was resolved when
// that script moved under src/ and became an importer of this module.

// ---------- decodeEntities ----------
export function decodeEntities(s) {
  if (!s) return s;
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

export function buildDescriptorsFromFields({ author1last, author2last, otherauthors }) {
  const out = [];
  for (const raw of [author1last, author2last, otherauthors]) {
    if (!raw) continue;
    const decoded = decodeEntities(raw);
    for (const tok of decoded.split(/[,;:&]/)) {
      const t = tok.trim();
      if (!t || t === 'et al.') continue;
      out.push(t);
    }
  }
  return out;
}

export function buildCitationFromFields({ author1last, author2last, otherauthors, pubyr }) {
  const a1 = author1last || '';
  const a2 = author2last || '';
  const oa = otherauthors || '';
  const yr = pubyr || '';
  let mid = '';
  if (oa !== '') mid = ' et al.';
  else if (a2 !== '') mid = ' and ' + a2;
  return (a1 + mid + ' ' + yr).trim();
}
