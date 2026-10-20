import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./check-media-glibc.mjs', import.meta.url));
test('portable media accepts GLIBC 2.35 and rejects newer builds', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-glibc-test-'));
  const manifest = path.join(dir, 'media-manifest.json');
  try {
    await fs.writeFile(manifest, JSON.stringify({ maxGlibc: '2.35' }));
    assert.match(execFileSync(process.execPath, [script, manifest], { encoding: 'utf8' }), /GLIBC_2\.35/);
    await fs.writeFile(manifest, JSON.stringify({ maxGlibc: '2.44' }));
    assert.throws(() => execFileSync(process.execPath, [script, manifest], { stdio: 'pipe' }), /Command failed/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
