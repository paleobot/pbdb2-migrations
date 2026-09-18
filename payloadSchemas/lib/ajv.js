// Shared ajv factory for payload schemas: draft 2019-09 (for
// unevaluatedProperties), strict mode, and the x-* annotations the annotated
// sources use registered as annotation-only keywords so strict mode accepts
// them. strictRequired is off: x-create is merged as an allOf entry whose
// `required` names properties defined on the parent node, which is valid JSON
// Schema but trips that check. See openspec/specs/payload-schema-variants/spec.md.
import Ajv2019 from 'ajv/dist/2019.js';

export const ANNOTATION_KEYWORDS = ['x-enumFrom', 'x-storage', 'x-create', 'x-variant'];

export function createAjv() {
  const ajv = new Ajv2019({ allErrors: true, strict: true, strictRequired: false });
  for (const keyword of ANNOTATION_KEYWORDS) ajv.addKeyword({ keyword });
  return ajv;
}
