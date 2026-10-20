import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { writeManifest, verifyManifest } from './artifact-manifest.mjs';
const context = { commit: 'a'.repeat(40), repository: 'owner/repo', runId: '123', ref: 'refs/heads/develop' };
test('launcher candidate is bound to exact bytes and commit', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'candidate-test-'));
  try {
    await fs.writeFile(path.join(root, 'Xodus-Nexus.AppImage'), 'synthetic artifact');
    await writeManifest('launcher', root, context);
    assert.equal((await verifyManifest(root, { commit: context.commit })).files.length, 2);
    await assert.rejects(verifyManifest(root, { commit: 'b'.repeat(40) }), /mismatch/);
    await fs.writeFile(path.join(root, 'Xodus-Nexus.AppImage'), 'corrupted');
    await assert.rejects(verifyManifest(root), /checksum mismatch/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
test('runtime requires the matching corresponding-source archive', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'candidate-test-'));
  try {
    await fs.writeFile(path.join(root, 'xodus-nexus-runtime-test-x86_64.tar.xz'), 'synthetic runtime');
    await assert.rejects(writeManifest('runtime', root, context), /complete/);
    await fs.writeFile(path.join(root, 'xodus-nexus-runtime-test-source.tar.xz'), 'synthetic source');
    await writeManifest('runtime', root, context);
    assert.equal((await verifyManifest(root, { kind: 'runtime' })).files.length, 4);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
test('symlink artifacts are rejected', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'candidate-test-'));
  try {
    await fs.writeFile(path.join(root, 'target'), 'not an artifact');
    await fs.symlink('target', path.join(root, 'Xodus-Nexus.AppImage'));
    await assert.rejects(writeManifest('launcher', root, context), /Unsafe/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
test('backend candidate requires binaries, source and exact metadata, detects tampering', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'backend-candidate-test-'));
  try {
    const name = 'xodus-nexus-backend-0.1.0-linux-x86_64';
    await fs.writeFile(path.join(root, `${name}.tar.xz`), 'synthetic backend');
    await assert.rejects(writeManifest('backend', root, context), /complete/);
    await fs.writeFile(path.join(root, `${name}-source.tar.xz`), 'synthetic source');
    await fs.writeFile(path.join(root, `${name}.manifest.json`), '{}');
    await writeManifest('backend', root, context);
    assert.equal((await verifyManifest(root, { kind: 'backend' })).files.length, 5);
    await fs.writeFile(path.join(root, `${name}.manifest.json`), 'tampered metadata');
    await assert.rejects(verifyManifest(root), /checksum mismatch/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
