import { constants, promises as fs, type Stats } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { engineRuntimeDirectory, managedPathMigrationActive, managedPaths, renameManagedDirectoryNoReplace, type ManagedPathOptions } from './managed-paths.js';

type Kind = 'directory' | 'file' | 'symlink';
interface Node { name: string; kind: Kind; stat: Stats; link?: string; children?: Node[] }
interface Scope { from: string; to: string; kind: 'runtime' | 'prefix'; tree: Node }
export interface ManagedDataCopyOptions extends ManagedPathOptions {
  /** Test seam. Production defaults to Linux statfs, never a fabricated free-space value. */
  availableBytes?: (directory: string) => Promise<number>;
}
export interface ManagedDataCopySummary {
  alreadyMigrated: boolean; runtimeBytes: number; prefixBytes: number; requiredBytes: number;
  availableBytes: number; files: number; symlinks: number; prefixes: number;
}
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
const inside = (value: string, root: string) => value === root || value.startsWith(root + path.sep);
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const owned = (stat: Stats) => stat.uid === process.getuid?.() && (stat.isSymbolicLink() || !(stat.mode & 0o002));
const same = (a: Stats, b: Stats) => a.dev === b.dev && a.ino === b.ino && a.mode === b.mode && a.uid === b.uid &&
  a.gid === b.gid && a.nlink === b.nlink && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
async function exists(file: string) { try { await fs.lstat(file); return true; } catch (error) { if (missing(error)) return false; throw error; } }
async function directory(file: string, privateMode = false): Promise<void> {
  const stat = await fs.lstat(file);
  if (!stat.isDirectory() || stat.isSymbolicLink() || !owned(stat) || privateMode && stat.mode & 0o022) throw Error('A managed directory is not safely owned or is redirected.');
}
async function readPrivate(file: string, maximum: number): Promise<{ bytes: Buffer; stat: Stats }> {
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || !owned(stat) || stat.nlink !== 1 || stat.size > maximum) throw Error('Managed metadata must be a bounded, unlinked regular file owned by this user.');
    const bytes = await handle.readFile();
    if (!same(stat, await handle.stat())) throw Error('Managed metadata changed while it was being read.');
    return { bytes, stat };
  } finally { await handle.close(); }
}
async function freeBytes(directory: string): Promise<number> {
  let current = directory;
  while (!await exists(current)) { const parent = path.dirname(current); if (parent === current) throw Error('The destination filesystem is unavailable.'); current = parent; }
  const value = await fs.statfs(current, { bigint: true }), available = value.bavail * value.bsize;
  return Number(available > BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(Number.MAX_SAFE_INTEGER) : available);
}
async function assertIdle(options: ManagedDataCopyOptions, profiles: readonly string[]): Promise<void> {
  if (await (options.isActive ?? managedPathMigrationActive)()) throw Error('Stop running games and Xodus/Wine services before copying managed data.');
  for (const profile of profiles) if (await exists(path.join(profile, 'SingletonLock'))) throw Error('Close every involved Chromium launcher profile before copying managed data.');
}
async function scan(root: string, counters: { entries: number }): Promise<Node> {
  async function visit(file: string, name: string, depth: number): Promise<Node> {
    if (++counters.entries > 250_000 || depth > 64) throw Error('The managed tree exceeds the bounded copy limit.');
    const stat = await fs.lstat(file);
    if (!owned(stat)) throw Error('A managed source entry is not owned by this user or is world-writable.');
    if (stat.isSymbolicLink()) return { name, kind: 'symlink', stat, link: await fs.readlink(file) };
    if (stat.isFile()) return { name, kind: 'file', stat };
    if (!stat.isDirectory()) throw Error('Special files cannot be copied as runtime or save data.');
    const handle = await fs.open(file, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      if (!same(stat, await handle.stat())) throw Error('A managed source directory changed during inspection.');
      const anchored = `/proc/self/fd/${handle.fd}`;
      const children: Node[] = [];
      for (const child of (await fs.readdir(anchored)).sort()) children.push(await visit(path.join(anchored, child), child, depth + 1));
      if (!same(stat, await handle.stat())) throw Error('A managed source directory changed during inspection.');
      return { name, kind: 'directory', stat, children };
    } finally { await handle.close(); }
  }
  const tree = await visit(root, '', 0);
  if (tree.kind !== 'directory') throw Error('A selected runtime or prefix root cannot be a symbolic link.');
  return tree;
}
function size(tree: Node): { bytes: number; files: number; symlinks: number } {
  const inodes = new Set<string>(); let bytes = 0, files = 0, symlinks = 0;
  function visit(node: Node) {
    if (node.kind === 'file') { files++; const key = `${node.stat.dev}:${node.stat.ino}`; if (!inodes.has(key)) { inodes.add(key); bytes += node.stat.size; } }
    else if (node.kind === 'symlink') symlinks++;
    else node.children?.forEach(visit);
  }
  visit(tree); return { bytes, files, symlinks };
}
function mappedLink(value: string, sourceDirectory: string, destinationDirectory: string, scopes: readonly Scope[]): string {
  const absolute = path.resolve(sourceDirectory, value);
  const scope = scopes.find(scope => inside(absolute, scope.from));
  if (!scope) return path.isAbsolute(value) ? value : absolute; // Preserve an external endpoint without traversing it.
  const rebased = scope.to + absolute.slice(scope.from.length);
  return path.isAbsolute(value) ? rebased : path.relative(destinationDirectory, rebased) || '.';
}
async function copyScope(scope: Scope, stagingRoot: string, finalRoot: string, scopes: readonly Scope[]): Promise<void> {
  const hardlinks = new Map<string, string>();
  const target = path.join(stagingRoot, path.relative(finalRoot, scope.to));
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  async function visit(node: Node, source: string, destination: string, logicalSource: string, logicalDestination: string) {
    const current = await fs.lstat(source);
    if (!same(node.stat, current)) throw Error('Managed source data changed after planning; make a new offline plan.');
    if (node.kind === 'symlink') {
      const link = await fs.readlink(source);
      if (link !== node.link) throw Error('A managed source link changed after planning.');
      await fs.symlink(mappedLink(link, path.dirname(logicalSource), path.dirname(logicalDestination), scopes), destination);
      if (!same(node.stat, await fs.lstat(source))) throw Error('A managed source link changed while copying.');
      return;
    }
    const handle = await fs.open(source, constants.O_RDONLY | constants.O_NOFOLLOW | (node.kind === 'directory' ? constants.O_DIRECTORY : 0));
    try {
      if (!same(node.stat, await handle.stat())) throw Error('A managed source entry changed while opening.');
      if (node.kind === 'directory') {
        await fs.mkdir(destination, { mode: 0o700 });
        const anchored = `/proc/self/fd/${handle.fd}`;
        const names = (await fs.readdir(anchored)).sort();
        if (JSON.stringify(names) !== JSON.stringify(node.children!.map(child => child.name))) throw Error('A managed source directory changed after planning.');
        for (const child of node.children!) await visit(child, path.join(anchored, child.name), path.join(destination, child.name), path.join(logicalSource, child.name), path.join(logicalDestination, child.name));
        await fs.chmod(destination, (node.stat.mode & 0o755) | 0o700);
      } else {
        const key = `${node.stat.dev}:${node.stat.ino}`, existing = hardlinks.get(key);
        if (existing) await fs.link(existing, destination);
        else {
          // FICLONE is an optimization only. The normal real copy remains the
          // fallback, and neither path hardlinks mutable destination data to Nexus.
          await fs.copyFile(`/proc/self/fd/${handle.fd}`, destination, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE);
          await fs.chmod(destination, node.stat.mode & 0o755);
          const copied = await fs.lstat(destination);
          if (copied.size !== node.stat.size || copied.dev === node.stat.dev && copied.ino === node.stat.ino) throw Error('The copied file is not independent and complete.');
          hardlinks.set(key, destination);
        }
      }
      if (!same(node.stat, await handle.stat()) || !same(node.stat, await fs.lstat(source))) throw Error('Managed source data changed during copying.');
    } finally { await handle.close(); }
  }
  await visit(scope.tree, scope.from, target, scope.from, scope.to);
}
async function verifyScope(scope: Scope): Promise<void> {
  const current = await scan(scope.from, { entries: 0 });
  const equal = (a: Node, b: Node): boolean => a.name === b.name && a.kind === b.kind && a.link === b.link && same(a.stat, b.stat) &&
    (a.children?.length ?? 0) === (b.children?.length ?? 0) && (a.children ?? []).every((child, index) => equal(child, b.children![index]));
  if (!equal(scope.tree, current)) throw Error('Managed source data changed during copying; make a new offline plan.');
}
/** Publish with the kernel's atomic no-replace primitive. There is deliberately
 * no rename(), mv or copy fallback: a concurrent creator must always win. */
export function publishManagedDataNoReplace(source: string, destination: string): void {
  renameManagedDirectoryNoReplace(source, destination);
}
async function writeNew(file: string, bytes: Buffer | string): Promise<void> {
  const handle = await fs.open(file, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
}
interface CopyInput {
  options: ManagedDataCopyOptions; profile: string; legacyProfile: string; stateFile: string;
  state: { bytes: Buffer; stat: Stats }; parsed: Record<string, any>; pointer: Record<string, unknown>;
  pointerSource: { file: string; bytes: Buffer; stat: Stats };
  sourceRoot: string; destinationRoot: string; winePath: string; scopes: Scope[];
}
/** Public plans expose counts only. Raw profile bytes, save names and filesystem
 * inventory stay in private fields and are never written to logs or receipts. */
export class ManagedDataCopyPlan {
  #input?: CopyInput;
  constructor(readonly summary: Readonly<ManagedDataCopySummary>, input?: CopyInput) { this.summary = Object.freeze({ ...summary }); this.#input = input; }
  async apply(): Promise<ManagedDataCopySummary> {
    const input = this.#input; if (!input) return { ...this.summary, alreadyMigrated: true };
    const { options, profile, legacyProfile, stateFile, destinationRoot, scopes } = input;
    const profiles = [profile, legacyProfile], parent = path.dirname(destinationRoot), id = randomUUID();
    await assertIdle(options, profiles);
    if (await exists(destinationRoot)) throw Error('The canonical data root already exists; automatic merging is disabled.');
    const available = await (options.availableBytes ?? freeBytes)(parent);
    if (available < this.summary.requiredBytes) throw Error('There is not enough free space for an independent managed data copy.');
    const state = await readPrivate(stateFile, 32 * 1024 * 1024);
    if (!same(state.stat, input.state.stat) || digest(state.bytes) !== digest(input.state.bytes)) throw Error('The profile changed after planning; make a new offline plan.');
    const pointer = await readPrivate(input.pointerSource.file, 1024 * 1024);
    if (!same(pointer.stat, input.pointerSource.stat) || digest(pointer.bytes) !== digest(input.pointerSource.bytes)) throw Error('The runtime pointer changed after planning.');
    await directory(path.dirname(profile), true);
    await fs.mkdir(parent, { recursive: true, mode: 0o700 }); await directory(parent, true);
    const lockFile = path.join(path.dirname(profile), '.xboks-path-migration.lock');
    const lock = await fs.open(lockFile, 'wx', 0o600);
    const staging = path.join(parent, `.engine-copy-${id}`), temporaryState = `${stateFile}.engine-copy-${id}`;
    let published = false;
    try {
      await assertIdle(options, profiles);
      await fs.mkdir(staging, { mode: 0o700 });
      for (const scope of scopes) await copyScope(scope, staging, destinationRoot, scopes);
      const runtimeRoot = path.join(destinationRoot, 'runtimes');
      await fs.mkdir(path.join(staging, 'runtimes'), { recursive: true, mode: 0o700 });
      await writeNew(path.join(staging, 'runtimes/current.json'), JSON.stringify({ ...input.pointer, winePath: input.winePath }, null, 2));
      await writeNew(path.join(staging, '.xboks-engine-copy.json'), JSON.stringify({ schema: 1, id, sourceStateSha256: digest(state.bytes), copiedAt: new Date().toISOString() }));
      const next = { ...input.parsed, settings: { ...input.parsed.settings, runtimeRoot, winePath: input.winePath } };
      await writeNew(temporaryState, JSON.stringify(next, null, 2));
      await assertIdle(options, profiles);
      for (const scope of scopes) await verifyScope(scope);
      const currentPointer = await readPrivate(input.pointerSource.file, 1024 * 1024);
      if (!same(currentPointer.stat, pointer.stat) || digest(currentPointer.bytes) !== digest(pointer.bytes)) throw Error('The runtime pointer changed while copying.');
      const unchanged = await readPrivate(stateFile, 32 * 1024 * 1024);
      if (!same(unchanged.stat, state.stat) || digest(unchanged.bytes) !== digest(state.bytes)) throw Error('The profile changed while data was copying.');
      await writeNew(`${stateFile}.before-engine-copy-${id}`, state.bytes);
      if (await exists(destinationRoot)) throw Error('The canonical data root appeared while copying; no files were overwritten.');
      publishManagedDataNoReplace(staging, destinationRoot); published = true;
      await assertIdle(options, profiles);
      const beforeCommit = await readPrivate(stateFile, 32 * 1024 * 1024);
      if (!same(beforeCommit.stat, state.stat) || digest(beforeCommit.bytes) !== digest(state.bytes)) throw Error('The profile changed before its managed paths could be committed.');
      await fs.rename(temporaryState, stateFile);
      this.#input = undefined;
      return { ...this.summary, alreadyMigrated: true };
    } catch (error) {
      if (published) throw Error(`Copied data was preserved in the canonical root for recovery; the profile was not switched: ${(error as Error).message}`);
      throw error;
    } finally {
      await fs.rm(temporaryState, { force: true }).catch(() => {});
      if (!published) await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
      await lock.close(); await fs.unlink(lockFile);
    }
  }
}

/** Explicit offline copy for an already-owned xboks profile that still selects
 * the exact shared legacy runtime root. Never runs automatically at startup. */
export async function planManagedDataCopy(options: ManagedDataCopyOptions = {}): Promise<ManagedDataCopyPlan> {
  if (process.platform !== 'linux') throw Error('Offline managed data copies require Linux.');
  const paths = managedPaths(options), defaults = managedPaths({ ...options, profile: undefined });
  if (path.resolve(paths.profile) !== defaults.profile) throw Error('An explicit custom profile cannot claim the default managed data tree.');
  await directory(paths.profile, true);
  const stateFile = path.join(paths.profile, 'launcher-state.json'), state = await readPrivate(stateFile, 32 * 1024 * 1024);
  const parsed = JSON.parse(state.bytes.toString('utf8')) as Record<string, any>;
  if (!parsed?.settings || typeof parsed.settings !== 'object' || Array.isArray(parsed.settings)) throw Error('The saved managed runtime selection is unavailable.');
  const available = await (options.availableBytes ?? freeBytes)(path.dirname(defaults.dataRoot));
  const empty: ManagedDataCopySummary = { alreadyMigrated: true, runtimeBytes: 0, prefixBytes: 0, requiredBytes: 0, availableBytes: available, files: 0, symlinks: 0, prefixes: 0 };
  if (parsed.settings.runtimeRoot === defaults.runtimeRoot && typeof parsed.settings.winePath === 'string' && inside(parsed.settings.winePath, defaults.runtimeRoot)) {
    await directory(defaults.dataRoot, true);
    if (!inside(await fs.realpath(parsed.settings.winePath), defaults.runtimeRoot)) throw Error('The canonical Wine selection redirects outside the managed runtime.');
    return new ManagedDataCopyPlan(empty);
  }
  const sourceRoot = path.join(path.dirname(path.dirname(defaults.dataRoot)), 'xodus-nexus'), runtimeRoot = path.join(sourceRoot, 'runtimes');
  if (parsed.settings.runtimeRoot !== runtimeRoot || typeof parsed.settings.winePath !== 'string') throw Error('Only an explicitly selected exact legacy default runtime root can be copied. Custom selections are preserved.');
  if (await exists(defaults.dataRoot)) throw Error('The canonical data root already exists; automatic merging is disabled.');
  for (const directoryPath of [sourceRoot, runtimeRoot, path.join(runtimeRoot, 'releases')]) await directory(directoryPath);
  const relative = path.relative(runtimeRoot, parsed.settings.winePath), components = relative.split(path.sep), release = components[1];
  if (components[0] !== 'releases' || components.length < 4 || !/^(?:proton-xodus-|xodus-proton-|xodus-nexus-runtime-|xboks-engine-runtime-)[A-Za-z0-9._-]+$/.test(release)) throw Error('The selected Wine path is not a known managed runtime release.');
  const sourceRelease = path.join(runtimeRoot, 'releases', release), realWine = await fs.realpath(parsed.settings.winePath);
  if (!inside(realWine, sourceRelease)) throw Error('The selected Wine executable redirects outside its managed release.');
  const pointerFile = path.join(runtimeRoot, 'current.json');
  const pointerData = await readPrivate(pointerFile, 1024 * 1024), pointer = JSON.parse(pointerData.bytes.toString('utf8')) as Record<string, unknown>;
  if (typeof pointer.winePath !== 'string' || await fs.realpath(pointer.winePath) !== realWine) throw Error('The selected Wine executable and current runtime pointer do not agree.');
  const counters = { entries: 0 }, runtimeDestination = path.join(defaults.runtimeRoot, 'releases', engineRuntimeDirectory(release));
  const scopes: Scope[] = [{ from: sourceRelease, to: runtimeDestination, kind: 'runtime', tree: await scan(sourceRelease, counters) }];
  if (!Array.isArray(parsed.games) || parsed.games.length > 5000) throw Error('The saved game prefix whitelist is invalid.');
  const ids = new Set<string>();
  for (const game of parsed.games) {
    if (typeof game?.id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(game.id)) ids.add(game.id);
    if (typeof game?.path === 'string' && path.isAbsolute(game.path)) ids.add(createHash('sha256').update(game.path).digest('hex').slice(0, 16));
  }
  for (const family of ['compatdata', 'prefixes']) {
    const familyRoot = path.join(sourceRoot, family); if (!await exists(familyRoot)) continue;
    await directory(familyRoot);
    for (const id of [...ids].sort()) {
      const from = path.join(familyRoot, id); if (!await exists(from)) continue;
      scopes.push({ from, to: path.join(defaults.dataRoot, family, id), kind: 'prefix', tree: await scan(from, counters) });
    }
  }
  const summary = { ...empty, alreadyMigrated: false };
  for (const scope of scopes) {
    const measured = size(scope.tree);
    if (scope.kind === 'runtime') summary.runtimeBytes += measured.bytes; else { summary.prefixBytes += measured.bytes; summary.prefixes++; }
    summary.files += measured.files; summary.symlinks += measured.symlinks;
  }
  const bytes = summary.runtimeBytes + summary.prefixBytes;
  if (!Number.isSafeInteger(bytes)) throw Error('The managed tree size cannot be represented safely.');
  summary.requiredBytes = bytes + Math.max(64 * 1024 * 1024, Math.ceil(bytes * 0.05));
  return new ManagedDataCopyPlan(summary, { options, profile: paths.profile, legacyProfile: path.join(path.dirname(defaults.profile), 'xodus-nexus'),
    stateFile, state, parsed, pointer, pointerSource: { file: pointerFile, ...pointerData }, sourceRoot, destinationRoot: defaults.dataRoot,
    winePath: runtimeDestination + parsed.settings.winePath.slice(sourceRelease.length), scopes });
}
