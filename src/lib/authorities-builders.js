// Citation/descriptor builders extracted verbatim from the root-level
// migrate-authorities.js, so src/lib/attribution.js can depend on src/lib/
// rather than reaching back into a root-level migrate-*.js. The logic is
// identical to migrate-authorities.js's decodeEntities / buildCitationFromFields
// / buildDescriptorsFromFields; keep the two in sync until the root scripts move.

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
