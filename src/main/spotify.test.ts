import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { parseSpotifyState, SpotifyManager, validateSpotifyCommand } from './spotify.js';

const available = { status: 'available', source: 'linux-mpris', playbackStatus: 'playing',
  track: { title: 'Song "quoted" Δ', artists: ['Artist'], album: 'Album', artUrl: 'https://i.scdn.co/image/test', durationMs: 180000 }, positionMs: 12000,
  capabilities: { playPause: true, previous: false, next: true, seek: true, open: true } };
let root: string, manager: SpotifyManager;
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'xboks-spotify-')); await fs.writeFile(path.join(root, 'helper.js'), '// fixture, never executed'); });
afterEach(async () => { manager?.dispose(); await fs.rm(root, { recursive: true, force: true }); });
function fixture(timeoutMs = 1000) {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null as number | null,
    kill: vi.fn(() => { child.exitCode = 0; child.emit('close', 0); return true; }) });
  const start = vi.fn(() => child as unknown as ChildProcessWithoutNullStreams), messages: any[] = [];
  child.stdin.on('data', bytes => { for (const line of String(bytes).trim().split('\n')) if (line) messages.push(JSON.parse(line)); });
  manager = new SpotifyManager({ helper: path.join(root, 'helper.js'), start, timeoutMs });
  return { child, start, messages, reply: (value: unknown) => child.stdout.write(JSON.stringify(value) + '\n') };
}

describe('local Spotify state boundary', () => {
  it('preserves observed metadata/capabilities without inventing account authorization or playlists', () => {
    expect(parseSpotifyState(available)).toEqual(available);
    const result = parseSpotifyState({ ...available, authorized: true, playlists: ['fake'], capabilities: { ...available.capabilities, premium: true } });
    expect(result).not.toHaveProperty('authorized'); expect(result).not.toHaveProperty('playlists'); expect(result.capabilities).not.toHaveProperty('premium');
  });
  it.each(['file:///home/private/cover.png', 'http://i.scdn.co/image/a', 'https://attacker.example/a', 'https://i.scdn.co.evil.example/a', 'https://user:pass@i.scdn.co/a'])(
    'does not expose arbitrary or local artwork: %s', artUrl => {
      expect(parseSpotifyState({ ...available, track: { ...available.track, artUrl } }).track?.artUrl).toBeUndefined();
    },
  );
  it('drops invalid/oversized metadata and bounds times without converting missing values into a track', () => {
    const value = parseSpotifyState({ ...available, positionMs: 1e20, track: { title: 'A'.repeat(513), artists: [null, 'B'.repeat(257)], durationMs: -1 } });
    expect(value.track).toBeUndefined(); expect(value.positionMs).toBeUndefined(); expect(value.capabilities.seek).toBe(false);
    expect(parseSpotifyState({ ...available, positionMs: 200000 }).positionMs).toBe(180000);
  });
  it('clears all transport state after absence and does not report helper response bodies as reasons', () => {
    const value = parseSpotifyState({ ...available, status: 'not-running', reason: 'private raw DBus error' });
    expect(value.track).toBeUndefined(); expect(value.positionMs).toBeUndefined(); expect(value.playbackStatus).toBe('unknown');
    expect(value.capabilities).toEqual({ playPause: false, previous: false, next: false, seek: false, open: true }); expect(value.reason).toBeUndefined();
  });
  it('reports a denied local read precisely and exposes only fixed diagnostic codes', () => {
    const value = parseSpotifyState({ ...available, status: 'error', reason: 'permission-denied',
      diagnostic: { code: 'access-denied', stage: 'player-properties', message: 'private D-Bus body' } });
    expect(value.reason).toContain('Desktop security denied access'); expect(value.reason).not.toContain('Refresh');
    expect(value.diagnostic).toEqual({ code: 'access-denied', stage: 'player-properties' });
    expect(value.track).toBeUndefined(); expect(value.positionMs).toBeUndefined();
    expect(value.capabilities).toEqual({ playPause: false, previous: false, next: false, seek: false, open: true });
    for (const diagnostic of [{ code: ['access-denied'], stage: 'identity' }, { code: 'access-denied', stage: ['identity'] },
      { code: 'private error', stage: 'identity' }, { code: 'read-failed', stage: '/private/path' }]) {
      expect(parseSpotifyState({ ...available, status: 'error', diagnostic }).diagnostic).toBeUndefined();
    }
    expect(parseSpotifyState({ ...available, diagnostic: { code: 'read-failed', stage: 'identity' } }).diagnostic).toBeUndefined();
  });
  it.each([{ ...available, source: 'web-api' }, { ...available, status: ['available'] }, { ...available, playbackStatus: ['playing'] },
    { ...available, capabilities: { ...available.capabilities, next: 'true' } }])('rejects malformed protocol states', value => {
    expect(() => parseSpotifyState(value)).toThrow('Invalid Spotify state');
  });
  it.each([null, 'next', { action: ['open'] }, { action: 'quit' }, { action: 'open', uri: 'file:///tmp/script' },
    { action: 'next', positionMs: 1 }, { action: 'seek', positionMs: -1 }, { action: 'seek', positionMs: 1.2 },
    { action: 'seek', positionMs: 604800001 }, { action: 'seek', positionMs: '1000' }])('rejects arbitrary launches or invalid commands', value => {
    expect(() => validateSpotifyCommand(value)).toThrow('Invalid Spotify operation');
  });
  it('accepts only the fixed controls and bounded absolute seek values', () => {
    for (const action of ['play-pause', 'previous', 'next', 'open']) expect(validateSpotifyCommand({ action })).toEqual({ action });
    expect(validateSpotifyCommand({ action: 'seek', positionMs: 12000 })).toEqual({ action: 'seek', positionMs: 12000 });
  });
});

describe('persistent local Spotify transport', () => {
  it('uses one helper and never changes playback during a state read, returning cloned snapshots', async () => {
    const f = fixture(), pending = manager.state();
    expect(f.messages).toEqual([{ id: 1, method: 'state' }]);
    f.reply({ id: 1, ok: true, state: available }); const result = await pending;
    result.track!.artists.push('mutated'); expect(manager.current.track!.artists).toEqual(['Artist']);
    const next = manager.control({ action: 'next' }); expect(f.messages[1]).toEqual({ id: 2, method: 'control', command: { action: 'next' } });
    f.reply({ id: 2, ok: true, state: { ...available, playbackStatus: 'paused' } });
    expect((await next).playbackStatus).toBe('paused'); expect(f.start).toHaveBeenCalledOnce();
  });
  it('accepts real state events and clears metadata when the player exits', async () => {
    const f = fixture(), pending = manager.state(); f.reply({ id: 1, ok: true, state: available }); await pending;
    f.reply({ event: 'state', state: { ...available, status: 'not-running', reason: 'not-running' } });
    expect(manager.current).toMatchObject({ status: 'not-running', playbackStatus: 'unknown' }); expect(manager.current.track).toBeUndefined();
  });
  it('rejects unsupported and uncertain mutations without automatic retry', async () => {
    const f = fixture();
    const pending = manager.control({ action: 'previous' }); const rejected = expect(pending).rejects.toThrow('does not currently support');
    f.reply({ id: 1, ok: false, state: available, error: 'unsupported-control' }); await rejected;
    expect(f.messages).toHaveLength(1); expect(manager.current.status).toBe('available');
    const second = manager.control({ action: 'next' }); const unconfirmed = expect(second).rejects.toThrow('did not confirm');
    f.reply({ id: 2, ok: false, state: available, error: 'private payload' }); await unconfirmed; expect(f.messages).toHaveLength(2);
  });
  it('fails closed on malformed/oversized protocol output and drops uncertain requests on timeout', async () => {
    const f = fixture(), pending = manager.control({ action: 'next' }); const rejected = expect(pending).rejects.toThrow('disconnected');
    f.reply({ id: 1, ok: true, state: { ...available, capabilities: {} } }); await rejected;
    expect(f.child.kill).toHaveBeenCalled(); expect(manager.current.track).toBeUndefined();
    const second = fixture(10); await expect(manager.control({ action: 'next' })).rejects.toThrow('disconnected');
    expect(second.messages).toHaveLength(1); expect(second.child.kill).toHaveBeenCalled();
    const third = fixture(), read = manager.state(); third.child.stdout.write('A'.repeat(65537));
    expect((await read).status).toBe('error'); expect(third.child.kill).toHaveBeenCalled();
  });
  it('reports helper absence and unsupported platforms as known states without spawning or launch fallback', async () => {
    const start = vi.fn();
    manager = new SpotifyManager({ helper: path.join(root, 'missing.js'), start });
    expect((await manager.state()).status).toBe('error'); expect(start).not.toHaveBeenCalled();
    manager = new SpotifyManager({ helper: path.join(root, 'helper.js'), start, platform: 'win32' });
    expect((await manager.state()).status).toBe('unsupported'); expect(start).not.toHaveBeenCalled();
  });
  it('validates commands before starting a helper', async () => {
    const f = fixture(); await expect(manager.control({ action: 'open', uri: 'file:///tmp/run' } as any)).rejects.toThrow('Invalid Spotify operation');
    expect(f.start).not.toHaveBeenCalled();
  });
});
