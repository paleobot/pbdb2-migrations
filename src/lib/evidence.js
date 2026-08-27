// basis -> evidence boolean (mapping doc §6.3). Shared across all pair handlers.
export function evidenceFromBasis(basis) {
  return basis === 'stated with evidence';
}
