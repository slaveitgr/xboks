import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { GameActivity } from '../shared/types.js';
import { manifestTitleId } from './game-locale.js';
import { spawnTracked } from './process.js';
import { resolvePackageFile } from './windows-path.js';

export async function installedTitleId(directory: string): Promise<string | undefined> {
  const entry = await resolvePackageFile(directory, 'MicrosoftGame.config');
  if (!entry) return;
  const file = path.join(directory, entry);
  const handle = await fs.open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 1_000_000) return;
    const title = manifestTitleId(await handle.readFile('utf8'));
    if (!title || !/^[a-f0-9]{1,8}$/i.test(title)) return;
    const value = Number.parseInt(title, 16);
    return value > 0 ? String(value) : undefined;
  } finally { await handle.close(); }
}

type Reader = (binary: string, titleId: string, signal: AbortSignal) => Promise<string>;
async function read(binary: string, titleId: string, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  const tracked = spawnTracked(binary, ['game-activity', titleId, '--json'], { maxOutput: 64_000, stdoutOnly: true });
  tracked.child.stdin.end();
  const stop = () => { tracked.child.kill('SIGKILL'); };
  signal.addEventListener('abort', stop, { once: true });
  if (signal.aborted) stop();
  const timer = setTimeout(stop, 30_000); timer.unref();
  try {
    const result = await tracked.result; signal.throwIfAborted();
    if (result.code !== 0) throw Error('Xbox activity unavailable.');
    return result.output;
  } finally { clearTimeout(timer); signal.removeEventListener('abort', stop); }
}

export function parseGameActivity(raw: string, account: string, titleId: string): GameActivity {
  if (raw.length > 64_000) throw Error('Activity too large.');
  const value = JSON.parse(raw);
  if (!value || value.schema !== 1 || value.account !== account || value.titleId !== titleId || typeof value.partial !== 'boolean') throw Error('Activity identity mismatch.');
  const minutes = value.minutesPlayed;
  if (minutes !== null && (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes < 0 || minutes > 1_000_000_000)) throw Error('Invalid time played.');
  const last = value.lastPlayed;
  if (last !== null && (typeof last !== 'string' || last.length > 40 || !/^\d{4}-\d{2}-\d{2}T/.test(last) || !Number.isFinite(Date.parse(last)) || Date.parse(last) > Date.now() + 5 * 60_000)) throw Error('Invalid last played.');
  return { status: minutes === null && last === null ? 'unavailable' : 'available',
    ...(minutes !== null ? { minutesPlayed: minutes } : {}), ...(last !== null ? { lastPlayed: new Date(last).toISOString() } : {}), partial: value.partial };
}

/** Account-bound, bounded in-memory cache only. Tokens and raw responses stay in CLI. */
export class GameActivities {
  private identity?: { account: string; binary: string };
  private generation = 0;
  private requests = new Map<string, { controller: AbortController; job: Promise<GameActivity> }>();
  private cache = new Map<string, { until: number; activity: GameActivity }>();
  constructor(private reader: Reader = read) {}
  select(account?: string, binary?: string): void {
    const next = account && binary ? { account, binary } : undefined;
    if (JSON.stringify(next) === JSON.stringify(this.identity)) return;
    this.generation++;
    for (const request of this.requests.values()) request.controller.abort();
    this.requests.clear(); this.cache.clear(); this.identity = next;
  }
  async get(titleId: string, refresh = false): Promise<GameActivity> {
    if (!/^[1-9]\d{0,9}$/.test(titleId) || Number(titleId) > 0xffffffff) throw Error('Invalid Xbox title ID.');
    const identity = this.identity, generation = this.generation;
    if (!identity) return { status: 'unsupported' };
    const cached = this.cache.get(titleId);
    if (!refresh && cached && cached.until > Date.now()) return structuredClone(cached.activity);
    const pending = this.requests.get(titleId); if (pending) return pending.job;
    if (this.requests.size >= 4) return { status: 'error' };
    const controller = new AbortController();
    const job = (async () => {
      try {
        const raw = await this.reader(identity.binary, titleId, controller.signal);
        if (generation !== this.generation || controller.signal.aborted) throw Error('Account changed.');
        const activity = parseGameActivity(raw, identity.account, titleId);
        if (this.cache.size >= 100) this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(titleId, { until: Date.now() + 5 * 60_000, activity });
        return structuredClone(activity);
      } catch { return { status: 'error' } as GameActivity; }
      finally { if (generation === this.generation) this.requests.delete(titleId); }
    })();
    this.requests.set(titleId, { controller, job });
    return job;
  }
}
