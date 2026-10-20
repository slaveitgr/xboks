import { isDeepStrictEqual } from 'node:util';
// Approval follows validation; a status label must not force repacking bytes.
export function assertRuntimePromotion(candidate, approved, candidateBase, approvedBase, candidateMedia, approvedMedia) {
  if (!candidate || !approved || candidate.schema !== 1 || approved.schema !== 1 ||
      !['development', 'release'].includes(candidate.status) || approved.status !== 'release')
    throw Error('Runtime recipe has not been release-approved');
  const { status: a, ...left } = candidate, { status: b, ...right } = approved;
  if (!isDeepStrictEqual(left, right)) throw Error('Approved runtime recipe differs from candidate');
  if (!candidateBase || !approvedBase || !isDeepStrictEqual(candidateBase, approvedBase)) throw Error('Runtime base changed since candidate');
  if (!candidateMedia || !approvedMedia || !isDeepStrictEqual(candidateMedia, approvedMedia)) throw Error('Runtime media changed since candidate');
}
