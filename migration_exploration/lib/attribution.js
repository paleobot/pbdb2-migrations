// Second-hand attribution rule, shared across pair handlers. Ported from
// migrate-assignment-opinions.js / migrate-synonymy-opinions.js; reuses the
// authorities migration's citation/descriptor builders rather than re-deriving them.
import Ajv from 'ajv/dist/2019.js';
import { opinionAttributionSchema } from '../../payloadSchemas/opinionAttribution.schema.js';
import { buildCitationFromFields, buildDescriptorsFromFields } from '../../migrate-authorities.js';

const ajv = new Ajv({ allErrors: true, strict: false });
const validateAttribution = ajv.compile(opinionAttributionSchema);

// opinions.pubyr is an optional string; empty/blank/'0' -> null.
export function parseYear(year) {
  if (year === null || year === undefined || String(year).trim() === '' || year === '0') return null;
  const n = parseInt(year, 10);
  return Number.isNaN(n) || n === 0 ? null : n;
}

// Rows with no discernible authorship (blank author1last) use the established
// "authority unknown" sentinel (authorities scenario (4) convention).
export function buildOpinionAttribution(src) {
  const hasAuthor = (src.author1last || '').trim() !== '';
  if (!hasAuthor) {
    return { citation: 'authority unknown', descriptors: [], publishedInReference: false };
  }
  return {
    citation: buildCitationFromFields(src),
    descriptors: buildDescriptorsFromFields(src),
    publishedInReference: false,
  };
}

// First-hand (ref_has_opinion = 'YES'): defer to the reference, no override.
// Second-hand: parse the attributed year and build the attribution payload.
export function resolveSecondHand(src, firstHand) {
  if (firstHand) return { publicationYear: null, attribution: null };
  return { publicationYear: parseYear(src.pubyr), attribution: buildOpinionAttribution(src) };
}

export function assertValidAttribution(attribution, context) {
  if (attribution === null) return;
  if (!validateAttribution({ attribution })) {
    throw new Error(`Invalid attribution for ${context}: ${JSON.stringify(validateAttribution.errors)} payload=${JSON.stringify(attribution)}`);
  }
}
