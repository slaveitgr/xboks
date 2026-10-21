import { isDeepStrictEqual } from 'node:util';
const promotionOnly = new Set(['scripts/ci/promote-candidate.mjs', 'scripts/ci/runtime-promotion-policy.mjs',
  'scripts/ci/release-notes-policy.mjs', 'scripts/ci/release-notes-policy.test.mjs',
  'scripts/ci/runtime-promotion-policy.test.mjs', 'scripts/ci/runtime-inputs.mjs',
  'scripts/ci/runtime-needed.mjs', 'scripts/ci/runtime-needed.test.mjs']);
export function runtimeRecipeMetadataOnly(before, after) {
  if (!before || !after || before.schema !== 1 || after.schema !== 1 ||
      !['development', 'release'].includes(before.status) || !['development', 'release'].includes(after.status)) return false;
  const { status: a, ...left } = before, { status: b, ...right } = after;
  return isDeepStrictEqual(left, right);
}
export function runtimeInputsChanged(files, metadataOnly = false) {
  files = files.filter(file => !promotionOnly.has(file) && !(metadataOnly && file === 'scripts/runtime-patches.lock.json'));
  // xodus-* patches belong to the independently built backend, not Wine/GDK.
  return files.some(file => (/^assets\/.*\.patch$/s.test(file) && !/^assets\/xodus-[a-z-]+\.patch$/.test(file)) ||
    /^scripts\/(?:ci\/|runtime-tests\/|runtime-compat\/|runtime-.*\.lock\.json$|(?:build-shared-runtime|build-runtime-media|build-runtime-dxvk|assemble-shared-runtime|verify-runtime-base)\.mjs$)/.test(file) ||
    file === '.github/workflows/runtime.yml' || /^src\/main\/proton\./.test(file));
}
