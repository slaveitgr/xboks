import { promises as fs, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import * as childProcess from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { managedPaths, migrateManagedPaths } from './managed-paths.js';
import { planManagedDataCopy } from './managed-data-copy.js';

vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFileSync: vi.fn(actual.execFileSync) };
});

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function put(file: string, value: string | Buffer, mode = 0o600) { await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 }); await fs.writeFile(file, value, { mode }); }
async function fixture() {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'xboks-offline-copy-')); roots.push(home);
  const options = { home, configHome: path.join(home, 'config'), dataHome: path.join(home, 'data'), isActive: async () => false };
  const canonical = managedPaths(options), legacyProfile = path.join(options.configHome, 'xodus-nexus'), legacyData = path.join(options.dataHome, 'xodus-nexus');
  const release = path.join(legacyData, 'runtimes/releases/xodus-nexus-runtime-fixture'), wine = path.join(release, 'files/bin/wine');
  await put(wine, 'synthetic Wine loader', 0o755); await put(path.join(release, 'files/lib/runtime.dll'), 'runtime DLL');
  await fs.link(wine, path.join(release, 'files/bin/wine-hardlink'));
  const gamePath = path.join(home, 'installed-game'), prefix = path.join(legacyData, 'compatdata/game-a');
  const hash = createHash('sha256').update(gamePath).digest('hex').slice(0, 16);
  await put(path.join(prefix, 'pfx/user.reg'), 'private synthetic registry');
  await put(path.join(prefix, 'pfx/save.dat'), 'private synthetic save');
  await fs.link(path.join(prefix, 'pfx/save.dat'), path.join(prefix, 'pfx/save-hardlink.dat'));
  await fs.symlink('pfx/save.dat', path.join(prefix, 'relative-save'));
  await fs.symlink(path.join(release, 'files/lib/runtime.dll'), path.join(prefix, 'runtime-link'));
  const outside = path.join(home, 'outside'); await put(path.join(outside, 'document'), 'external document unchanged');
  await fs.symlink(outside, path.join(prefix, 'external-link'));
  await fs.symlink(path.relative(path.join(prefix, 'pfx'), outside), path.join(prefix, 'pfx/external-relative'));
  await put(path.join(legacyData, 'compatdata', hash, 'pfx/hash-save'), 'old path-hash prefix');
  await put(path.join(legacyData, 'compatdata/nexus-only/pfx/save'), 'other profile save');
  await put(path.join(legacyData, 'runtimes/releases/xodus-nexus-runtime-other/files/bin/wine'), 'other runtime');
  await put(path.join(legacyProfile, 'launcher-state.json'), 'separate Nexus profile bytes');
  const pointer = { name: 'xodus-nexus-runtime-fixture', winePath: wine, commit: 'a'.repeat(40), installedAt: '2026-01-01T00:00:00Z' };
  const pointerFile = path.join(legacyData, 'runtimes/current.json'); await put(pointerFile, JSON.stringify(pointer));
  const state = { settings: { runtimeRoot: path.join(legacyData, 'runtimes'), winePath: wine, externalXodusRoot: '/mnt/custom-backend', market: 'US' },
    games: [{ id: 'game-a', path: gamePath }], downloads: [{ id: 'queued', status: 'paused', destination: '/mnt/custom-download' }], retained: 'unchanged' };
  const stateFile = path.join(canonical.profile, 'launcher-state.json'), bytes = JSON.stringify(state); await put(stateFile, bytes);
  await fs.chmod(legacyData, 0o775); await fs.chmod(prefix, 0o775);
  return { options, canonical, legacyProfile, legacyData, release, prefix, wine, hash, pointer, pointerFile, state, stateFile, bytes, outside };
}

describe('explicit offline shared-data copy', () => {
  it('plans counts and space without creating the target or changing either profile/source', async () => {
    const f = await fixture(), plan = await planManagedDataCopy({ ...f.options, isActive: async () => true });
    expect(plan.summary).toMatchObject({ alreadyMigrated: false, prefixes: 2, symlinks: 4 });
    expect(plan.summary.runtimeBytes).toBeGreaterThan(0); expect(plan.summary.prefixBytes).toBeGreaterThan(0);
    expect(plan.summary.requiredBytes).toBeGreaterThan(plan.summary.runtimeBytes + plan.summary.prefixBytes);
    expect(JSON.stringify(plan)).not.toContain('private synthetic');
    await expect(fs.lstat(f.canonical.dataRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(f.stateFile, 'utf8')).toBe(f.bytes);
  });
  it('copies only the selected release/own IDs and hashes; preserves saves, internal hardlinks and separate Nexus bytes', async () => {
    const f = await fixture(), plan = await planManagedDataCopy(f.options);
    const sourceInode = await fs.stat(path.join(f.prefix, 'pfx/save.dat'));
    await plan.apply(); const state = JSON.parse(await fs.readFile(f.stateFile, 'utf8'));
    const selectedWine = path.join(f.canonical.runtimeRoot, 'releases/xboks-engine-runtime-fixture/files/bin/wine');
    expect(state).toEqual({ ...f.state, settings: { ...f.state.settings, runtimeRoot: f.canonical.runtimeRoot, winePath: selectedWine } });
    expect(JSON.parse(await fs.readFile(path.join(f.canonical.runtimeRoot, 'current.json'), 'utf8'))).toEqual({ ...f.pointer, winePath: selectedWine });
    expect(await fs.readFile(path.join(f.canonical.dataRoot, 'compatdata/game-a/pfx/save.dat'), 'utf8')).toBe('private synthetic save');
    expect(await fs.readFile(path.join(f.canonical.dataRoot, 'compatdata', f.hash, 'pfx/hash-save'), 'utf8')).toBe('old path-hash prefix');
    const copied = await fs.stat(path.join(f.canonical.dataRoot, 'compatdata/game-a/pfx/save.dat'));
    expect(copied.ino).not.toBe(sourceInode.ino);
    expect((await fs.stat(path.join(f.canonical.dataRoot, 'compatdata/game-a/pfx/save-hardlink.dat'))).ino).toBe(copied.ino);
    expect((await fs.stat(selectedWine)).ino).not.toBe((await fs.stat(f.wine)).ino);
    expect((await fs.stat(selectedWine + '-hardlink')).ino).toBe((await fs.stat(selectedWine)).ino);
    await expect(fs.lstat(path.join(f.canonical.dataRoot, 'compatdata/nexus-only'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.lstat(path.join(f.canonical.runtimeRoot, 'releases/xodus-nexus-runtime-other'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(path.join(f.legacyProfile, 'launcher-state.json'), 'utf8')).toBe('separate Nexus profile bytes');
    expect(await fs.readFile(f.pointerFile, 'utf8')).toBe(JSON.stringify(f.pointer));
    expect((await fs.stat(path.join(f.prefix, 'pfx/save.dat'))).ino).toBe(sourceInode.ino);
    expect(await fs.readFile(path.join(f.prefix, 'pfx/save.dat'), 'utf8')).toBe('private synthetic save');
    const backup = (await fs.readdir(f.canonical.profile)).find(name => name.startsWith('launcher-state.json.before-engine-copy-'))!;
    expect(await fs.readFile(path.join(f.canonical.profile, backup), 'utf8')).toBe(f.bytes);
    expect((await fs.stat(path.join(f.canonical.profile, backup))).mode & 0o777).toBe(0o600);
    expect((await plan.apply()).alreadyMigrated).toBe(true);
    const again = await planManagedDataCopy(f.options); expect(again.summary.alreadyMigrated).toBe(true); await again.apply();
  });
  it('rebases selected internal links and preserves external endpoints without traversing them', async () => {
    const f = await fixture(); await (await planManagedDataCopy(f.options)).apply();
    const prefix = path.join(f.canonical.dataRoot, 'compatdata/game-a');
    expect(await fs.readFile(path.join(prefix, 'relative-save'), 'utf8')).toBe('private synthetic save');
    expect(await fs.readlink(path.join(prefix, 'runtime-link'))).toBe(path.join(f.canonical.runtimeRoot, 'releases/xboks-engine-runtime-fixture/files/lib/runtime.dll'));
    expect(await fs.readlink(path.join(prefix, 'external-link'))).toBe(f.outside);
    expect(await fs.readlink(path.join(prefix, 'pfx/external-relative'))).toBe(f.outside);
    expect(await fs.readFile(path.join(f.outside, 'document'), 'utf8')).toBe('external document unchanged');
    expect((await fs.lstat(path.join(prefix, 'external-link'))).isSymbolicLink()).toBe(true);
  });
  it.each(['activity', 'canonical-lock', 'legacy-lock', 'space'])('refuses %s before publishing data or changing profile bytes', async scenario => {
    const f = await fixture();
    const options = { ...f.options, ...(scenario === 'activity' ? { isActive: async () => true } : {}), ...(scenario === 'space' ? { availableBytes: async () => 0 } : {}) };
    const plan = await planManagedDataCopy(options);
    if (scenario.endsWith('-lock')) await fs.symlink('synthetic-host-123', path.join(scenario === 'canonical-lock' ? f.canonical.profile : f.legacyProfile, 'SingletonLock'));
    await expect(plan.apply()).rejects.toThrow(/Stop|Close|free space/);
    expect(await fs.readFile(f.stateFile, 'utf8')).toBe(f.bytes);
    await expect(fs.lstat(f.canonical.dataRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it.each(['source', 'state', 'pointer'])('fails closed if %s changes after inspection', async changed => {
    const f = await fixture(), plan = await planManagedDataCopy(f.options);
    const file = changed === 'source' ? path.join(f.prefix, 'pfx/save.dat') : changed === 'state' ? f.stateFile : f.pointerFile;
    await fs.writeFile(file, changed === 'state' ? JSON.stringify({ ...f.state, retained: 'new profile state' }) : 'changed after inspection');
    await expect(plan.apply()).rejects.toThrow(/changed/);
    if (changed !== 'state') expect(await fs.readFile(f.stateFile, 'utf8')).toBe(f.bytes);
    await expect(fs.lstat(f.canonical.dataRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('preserves a target that appears while copying and leaves the original profile selection unchanged', async () => {
    const f = await fixture(), plan = await planManagedDataCopy(f.options), copy = fs.copyFile.bind(fs);
    vi.spyOn(fs, 'copyFile').mockImplementationOnce(async (...args) => { await copy(...args); await put(path.join(f.canonical.dataRoot, 'foreign'), 'concurrent creator'); });
    await expect(plan.apply()).rejects.toThrow('appeared while copying');
    expect(await fs.readFile(path.join(f.canonical.dataRoot, 'foreign'), 'utf8')).toBe('concurrent creator');
    expect(await fs.readFile(f.stateFile, 'utf8')).toBe(f.bytes);
  });
  it.each(['directory', 'file', 'symlink'])('never replaces a concurrent %s published at the final native rename boundary', async kind => {
    const f = await fixture(), plan = await planManagedDataCopy(f.options);
    const native = (await vi.importActual<typeof import('node:child_process')>('node:child_process')).execFileSync;
    vi.mocked(childProcess.execFileSync).mockImplementationOnce(((...args: Parameters<typeof native>) => {
      if (kind === 'directory') mkdirSync(f.canonical.dataRoot);
      else if (kind === 'file') writeFileSync(f.canonical.dataRoot, 'concurrent creator');
      else symlinkSync(f.outside, f.canonical.dataRoot);
      return native(...args);
    }) as typeof native);
    await expect(plan.apply()).rejects.toThrow('without replacing');
    const final = await fs.lstat(f.canonical.dataRoot);
    if (kind === 'directory') { expect(final.isDirectory()).toBe(true); expect(await fs.readdir(f.canonical.dataRoot)).toEqual([]); }
    else if (kind === 'file') expect(await fs.readFile(f.canonical.dataRoot, 'utf8')).toBe('concurrent creator');
    else expect(await fs.readlink(f.canonical.dataRoot)).toBe(f.outside);
    expect(await fs.readFile(f.stateFile, 'utf8')).toBe(f.bytes);
    expect(await fs.readFile(path.join(f.prefix, 'pfx/save.dat'), 'utf8')).toBe('private synthetic save');
    expect(await fs.readFile(path.join(f.outside, 'document'), 'utf8')).toBe('external document unchanged');
  });
  it('refuses cooperating launcher startup while an offline copy is at the final profile commit', async () => {
    const f = await fixture(), plan = await planManagedDataCopy(f.options), rename = fs.rename.bind(fs); let blocked = false;
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (to === f.stateFile) {
        await expect(migrateManagedPaths({ ...f.options, retainStartupLock: true })).rejects.toThrow('Managed paths are busy');
        blocked = true;
      }
      await rename(from, to);
    });
    await plan.apply(); expect(blocked).toBe(true);
  });
  it('refuses copying while a launcher retains the migration-to-Chromium startup lease', async () => {
    const f = await fixture(), plan = await planManagedDataCopy(f.options);
    const startup = await migrateManagedPaths({ ...f.options, retainStartupLock: true });
    try {
      await expect(plan.apply()).rejects.toMatchObject({ code: 'EEXIST' });
      expect(await fs.readFile(f.stateFile, 'utf8')).toBe(f.bytes);
      await expect(fs.lstat(f.canonical.dataRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally { await startup.releaseStartupLock!(); }
    await plan.apply();
  });
  it('retains independent published data and exact backup for recovery if the profile commit fails', async () => {
    const f = await fixture(), plan = await planManagedDataCopy(f.options), rename = fs.rename.bind(fs);
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => { if (to === f.stateFile) throw Error('synthetic profile write failure'); await rename(from, to); });
    await expect(plan.apply()).rejects.toThrow('preserved in the canonical root for recovery');
    expect(await fs.readFile(f.stateFile, 'utf8')).toBe(f.bytes);
    expect(await fs.readFile(path.join(f.canonical.dataRoot, 'compatdata/game-a/pfx/save.dat'), 'utf8')).toBe('private synthetic save');
    expect(await fs.readFile(path.join(f.prefix, 'pfx/save.dat'), 'utf8')).toBe('private synthetic save');
  });
  it.each(['custom-runtime', 'custom-profile', 'root-link', 'prefix-link', 'mismatched-pointer', 'unsafe-file'])('rejects %s without claiming unrelated data', async scenario => {
    const f = await fixture(); let options = f.options;
    if (scenario === 'custom-runtime') await fs.writeFile(f.stateFile, JSON.stringify({ ...f.state, settings: { ...f.state.settings, runtimeRoot: '/mnt/custom-runtime' } }));
    if (scenario === 'custom-profile') options = { ...f.options, profile: f.legacyProfile } as typeof options;
    if (scenario === 'root-link') { await fs.rename(f.release, f.release + '-outside'); await fs.symlink(f.release + '-outside', f.release); }
    if (scenario === 'prefix-link') { await fs.rename(f.prefix, f.prefix + '-outside'); await fs.symlink(f.prefix + '-outside', f.prefix); }
    if (scenario === 'mismatched-pointer') await fs.writeFile(f.pointerFile, JSON.stringify({ ...f.pointer, winePath: path.join(f.legacyData, 'runtimes/releases/xodus-nexus-runtime-other/files/bin/wine') }));
    if (scenario === 'unsafe-file') await fs.chmod(path.join(f.prefix, 'pfx/save.dat'), 0o666);
    await expect(planManagedDataCopy(options)).rejects.toThrow();
    await expect(fs.lstat(f.canonical.dataRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
