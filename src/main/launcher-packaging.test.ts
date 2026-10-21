import { afterEach, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xboks-after-pack-')); roots.push(root);
  const scripts = path.join(root, 'scripts'), compiled = path.join(root, 'dist-electron', 'main');
  await fs.mkdir(scripts); await fs.mkdir(compiled, { recursive: true });
  for (const name of ['launcher-fonts-after-pack.cjs', 'launcher-font-wrapper.sh', 'launcher-font-bootstrap.mjs']) await fs.copyFile(path.join('scripts', name), path.join(scripts, name));
  // Test the real hook with a disposable compiled-module fixture; no app build or
  // desktop launch is needed to verify publication of the bootstrap resources.
  const fontModule = 'export const packagedFontModuleFixture = true;\n';
  await fs.writeFile(path.join(compiled, 'launcher-fonts.js'), fontModule);
  return { root, hook: require(path.join(scripts, 'launcher-fonts-after-pack.cjs')), fontModule };
}

it.each(['xboks', 'xodus-nexus'])('packages and executes the actual Linux %s wrapper with matching native helper', async executableName => {
  const { root, hook, fontModule } = await fixture();
  const output = path.join(root, "output with spaces and 'quote"); await fs.mkdir(output);
  const executable = path.join(output, executableName);
  const helper = Buffer.from('Synthetic sandbox helper fixture, never executed.');
  await fs.writeFile(path.join(output, 'chrome-sandbox'), helper, { mode: 0o755 });
  const binary = `#!${process.execPath}\nprocess.stdout.write(JSON.stringify({args:process.argv.slice(2),pid:process.pid,node:process.env.ELECTRON_RUN_AS_NODE}));process.exitCode=37;\n`;
  await fs.writeFile(executable, binary, { mode: 0o755 });
  await hook({ electronPlatformName: 'linux', appOutDir: output, packager: { executableName } });
  expect(await fs.readFile(executable + '.bin', 'utf8')).toBe(binary);
  expect((await fs.stat(executable)).mode & 0o777).toBe(0o755);
  expect((await fs.stat(output)).mode & 0o7777).toBe(0o755);
  expect((await fs.stat(path.join(output, 'resources'))).mode & 0o7777).toBe(0o755);
  expect((await fs.stat(path.join(output, 'chrome-sandbox'))).mode & 0o7777).toBe(0o755);
  expect(await fs.readFile(executable, 'utf8')).toBe(await fs.readFile('scripts/launcher-font-wrapper.sh', 'utf8'));
  expect(await fs.readFile(path.join(output, 'resources/font-bootstrap/launcher-fonts.mjs'), 'utf8')).toBe(fontModule);
  expect(await fs.readFile(path.join(output, 'resources/font-bootstrap/bootstrap.mjs'), 'utf8')).toBe(await fs.readFile('scripts/launcher-font-bootstrap.mjs', 'utf8'));
  expect(await fs.readFile(path.join(output, 'resources/xboks-sandbox.sha256'), 'utf8')).toBe(
    `${createHash('sha256').update(binary).digest('hex')}  ${executableName}.bin\n${createHash('sha256').update(helper).digest('hex')}  chrome-sandbox\n`);
  const args = ['--native-helper', 'argument with spaces', "it's quoted", '', '$literal;value'];
  const result = spawnSync(executable, args, { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 10_000 });
  expect(result.error).toBeUndefined(); expect(result.status, result.stderr).toBe(37);
  expect(JSON.parse(result.stdout)).toEqual({ args, pid: result.pid, node: '1' });
  // User launchers and /usr/bin -> alternatives can use different basenames
  // and multiple symlink hops. Native sibling lookup follows the real wrapper.
  const links = path.join(root, 'user bin'); await fs.mkdir(links);
  await fs.symlink(executable, path.join(links, 'alternative target'));
  const alias = path.join(links, 'different-command');
  await fs.symlink('alternative target', alias);
  const linked = spawnSync(alias, args, { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 10_000 });
  expect(linked.error).toBeUndefined(); expect(linked.status, linked.stderr).toBe(37);
  expect(JSON.parse(linked.stdout)).toEqual({ args, pid: linked.pid, node: '1' });
});
it('does not change non-Linux package outputs', async () => {
  const { root, hook } = await fixture();
  const output = path.join(root, 'non-linux'); await fs.mkdir(output);
  await fs.writeFile(path.join(output, 'xboks'), 'unchanged');
  await hook({ electronPlatformName: 'darwin', appOutDir: output });
  expect(await fs.readdir(output)).toEqual(['xboks']);
  expect(await fs.readFile(path.join(output, 'xboks'), 'utf8')).toBe('unchanged');
});
it('rejects an invalid executable name before changing package output', async () => {
  const { root, hook } = await fixture();
  const output = path.join(root, 'invalid'); await fs.mkdir(output);
  for (const executableName of ['', '.', '..', '../outside', '/absolute', 'bad\nname']) await expect(hook({ electronPlatformName: 'linux', appOutDir: output, packager: { executableName } })).rejects.toThrow('Invalid packaged');
  expect(await fs.readdir(output)).toEqual([]);
});
