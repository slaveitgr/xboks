import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { verifyRuntimeBase } from './verify-runtime-base.mjs';

test('locked base verifies version and loader bytes, rejects different distribution', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-base-test-'));
  try {
    await fs.mkdir(path.join(root, 'files/bin'), { recursive: true });
    await fs.writeFile(path.join(root, 'version'), 'test base\n');
    await fs.writeFile(path.join(root, 'files/bin/wine'), 'test loader');
    const lock = { schema: 1, version: 'test base', files: { 'files/bin/wine': createHash('sha256').update('test loader').digest('hex') } };
    await verifyRuntimeBase(root, lock);
    await fs.writeFile(path.join(root, 'files/bin/wine'), 'other loader');
    await assert.rejects(verifyRuntimeBase(root, lock), /checksum mismatch/);
    await fs.writeFile(path.join(root, 'version'), 'different Proton');
    await assert.rejects(verifyRuntimeBase(root, lock), /version does not match/);
    await assert.rejects(verifyRuntimeBase(root, {}), /Invalid base lock/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
test('unsafe paths are rejected, not read', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-base-test-'));
  try {
    await fs.writeFile(path.join(root, 'version'), 'test');
    await assert.rejects(verifyRuntimeBase(root, { schema: 1, version: 'test', files: { 'files/../../secret': 'a'.repeat(64) } }), /Invalid base component lock/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
