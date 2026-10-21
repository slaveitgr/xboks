import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { managedPathMigrationActive, managedPaths, migrateManagedPaths, rebaseManagedPath } from './managed-paths.js';

const roots: string[] = [];
async function fixture() {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'xboks-managed-migration-')); roots.push(home);
  const configHome = path.join(home, 'config'); const dataHome = path.join(home, 'data');
  return { home, configHome, dataHome, isActive: async () => false };
}
async function put(file: string, value = 'unchanged') { await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 }); await fs.writeFile(file, value, { mode: 0o600 }); }
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });

describe('managed paths', () => {
  it('uses xboks/engine with absolute XDG roots and ignores relative roots', async () => {
    const options = await fixture(); const paths = managedPaths(options);
    expect(paths).toEqual({ profile: path.join(options.configHome, 'xboks'), dataRoot: path.join(options.dataHome, 'xboks/engine'), runtimeRoot: path.join(options.dataHome, 'xboks/engine/runtimes') });
    expect(managedPaths({ home: options.home, configHome: 'relative', dataHome: 'relative' }).runtimeRoot).toBe(path.join(options.home, '.local/share/xboks/engine/runtimes'));
  });

  it('moves whole owned roots and backend with account, checkpoints and prefixes byte-for-byte; aliases support old absolute paths', async () => {
    const options = await fixture(); const legacy = path.join(options.configHome, 'xodus-nexus'); const data = path.join(options.dataHome, 'xodus-nexus');
    const files = ['launcher-state.json', 'xbox-profile.json', 'download-cleanup.json', 'xodus-backends/current.json', 'xodus-backends/releases/v1/xodus-cli', 'shortcuts/launch-game'];
    for (const file of files) await put(path.join(legacy, file), file + '-bytes');
    for (const file of ['runtimes/current.json', 'compatdata/game/pfx/user.reg', 'prefixes/game/save', 'logs/run.log']) await put(path.join(data, file), file + '-bytes');
    const migration = await migrateManagedPaths(options);
    expect(migration.warnings).toEqual([]); expect(migration.moves).toHaveLength(3); expect(migration.legacyProfiles).toEqual([legacy]);
    expect(await fs.realpath(legacy)).toBe(migration.profile);
    expect(await fs.realpath(data)).toBe(migration.dataRoot);
    expect(await fs.readFile(path.join(migration.profile, 'engine/current.json'), 'utf8')).toBe('xodus-backends/current.json-bytes');
    for (const file of files) expect(await fs.readFile(path.join(legacy, file), 'utf8')).toBe(file + '-bytes');
    expect(await fs.readFile(path.join(migration.dataRoot, 'compatdata/game/pfx/user.reg'), 'utf8')).toBe('compatdata/game/pfx/user.reg-bytes');
    expect(rebaseManagedPath(path.join(legacy, 'xodus-backends/current.json'), migration.moves)).toBe(path.join(migration.profile, 'engine/current.json'));
    const again = await migrateManagedPaths(options);
    expect(again.warnings).toEqual([]); expect(again.profile).toBe(migration.profile); expect(again.moves).toEqual(migration.moves);
  });

  it('does not create empty legacy aliases or game directories on fresh install', async () => {
    const options = await fixture(); const migration = await migrateManagedPaths(options);
    expect(migration.moves).toEqual([]); expect(migration.warnings).toEqual([]);
    await expect(fs.lstat(path.join(options.configHome, 'xodus-nexus'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.lstat(path.join(options.home, 'Games'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('renames only managed runtime release basenames, preserves preview aliases and rebases nested paths', async () => {
    const options = await fixture(); const data = path.join(options.dataHome, 'xodus-nexus');
    await put(path.join(options.configHome, 'xodus-nexus/launcher-state.json'));
    const releases = ['proton-xodus-11.0-fixture', 'xodus-proton-abcdef01', 'xodus-nexus-runtime-0.3.0', 'custom-proton'];
    for (const release of releases) await put(path.join(data, 'runtimes/releases', release, 'bin/wine'), release);
    const migration = await migrateManagedPaths(options);
    expect(migration.warnings).toEqual([]);
    for (const oldName of releases.slice(0, 3)) {
      const canonical = oldName.replace(/^(?:proton-xodus-|xodus-proton-|xodus-nexus-runtime-)/, 'xboks-engine-runtime-');
      const oldWine = path.join(data, 'runtimes/releases', oldName, 'bin/wine');
      expect(await fs.realpath(oldWine)).toBe(path.join(migration.runtimeRoot, 'releases', canonical, 'bin/wine'));
      expect(rebaseManagedPath(oldWine, migration.moves)).toBe(await fs.realpath(oldWine));
      expect(await fs.readFile(oldWine, 'utf8')).toBe(oldName);
    }
    expect((await fs.lstat(path.join(migration.runtimeRoot, 'releases/custom-proton'))).isSymbolicLink()).toBe(false);
  });

  it('canonicalizes only the verified old default profile alias when explicitly invoked by a legacy shortcut', async () => {
    const options = await fixture(); const legacy = path.join(options.configHome, 'xodus-nexus');
    await put(path.join(legacy, 'launcher-state.json'));
    const first = await migrateManagedPaths(options);
    const again = await migrateManagedPaths({ ...options, profile: legacy, explicitProfile: true });
    expect(again.profile).toBe(first.profile); expect(again.legacyProfiles).toEqual([legacy]);
    expect(again.moves).toEqual([{ from: legacy, to: first.profile }]);
  });

  it('preserves both conflicting profiles and uses the existing canonical profile', async () => {
    const options = await fixture(); const oldProfile = path.join(options.configHome, 'xodus-nexus'); const newProfile = path.join(options.configHome, 'xboks');
    await put(path.join(oldProfile, 'launcher-state.json'), 'old-state'); await put(path.join(newProfile, 'launcher-state.json'), 'new-state');
    const migration = await migrateManagedPaths(options);
    expect(migration.profile).toBe(newProfile); expect(migration.warnings.join()).toContain('merging is disabled');
    expect(await fs.readFile(path.join(oldProfile, 'launcher-state.json'), 'utf8')).toBe('old-state');
    expect(await fs.readFile(path.join(newProfile, 'launcher-state.json'), 'utf8')).toBe('new-state');
  });

  it('preserves conflicting data roots and all existing runtime/prefix files', async () => {
    const options = await fixture(); const oldData = path.join(options.dataHome, 'xodus-nexus'); const newData = managedPaths(options).dataRoot;
    await put(path.join(oldData, 'prefixes/game/save'), 'old-save'); await put(path.join(newData, 'prefixes/game/save'), 'new-save');
    const migration = await migrateManagedPaths(options);
    expect(migration.dataRoot).toBe(oldData); expect(migration.runtimeRoot).toBe(path.join(oldData, 'runtimes'));
    expect(await fs.readFile(path.join(oldData, 'prefixes/game/save'), 'utf8')).toBe('old-save'); expect(await fs.readFile(path.join(newData, 'prefixes/game/save'), 'utf8')).toBe('new-save');
  });

  it('preserves explicit custom profiles while renaming their owned backend child', async () => {
    const options = await fixture(); const profile = path.join(options.home, 'custom-profile');
    await put(path.join(profile, 'launcher-state.json')); await put(path.join(profile, 'xodus-backends/current.json'));
    const legacyData = path.join(options.dataHome, 'xodus-nexus'); await put(path.join(legacyData, 'prefixes/save'), 'do-not-move');
    const migration = await migrateManagedPaths({ ...options, profile, explicitProfile: true });
    expect(migration.profile).toBe(profile); expect(migration.legacyProfiles).toEqual([]);
    expect(await fs.realpath(path.join(profile, 'xodus-backends'))).toBe(path.join(profile, 'engine'));
    expect(await fs.readFile(path.join(profile, 'launcher-state.json'), 'utf8')).toBe('unchanged');
    expect((await fs.lstat(legacyData)).isSymbolicLink()).toBe(false);
    expect(await fs.readFile(path.join(legacyData, 'prefixes/save'), 'utf8')).toBe('do-not-move');
  });

  it.each(['legacy', 'canonical', 'custom'])('any active involved profile stops data and backend mutation: %s', async selected => {
    const options = await fixture(); const legacy = path.join(options.configHome, 'xodus-nexus'); const canonical = managedPaths(options).profile; const custom = path.join(options.home, 'custom');
    const active = selected === 'legacy' ? legacy : selected === 'canonical' ? canonical : custom;
    await put(path.join(active, 'xodus-backends/current.json')); await fs.symlink('host-123', path.join(active, 'SingletonLock'));
    const legacyData = path.join(options.dataHome, 'xodus-nexus'); await put(path.join(legacyData, 'prefixes/save'));
    const migration = await migrateManagedPaths({ ...options, ...(selected === 'custom' ? { profile: custom, explicitProfile: true } : {}) });
    expect(migration.moves).toEqual([]); expect(migration.warnings.join()).toContain('instance lock');
    expect((await fs.lstat(legacyData)).isSymbolicLink()).toBe(false);
    expect((await fs.lstat(path.join(active, 'xodus-backends'))).isSymbolicLink()).toBe(false);
  });

  it.each([false, true])('stops startup if compatibility alias publication fails, preserving original data at destination (concurrent source=%s)', async concurrent => {
    const options = await fixture(); const legacy = path.join(options.configHome, 'xodus-nexus'); const canonical = managedPaths(options).profile;
    await put(path.join(legacy, 'launcher-state.json'), 'original-state');
    vi.spyOn(fs, 'symlink').mockImplementationOnce(async () => {
      if (concurrent) await put(path.join(legacy, 'launcher-state.json'), 'concurrent-state');
      throw Object.assign(Error('synthetic alias failure'), { code: 'EACCES' });
    });
    await expect(migrateManagedPaths(options)).rejects.toThrow('Startup stopped to preserve');
    expect(await fs.readFile(path.join(canonical, 'launcher-state.json'), 'utf8')).toBe('original-state');
    if (concurrent) expect(await fs.readFile(path.join(legacy, 'launcher-state.json'), 'utf8')).toBe('concurrent-state');
    else await expect(fs.lstat(legacy)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.lstat(path.join(options.configHome, '.xboks-path-migration.lock'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['world-writable', 'symlink', 'instance-lock'])('fails closed for unsafe or active legacy profiles: %s', async scenario => {
    const options = await fixture(); const legacy = path.join(options.configHome, 'xodus-nexus'); const outside = path.join(options.home, 'outside');
    if (scenario === 'symlink') { await put(path.join(outside, 'launcher-state.json')); await fs.mkdir(options.configHome, { mode: 0o700 }); await fs.symlink(outside, legacy); }
    else { await put(path.join(legacy, 'launcher-state.json')); if (scenario === 'world-writable') await fs.chmod(legacy, 0o777); else await fs.symlink('hostname-123', path.join(legacy, 'SingletonLock')); }
    const migration = await migrateManagedPaths(options);
    expect(migration.profile).toBe(legacy); expect(migration.warnings.length).toBeGreaterThan(0);
    expect(await fs.readFile(path.join(legacy, 'launcher-state.json'), 'utf8')).toBe('unchanged');
    await expect(fs.lstat(managedPaths(options).profile)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not race a concurrent migration or delete its lock', async () => {
    const options = await fixture(); const legacy = path.join(options.configHome, 'xodus-nexus');
    await put(path.join(legacy, 'launcher-state.json')); const lock = path.join(options.configHome, '.xboks-path-migration.lock'); await put(lock, 'other-process');
    await expect(migrateManagedPaths(options)).rejects.toThrow('Managed paths are busy');
    expect(await fs.readFile(lock, 'utf8')).toBe('other-process');
  });

  it('finishes a mixed owned profile with historical 0775 data without changing file inodes or following saved links', async () => {
    const options = await fixture(), paths = managedPaths(options), oldData = path.join(options.dataHome, 'xodus-nexus');
    await put(path.join(paths.profile, 'launcher-state.json'), JSON.stringify({ settings: { runtimeRoot: path.join(oldData, 'runtimes') } }));
    const save = path.join(oldData, 'compatdata/game/pfx/save'); await put(save, 'preserved save');
    await fs.link(save, save + '-hardlink'); await fs.symlink('save', save + '-symlink');
    await fs.chmod(oldData, 0o775); const before = await fs.stat(save);
    const migration = await migrateManagedPaths(options);
    expect(migration.warnings).toEqual([]); expect(migration.dataRoot).toBe(paths.dataRoot);
    expect((await fs.stat(path.join(paths.dataRoot, 'compatdata/game/pfx/save'))).ino).toBe(before.ino);
    expect((await fs.stat(save + '-hardlink')).ino).toBe(before.ino);
    expect(await fs.readlink(save + '-symlink')).toBe('save'); expect(await fs.readFile(save, 'utf8')).toBe('preserved save');
    const again = await migrateManagedPaths(options); expect(again.warnings).toEqual([]); expect(again.moves).toEqual(migration.moves);
  });

  it('does not claim shared data when separate canonical and Nexus profiles still reference it', async () => {
    const options = await fixture(), paths = managedPaths(options), oldData = path.join(options.dataHome, 'xodus-nexus');
    const state = JSON.stringify({ settings: { runtimeRoot: path.join(oldData, 'runtimes') } });
    await put(path.join(paths.profile, 'launcher-state.json'), state);
    await put(path.join(options.configHome, 'xodus-nexus/launcher-state.json'), state);
    await put(path.join(oldData, 'compatdata/game/pfx/save'), 'shared save'); await fs.chmod(oldData, 0o775);
    const migration = await migrateManagedPaths(options);
    expect(migration.moves).toEqual([]); expect(migration.warnings.join()).toContain('exclusive ownership');
    expect((await fs.lstat(oldData)).isSymbolicLink()).toBe(false);
    await expect(fs.lstat(paths.dataRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['unrelated', 'dangling'])('preserves data when the old profile has an %s alias rather than our verified compatibility alias', async kind => {
    const options = await fixture(), paths = managedPaths(options), oldData = path.join(options.dataHome, 'xodus-nexus');
    await put(path.join(paths.profile, 'launcher-state.json'), JSON.stringify({ settings: { runtimeRoot: path.join(oldData, 'runtimes') } }));
    const otherProfile = path.join(options.home, 'separate-nexus-profile');
    if (kind === 'unrelated') await put(path.join(otherProfile, 'launcher-state.json'), 'separate Nexus bytes');
    await fs.symlink(otherProfile, path.join(options.configHome, 'xodus-nexus'));
    await put(path.join(oldData, 'compatdata/game/pfx/save'), 'shared save');
    const migration = await migrateManagedPaths(options);
    expect(migration.moves).toEqual([]); expect(migration.warnings.join()).toContain('exclusive ownership');
    expect(await fs.readlink(path.join(options.configHome, 'xodus-nexus'))).toBe(otherProfile);
    expect(await fs.readFile(path.join(oldData, 'compatdata/game/pfx/save'), 'utf8')).toBe('shared save');
    await expect(fs.lstat(paths.dataRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('retains an opt-in startup lease until the caller has acquired the Chromium singleton, then releases it once', async () => {
    const options = await fixture(), lock = path.join(options.configHome, '.xboks-path-migration.lock');
    const migration = await migrateManagedPaths({ ...options, retainStartupLock: true });
    expect(migration.releaseStartupLock).toBeTypeOf('function');
    await expect(migrateManagedPaths(options)).rejects.toThrow('Managed paths are busy');
    await migration.releaseStartupLock!(); await migration.releaseStartupLock!();
    await expect(fs.lstat(lock)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(migrateManagedPaths(options)).resolves.toMatchObject({ warnings: [] });
  });

  it('releases a retained startup lease when migration fails before returning to its caller', async () => {
    const options = await fixture(); await put(path.join(options.configHome, 'xodus-nexus/launcher-state.json'));
    vi.spyOn(fs, 'symlink').mockRejectedValueOnce(Error('synthetic alias failure'));
    await expect(migrateManagedPaths({ ...options, retainStartupLock: true })).rejects.toThrow('Startup stopped');
    await expect(fs.lstat(path.join(options.configHome, '.xboks-path-migration.lock'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['active', 'unknown'])('defers every data/backend mutation when game/service activity is %s', async state => {
    const options = await fixture(), legacy = path.join(options.configHome, 'xodus-nexus');
    await put(path.join(legacy, 'xodus-backends/current.json')); await put(path.join(options.dataHome, 'xodus-nexus/runtimes/current.json'));
    const isActive = async () => { if (state === 'unknown') throw Error('metadata unavailable'); return true; };
    const migration = await migrateManagedPaths({ ...options, isActive });
    expect(migration.moves).toEqual([]); expect(migration.warnings.join()).toMatch(/active|activity/);
    expect((await fs.lstat(legacy)).isSymbolicLink()).toBe(false);
  });

  it('recognizes only same-user Wine/Xodus process metadata and ignores its own process', async () => {
    const options = await fixture(), proc = path.join(options.home, 'proc');
    await put(path.join(proc, '123/comm'), 'xodus-service\n'); await fs.symlink('/synthetic/xodus-service', path.join(proc, '123/exe'));
    expect(await managedPathMigrationActive(proc, process.getuid?.(), 999)).toBe(true);
    expect(await managedPathMigrationActive(proc, process.getuid?.(), 123)).toBe(false);
    expect(await managedPathMigrationActive(proc, (process.getuid?.() ?? 0) + 1, 999)).toBe(false);
    await fs.writeFile(path.join(proc, '123/comm'), 'unrelated\n'); await fs.unlink(path.join(proc, '123/exe')); await fs.symlink('/synthetic/wine64-preloader', path.join(proc, '123/exe'));
    expect(await managedPathMigrationActive(proc, process.getuid?.(), 999)).toBe(true);
    await fs.writeFile(path.join(proc, '123/comm'), 'xboks-engine-se\n'); await fs.unlink(path.join(proc, '123/exe')); await fs.symlink('/synthetic/xboks-engine-service', path.join(proc, '123/exe'));
    expect(await managedPathMigrationActive(proc, process.getuid?.(), 999)).toBe(true);
    await fs.unlink(path.join(proc, '123/exe')); // comm can be truncated to 15 bytes on Linux.
    expect(await managedPathMigrationActive(proc, process.getuid?.(), 999)).toBe(true);
  });

  it('rebases only exact roots and descendants with a separator', () => {
    expect(rebaseManagedPath('/old/runtimes/wine', [{ from: '/old', to: '/new' }])).toBe('/new/runtimes/wine');
    expect(rebaseManagedPath('/older/custom/wine', [{ from: '/old', to: '/new' }])).toBe('/older/custom/wine');
  });
});
