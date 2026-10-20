import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { readFileSync } from 'node:fs';
import { gameModeDisplayEnvironment, prepareGameModeKeyring } from './session-environment.js';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('node:child_process', async original => ({ ...await original<typeof import('node:child_process')>(), execFile: execute }));
const session = { XDG_CURRENT_DESKTOP: 'gamescope', DISPLAY: ':1', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus' };
beforeEach(() => {
  execute.mockReset().mockImplementation((_binary, _args, _options, done) => done(null));
  vi.spyOn(fs, 'lstat').mockResolvedValue({ isSocket: () => true, uid: process.getuid?.() } as any);
  vi.spyOn(fs, 'access').mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('Game Mode keyring activation environment', () => {
  it.each(['KDE', 'GNOME', 'ubuntu:GNOME', 'XFCE', ''])('does not touch the normal desktop %j, even with Steam variables', async desktop => {
    expect(await prepareGameModeKeyring({ ...session, XDG_CURRENT_DESKTOP: desktop, SteamDeck: '1', GAMESCOPE_WAYLAND_DISPLAY: 'gamescope-0' })).toBe('skipped');
    expect(execute).not.toHaveBeenCalled();
    expect(fs.lstat).not.toHaveBeenCalled();
  });
  it.each(['win32', 'darwin'] as const)('does not run on %s', async platform => {
    expect(await prepareGameModeKeyring(session, platform)).toBe('skipped');
    expect(execute).not.toHaveBeenCalled();
  });
  it.each([undefined, '', 'localhost:10.0', 'remote:0', ':1\n--all', ':1;bad'])('rejects absent or nonlocal display %j', async display => {
    expect(await prepareGameModeKeyring({ ...session, DISPLAY: display })).toBe('skipped');
    expect(execute).not.toHaveBeenCalled();
  });
  it('requires an existing session bus and never starts a private replacement', async () => {
    expect(await prepareGameModeKeyring({ ...session, DBUS_SESSION_BUS_ADDRESS: undefined })).toBe('skipped');
    expect(execute).not.toHaveBeenCalled();
  });
  it('publishes only three graphical values, clearing absent stale endpoints', async () => {
    const environment = { ...session, SECRET_TOKEN: 'private', LD_LIBRARY_PATH: '/steam/libs' };
    const original = { ...environment };
    expect(await prepareGameModeKeyring(environment)).toBe('updated');
    expect(execute).toHaveBeenCalledWith('/usr/bin/dbus-update-activation-environment',
      ['--systemd', 'DISPLAY=:1', 'XAUTHORITY=', 'WAYLAND_DISPLAY='],
      expect.objectContaining({ timeout: 2000, killSignal: 'SIGKILL', maxBuffer: 4096 }), expect.any(Function));
    expect(environment).toEqual(original);
    expect(execute.mock.calls[0][1].join(' ')).not.toMatch(/SECRET_TOKEN|LD_LIBRARY_PATH|--all/);
  });
  it('passes an authority path literally and validates the current Wayland socket', async () => {
    const environment = { ...session, DISPLAY: ':1.0', XAUTHORITY: "/tmp/it's a $literal cookie", WAYLAND_DISPLAY: 'gamescope-0', XDG_RUNTIME_DIR: '/run/user/1000' };
    expect(await prepareGameModeKeyring(environment)).toBe('updated');
    expect(fs.lstat).toHaveBeenCalledWith('/tmp/.X11-unix/X1');
    expect(fs.lstat).toHaveBeenCalledWith('/run/user/1000/gamescope-0');
    expect(fs.access).toHaveBeenCalledWith(environment.XAUTHORITY, expect.any(Number));
    expect(execute.mock.calls[0][1]).toContain('XAUTHORITY=' + environment.XAUTHORITY);
  });
  it.each([{ XAUTHORITY: 'relative' }, { XAUTHORITY: '/tmp/bad\nvalue' }, { WAYLAND_DISPLAY: '../other' }])('rejects malformed endpoints %j', async override => {
    expect(gameModeDisplayEnvironment({ ...session, ...override })).toBeUndefined();
    expect(execute).not.toHaveBeenCalled();
  });
  it.each(['missing', 'not-socket', 'foreign-owner', 'unreadable-authority', 'missing-runtime', 'wayland-failure'])('leaves invalid session prerequisites alone: %s', async scenario => {
    if (scenario === 'missing') vi.mocked(fs.lstat).mockRejectedValue(Error('missing'));
    if (scenario === 'not-socket') vi.mocked(fs.lstat).mockResolvedValue({ isSocket: () => false } as any);
    if (scenario === 'foreign-owner') vi.mocked(fs.lstat).mockResolvedValue({ isSocket: () => true, uid: -1 } as any);
    if (scenario === 'unreadable-authority') vi.mocked(fs.access).mockRejectedValue(Error('denied'));
    if (scenario === 'wayland-failure') vi.mocked(fs.lstat).mockResolvedValueOnce({ isSocket: () => true, uid: process.getuid?.() } as any).mockRejectedValue(Error('missing'));
    const environment = { ...session, ...(scenario === 'unreadable-authority' ? { XAUTHORITY: '/tmp/auth' } : {}),
      ...(['missing-runtime', 'wayland-failure'].includes(scenario) ? { WAYLAND_DISPLAY: 'gamescope-0' } : {}),
      ...(scenario === 'wayland-failure' ? { XDG_RUNTIME_DIR: '/run/user/1000' } : {}) };
    expect(await prepareGameModeKeyring(environment)).toBe('unavailable');
    expect(execute).not.toHaveBeenCalled();
  });
  it.each(['ENOENT', 'timeout', 'bus-denied'])('keeps an unavailable update nonfatal: %s', async reason => {
    execute.mockImplementation((_binary, _args, _options, done) => done(Error(reason)));
    expect(await prepareGameModeKeyring(session)).toBe('unavailable');
  });
  it('awaits completion before allowing backend initialization', async () => {
    let complete: (error: Error | null) => void = () => {};
    execute.mockImplementation((_binary, _args, _options, done) => { complete = done; });
    let finished = false;
    const result = prepareGameModeKeyring(session).then(value => { finished = true; return value; });
    await vi.waitFor(() => expect(execute).toHaveBeenCalled());
    expect(finished).toBe(false);
    complete(null);
    expect(await result).toBe('updated');
    const source = readFileSync('src/main/index.ts', 'utf8');
    const ready = source.slice(source.indexOf('app.whenReady()'));
    expect(ready.indexOf('await prepareGameModeKeyring()')).toBeLessThan(ready.indexOf('await backend.refresh()'));
    expect(ready).toContain('if (!demoMode && await prepareGameModeKeyring()');
  });
});
