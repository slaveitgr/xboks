import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertRuntimePromotion } from './runtime-promotion-policy.mjs';
const candidate = { schema: 1, status: 'development', sources: { wine: 'pinned' }, patches: [{ file: 'fix.patch', sha256: 'a' }], expectedXgameruntimeSources: { source: 'b' }, requiresBackendVersion: '0.2.1' };
const approved = { ...candidate, status: 'release' };
const base = { commit: 'base', archiveSha512: 'base-hash' }, media = { version: '4.4.8', sha256: 'media-hash' };
test('metadata-only approval accepts identical candidate inputs without repacking', () => {
  assert.doesNotThrow(() => assertRuntimePromotion(candidate, approved, base, base, media, media));
  assert.doesNotThrow(() => assertRuntimePromotion(approved, approved, base, base, media, media));
});
test('unapproved and unknown states fail closed', () => {
  assert.throws(() => assertRuntimePromotion(candidate, candidate, base, base, media, media));
  assert.throws(() => assertRuntimePromotion({ ...candidate, status: 'unknown' }, approved, base, base, media, media));
});
for (const field of ['sources', 'patches', 'expectedXgameruntimeSources', 'requiresBackendVersion']) {
  test(`changed ${field} rejects an older candidate`, () => {
    assert.throws(() => assertRuntimePromotion(candidate, { ...approved, [field]: 'changed' }, base, base, media, media));
  });
}
test('changed or missing base/media locks reject an older candidate', () => {
  assert.throws(() => assertRuntimePromotion(candidate, approved, base, { ...base, commit: 'changed' }, media, media));
  assert.throws(() => assertRuntimePromotion(candidate, approved, base, base, media, { ...media, sha256: 'changed' }));
  assert.throws(() => assertRuntimePromotion(candidate, approved, undefined, undefined, media, media));
});
