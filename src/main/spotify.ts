import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { SpotifyCommand, SpotifyState } from '../shared/spotify.js';
import { externalLauncherEnvironment } from './launcher-environment.js';

const MAX_TIME_MS = 604_800_000;
const empty = (status: SpotifyState['status'], reason: string): SpotifyState => ({ status, source: 'linux-mpris', playbackStatus: 'unknown',
  capabilities: { playPause: false, previous: false, next: false, seek: false, open: false }, reason });
const record = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const text = (value: unknown, limit: number): string | undefined => typeof value === 'string' && value.trim() && value.length <= limit ? value.trim() : undefined;
const time = (value: unknown): number | undefined => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_TIME_MS ? value : undefined;

export function parseSpotifyState(value: unknown): SpotifyState {
  const data = record(value), caps = record(data?.capabilities);
  if (!data || data.source !== 'linux-mpris' || typeof data.status !== 'string' || !['available', 'not-running', 'unsupported', 'error'].includes(data.status) ||
      typeof data.playbackStatus !== 'string' || !['playing', 'paused', 'stopped', 'unknown'].includes(data.playbackStatus) || !caps ||
      ['playPause', 'previous', 'next', 'seek', 'open'].some(key => typeof caps[key] !== 'boolean')) throw Error('Invalid Spotify state.');
  const state: SpotifyState = { status: data.status as SpotifyState['status'], source: 'linux-mpris', playbackStatus: data.playbackStatus as SpotifyState['playbackStatus'],
    capabilities: { playPause: caps.playPause as boolean, previous: caps.previous as boolean, next: caps.next as boolean, seek: caps.seek as boolean, open: caps.open as boolean } };
  if (state.status !== 'available') {
    state.playbackStatus = 'unknown';
    state.capabilities = { playPause: false, previous: false, next: false, seek: false, open: state.capabilities.open };
  } else {
    const metadata = record(data.track);
    if (metadata) {
      const title = text(metadata.title, 512), artists = Array.isArray(metadata.artists)
        ? metadata.artists.slice(0, 10).flatMap(value => text(value, 256) ?? []) : [];
      if (title || artists.length) {
        state.track = { title: title ?? '', artists };
        const album = text(metadata.album, 512), durationMs = time(metadata.durationMs), art = text(metadata.artUrl, 2048);
        if (album) state.track.album = album;
        if (durationMs !== undefined) state.track.durationMs = durationMs;
        if (art) { try { const url = new URL(art); if (url.protocol === 'https:' && url.hostname === 'i.scdn.co' && !url.username && !url.password && !url.port) state.track.artUrl = url.toString(); } catch { /* No arbitrary/file artwork. */ } }
      }
    }
    const position = time(data.positionMs);
    if (position !== undefined) state.positionMs = state.track?.durationMs === undefined ? position : Math.min(position, state.track.durationMs);
    if (!state.track?.durationMs) state.capabilities.seek = false;
  }
  // Reasons are our fixed helper protocol codes, not arbitrary player data.
  const reasons: Record<string, string> = { 'not-running': 'Spotify is not running. Open the installed Spotify desktop app.',
    'not-installed': 'The Spotify desktop app was not found. Install Spotify to use local playback controls.',
    'ambiguous-player': 'More than one Spotify instance is available. Close the extra instance and refresh.',
    'permission-denied': 'Desktop security denied access to Spotify’s local media controls. Check the app’s desktop permissions.',
    'transport-error': 'The Spotify desktop player could not be read. Refresh and try again.' };
  if (typeof data.reason === 'string' && reasons[data.reason]) state.reason = reasons[data.reason];
  const diagnostic = record(data.diagnostic);
  if (state.status === 'error' && diagnostic && typeof diagnostic.code === 'string' && typeof diagnostic.stage === 'string' &&
      ['access-denied', 'read-failed'].includes(diagnostic.code) && ['discovery', 'identity', 'player-properties'].includes(diagnostic.stage)) {
    state.diagnostic = { code: diagnostic.code as NonNullable<SpotifyState['diagnostic']>['code'],
      stage: diagnostic.stage as NonNullable<SpotifyState['diagnostic']>['stage'] };
  }
  return state;
}

export function validateSpotifyCommand(value: unknown): SpotifyCommand {
  const data = record(value);
  if (!data || typeof data.action !== 'string' || !['play-pause', 'previous', 'next', 'seek', 'open'].includes(data.action) ||
      Object.keys(data).some(key => !['action', ...(data.action === 'seek' ? ['positionMs'] : [])].includes(key)) ||
      data.action === 'seek' && time(data.positionMs) === undefined) throw Error('Invalid Spotify operation.');
  return data as unknown as SpotifyCommand;
}

/** Persistent, bounded JSON transport to the local session bus. No OAuth,
 * automatic player launch, background playback or Web API requests. */
export class SpotifyManager {
  private child?: ChildProcessWithoutNullStreams;
  private partial = '';
  private nextId = 0;
  private value = empty('not-running', 'Spotify has not been checked.');
  private pending = new Map<number, { resolve(value: SpotifyState): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  constructor(private options: { helper: string; environment?: NodeJS.ProcessEnv; changed?: (state: SpotifyState) => void;
    start?: () => ChildProcessWithoutNullStreams; timeoutMs?: number; platform?: NodeJS.Platform }) {}
  get current(): SpotifyState { return structuredClone(this.value); }
  private publish(value: SpotifyState): void { this.value = value; this.options.changed?.(this.current); }
  private fail(reason: string): void {
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(Error(reason)); }
    this.pending.clear(); this.publish(empty('error', reason));
  }
  private start(): void {
    if (this.child) return;
    if ((this.options.platform ?? process.platform) !== 'linux') throw Error('Local Spotify controls require a Linux desktop session.');
    if (!path.isAbsolute(this.options.helper) || !existsSync(this.options.helper)) throw Error('The local Spotify integration helper is unavailable.');
    const child = this.options.start?.() ?? spawn('gjs', ['-m', this.options.helper], {
      env: externalLauncherEnvironment(this.options.environment ?? process.env), stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child; this.partial = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (this.child !== child) return;
      this.partial += chunk;
      if (Buffer.byteLength(this.partial, 'utf8') > 65_536) { this.dispose(); return; }
      let newline;
      while ((newline = this.partial.indexOf('\n')) >= 0) {
        const line = this.partial.slice(0, newline); this.partial = this.partial.slice(newline + 1);
        if (line) this.receive(line);
      }
    });
    child.stderr.resume(); // Never copy player metadata or raw D-Bus errors into logs.
    child.stdin.on('error', () => { if (this.child === child) this.dispose(); });
    child.once('error', () => { if (this.child === child) { this.child = undefined; this.fail('The local Spotify helper could not start. Install GJS to enable MPRIS controls.'); } });
    child.once('close', () => { if (this.child === child) { this.child = undefined; this.fail('The local Spotify connection closed. Refresh to reconnect.'); } });
  }
  private receive(line: string): void {
    try {
      const message = record(JSON.parse(line));
      if (!message) throw Error();
      const state = parseSpotifyState(message.state);
      if (message.event === 'state') { this.publish(state); return; }
      if (!Number.isSafeInteger(message.id) || typeof message.ok !== 'boolean' || message.event !== undefined) throw Error();
      const pending = this.pending.get(message.id as number);
      if (!pending) return;
      clearTimeout(pending.timer); this.pending.delete(message.id as number); this.publish(state);
      if (message.ok) pending.resolve(this.current);
      else pending.reject(Error(message.error === 'unsupported-control' ? 'Spotify does not currently support that control.' :
        message.error === 'unavailable' ? 'The Spotify desktop player is not available.' :
          'Spotify did not confirm the request. Refresh before trying again.'));
    } catch { this.dispose(); }
  }
  private request(method: 'state' | 'control', command?: SpotifyCommand): Promise<SpotifyState> {
    this.start();
    if (this.pending.size >= 8) return Promise.reject(Error('Too many Spotify requests are pending.'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { if (this.pending.has(id)) this.dispose(); }, this.options.timeoutMs ?? (method === 'control' ? 20_000 : 10_000));
      this.pending.set(id, { resolve, reject, timer });
      try { this.child!.stdin.write(JSON.stringify({ id, method, ...(command ? { command } : {}) }) + '\n'); }
      catch { this.dispose(); }
    });
  }
  async state(): Promise<SpotifyState> {
    try { return await this.request('state'); }
    catch (error) { const reason = (error as Error).message; this.publish(empty((this.options.platform ?? process.platform) !== 'linux' ? 'unsupported' : 'error', reason)); return this.current; }
  }
  async control(value: SpotifyCommand): Promise<SpotifyState> { return this.request('control', validateSpotifyCommand(value)); }
  dispose(): void {
    const child = this.child; this.child = undefined; this.partial = '';
    this.fail('The local Spotify connection is disconnected. Refresh to reconnect.');
    if (!child) return;
    child.stdin.end(); child.kill('SIGTERM');
    const timer = setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 1500);
    timer.unref(); child.once('close', () => clearTimeout(timer));
  }
}
