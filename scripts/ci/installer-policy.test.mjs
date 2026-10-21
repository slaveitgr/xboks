import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

test('installer release selection, checksum/body bounds and CDN policy use only synthetic responses', () => {
  execFileSync('python3', ['scripts/installer-release.test.py'], { stdio: 'pipe' });
  execFileSync('bash', ['-n', 'scripts/install.sh'], { stdio: 'pipe' });
  const help = execFileSync('bash', ['scripts/install.sh', '--help'], { encoding: 'utf8' });
  assert.match(help, /xboks user installer/);
  assert.doesNotMatch(help, /domsvoboda|Xodus Nexus/);
});

test('local installer uses owned paths, preserves an old install on invalid replacement and never executes the image', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xboks-install-test-'));
  try {
    const prefix = path.join(root, 'local with spaces'), data = path.join(root, 'data');
    const tools = path.join(root, 'tools'); await fs.mkdir(tools);
    // Every curl call is refused by a local executable; no network or system
    // package manager is touched. The explicitly supplied image is inert bytes.
    await fs.writeFile(path.join(tools, 'curl'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    const image = path.join(root, 'input.AppImage'), bytes = Buffer.alloc(100);
    Buffer.from('7f454c460201', 'hex').copy(bytes); Buffer.from('414902', 'hex').copy(bytes, 8); bytes.writeUInt16LE(62, 18);
    await fs.writeFile(image, bytes);
    const env = { ...process.env, XBOKS_PREFIX: prefix, XBOKS_APPIMAGE: image, XBOKS_SKIP_DEPS: '1', XDG_DATA_HOME: data, PATH: `${tools}:${process.env.PATH}` };
    execFileSync('bash', ['scripts/install.sh'], { env, stdio: 'pipe' });
    const installed = path.join(prefix, 'opt/xboks/xboks.AppImage');
    assert.deepEqual(await fs.readFile(installed), bytes);
    assert.equal(await fs.readlink(path.join(prefix, 'bin/xboks')), installed);
    const desktop = await fs.readFile(path.join(data, 'applications/xboks.desktop'), 'utf8');
    assert.match(desktop, /^Name=xboks$/m); assert.match(desktop, /^Exec=".*\/xboks" %U$/m);
    assert.doesNotMatch(desktop, /xodus|nexus/i);
    await fs.writeFile(image, 'Invalid replacement');
    assert.throws(() => execFileSync('bash', ['scripts/install.sh'], { env, stdio: 'pipe' }));
    assert.deepEqual(await fs.readFile(installed), bytes);
    assert.equal((await fs.readdir(path.dirname(installed))).some(name => name.startsWith('.install-')), false);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
