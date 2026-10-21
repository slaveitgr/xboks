import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runtimeInputsChanged, runtimeRecipeMetadataOnly } from './runtime-inputs.mjs';
const script = fileURLToPath(new URL('./runtime-needed.mjs', import.meta.url));
test('approval-only status does not rebuild binaries; changed recipes still do', () => {
  const before = { schema: 1, status: 'development', patches: ['pinned'] };
  assert.equal(runtimeRecipeMetadataOnly(before, { ...before, status: 'release' }), true);
  assert.equal(runtimeRecipeMetadataOnly(before, { ...before, status: 'release', patches: ['changed'] }), false);
  assert.equal(runtimeRecipeMetadataOnly(before, { ...before, status: 'invalid' }), false);
  assert.equal(runtimeInputsChanged(['scripts/runtime-patches.lock.json'], true), false);
  assert.equal(runtimeInputsChanged(['scripts/runtime-patches.lock.json']), true);
  assert.equal(runtimeInputsChanged(['scripts/runtime-patches.lock.json', 'assets/real.patch'], true), true);
  assert.equal(runtimeInputsChanged(['scripts/ci/promote-candidate.mjs', 'scripts/ci/runtime-needed.mjs']), false);
  assert.equal(runtimeInputsChanged(['scripts/ci/release-notes-policy.mjs', 'scripts/ci/release-notes-policy.test.mjs']), false);
});
test('runtime inputs trigger native CI but documentation/UI-only diffs do not', () => {
  for (const file of ['assets/fix.patch', 'assets/odd\nname.patch', 'scripts/runtime-patches.lock.json', 'scripts/runtime-base.lock.json', 'scripts/runtime-media.lock.json', 'scripts/runtime-dxvk.lock.json', 'scripts/build-runtime-dxvk.mjs',
    'scripts/runtime-tests/winrt-json-probe.c', 'scripts/runtime-tests/media-codecs-probe.c', 'scripts/runtime-compat/playfab-save-folder.c', 'scripts/runtime-compat/build.mjs', 'scripts/build-shared-runtime.mjs', 'scripts/build-runtime-media.mjs', 'scripts/assemble-shared-runtime.mjs',
    '.github/workflows/runtime.yml', 'src/main/proton.ts']) assert.equal(runtimeInputsChanged([file]), true, file);
  assert.equal(runtimeInputsChanged(['docs/development/STATUS.md', 'src/renderer/App.tsx']), false);
  assert.equal(runtimeInputsChanged(['assets/xodus-subscription-login.patch', 'assets/xodus-account-profile.patch', 'assets/backend-source.lock.json', 'scripts/build-backend.mjs']), false);
  assert.equal(runtimeInputsChanged(['assets/xodus-subscription-login.patch', 'assets/xgameruntime-user-signin.patch']), true);
});
test('first/manual runtime builds are forced and malformed revisions are rejected', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-needed-test-'));
  try {
    const output = path.join(root, 'output');
    const env = { ...process.env, BASE_SHA: '0'.repeat(40), HEAD_SHA: 'a'.repeat(40), GITHUB_OUTPUT: output };
    execFileSync(process.execPath, [script], { env, stdio: 'pipe' });
    assert.equal(await fs.readFile(output, 'utf8'), 'needed=true\n');
    assert.throws(() => execFileSync(process.execPath, [script], { env: { ...env, HEAD_SHA: 'HEAD; touch forbidden' }, stdio: 'pipe' }));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
test('promotion refuses an unauthorised invocation before accessing GitHub', () => {
  const promote = fileURLToPath(new URL('./promote-candidate.mjs', import.meta.url));
  assert.throws(() => execFileSync(process.execPath, [promote], { env: { ...process.env, GITHUB_REF: 'refs/heads/develop', APPROVE_RELEASE: 'false' }, stdio: 'pipe' }), /Command failed/);
});
test('a removed pre-reset base forces a complete runtime build', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-reset-test-'));
  try {
    const output = path.join(root, 'output');
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    execFileSync(process.execPath, [script], {
      env: { ...process.env, BASE_SHA: 'f'.repeat(40), HEAD_SHA: head, FORCE_RUNTIME: 'false', GITHUB_OUTPUT: output },
      stdio: 'pipe',
    });
    assert.equal(await fs.readFile(output, 'utf8'), 'needed=true\n');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
