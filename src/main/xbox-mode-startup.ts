import { constants, promises as fs, type Stats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { desktopExec } from './desktop-settings.js';

const MAX_BYTES = 64 * 1024;
const MAX_AGE = 24 * 60 * 60 * 1000;
const JOURNAL = 'xbox-mode-startup.json';
const CLAIM = 'xbox-mode-startup.consuming.json';
const consumingProfiles = new Set<string>();
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
interface OwnedFile { bytes: Buffer; dev: number; ino: number }
interface Intent {
  version: 1;
  id: string;
  profile: string;
  originBootId: string;
  createdAt: number;
  expiresAt: number;
  launchArguments: string[];
}
export interface XboxModeStartupStatus { available: boolean; reason?: string }
export interface XboxModeStartupTransaction { id: string; rollback(): Promise<void> }
export interface XboxModeStartupOptions {
  profile: string;
  configRoot: string;
  executable: string;
  /** Set false for development/demo operation; no files are created by status(). */
  enabled?: boolean;
  appArgs?: readonly string[];
  now?: () => number;
  readBootId?: () => Promise<string>;
  uid?: number;
}

function absolute(value: string): string {
  if (!path.isAbsolute(value) || /[\x00-\x1f\x7f]/.test(value) || value.split(path.sep).includes('..')) throw Error('Xbox mode startup needs safe absolute paths.');
  return path.resolve(value);
}
function privateDirectory(stat: Stats, uid: number, privateAncestor: boolean): boolean {
  // A 0700 owned root prevents other users from reaching its descendants.
  // Keep ownership mandatory, and allow group-write only behind that boundary.
  if (!stat.isDirectory() || stat.uid !== uid || stat.mode & 0o002 || !privateAncestor && stat.mode & 0o020) throw Error('Xbox mode startup directories must belong to you and cannot be writable by other users.');
  return privateAncestor || (stat.mode & 0o077) === 0;
}
function anchor(directory: FileHandle, name: string): string { return `/proc/self/fd/${directory.fd}/${name}`; }

/** Walk without following directory symlinks, then retain an fd for all file
 * operations. Renaming a parent during a request cannot redirect publication. */
async function directory(location: string, ownedRoot: string, uid: number, create = false): Promise<FileHandle> {
  const parts = absolute(location).split(path.sep).filter(Boolean);
  const ownedAt = absolute(ownedRoot).split(path.sep).filter(Boolean).length - 1;
  let handle = await fs.open('/', constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  let privateAncestor = false;
  try {
    for (let index = 0; index < parts.length; index++) {
      const next = anchor(handle, parts[index]);
      if (create && index >= ownedAt) {
        try { await fs.mkdir(next, { mode: 0o700 }); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      }
      const opened = await fs.open(next, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      await handle.close(); handle = opened;
      const stat = await handle.stat();
      if (index >= ownedAt) privateAncestor = privateDirectory(stat, uid, privateAncestor);
      else if (![0, uid].includes(stat.uid) || stat.mode & 0o022 && !(stat.uid === 0 && stat.mode & 0o1000)) {
        // System sticky directories such as /tmp protect each owner's entry.
        // Other writable ancestors could replace the private root itself.
        throw Error('Xbox mode startup directories have an unsafe writable ancestor.');
      }
    }
    return handle;
  } catch (error) { await handle.close(); throw error; }
}

async function readOwned(directory: FileHandle, name: string, uid: number): Promise<OwnedFile | undefined> {
  let handle: FileHandle;
  try { handle = await fs.open(anchor(directory, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (error) { if (missing(error)) return; throw Error('An Xbox mode startup file is unsafe or cannot be read.'); }
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.uid !== uid || stat.mode & 0o077 || stat.nlink !== 1 || stat.size > MAX_BYTES) throw Error('An Xbox mode startup file is unsafe or cannot be read.');
    const bytes = await handle.readFile();
    if (bytes.length > MAX_BYTES) throw Error('An Xbox mode startup file exceeded the size limit.');
    return { bytes, dev: stat.dev, ino: stat.ino };
  } finally { await handle.close(); }
}
function same(first: OwnedFile, second: OwnedFile): boolean { return first.dev === second.dev && first.ino === second.ino && first.bytes.equals(second.bytes); }
async function removeUnchanged(directory: FileHandle, name: string, expected: OwnedFile, uid: number): Promise<void> {
  const current = await readOwned(directory, name, uid);
  if (!current) return;
  if (!same(expected, current)) throw Error('Xbox mode startup files changed; the changed files were preserved.');
  await fs.unlink(anchor(directory, name));
}
/** An exclusive hard-link publication cannot replace another request's file. */
async function publish(directory: FileHandle, name: string, bytes: Buffer, uid: number): Promise<OwnedFile> {
  const temporary = `.xboks-mode-${randomUUID()}.tmp`;
  const handle = await fs.open(anchor(directory, temporary), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  let expected: OwnedFile | undefined, published = false;
  try {
    await handle.writeFile(bytes); await handle.sync();
    const stat = await handle.stat(); expected = { bytes, dev: stat.dev, ino: stat.ino };
    await fs.link(anchor(directory, temporary), anchor(directory, name)); published = true;
    await fs.unlink(anchor(directory, temporary));
    await directory.sync();
    const result = await readOwned(directory, name, uid);
    if (!result || !same(expected, result)) throw Error('The Xbox mode startup file was changed during publication.');
    return result;
  } catch (error) {
    try { await fs.unlink(anchor(directory, temporary)); } catch (cleanup) { if (!missing(cleanup)) throw cleanup; }
    if (published && expected) await removeUnchanged(directory, name, expected, uid);
    throw error;
  } finally { await handle.close(); }
}

/** One reboot, one profile, one attempt. This configures ordinary login
 * autostart only; it never changes the desktop session or promises performance. */
export class XboxModeStartup {
  readonly profile: string;
  readonly configRoot: string;
  readonly autostartName: string;
  readonly intentPath: string;
  readonly autostartPath: string;
  private readonly uid: number;
  private readonly now: () => number;
  private readonly readBootId: () => Promise<string>;
  private preparing = false;
  private consuming = false;
  constructor(private readonly options: XboxModeStartupOptions) {
    this.profile = absolute(options.profile);
    this.configRoot = absolute(options.configRoot);
    this.uid = options.uid ?? process.getuid?.() ?? -1;
    this.now = options.now ?? Date.now;
    this.readBootId = options.readBootId ?? (async () => (await fs.readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim());
    const profileId = createHash('sha256').update(this.profile).digest('hex').slice(0, 16);
    this.autostartName = `gr.slave.xboks-xbox-mode-${profileId}.desktop`;
    this.intentPath = path.join(this.profile, JOURNAL);
    this.autostartPath = path.join(this.configRoot, 'autostart', this.autostartName);
  }
  private async bootId(): Promise<string> {
    const value = await this.readBootId();
    if (!/^[a-zA-Z0-9-]{1,128}$/.test(value)) throw Error('The current Linux boot cannot be identified safely.');
    return value;
  }
  private arguments(): string[] {
    const executable = absolute(this.options.executable);
    if (/(?:^|\/)\.mount_[^/]*(?:\/|$)/.test(executable)) throw Error('Restart needs the persistent launcher, rather than a temporary AppImage mount.');
    const args = [...(this.options.appArgs ?? [])];
    if (args.length > 16 || args.some(arg => typeof arg !== 'string' || arg.length > 4096 || /[\x00-\x1f\x7f]/.test(arg) || ['--background', '--gamebar-service', '--xboks-profile', '--nexus-profile', '--launch-game'].includes(arg))) throw Error('The Xbox mode startup arguments are invalid.');
    return [executable, ...args, '--xboks-profile', this.profile];
  }
  private async validate(): Promise<void> {
    if (this.options.enabled === false || process.platform !== 'linux' || this.uid < 1) throw Error('Restart into Xbox mode requires an installed Linux launcher.');
    const [executable] = this.arguments();
    const resolved = await fs.realpath(executable);
    if (/(?:^|\/)\.mount_[^/]*(?:\/|$)/.test(resolved)) throw Error('The launcher resolves to a temporary AppImage mount.');
    const stat = await fs.stat(resolved);
    if (!stat.isFile() || ![0, this.uid].includes(stat.uid) || stat.mode & 0o022) throw Error('The installed launcher is unsafe or unavailable.');
    await fs.access(executable, constants.X_OK);
    await this.bootId();
  }
  private entry(intent: Intent): Buffer {
    return Buffer.from(`[Desktop Entry]\nType=Application\nName=XBOKS Xbox mode\nExec=${desktopExec(intent.launchArguments)}\nTerminal=false\nX-GNOME-Autostart-enabled=true\nX-Xboks-Xbox-Mode-Intent=${intent.id}\n`);
  }
  private intent(file: OwnedFile): Intent {
    let value: Intent;
    try { value = JSON.parse(file.bytes.toString('utf8')); } catch { throw Error('The pending Xbox mode startup intent is invalid.'); }
    if (!value || value.version !== 1 || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.id) || value.profile !== this.profile ||
      !/^[a-zA-Z0-9-]{1,128}$/.test(value.originBootId) || !Number.isSafeInteger(value.createdAt) || !Number.isSafeInteger(value.expiresAt) ||
      value.expiresAt <= value.createdAt || value.expiresAt - value.createdAt > MAX_AGE || value.createdAt > this.now() + 5 * 60_000 ||
      !Array.isArray(value.launchArguments) || value.launchArguments.length < 3 || value.launchArguments.length > 20 ||
      value.launchArguments.some(arg => typeof arg !== 'string' || arg.length > 4096 || /[\x00-\x1f\x7f]/.test(arg)) ||
      !path.isAbsolute(value.launchArguments[0]) || value.launchArguments.at(-2) !== '--xboks-profile' || value.launchArguments.at(-1) !== this.profile) throw Error('The pending Xbox mode startup intent is invalid.');
    return value;
  }
  private async open(create = false): Promise<{ profile: FileHandle; autostart?: FileHandle }> {
    const profile = await directory(this.profile, this.profile, this.uid);
    try {
      // Check the configuration root even when its autostart directory is absent.
      const config = await directory(this.configRoot, this.configRoot, this.uid, create);
      await config.close();
      let autostart: FileHandle | undefined;
      try { autostart = await directory(path.join(this.configRoot, 'autostart'), this.configRoot, this.uid, create); }
      catch (error) { if (create || !missing(error)) throw error; }
      return { profile, autostart };
    } catch (error) { await profile.close(); throw error; }
  }
  private async assertAbsent(profile: FileHandle, autostart?: FileHandle): Promise<void> {
    if (await readOwned(profile, JOURNAL, this.uid) || await readOwned(profile, CLAIM, this.uid)) throw Error('A restart into Xbox mode is already pending.');
    if (autostart && await readOwned(autostart, this.autostartName, this.uid)) throw Error('An Xbox mode startup entry already exists and was preserved.');
  }
  async status(): Promise<XboxModeStartupStatus> {
    try {
      await this.validate();
      const handles = await this.open();
      try {
        await this.assertAbsent(handles.profile, handles.autostart);
        await fs.access(this.profile, constants.W_OK | constants.X_OK);
        await fs.access(handles.autostart ? anchor(handles.autostart, '.') : this.configRoot, constants.W_OK | constants.X_OK);
      } finally { await handles.profile.close(); await handles.autostart?.close(); }
      return { available: true };
    } catch (error) { return { available: false, reason: (error as Error).message }; }
  }
  async prepare(): Promise<XboxModeStartupTransaction> {
    if (this.preparing || this.consuming) throw Error('An Xbox mode startup operation is already in progress.');
    this.preparing = true;
    let journal: OwnedFile | undefined, entry: OwnedFile | undefined;
    let handles: Awaited<ReturnType<XboxModeStartup['open']>> | undefined;
    try {
      await this.validate();
      handles = await this.open(true);
      await this.assertAbsent(handles.profile, handles.autostart);
      const createdAt = this.now();
      const intent: Intent = { version: 1, id: randomUUID(), profile: this.profile, originBootId: await this.bootId(), createdAt, expiresAt: createdAt + MAX_AGE, launchArguments: this.arguments() };
      journal = await publish(handles.profile, JOURNAL, Buffer.from(JSON.stringify(intent) + '\n'), this.uid);
      entry = await publish(handles.autostart!, this.autostartName, this.entry(intent), this.uid);
      const expectedJournal = journal, expectedEntry = entry;
      return { id: intent.id, rollback: async () => {
        const opened = await this.open();
        try {
          // Stop future autostart before discarding the matching intent.
          if (opened.autostart) await removeUnchanged(opened.autostart, this.autostartName, expectedEntry, this.uid);
          await removeUnchanged(opened.profile, JOURNAL, expectedJournal, this.uid);
          await opened.profile.sync(); await opened.autostart?.sync();
        } finally { await opened.profile.close(); await opened.autostart?.close(); }
      } };
    } catch (error) {
      if (handles) {
        // Exclusive publication ensures another request's files are never ours.
        if (entry && handles.autostart) await removeUnchanged(handles.autostart, this.autostartName, entry, this.uid);
        if (journal) await removeUnchanged(handles.profile, JOURNAL, journal, this.uid);
      }
      throw error;
    } finally { this.preparing = false; await handles?.profile.close(); await handles?.autostart?.close(); }
  }
  async consume(): Promise<boolean> {
    if (this.options.enabled === false || process.platform !== 'linux' || this.uid < 1 || this.preparing || this.consuming || consumingProfiles.has(this.profile)) return false;
    this.consuming = true;
    consumingProfiles.add(this.profile);
    let handles: Awaited<ReturnType<XboxModeStartup['open']>> | undefined;
    try {
      handles = await this.open();
      const existingClaim = await readOwned(handles.profile, CLAIM, this.uid);
      const journal = await readOwned(handles.profile, JOURNAL, this.uid);
      if (!journal && !existingClaim) return false;
      if (journal && existingClaim && !journal.bytes.equals(existingClaim.bytes)) throw Error('Conflicting Xbox mode startup intents were preserved.');
      const saved = journal ?? existingClaim!;
      const intent = this.intent(saved);
      const expired = intent.expiresAt <= this.now();
      if (journal && !existingClaim && !expired && intent.originBootId === await this.bootId()) return false;
      const entry = handles.autostart && await readOwned(handles.autostart, this.autostartName, this.uid);
      if (entry && !entry.bytes.equals(this.entry(intent))) throw Error('The Xbox mode startup entry changed and was preserved.');
      // Exclusive publication never replaces a claim created by another caller.
      // A previous crash's claim only triggers cleanup, never another attempt.
      const claimed = existingClaim ?? await publish(handles.profile, CLAIM, saved.bytes, this.uid);
      try { if (journal) await removeUnchanged(handles.profile, JOURNAL, journal, this.uid); }
      catch (error) { if (!existingClaim) await removeUnchanged(handles.profile, CLAIM, claimed, this.uid); throw error; }
      if (entry && handles.autostart) await removeUnchanged(handles.autostart, this.autostartName, entry, this.uid);
      await removeUnchanged(handles.profile, CLAIM, claimed, this.uid);
      await handles.profile.sync(); await handles.autostart?.sync();
      return Boolean(journal && !existingClaim && !expired && entry);
    } catch (error) { if (missing(error)) return false; throw error; }
    finally { this.consuming = false; consumingProfiles.delete(this.profile); await handles?.profile.close(); await handles?.autostart?.close(); }
  }
}
