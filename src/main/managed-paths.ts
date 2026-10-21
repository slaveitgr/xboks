import { promises as fs, type Stats } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface ManagedPathMove { from: string; to: string }
export interface ManagedPathOptions {
  home?: string;
  configHome?: string;
  dataHome?: string;
  profile?: string;
  explicitProfile?: boolean;
}
export interface ManagedPathMigration {
  profile: string;
  dataRoot: string;
  runtimeRoot: string;
  legacyProfiles: string[];
  moves: ManagedPathMove[];
  warnings: string[];
}

/** Relative XDG values are invalid. Explicit options make migrations testable
 * without reading or moving the real user's profile. */
export function managedPaths(options: ManagedPathOptions = {}): Pick<ManagedPathMigration, 'profile' | 'dataRoot' | 'runtimeRoot'> {
  const home = options.home ?? os.homedir();
  const config = options.configHome ?? process.env.XDG_CONFIG_HOME;
  const data = options.dataHome ?? process.env.XDG_DATA_HOME;
  const configHome = config && path.isAbsolute(config) ? config : path.join(home, '.config');
  const dataHome = data && path.isAbsolute(data) ? data : path.join(home, '.local', 'share');
  const dataRoot = path.join(dataHome, 'xboks', 'engine');
  return { profile: options.profile ?? path.join(configHome, 'xboks'), dataRoot, runtimeRoot: path.join(dataRoot, 'runtimes') };
}

const absent = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
async function statOrNull(file: string) { try { return await fs.lstat(file); } catch (error) { if (absent(error)) return null; throw error; } }
function ownedDirectory(stat: Stats): boolean {
  return stat.isDirectory() && !stat.isSymbolicLink() && (process.getuid === undefined || stat.uid === process.getuid()) && !(stat.mode & 0o022);
}

/** Apply validated moves in order, including nested moves. Boundary checks
 * deliberately preserve similar-looking custom paths. */
export function rebaseManagedPath(value: string, moves: readonly ManagedPathMove[]): string {
  return moves.reduce((current, move) => current === move.from ? move.to
    : current.startsWith(move.from + path.sep) ? move.to + current.slice(move.from.length) : current, value);
}

/** Archive names and runtime metadata remain protocol inputs; only our local
 * release directory names change. Preview/base aliases continue to resolve. */
export function engineRuntimeDirectory(name: string): string {
  return name.replace(/^(?:proton-xodus-|xodus-proton-|xodus-nexus-runtime-)/, 'xboks-engine-runtime-');
}

/** Move only known app-owned roots. Never merge, copy across filesystems,
 * replace an existing destination, or rewrite credentials/pointers. Legacy
 * aliases preserve absolute Wine paths and pre-existing launcher shortcuts. */
export async function migrateManagedPaths(options: ManagedPathOptions = {}): Promise<ManagedPathMigration> {
  const defaults = managedPaths({ ...options, profile: undefined });
  const result: ManagedPathMigration = { ...managedPaths(options), legacyProfiles: [], moves: [], warnings: [] };
  const legacyProfile = path.join(path.dirname(defaults.profile), 'xodus-nexus');
  const legacyData = path.join(path.dirname(path.dirname(defaults.dataRoot)), 'xodus-nexus');
  // A pre-existing shortcut can explicitly name the compatibility alias. Treat
  // only that verified default alias as the same canonical app profile.
  if (options.profile && path.resolve(options.profile) === legacyProfile) {
    const legacyStat = await statOrNull(legacyProfile); const canonicalStat = await statOrNull(defaults.profile);
    if (legacyStat?.isSymbolicLink() && canonicalStat && ownedDirectory(canonicalStat) && await fs.realpath(legacyProfile).catch(() => '') === defaults.profile) {
      result.profile = defaults.profile; result.legacyProfiles.push(legacyProfile);
      result.moves.push({ from: legacyProfile, to: defaults.profile });
    }
  }
  const keepLegacy = async () => {
    if (!options.explicitProfile && !await statOrNull(defaults.profile) && await statOrNull(legacyProfile)) result.profile = await fs.realpath(legacyProfile).catch(() => legacyProfile);
    if (!options.explicitProfile && await statOrNull(legacyData)) result.dataRoot = await fs.realpath(legacyData).catch(() => legacyData);
    result.runtimeRoot = path.join(result.dataRoot, 'runtimes');
  };
  // An explicit custom --profile remains a custom profile, even if its spelling
  // resembles an old default. Only children managed by us may be renamed there.
  const move = async (from: string, to: string, profile = false): Promise<string> => {
    if (from === to) return to;
    let renamed = false;
    try {
      const source = await statOrNull(from);
      if (!source) return to;
      if (source.isSymbolicLink()) {
        if (await fs.realpath(from) === await fs.realpath(to)) {
          if (!ownedDirectory(await fs.lstat(to))) throw Error('the migrated destination is not safely owned by this user');
          result.moves.push({ from, to });
          return to;
        }
        throw Error('the legacy path is an unrelated symbolic link');
      }
      if (!ownedDirectory(source)) throw Error('the legacy directory is not safely owned by this user');
      if (profile && await statOrNull(path.join(from, 'SingletonLock'))) throw Error('the legacy profile has a Chromium instance lock');
      if (await statOrNull(to)) throw Error('both legacy and new directories exist; automatic merging is disabled');
      await fs.mkdir(path.dirname(to), { recursive: true, mode: 0o700 });
      // A managed parent may not redirect writes to an unrelated location.
      if (!ownedDirectory(await fs.lstat(path.dirname(to)))) throw Error('the destination parent is not safely owned by this user');
      await fs.rename(from, to);
      renamed = true;
      try { await fs.symlink(to, from, 'dir'); }
      catch (error) {
        // The original data remains safely at `to`. Stop startup instead of
        // selecting a concurrent creator at `from` or risking a clobber rollback.
        throw error;
      }
      result.moves.push({ from, to });
      return to;
    } catch (error) {
      if (renamed) throw Error(`Managed directory moved to ${to}, but its compatibility alias could not be created. Startup stopped to preserve the original state: ${(error as Error).message}`);
      result.warnings.push(`Managed path migration kept ${from}: ${(error as Error).message}`);
      if (profile) {
        const destination = await statOrNull(to);
        if (destination && ownedDirectory(destination)) return to;
      }
      return from;
    }
  };

  // This lock is separate from Electron's instance lock and serializes moves
  // across old/new default profile names. A stale lock fails conservatively.
  const lock = path.join(options.explicitProfile ? result.profile : path.dirname(defaults.profile), '.xboks-path-migration.lock');
  let lockHandle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    await fs.mkdir(path.dirname(lock), { recursive: true, mode: 0o700 });
    if (!ownedDirectory(await fs.lstat(path.dirname(lock)))) throw Error('Migration lock parent is not safely owned by this user');
    lockHandle = await fs.open(lock, 'wx', 0o600);
  } catch (error) {
    result.warnings.push(`Managed paths were not moved: ${(error as Error).message}`);
    await keepLegacy();
    return result;
  }
  try {
    if ((!options.explicitProfile && await statOrNull(path.join(legacyProfile, 'SingletonLock'))) || await statOrNull(path.join(result.profile, 'SingletonLock'))) {
      result.warnings.push('Managed paths were not moved because a profile has a Chromium instance lock.');
      await keepLegacy();
      return result;
    }
    if (!options.explicitProfile && (!options.profile || path.resolve(options.profile) === defaults.profile || path.resolve(options.profile) === legacyProfile)) {
      result.profile = await move(legacyProfile, defaults.profile, true);
      if (result.profile === defaults.profile && result.moves.some(entry => entry.from === legacyProfile) && !result.legacyProfiles.includes(legacyProfile)) result.legacyProfiles.push(legacyProfile);
    }
    if (!options.explicitProfile) result.dataRoot = await move(legacyData, defaults.dataRoot);
    result.runtimeRoot = path.join(result.dataRoot, 'runtimes');
    if (!options.explicitProfile && result.dataRoot === defaults.dataRoot) {
      const releases = path.join(result.runtimeRoot, 'releases'); const releasesStat = await statOrNull(releases);
      if (releasesStat && ownedDirectory(releasesStat)) {
        const names = await fs.readdir(releases);
        if (names.length > 2_000) result.warnings.push('Runtime release migration deferred because the managed release directory has more than 2000 entries.');
        else for (const name of names.sort()) {
          const canonical = engineRuntimeDirectory(name);
          if (canonical !== name && /^[A-Za-z0-9._-]+$/.test(name)) await move(path.join(releases, name), path.join(releases, canonical));
        }
      }
    }
    const profileStat = await statOrNull(result.profile);
    if (profileStat && ownedDirectory(profileStat)) await move(path.join(result.profile, 'xodus-backends'), path.join(result.profile, 'engine'));
  } finally {
    await lockHandle.close();
    await fs.unlink(lock);
  }
  return result;
}
