import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { DownloadTask, GameOperation } from '../shared/types.js';

type Job = { id: string; run: () => Promise<void>; failed: (error: unknown) => Promise<void> };

/** A paused live process retains its slot. Only process cleanup releases it. */
export class InstallQueue {
  private jobs: Job[] = [];
  private active?: string;
  private stopped = false;
  private holds = 0;
  private waiters = new Map<string, (() => void)[]>();
  constructor(private readonly idle: () => void = () => {}) {}
  get size(): number { return this.jobs.length + Number(Boolean(this.active)); }
  has(id: string): boolean { return this.active === id || this.jobs.some(job => job.id === id); }
  hold(): () => void {
    this.holds++; let released = false;
    return () => { if (!released) { released = true; this.holds--; void this.pump(); } };
  }
  settled(id: string, timeoutMs = 15_000): Promise<void> {
    if (!this.has(id)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const finish = () => { clearTimeout(timer); resolve(); };
      const timer = setTimeout(() => {
        this.waiters.set(id, (this.waiters.get(id) ?? []).filter(waiter => waiter !== finish));
        if (!this.waiters.get(id)?.length) this.waiters.delete(id);
        reject(Error('The download is still stopping. Files were not deleted.'));
      }, timeoutMs);
      timer.unref();
      this.waiters.set(id, [...this.waiters.get(id) ?? [], finish]);
    });
  }
  private notify(id: string): void { this.waiters.get(id)?.forEach(resolve => resolve()); this.waiters.delete(id); }
  enqueue(job: Job): void {
    if (this.stopped) throw Error('The launcher is closing.');
    if (this.has(job.id)) throw Error('Installation is already queued.');
    this.jobs.push(job);
    void this.pump();
  }
  cancel(id: string): boolean {
    const index = this.jobs.findIndex(job => job.id === id);
    if (index < 0) return false;
    this.jobs.splice(index, 1);
    this.notify(id);
    return true;
  }
  stop(): void { this.stopped = true; }
  private async pump(): Promise<void> {
    if (this.active || this.stopped || this.holds) return;
    const job = this.jobs.shift();
    if (!job) return;
    this.active = job.id;
    try { await job.run(); }
    catch (error) {
      try { await job.failed(error); }
      catch { this.stopped = true; console.error('Could not persist installation failure; queue stopped.'); }
    } finally { this.active = undefined; this.notify(job.id); if (!this.jobs.length) this.idle(); void this.pump(); }
  }
}

export function assertActivityCompatible(operations: Iterable<string>, downloads: readonly DownloadTask[], game: GameOperation | undefined,
  queued: number, mode?: 'install' | 'launch' | 'remove'): void {
  const downloadIds = new Set(downloads.map(task => task.id));
  const gameActive = game && ['preparing', 'running', 'stopping'].includes(game.status);
  const allowedGame = (mode === 'install' || mode === 'remove') && gameActive && game.kind === 'launch' && game.status === 'running';
  if ((!mode && queued > 0) || (gameActive && !allowedGame) || [...operations].some(id =>
    !(mode && downloadIds.has(id)) && !(allowedGame && game.id === id))) {
    throw Error('Another xboks Engine operation is active. Wait for it to finish or stop it first.');
  }
}

/** Resolve existing ancestors too, so a new directory through a symlink is locked. */
export async function canonicalInstallPath(input: string): Promise<string> {
  if (!path.isAbsolute(input) || input.includes('\0')) throw Error('The destination must be an absolute path.');
  const resolved = path.resolve(input);
  try { return await fs.realpath(resolved); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    // realpath cannot resolve a dangling link, but its future destination still
    // reserves real files under the target. Do not treat the link as a new folder.
    const entry = await fs.lstat(resolved).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return undefined;
    });
    if (entry?.isSymbolicLink()) return canonicalInstallPath(path.resolve(path.dirname(resolved), await fs.readlink(resolved)));
    const parent = path.dirname(resolved);
    if (parent === resolved) throw error;
    return path.join(await canonicalInstallPath(parent), path.basename(resolved));
  }
}

export function installPathsOverlap(left: string, right: string): boolean {
  const contains = (a: string, b: string) => { const relative = path.relative(a, b); return !relative || relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); };
  return contains(left, right) || contains(right, left);
}

export async function assertInstallDestination(destination: string, locked: readonly string[]): Promise<string> {
  const canonical = await canonicalInstallPath(destination);
  for (const item of locked) {
    if (installPathsOverlap(canonical, await canonicalInstallPath(item))) throw Error('This location overlaps an installed game or another installation. Choose a separate folder.');
  }
  return canonical;
}
