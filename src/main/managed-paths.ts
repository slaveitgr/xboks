import { promises as fs, type Stats } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { externalLauncherEnvironment } from './launcher-environment.js';

export interface ManagedPathMove { from: string; to: string }
export interface ManagedPathOptions {
  home?: string;
  configHome?: string;
  dataHome?: string;
  profile?: string;
  explicitProfile?: boolean;
  isActive?: () => boolean | Promise<boolean>;
  /** Main startup holds this lease until Electron has acquired its own lock. */
  retainStartupLock?: boolean;
}
export interface ManagedPathMigration {
  profile: string;
  dataRoot: string;
  runtimeRoot: string;
  legacyProfiles: string[];
  moves: ManagedPathMove[];
  warnings: string[];
  releaseStartupLock?: () => Promise<void>;
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
/** Historical managed data used the desktop umask (commonly 0775). Atomic
 * rename preserves its inodes without granting permissions or copying through
 * links. Profiles and migration lock parents still require private ownership. */
function ownedDataDirectory(stat: Stats): boolean {
  return stat.isDirectory() && !stat.isSymbolicLink() && (process.getuid === undefined || stat.uid === process.getuid()) && !(stat.mode & 0o002);
}

/** Metadata only: never read process arguments, environments or credentials.
 * Conservatively defer while any same-user Wine/game or Xodus service exists. */
export async function managedPathMigrationActive(procRoot = '/proc', uid = process.getuid?.(), ownPid = process.pid): Promise<boolean> {
  if (process.platform !== 'linux') return true;
  if (uid === undefined) throw Error('The current process owner could not be verified.');
  for (const name of await fs.readdir(procRoot)) {
    if (!/^\d+$/.test(name) || Number(name) === ownPid) continue;
    const directory = path.join(procRoot, name);
    try {
      if ((await fs.stat(directory)).uid !== uid) continue;
      const comm = (await fs.readFile(path.join(directory, 'comm'), 'utf8')).trim();
      const executable = path.basename(await fs.readlink(path.join(directory, 'exe')).catch(() => ''));
      if ([comm, executable].some(value => /^(?:xodus-cli|xodus-service|xboks-engine-(?:backend|service|ba|se)|proton|wineserver(?:64)?|wine(?:64)?(?:-preloader)?)$|\.exe$/i.test(value))) return true;
    } catch (error) { if (!absent(error) && (error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
  }
  return false;
}

async function configuredRuntimeRoot(profile: string): Promise<string | undefined> {
  const file = path.join(profile, 'launcher-state.json'), stat = await statOrNull(file);
  if (!stat || !stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 32 * 1024 * 1024 ||
      stat.uid !== process.getuid?.() || stat.mode & 0o022) return;
  try {
    const value = JSON.parse(await fs.readFile(file, 'utf8')) as { settings?: { runtimeRoot?: unknown } };
    return typeof value.settings?.runtimeRoot === 'string' ? value.settings.runtimeRoot : undefined;
  } catch { return undefined; }
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

/** Linux atomic no-replace rename. No rename(), mv or copy fallback is safe
 * when a concurrent creator appears after an ownership/destination check. */
export function renameManagedDirectoryNoReplace(source: string, destination: string): void {
  const script = `import ctypes, os, sys
libc = ctypes.CDLL(None, use_errno=True)
rename = libc.renameat2
rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
rename.restype = ctypes.c_int
if rename(-100, os.fsencode(sys.argv[1]), -100, os.fsencode(sys.argv[2]), 1) != 0:
    raise OSError(ctypes.get_errno(), 'Atomic no-replace publication failed')
`;
  const environment = externalLauncherEnvironment(process.env);
  delete environment.LD_LIBRARY_PATH; delete environment.LD_PRELOAD;
  try {
    // -I excludes user modules/PYTHON* variables. Paths are separate argv;
    // neither a shell nor untrusted executable discovery is involved.
    execFileSync('/usr/bin/python3', ['-I', '-c', script, source, destination], {
      env: environment, stdio: 'pipe', timeout: 10_000, maxBuffer: 4096,
    });
  } catch { throw Error('The managed directory could not be published without replacing an existing path.'); }
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
    const owned = profile ? ownedDirectory : ownedDataDirectory;
    if (from === to) return to;
    let renamed = false;
    try {
      const source = await statOrNull(from);
      if (!source) return to;
      if (source.isSymbolicLink()) {
        if (await fs.realpath(from) === await fs.realpath(to)) {
          if (!owned(await fs.lstat(to))) throw Error('the migrated destination is not safely owned by this user');
          result.moves.push({ from, to });
          return to;
        }
        throw Error('the legacy path is an unrelated symbolic link');
      }
      if (!owned(source)) throw Error('the legacy directory is not safely owned by this user');
      if (profile && await statOrNull(path.join(from, 'SingletonLock'))) throw Error('the legacy profile has a Chromium instance lock');
      if (await statOrNull(to)) throw Error('both legacy and new directories exist; automatic merging is disabled');
      await fs.mkdir(path.dirname(to), { recursive: true, mode: 0o700 });
      // A managed parent may not redirect writes to an unrelated location.
      if (!owned(await fs.lstat(path.dirname(to)))) throw Error('the destination parent is not safely owned by this user');
      renameManagedDirectoryNoReplace(from, to);
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
    // Starting a cooperating launcher while an offline copy owns the same
    // lease would race its final profile commit. Fail startup, never bypass it.
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw Error('Managed paths are busy. Wait for the current migration or offline copy to finish before starting xboks.');
    result.warnings.push(`Managed paths were not moved: ${(error as Error).message}`);
    await keepLegacy();
    return result;
  }
  const release = async () => {
    if (!lockHandle) return;
    const handle = lockHandle; lockHandle = undefined;
    try { await handle.close(); } finally { await fs.unlink(lock); }
  };
  if (options.retainStartupLock) result.releaseStartupLock = release;
  try {
    try {
      if (await (options.isActive ?? managedPathMigrationActive)()) {
        result.warnings.push('Managed paths were not moved because a game or Xodus service may be active.');
        await keepLegacy(); return result;
      }
    } catch {
      result.warnings.push('Managed paths were not moved because game/service activity could not be verified.');
      await keepLegacy(); return result;
    }
    if ((!options.explicitProfile && await statOrNull(path.join(legacyProfile, 'SingletonLock'))) || await statOrNull(path.join(result.profile, 'SingletonLock'))) {
      result.warnings.push('Managed paths were not moved because a profile has a Chromium instance lock.');
      await keepLegacy();
      return result;
    }
    if (!options.explicitProfile && (!options.profile || path.resolve(options.profile) === defaults.profile || path.resolve(options.profile) === legacyProfile)) {
      result.profile = await move(legacyProfile, defaults.profile, true);
      if (result.profile === defaults.profile && result.moves.some(entry => entry.from === legacyProfile) && !result.legacyProfiles.includes(legacyProfile)) result.legacyProfiles.push(legacyProfile);
    }
    if (!options.explicitProfile) {
      const legacySource = await statOrNull(legacyData);
      const legacyProfileStat = await statOrNull(legacyProfile);
      const adoptedProfile = result.moves.some(entry => entry.from === legacyProfile && entry.to === defaults.profile);
      // Only a positively verified compatibility alias belongs to us. An
      // unrelated or dangling alias can still represent a separate install.
      const distinctLegacyProfile = legacyProfileStat && !adoptedProfile;
      const configured = result.profile === defaults.profile ? await configuredRuntimeRoot(result.profile) : undefined;
      if (legacySource && !adoptedProfile && (distinctLegacyProfile || configured !== path.join(legacyData, 'runtimes'))) {
        result.warnings.push('Legacy runtime data was kept because exclusive ownership by this profile could not be established. Use an explicit offline copy to preserve a separate Nexus installation.');
        if (configured === path.join(legacyData, 'runtimes') || !configured) result.dataRoot = legacyData;
      } else result.dataRoot = await move(legacyData, defaults.dataRoot);
    }
    result.runtimeRoot = path.join(result.dataRoot, 'runtimes');
    if (!options.explicitProfile && result.dataRoot === defaults.dataRoot) {
      const releases = path.join(result.runtimeRoot, 'releases'); const releasesStat = await statOrNull(releases);
      if (releasesStat && ownedDataDirectory(releasesStat)) {
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
  } catch (error) {
    await release(); throw error;
  } finally {
    if (!options.retainStartupLock) await release();
  }
  return result;
}
