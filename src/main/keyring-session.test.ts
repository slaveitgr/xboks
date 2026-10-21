import { beforeEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
const mocks = vi.hoisted(() => ({ lstat: vi.fn(), stat: vi.fn(), access: vi.fn(), spawn: vi.fn() }));
vi.mock('node:fs', async original => ({ ...await original<typeof import('node:fs')>(), promises: { lstat: mocks.lstat, stat: mocks.stat, access: mocks.access } }));
vi.mock('node:child_process', async original => ({ ...await original<typeof import('node:child_process')>(), spawn: mocks.spawn }));
import { keyringSessionEnvironment, startSessionKeyring } from './keyring-session.js';
const source = { XDG_CURRENT_DESKTOP: 'gamescope', DISPLAY: ':1', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus', XDG_RUNTIME_DIR: '/run/user/1000' };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.lstat.mockResolvedValue({ isSocket: () => true, isDirectory: () => true, uid: process.getuid?.(), mode: 0o700 });
  mocks.stat.mockResolvedValue({ isFile: () => true, uid: 0, mode: 0o755 });
  mocks.access.mockResolvedValue(undefined);
  mocks.spawn.mockImplementation(() => { const child = Object.assign(new EventEmitter(), { kill: vi.fn() }); queueMicrotask(() => child.emit('exit', 0)); return child; });
});
it('prepares only the child with a verified local X display, never guesses or updates global session state', async () => {
  const input = { ...source, LD_LIBRARY_PATH: '/steam/lib', LD_PRELOAD: 'overlay.so', QT_PLUGIN_PATH: '/app/plugins', QT_QPA_PLATFORM: 'offscreen', WAYLAND_DISPLAY: 'old-socket', APPDIR: '/tmp/app' };
  const copy = { ...input };
  const result = await keyringSessionEnvironment(input);
  expect(input).toEqual(copy);
  expect(result).toMatchObject({ DISPLAY: ':1', QT_QPA_PLATFORM: 'xcb', DBUS_SESSION_BUS_ADDRESS: source.DBUS_SESSION_BUS_ADDRESS });
  for (const key of ['LD_LIBRARY_PATH','LD_PRELOAD','QT_PLUGIN_PATH','APPDIR','WAYLAND_DISPLAY']) expect(result[key]).toBeUndefined();
});
it('supports a verified native Wayland socket without inheriting an invalid X endpoint', async () => {
  const result = await keyringSessionEnvironment({ ...source, DISPLAY: 'remote:0', WAYLAND_DISPLAY: 'wayland-0', XAUTHORITY: '/old/cookie' });
  expect(result).toMatchObject({ WAYLAND_DISPLAY: 'wayland-0', QT_QPA_PLATFORM: 'wayland' });
  expect(result.DISPLAY).toBeUndefined(); expect(result.XAUTHORITY).toBeUndefined();
});
it.each([{}, { ...source, DISPLAY: undefined }, { ...source, DISPLAY: ':1\nbad' }, { ...source, DBUS_SESSION_BUS_ADDRESS: 'tcp:host=other' },
  { ...source, DISPLAY: undefined, WAYLAND_DISPLAY: '../foreign' }, { ...source, XAUTHORITY: 'relative' }])('rejects missing or unsafe session endpoints %j', async env => {
  await expect(keyringSessionEnvironment(env)).rejects.toThrow();
  expect(mocks.spawn).not.toHaveBeenCalled();
});
it.each(['missing','foreign','regular'])('rejects a %s display socket before starting a provider', async scenario => {
  if (scenario === 'missing') mocks.lstat.mockRejectedValue(Error('not found'));
  else mocks.lstat.mockResolvedValue({ isSocket: () => scenario !== 'regular', uid: scenario === 'foreign' ? -1 : process.getuid?.() });
  await expect(startSessionKeyring('ksecretd', source, async () => false)).rejects.toThrow();
  expect(mocks.spawn).not.toHaveBeenCalled();
});
it.each(['ksecretd','kwallet','kwallet5'] as const)('starts the fixed distro %s executable in a session-bound transient service, outside the Steam reaper', async provider => {
  await startSessionKeyring(provider, source, async () => false);
  const [command, args, options] = mocks.spawn.mock.calls[0];
  expect(command).toBe('/usr/bin/systemd-run');
  expect(args).toEqual(expect.arrayContaining(['--user', '--collect', '--service-type=exec', '--expand-environment=no',
    '--property=PartOf=graphical-session.target', '--property=StandardOutput=null', '--property=StandardError=null',
    '/usr/bin/env', '-i', 'DISPLAY=:1', 'QT_QPA_PLATFORM=xcb', provider === 'ksecretd' ? '/usr/bin/ksecretd' : provider === 'kwallet5' ? '/usr/bin/kwalletd5' : '/usr/bin/kwalletd6']));
  expect(args.some((arg: string) => /^--unit=xboks-keyring-[0-9a-f-]{36}$/.test(arg))).toBe(true);
  expect(options).toEqual({ shell: false, stdio: 'ignore', env: { PATH: '/usr/bin:/bin', XDG_RUNTIME_DIR: source.XDG_RUNTIME_DIR, DBUS_SESSION_BUS_ADDRESS: source.DBUS_SESSION_BUS_ADDRESS } });
});
it('never starts a second provider if an owner appeared during session validation', async () => {
  await startSessionKeyring('ksecretd', source, async () => true);
  expect(mocks.spawn).not.toHaveBeenCalled();
});
it('uses bounded native graceful stop only when a real backend helper is available', async () => {
  await startSessionKeyring('ksecretd', source, async () => false, '/tmp/test-backend/xodus-cli');
  const [, args] = mocks.spawn.mock.calls[0];
  const stop = args.find((arg: string) => arg.startsWith('--property=ExecStop='));
  expect(stop).toContain('"/tmp/test-backend/xodus-cli" "keyring-session-stop" "--provider-pid" ${MAINPID}');
  expect(stop).toContain('"DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus"');
  expect(args).toContain('--property=TimeoutStopSec=12s');
  expect(stop).not.toMatch(/sleep|closeAllWallets|sh -c|kill/);
});
it('does not invent a stop command for an older backend', async () => {
  await startSessionKeyring('ksecretd', source, async () => false);
  expect(mocks.spawn.mock.calls[0][1].some((arg: string) => arg.includes('ExecStop='))).toBe(false);
});
it('quotes literal helper paths and private bus addresses without shell or systemd expansion', async () => {
  const helper = '/tmp/test $HOME/%u/with "quote"/xodus-cli';
  await startSessionKeyring('ksecretd', { ...source, DBUS_SESSION_BUS_ADDRESS: 'unix:path=/tmp/test $BUS/%u/bus' }, async () => false, helper);
  const stop = mocks.spawn.mock.calls[0][1].find((arg: string) => arg.startsWith('--property=ExecStop='));
  expect(stop).toContain('test $$HOME/%%u/with \\"quote\\"/xodus-cli');
  expect(stop).toContain('unix:path=/tmp/test $$BUS/%%u/bus');
  expect(stop).toMatch(/\$\{MAINPID\}$/);
});
it.each(['relative', '/tmp/helper\ncommand', '/tmp/helper\0command'])('rejects an unsafe stop helper path %j', async helper => {
  await expect(startSessionKeyring('ksecretd', source, async () => false, helper)).rejects.toThrow();
  expect(mocks.spawn).not.toHaveBeenCalled();
});
it.each(['foreign', 'writable', 'directory'])('rejects a %s stop helper without starting a provider', async scenario => {
  mocks.stat.mockImplementation(async name => name === '/tmp/helper'
    ? { isFile: () => scenario !== 'directory', uid: scenario === 'foreign' ? -1 : process.getuid?.(), mode: scenario === 'writable' ? 0o777 : 0o700 }
    : { isFile: () => true, uid: 0, mode: 0o755 });
  await expect(startSessionKeyring('ksecretd', source, async () => false, '/tmp/helper')).rejects.toThrow();
  expect(mocks.spawn).not.toHaveBeenCalled();
});
it.each([0o777, 0o775])('rejects a writable provider binary (%i)', async mode => {
  mocks.stat.mockResolvedValue({ isFile: () => true, uid: 0, mode });
  await expect(startSessionKeyring('ksecretd', source, async () => false)).rejects.toThrow();
  expect(mocks.spawn).not.toHaveBeenCalled();
});
it('passes only allowlisted literal display metadata to the service, and connects the client to the actual user manager', async () => {
  const input = { ...source, HOME: '/tmp/test $HOME', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/tmp/private/bus', API_TOKEN: 'private', HTTPS_PROXY: 'https://user:password@proxy', LD_PRELOAD: 'bad.so', QT_PLUGIN_PATH: '/bad' };
  await startSessionKeyring('ksecretd', input, async () => false);
  const [, args, options] = mocks.spawn.mock.calls[0];
  expect(args).toContain('HOME=/tmp/test $HOME'); expect(args).toContain('DBUS_SESSION_BUS_ADDRESS=unix:path=/tmp/private/bus');
  expect(args.join(' ')).not.toMatch(/private(?=\s)|API_TOKEN|password|LD_PRELOAD|QT_PLUGIN_PATH/);
  expect(options.env.DBUS_SESSION_BUS_ADDRESS).toBe('unix:path=/run/user/1000/bus');
});
it.each(['foreign', 'writable', 'symlink', 'not-socket'])('rejects a %s user-manager endpoint', async scenario => {
  mocks.lstat.mockImplementation(async name => name === source.XDG_RUNTIME_DIR
    ? { isDirectory: () => scenario !== 'symlink', uid: scenario === 'foreign' ? -1 : process.getuid?.(), mode: scenario === 'writable' ? 0o777 : 0o700 }
    : { isSocket: () => scenario !== 'not-socket', uid: process.getuid?.() });
  await expect(startSessionKeyring('ksecretd', source, async () => false)).rejects.toThrow();
  expect(mocks.spawn).not.toHaveBeenCalled();
});
it.each(['error', 'exit'])('reports only a fixed error if systemd-run fails (%s)', async event => {
  mocks.spawn.mockImplementation(() => { const child = Object.assign(new EventEmitter(), { kill: vi.fn() }); queueMicrotask(() => child.emit(event, event === 'error' ? Error('private error') : 1)); return child; });
  await expect(startSessionKeyring('ksecretd', source, async () => false)).rejects.toThrow('Could not start system keyring provider');
});
it('bounds a stalled systemd client without leaving xboks Engine waiting indefinitely', async () => {
  vi.useFakeTimers();
  const child = Object.assign(new EventEmitter(), { kill: vi.fn() }); mocks.spawn.mockReturnValue(child);
  try {
    const result = expect(startSessionKeyring('ksecretd', source, async () => false)).rejects.toThrow('Could not start system keyring provider');
    await vi.advanceTimersByTimeAsync(10_000); await result;
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  } finally { vi.useRealTimers(); }
});
