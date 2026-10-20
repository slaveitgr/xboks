import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { constants, promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { addLiveSteamShortcut, requestSteamImport } from './steam-live.js';
import { findSteamLaunch, findSteamLaunches, planSteamShortcut, type SteamLaunch } from './steam-shortcuts.js';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('node:child_process', async original => ({ ...await original<typeof import('node:child_process')>(), execFile: execute }));
let root: string;
const launch: SteamLaunch = { title: 'Live title', executable: '"/bin/sh"', options: '"/home/test/launch-game" "0123456789abcdef"',
  directory: '/home/test', identity: 'profile:game', icon: '/home/test/icon.png' };
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-steam-live-')); execute.mockReset(); });
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); await fs.rm(root, { recursive: true, force: true }); });
function assigned(bytes = planSteamShortcut(undefined, launch).bytes) {
  const result = Buffer.from(bytes); result.writeUInt32LE(0xf1234567, result.indexOf(Buffer.from('appid\0')) + 6); return result;
}
const uri = `steam://rungameid/${(0xf1234567n << 32n) | 0x02000000n}`;

describe('live Steam confirmation', () => {
  it('waits for Steam to write its real assigned ID, never modifying its VDF itself', async () => {
    const request = vi.fn(async () => { await fs.writeFile(path.join(root, 'shortcuts.vdf'), assigned(), { mode: 0o600 }); });
    expect(await addLiveSteamShortcut([root], launch, '/private/game.desktop', {}, request)).toBe(uri);
    expect(request).toHaveBeenCalledWith('/private/game.desktop');
    expect(await fs.readFile(path.join(root, 'shortcuts.vdf'))).toEqual(assigned());
    expect((await fs.readdir(root)).some(file => file.includes('backup') || file.includes('lock'))).toBe(false);
  });
  it('recognizes equivalent quoted arguments and avoids duplicate live imports', async () => {
    const bytes = planSteamShortcut(undefined, { ...launch, executable: '/bin/sh', options: '/home/test/launch-game 0123456789abcdef' }).bytes;
    const actual = assigned(bytes);
    expect(findSteamLaunch(actual, launch)).toBe(0xf1234567);
    await fs.writeFile(path.join(root, 'shortcuts.vdf'), actual, { mode: 0o600 });
    const request = vi.fn();
    const choose = vi.fn(async () => root);
    expect(await addLiveSteamShortcut([root], launch, '/private/game.desktop', {}, request, 0, choose)).toBe(uri);
    expect(choose).toHaveBeenCalledWith([root]);
    expect(request).not.toHaveBeenCalled();
    expect(await fs.readFile(path.join(root, 'shortcuts.vdf'))).toEqual(actual);
  });
  it('does not pretend an accepted URI alone means the game was added', async () => {
    const request = vi.fn(async () => {});
    await expect(addLiveSteamShortcut([root], launch, '/private/game.desktop', {}, request, 0)).rejects.toThrow('has not confirmed');
    expect(request).toHaveBeenCalled();
    expect(await fs.readdir(root)).toEqual([]);
  });
  it('releases its import guard after a request failure', async () => {
    await expect(addLiveSteamShortcut([root], launch, '/private/game.desktop', {}, async () => { throw Error('request failed'); })).rejects.toThrow('request failed');
    expect(await addLiveSteamShortcut([root], launch, '/private/game.desktop', {}, async () => {
      await fs.writeFile(path.join(root, 'shortcuts.vdf'), assigned(), { mode: 0o600 });
    })).toBe(uri);
  });
  it('rejects overlapping imports rather than racing the shared client handshake', async () => {
    let release: () => void = () => {};
    const request = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
    const first = addLiveSteamShortcut([root], launch, '/private/game.desktop', {}, request);
    await vi.waitFor(() => expect(request).toHaveBeenCalled());
    await expect(addLiveSteamShortcut([root], launch, '/other.desktop', {}, request)).rejects.toThrow('in progress');
    await fs.writeFile(path.join(root, 'shortcuts.vdf'), assigned(), { mode: 0o600 });
    release(); expect(await first).toBe(uri);
  });
});

describe('Steam-owned profile selection', () => {
  async function profiles() {
    const accounts = ['123', '456'].map(id => path.join(root, 'userdata', id, 'config'));
    for (const account of accounts) await fs.mkdir(account, { recursive: true, mode: 0o700 });
    return accounts;
  }
  const cover = Buffer.from('89504e470d0a1a0a', 'hex');
  it('observes the current session import across saved profiles without reading login preferences', async () => {
    const accounts = await profiles();
    // No loginusers.vdf, MostRecent, AutoLogin or registry is required.
    const request = vi.fn(async () => { await fs.writeFile(path.join(accounts[1], 'shortcuts.vdf'), assigned(), { mode: 0o600 }); });
    expect(await addLiveSteamShortcut(accounts, launch, '/private/game.desktop', { cover }, request, 0)).toBe(uri);
    expect(request).toHaveBeenCalledOnce();
    expect(await fs.readFile(path.join(accounts[1], 'grid/4045620583p.png'))).toEqual(cover);
    expect(await fs.readdir(accounts[0])).toEqual([]);
  });
  it('never treats an inactive existing shortcut as acknowledgment of a new import', async () => {
    const accounts = await profiles();
    await fs.writeFile(path.join(accounts[0], 'shortcuts.vdf'), assigned(), { mode: 0o600 });
    const choose = vi.fn(async () => undefined);
    const request = vi.fn(async () => { await fs.writeFile(path.join(accounts[1], 'shortcuts.vdf'), assigned(), { mode: 0o600 }); });
    expect(await addLiveSteamShortcut(accounts, launch, '/private/game.desktop', { cover }, request, 0, choose)).toBe(uri);
    expect(choose).toHaveBeenCalledWith([accounts[0]]);
    expect(await fs.readdir(accounts[0])).toEqual(['shortcuts.vdf']);
    expect(await fs.readFile(path.join(accounts[1], 'grid/4045620583p.png'))).toEqual(cover);
  });
  it('requires explicit reuse and never duplicates a shortcut after account switching', async () => {
    const accounts = await profiles();
    for (const account of accounts) await fs.writeFile(path.join(account, 'shortcuts.vdf'), assigned(), { mode: 0o600 });
    const request = vi.fn();
    await expect(addLiveSteamShortcut(accounts, launch, '/private/game.desktop', {}, request, 0)).rejects.toThrow('Choose');
    expect(await addLiveSteamShortcut(accounts, launch, '/private/game.desktop', { cover }, request, 0, async existing => existing[1])).toBe(uri);
    expect(request).not.toHaveBeenCalled();
    expect(await fs.readdir(accounts[0])).toEqual(['shortcuts.vdf']);
  });
  it('ignores old matches and detects a newly assigned ID even in a profile with a duplicate', async () => {
    const [account] = await profiles();
    const old = assigned(); await fs.writeFile(path.join(account, 'shortcuts.vdf'), old, { mode: 0o600 });
    // Append a second real matching entry with another Steam-assigned ID.
    const block = Buffer.from(old.subarray(Buffer.byteLength('\0shortcuts\0'), -2));
    block[1] = '1'.charCodeAt(0);
    block.writeUInt32LE(0xf1234568, block.indexOf(Buffer.from('appid\0')) + 6);
    const doubled = Buffer.concat([old.subarray(0, -2), block, old.subarray(-2)]);
    expect(findSteamLaunches(doubled, launch)).toEqual([0xf1234567, 0xf1234568]);
    const request = async () => { await fs.writeFile(path.join(account, 'shortcuts.vdf'), doubled); };
    expect(await addLiveSteamShortcut([account], launch, '/private/game.desktop', {}, request, 0, async () => undefined))
      .toBe(`steam://rungameid/${(0xf1234568n << 32n) | 0x02000000n}`);
  });
  it('rejects more than one changed profile without writing artwork or guessing', async () => {
    const accounts = await profiles();
    const request = async () => { for (const account of accounts) await fs.writeFile(path.join(account, 'shortcuts.vdf'), assigned(), { mode: 0o600 }); };
    await expect(addLiveSteamShortcut(accounts, launch, '/private/game.desktop', { cover }, request, 0)).rejects.toThrow('more than one');
    for (const account of accounts) expect(await fs.readdir(account)).toEqual(['shortcuts.vdf']);
  });
  it('offers explicit selection if more than one profile confirms a new entry', async () => {
    const accounts = await profiles();
    const request = async () => { for (const account of accounts) await fs.writeFile(path.join(account, 'shortcuts.vdf'), assigned(), { mode: 0o600 }); };
    const choose = vi.fn(async (matching: string[]) => matching[1]);
    expect(await addLiveSteamShortcut(accounts, launch, '/private/game.desktop', { cover }, request, 0, choose)).toBe(uri);
    expect(choose).toHaveBeenCalledWith(accounts);
    expect(await fs.readdir(accounts[0])).toEqual(['shortcuts.vdf']);
  });
  it('retries partially written profile files and never writes optional artwork before a complete read', async () => {
    const accounts = await profiles();
    let repaired: Promise<void> = Promise.resolve();
    const request = async () => {
      await fs.writeFile(path.join(accounts[0], 'shortcuts.vdf'), assigned(), { mode: 0o600 });
      await fs.writeFile(path.join(accounts[1], 'shortcuts.vdf'), 'partial', { mode: 0o600 });
      repaired = new Promise<void>((resolve, reject) => setTimeout(() => {
        fs.writeFile(path.join(accounts[1], 'shortcuts.vdf'), planSteamShortcut(undefined, { ...launch, options: 'other' }).bytes)
          .then(resolve, reject);
      }, 30));
    };
    expect(await addLiveSteamShortcut(accounts, launch, '/private/game.desktop', { cover }, request, 1000)).toBe(uri);
    await repaired;
    expect(await fs.readdir(accounts[1])).toEqual(['shortcuts.vdf']);
  });
  it('does not confuse an existing entry or an unrelated file change with import success', async () => {
    const accounts = await profiles();
    await fs.writeFile(path.join(accounts[0], 'shortcuts.vdf'), assigned(), { mode: 0o600 });
    const request = async () => { await fs.writeFile(path.join(accounts[1], 'shortcuts.vdf'), planSteamShortcut(undefined, { ...launch, options: 'other-game' }).bytes, { mode: 0o600 }); };
    await expect(addLiveSteamShortcut(accounts, launch, '/private/game.desktop', {}, request, 0, async () => undefined)).rejects.toThrow('has not confirmed');
  });
  it('handles cancelled/invalid reuse and preserves the import guard', async () => {
    const accounts = await profiles();
    await fs.writeFile(path.join(accounts[0], 'shortcuts.vdf'), assigned(), { mode: 0o600 });
    const request = vi.fn();
    await expect(addLiveSteamShortcut(accounts, launch, '/private/game.desktop', {}, request, 0, async () => { throw Error('cancelled'); })).rejects.toThrow('cancelled');
    await expect(addLiveSteamShortcut(accounts, launch, '/private/game.desktop', {}, request, 0, async () => '/wrong')).rejects.toThrow('Invalid');
    expect(request).not.toHaveBeenCalled();
    expect(await addLiveSteamShortcut(accounts, launch, '/private/game.desktop', {}, request, 0, async existing => existing[0])).toBe(uri);
  });
  it('does not create duplicates for repeated account paths and fails closed on unreadable snapshots', async () => {
    const accounts = await profiles();
    const request = async () => { await fs.writeFile(path.join(accounts[0], 'shortcuts.vdf'), assigned(), { mode: 0o600 }); };
    expect(await addLiveSteamShortcut([accounts[0], accounts[0]], launch, '/private/game.desktop', {}, request, 0)).toBe(uri);
    await fs.writeFile(path.join(accounts[1], 'shortcuts.vdf'), 'malformed', { mode: 0o600 });
    const untouched = vi.fn();
    await expect(addLiveSteamShortcut(accounts, launch, '/private/game.desktop', {}, untouched, 0)).rejects.toThrow();
    expect(untouched).not.toHaveBeenCalled();
  });
});

describe('native Steam URI request', () => {
  async function setup() {
    const file = path.join(root, 'Game with spaces and é.desktop'); await fs.writeFile(file, '[Desktop Entry]', { mode: 0o600 });
    const handle = { stat: vi.fn(async () => ({ isFile: () => true, uid: process.getuid?.(), nlink: 1, size: 0, mode: 0o600 })),
      utimes: vi.fn(async () => {}), close: vi.fn(async () => {}) };
    vi.spyOn(fs, 'open').mockResolvedValue(handle as any);
    execute.mockImplementation((_binary, _args, _options, done) => done(null));
    return { file, handle };
  }
  it('sends a single encoded path without a shell and uses a safe nonblocking sentinel', async () => {
    const { file, handle } = await setup();
    await requestSteamImport(file);
    expect(fs.open).toHaveBeenCalledWith('/tmp/addnonsteamgamefile', expect.any(Number), 0o600);
    const flags = vi.mocked(fs.open).mock.calls[0][1] as number;
    expect(flags & constants.O_NOFOLLOW).not.toBe(0);
    expect(flags & constants.O_NONBLOCK).not.toBe(0);
    expect(flags & constants.O_TRUNC).toBe(0);
    expect(execute).toHaveBeenCalledWith('/usr/bin/steam', ['steam://addnonsteamgame/' + encodeURIComponent(file)],
      expect.objectContaining({ timeout: 5000, killSignal: 'SIGKILL', maxBuffer: 8192 }), expect.any(Function));
    expect(handle.close).toHaveBeenCalledOnce();
  });
  it('never touches an unsafe existing handshake file', async () => {
    const { file, handle } = await setup();
    handle.stat.mockResolvedValue({ isFile: () => true, uid: -1, nlink: 1, size: 0, mode: 0o600 });
    await expect(requestSteamImport(file)).rejects.toThrow('Unsafe');
    expect(handle.utimes).not.toHaveBeenCalled(); expect(handle.close).toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  });
  it('rejects symlink launchers and reports missing/broken Steam without raw output', async () => {
    const { file } = await setup(); const alias = path.join(root, 'link.desktop'); await fs.symlink(file, alias);
    await expect(requestSteamImport(alias)).rejects.toThrow('Unsafe');
    execute.mockImplementation((_binary, _args, _options, done) => done(Error('secret raw output')));
    await expect(requestSteamImport(file)).rejects.toThrow('Could not send');
  });
});
