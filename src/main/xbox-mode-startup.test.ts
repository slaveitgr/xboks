import { afterEach, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { XboxModeStartup } from './xbox-mode-startup';

const directories: string[] = [];
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xboks-mode-startup-'));
  directories.push(root);
  const profile = path.join(root, 'profile'), configRoot = path.join(root, 'config');
  await fs.mkdir(profile, { mode: 0o700 }); await fs.mkdir(configRoot, { mode: 0o700 });
  const executable = path.join(root, 'xboks'); await fs.writeFile(executable, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  let boot = 'boot-before', now = 1_000_000;
  const options = { profile, configRoot, executable, now: () => now, readBootId: async () => boot };
  const startup = new XboxModeStartup(options);
  return { root, profile, configRoot, executable, options, startup, reboot: () => { boot = 'boot-after'; }, advance: (ms: number) => { now += ms; } };
}
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true }))); });

it('status never creates startup files, and rejects development or missing launchers', async () => {
  const f = await fixture();
  expect(await f.startup.status()).toEqual({ available: true });
  expect(await fs.readdir(f.configRoot)).toEqual([]);
  expect(await fs.readdir(f.profile)).toEqual([]);
  expect(await new XboxModeStartup({ ...f.options, enabled: false }).status()).toMatchObject({ available: false, reason: expect.stringContaining('installed') });
  expect(await new XboxModeStartup({ ...f.options, executable: path.join(f.root, 'missing') }).status()).toMatchObject({ available: false });
});
it('publishes a private profile-bound one-shot entry without changing ordinary autostart', async () => {
  const f = await fixture();
  await fs.mkdir(path.join(f.configRoot, 'autostart'), { mode: 0o700 });
  const ordinary = path.join(f.configRoot, 'autostart', 'gr.slave.xboks.desktop');
  await fs.writeFile(ordinary, 'keep existing background preference');
  const transaction = await f.startup.prepare();
  const intent = JSON.parse(await fs.readFile(f.startup.intentPath, 'utf8'));
  expect(intent).toMatchObject({ version: 1, id: transaction.id, profile: f.profile, originBootId: 'boot-before', createdAt: 1_000_000 });
  expect(intent.expiresAt - intent.createdAt).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
  expect((await fs.stat(f.startup.intentPath)).mode & 0o777).toBe(0o600);
  expect((await fs.stat(f.startup.autostartPath)).mode & 0o777).toBe(0o600);
  const entry = await fs.readFile(f.startup.autostartPath, 'utf8');
  expect(entry).toContain(`Exec="${f.executable}" "--xboks-profile" "${f.profile}"`);
  expect(entry).toContain(`X-Xboks-Xbox-Mode-Intent=${transaction.id}`);
  expect(await fs.readFile(ordinary, 'utf8')).toBe('keep existing background preference');
  expect(await f.startup.status()).toMatchObject({ available: false, reason: expect.stringContaining('pending') });
});
it('does not consume a same-boot process restart, then consumes once after an actual boot change', async () => {
  const f = await fixture(); await f.startup.prepare();
  expect(await new XboxModeStartup(f.options).consume()).toBe(false);
  expect(await fs.readFile(f.startup.intentPath, 'utf8')).toContain('boot-before');
  f.reboot();
  // Consumption does not depend on argv, so a service-first primary works too.
  expect(await new XboxModeStartup(f.options).consume()).toBe(true);
  expect(await f.startup.consume()).toBe(false);
  expect(await fs.readdir(path.join(f.configRoot, 'autostart'))).toEqual([]);
  expect(await fs.readdir(f.profile)).toEqual([]);
});
it('rolls back rejected reboot preparation and tolerates a repeated rollback', async () => {
  const f = await fixture(); const transaction = await f.startup.prepare();
  await transaction.rollback(); await transaction.rollback();
  expect(await fs.readdir(f.profile)).toEqual([]);
  expect(await fs.readdir(path.join(f.configRoot, 'autostart'))).toEqual([]);
  expect(await f.startup.status()).toEqual({ available: true });
});
it('preserves an entry modified after preparation instead of deleting another writer’s data', async () => {
  const f = await fixture(); const transaction = await f.startup.prepare();
  await fs.writeFile(f.startup.autostartPath, 'changed by another writer');
  await expect(transaction.rollback()).rejects.toThrow('preserved');
  expect(await fs.readFile(f.startup.autostartPath, 'utf8')).toBe('changed by another writer');
  f.reboot(); await expect(f.startup.consume()).rejects.toThrow('preserved');
});
it('expires and removes an owned intent instead of entering mode after a later unrelated restart', async () => {
  const f = await fixture(); await f.startup.prepare(); f.advance(24 * 60 * 60 * 1000); f.reboot();
  expect(await f.startup.consume()).toBe(false);
  expect(await fs.readdir(f.profile)).toEqual([]);
  expect(await fs.readdir(path.join(f.configRoot, 'autostart'))).toEqual([]);
});
it('separates profiles and refuses a conflicting existing entry', async () => {
  const f = await fixture(); const other = path.join(f.root, 'other-profile'); await fs.mkdir(other, { mode: 0o700 });
  const second = new XboxModeStartup({ ...f.options, profile: other });
  expect(second.autostartName).not.toBe(f.startup.autostartName);
  await fs.mkdir(path.join(f.configRoot, 'autostart'), { mode: 0o700 });
  await fs.writeFile(f.startup.autostartPath, 'foreign entry', { mode: 0o600 });
  await expect(f.startup.prepare()).rejects.toThrow('preserved');
  expect(await fs.readFile(f.startup.autostartPath, 'utf8')).toBe('foreign entry');
  expect(await fs.readdir(f.profile)).toEqual([]);
  expect(await second.status()).toEqual({ available: true });
});
it('rejects symlink files and directories without touching their targets', async () => {
  const f = await fixture(); const target = path.join(f.root, 'target'); await fs.writeFile(target, 'keep');
  await fs.symlink(target, f.startup.intentPath);
  expect(await f.startup.status()).toMatchObject({ available: false });
  await expect(f.startup.prepare()).rejects.toThrow('unsafe');
  expect(await fs.readFile(target, 'utf8')).toBe('keep');
  await fs.unlink(f.startup.intentPath);
  await fs.rmdir(path.join(f.configRoot, 'autostart'));
  const outside = path.join(f.root, 'outside'); await fs.mkdir(outside, { mode: 0o700 });
  await fs.symlink(outside, path.join(f.configRoot, 'autostart'));
  expect(await f.startup.status()).toMatchObject({ available: false });
  await expect(f.startup.prepare()).rejects.toThrow();
  expect(await fs.readdir(outside)).toEqual([]);
});
it('uses exclusive publication when two preparations race for the same profile', async () => {
  const f = await fixture();
  const results = await Promise.allSettled([f.startup.prepare(), new XboxModeStartup(f.options).prepare()]);
  const successes = results.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<XboxModeStartup['prepare']>>> => result.status === 'fulfilled');
  expect(successes).toHaveLength(1);
  expect(JSON.parse(await fs.readFile(f.startup.intentPath, 'utf8')).id).toBe(successes[0].value.id);
  expect(await fs.readFile(f.startup.autostartPath, 'utf8')).toContain(successes[0].value.id);
  await successes[0].value.rollback();
  expect(await fs.readdir(f.profile)).toEqual([]);
});
it('removes its journal when a conflicting entry appears during preparation', async () => {
  const f = await fixture(); let probes = 0;
  const startup = new XboxModeStartup({ ...f.options, readBootId: async () => {
    if (++probes === 2) await fs.writeFile(f.startup.autostartPath, 'concurrent entry', { mode: 0o600 });
    return 'boot-before';
  } });
  await expect(startup.prepare()).rejects.toMatchObject({ code: 'EEXIST' });
  expect(await fs.readdir(f.profile)).toEqual([]);
  expect(await fs.readFile(f.startup.autostartPath, 'utf8')).toBe('concurrent entry');
});
it('cleans an interrupted consumption without retrying mode entry', async () => {
  const f = await fixture(); await f.startup.prepare(); f.reboot();
  const claim = path.join(f.profile, 'xbox-mode-startup.consuming.json');
  await fs.copyFile(f.startup.intentPath, claim);
  expect(await f.startup.consume()).toBe(false);
  expect(await fs.readdir(f.profile)).toEqual([]);
  expect(await fs.readdir(path.join(f.configRoot, 'autostart'))).toEqual([]);
  await f.startup.prepare();
  await fs.rename(f.startup.intentPath, claim);
  expect(await f.startup.consume()).toBe(false);
  expect(await fs.readdir(f.profile)).toEqual([]);
});
it('only grants one consumption when startup callers race', async () => {
  const f = await fixture(); await f.startup.prepare(); f.reboot();
  const results = await Promise.allSettled([f.startup.consume(), new XboxModeStartup(f.options).consume()]);
  expect(results.filter(result => result.status === 'fulfilled' && result.value === true)).toHaveLength(1);
  expect(await f.startup.consume()).toBe(false);
});
it('preserves the supplied persistent wrapper path and safely quotes its desktop entry', async () => {
  const f = await fixture();
  const wrapper = path.join(f.root, 'My 100% $xboks wrapper');
  await fs.symlink(f.executable, wrapper);
  const startup = new XboxModeStartup({ ...f.options, executable: wrapper });
  expect(await startup.status()).toEqual({ available: true });
  const transaction = await startup.prepare();
  expect(await fs.readFile(startup.autostartPath, 'utf8')).toContain('My 100%% \\$xboks wrapper');
  await transaction.rollback();
});
it('rejects group-writable executables, unsafe directories and temporary AppImage mounts', async () => {
  const f = await fixture();
  await fs.chmod(f.executable, 0o770);
  expect(await f.startup.status()).toMatchObject({ available: false });
  await fs.chmod(f.executable, 0o700); await fs.chmod(f.profile, 0o777);
  expect(await f.startup.status()).toMatchObject({ available: false });
  expect(await new XboxModeStartup({ ...f.options, executable: '/tmp/.mount_xboks123/xboks' }).status()).toMatchObject({ available: false, reason: expect.stringContaining('temporary') });
});
it('supports owner group-write behind a private configuration root without chmod', async () => {
  const f = await fixture(); const autostart = path.join(f.configRoot, 'autostart');
  await fs.mkdir(autostart); await fs.chmod(autostart, 0o775);
  expect(await f.startup.status()).toEqual({ available: true });
  const transaction = await f.startup.prepare();
  expect((await fs.stat(f.configRoot)).mode & 0o777).toBe(0o700);
  expect((await fs.stat(autostart)).mode & 0o777).toBe(0o775);
  await transaction.rollback();
  expect((await fs.stat(autostart)).mode & 0o777).toBe(0o775);
});
it('rejects group-write without a private root and rejects world-write even behind one', async () => {
  const f = await fixture(); const autostart = path.join(f.configRoot, 'autostart');
  await fs.mkdir(autostart); await fs.chmod(autostart, 0o775); await fs.chmod(f.configRoot, 0o755);
  expect(await f.startup.status()).toMatchObject({ available: false, reason: expect.stringContaining('directories') });
  await expect(f.startup.prepare()).rejects.toThrow('directories');
  expect(await fs.readdir(f.profile)).toEqual([]);
  await fs.chmod(f.configRoot, 0o700); await fs.chmod(autostart, 0o777);
  expect(await f.startup.status()).toMatchObject({ available: false, reason: expect.stringContaining('directories') });
});
it('keeps ownership mandatory even when the configuration root is private', async () => {
  const f = await fixture();
  const startup = new XboxModeStartup({ ...f.options, executable: '/usr/bin/true', uid: (process.getuid?.() ?? 1000) + 1 });
  expect(await startup.status()).toMatchObject({ available: false, reason: expect.stringContaining('directories') });
  await expect(startup.prepare()).rejects.toThrow('directories');
  expect(await fs.readdir(f.configRoot)).toEqual([]);
  expect(await fs.readdir(f.profile)).toEqual([]);
});
it('rejects a writable ancestor before the owned private boundary', async () => {
  const f = await fixture(); await fs.chmod(f.root, 0o775);
  expect(await f.startup.status()).toMatchObject({ available: false, reason: expect.stringContaining('ancestor') });
  await expect(f.startup.prepare()).rejects.toThrow('ancestor');
  expect(await fs.readdir(f.configRoot)).toEqual([]);
});
