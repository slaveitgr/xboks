import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnTracked } from './process.js';
import { parseSubscription } from '../shared/subscription.js';
import { parseXboxSelfProfileDetails, profileCheckedAt, type XboxSelfProfile } from '../shared/xbox-profile.js';

export type XboxProfile = XboxSelfProfile;
type Reader = (binary: string, signal: AbortSignal) => Promise<string>;
const name = (value: unknown): value is string => typeof value === 'string' && Boolean(value.trim()) && value.length <= 128 && !/[\x00-\x1f\x7f]/.test(value);
const image = (value: unknown): value is string => typeof value === 'string' && value.length < 3_000_000 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value);

async function readProfile(binary: string, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  const tracked = spawnTracked(binary, ['profile', '--json'], { maxOutput: 4_000_000, stdoutOnly: true });
  const stop = () => { tracked.child.kill('SIGKILL'); };
  signal.addEventListener('abort', stop, { once: true });
  if (signal.aborted) stop();
  const timer = setTimeout(stop, 50_000); timer.unref();
  try {
    const result = await tracked.result;
    signal.throwIfAborted();
    if (result.code !== 0) throw Error('Xbox profile unavailable.');
    return result.output;
  } finally { clearTimeout(timer); signal.removeEventListener('abort', stop); }
}

/** Only the currently stored account can publish/cache a profile result. */
export class AccountProfile {
  value?: XboxProfile;
  source?: 'live' | 'cache';
  error?: string;
  get refreshing(): boolean { return Boolean(this.controller); }
  private account?: string;
  private binary?: string;
  private generation = 0;
  private controller?: AbortController;
  private refreshedAt = 0;
  private job?: Promise<void>;
  private disk: Promise<void> = Promise.resolve();
  private readonly file: string;
  constructor(userData: string, private changed: () => void,
    private normalize: (dataUrl: string) => string | undefined, private reader: Reader = readProfile, private now = Date.now) {
    this.file = path.join(userData, 'xbox-profile.json');
  }
  matchesAccount(account: string | undefined): boolean { return Boolean(account?.trim()) && account === this.account; }
  cancel(): void { this.generation++; this.controller?.abort(); this.controller = undefined; }
  async settled(): Promise<void> { await this.job; await this.disk; }
  private hash(account: string): string { return createHash('sha256').update(account).digest('hex'); }
  private write(action: () => Promise<void>): Promise<void> {
    this.disk = this.disk.catch(() => {}).then(action).catch(() => { /* Optional private cache. */ });
    return this.disk;
  }
  async select(account: string | undefined, binary?: string, force = false): Promise<void> {
    const switched = account !== this.account;
    const backendChanged = binary !== this.binary;
    // Repeated Refresh clicks must share an existing request. Aborting it can
    // interrupt device renewal and disguises a UI cancellation as a backend crash.
    if (switched || backendChanged || !account) this.cancel();
    this.account = account;
    this.binary = binary;
    if (backendChanged) { this.refreshedAt = 0; this.error = undefined; }
    const generation = this.generation;
    if (!account) {
      this.value = undefined; this.source = undefined; this.error = undefined; this.refreshedAt = 0; this.changed();
      await this.write(() => fs.rm(this.file, { force: true })); return;
    }
    if (switched) {
      this.value = undefined; this.source = undefined; this.error = undefined; this.refreshedAt = 0; this.changed();
      await this.disk;
      try {
        const stat = await fs.lstat(this.file);
        if (!stat.isFile() || stat.uid !== process.getuid?.() || stat.size > 1_000_000 || (stat.mode & 0o077)) throw Error('Unsafe cache');
        const cached = JSON.parse(await fs.readFile(this.file, 'utf8'));
        if (generation !== this.generation) return;
        if (cached.schema !== 1 || cached.accountHash !== this.hash(account) || !name(cached.gamertag)) throw Error('Different account');
        this.value = { gamertag: cached.gamertag, avatarDataUrl: image(cached.avatarDataUrl) ? this.normalize(cached.avatarDataUrl) : undefined,
          subscription: parseSubscription(cached.subscription, this.now()), ...parseXboxSelfProfileDetails(cached),
          checkedAt: profileCheckedAt(cached.checkedAt, this.now()) };
        this.source = 'cache';
        this.changed();
      } catch {
        if (generation !== this.generation) return;
        await this.write(() => fs.rm(this.file, { force: true }));
      }
    }
    if (generation !== this.generation || !binary || this.controller || (!force && this.now() - this.refreshedAt < 10 * 60_000)) return;
    const controller = new AbortController(); this.controller = controller; this.error = undefined; this.changed();
    this.job = (async () => {
      try {
        const output = await this.reader(binary, controller.signal);
        if (output.length > 4_000_000) throw Error('Profile too large');
        const line = output.split('\n').reverse().find(line => line.trimStart().startsWith('{'));
        const result = JSON.parse(line ?? '');
        if (generation !== this.generation || controller.signal.aborted) return;
        if (result.schema !== 1 || result.account !== account || !name(result.gamertag)) throw Error('Profile identity mismatch');
        const value: XboxProfile = { gamertag: result.gamertag.trim(), avatarDataUrl: image(result.gamerpicDataUrl) ? this.normalize(result.gamerpicDataUrl) : undefined,
          subscription: parseSubscription(result.subscription, this.now()), ...parseXboxSelfProfileDetails(result),
          checkedAt: new Date(this.now()).toISOString() };
        this.value = value; this.source = 'live'; this.changed();
        await this.write(async () => {
          if (generation !== this.generation) return;
          await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
          const temporary = `${this.file}.${randomUUID()}`;
          try {
            await fs.writeFile(temporary, JSON.stringify({ schema: 1, accountHash: this.hash(account), ...value }), { flag: 'wx', mode: 0o600 });
            if (generation === this.generation) await fs.rename(temporary, this.file);
          } finally { await fs.rm(temporary, { force: true }); }
        });
      } catch {
        // Provider output and errors can contain private data. Publish only a
        // generic status and retain previously retrieved same-account details.
        if (generation === this.generation && !controller.signal.aborted) {
          if (this.value) this.source = 'cache';
          this.error = 'Xbox profile is temporarily unavailable.';
        }
      }
      finally {
        if (generation === this.generation) { this.controller = undefined; this.refreshedAt = this.now(); this.changed(); }
      }
    })();
  }
}
