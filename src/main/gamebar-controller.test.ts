import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { controllerSessionActive, GameBarController } from './gamebar-controller.js';

const helper = path.resolve('assets/desktop/gamebar-controller.py');
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
const info = 'User=1000\nActive=yes\nLockedHint=no\nRemote=no\nClass=user\nType=wayland\nSeat=seat0\n';
const sessions = [{ session: '2', uid: 1000, seat: 'seat0', class: 'user' },
  { session: '3', uid: 1000, seat: null, class: 'manager' }];

describe('bounded active desktop session gate', () => {
  const setup = (environment: NodeJS.ProcessEnv = { XDG_CURRENT_DESKTOP: 'GNOME' }) => {
    const run = vi.fn(async (command: string, args: readonly string[]) => command === 'gdbus' ? '(false,)\n' :
      args[0] === 'list-sessions' ? JSON.stringify(sessions) : info);
    return { run, check: () => controllerSessionActive({ uid: 1000, platform: 'linux', environment, run }) };
  };
  it('resolves same-user active local graphical session without XDG_SESSION_ID or self', async () => {
    const f = setup(); expect(await f.check()).toBe(true);
    expect(f.run.mock.calls[0]).toEqual(['loginctl', ['list-sessions', '--json=short', '--no-pager']]);
    expect(f.run.mock.calls[1][1]).toContain('2');
    expect(f.run.mock.calls.flat(2)).not.toContain('self');
    expect(f.run.mock.calls.at(-1)?.[0]).toBe('gdbus');
  });
  it('uses an explicit valid session without enumerating other sessions', async () => {
    const f = setup({ XDG_SESSION_ID: 'c2', XDG_CURRENT_DESKTOP: 'ubuntu:GNOME' });
    expect(await f.check()).toBe(true);
    expect(f.run.mock.calls[0][1]).toContain('c2');
    expect(f.run.mock.calls).toHaveLength(2);
  });
  it.each(['', '--all', '../2', 'a b', 'a\n2', 'x'.repeat(65)])('fails closed for unsafe explicit session %j', async id => {
    const f = setup({ XDG_SESSION_ID: id }); expect(await f.check()).toBe(false); expect(f.run).not.toHaveBeenCalled();
  });
  it.each([
    ['Active=yes', 'Active=no'], ['LockedHint=no', 'LockedHint=yes'], ['Remote=no', 'Remote=yes'],
    ['Class=user', 'Class=greeter'], ['Type=wayland', 'Type=tty'], ['User=1000', 'User=1001'], ['Seat=seat0', 'Seat='],
  ])('rejects inactive/locked/remote/nonuser/nongraphical/other-user/unseated state %s', async (from, to) => {
    const f = setup(); f.run.mockImplementation(async (_command, args) => args[0] === 'list-sessions' ? JSON.stringify(sessions) : info.replace(from, to));
    expect(await f.check()).toBe(false);
  });
  it('does not trust screensaver false without a valid logind session', async () => {
    const f = setup(); f.run.mockImplementation(async command => command === 'gdbus' ? '(false,)' : '[]');
    expect(await f.check()).toBe(false); expect(f.run.mock.calls).toHaveLength(1);
  });
  it.each(['(true,)', 'false', '(false, false)', ''])('requires exact GNOME unlocked response %j', async raw => {
    const f = setup(); f.run.mockImplementation(async (command, args) => command === 'gdbus' ? raw : args[0] === 'list-sessions' ? JSON.stringify(sessions) : info);
    expect(await f.check()).toBe(false);
  });
  it('rejects duplicate/missing logind properties and ambiguous simultaneous sessions', async () => {
    const f = setup({ XDG_SESSION_ID: '2' }); f.run.mockResolvedValue(info + 'User=1000\n'); expect(await f.check()).toBe(false);
    f.run.mockResolvedValue(info.replace('LockedHint=no\n', '')); expect(await f.check()).toBe(false);
    const g = setup(); g.run.mockImplementation(async (_command, args) => args[0] === 'list-sessions' ?
      JSON.stringify([sessions[0], { ...sessions[0], session: '4' }]) : info);
    expect(await g.check()).toBe(false);
  });
  it.each([Array(65).fill(sessions[0]), [sessions[0], sessions[0]], Array.from({ length: 5 }, (_, i) => ({ ...sessions[0], session: String(i) }))])(
    'bounds session enumeration and rejects duplicate identities', async list => {
      const f = setup(); f.run.mockResolvedValue(JSON.stringify(list)); expect(await f.check()).toBe(false); expect(f.run.mock.calls).toHaveLength(1);
    });
  it('fails closed on command errors, malformed/oversized responses and unsupported platform/root UID', async () => {
    const f = setup(); f.run.mockRejectedValue(Error('private raw bus failure')); expect(await f.check()).toBe(false);
    f.run.mockResolvedValue('{'); expect(await f.check()).toBe(false);
    f.run.mockResolvedValue(' '.repeat(16385)); expect(await f.check()).toBe(false);
    expect(await controllerSessionActive({ platform: 'win32', run: f.run })).toBe(false);
    f.run.mockClear(); expect(await controllerSessionActive({ uid: 0, platform: 'linux', run: f.run })).toBe(false); expect(f.run).not.toHaveBeenCalled();
  });
});

class Child extends EventEmitter {
  stdin = new PassThrough(); stdout = new PassThrough(); stderr = new PassThrough(); exitCode: number | null = null;
  commands: string[] = [];
  kill = vi.fn((_signal: NodeJS.Signals) => true);
  constructor() { super(); this.stdin.on('data', data => this.commands.push(data.toString())); }
  line(value: unknown) { this.stdout.write(JSON.stringify(value) + '\n'); }
  status(devices = 1) { this.line({ schema: 1, event: 'status', status: devices ? 'listening' : 'unavailable', devices, ...(devices ? {} : { reason: 'no-controller' }) }); }
  press() { this.line({ schema: 1, event: 'guide' }); }
}
describe('Guide-only helper ownership', () => {
  const controllers: GameBarController[] = [];
  afterEach(() => { for (const controller of controllers.splice(0)) controller.dispose(); vi.useRealTimers(); });
  const setup = (overrides: Partial<ConstructorParameters<typeof GameBarController>[0]> = {}) => {
    const child = new Child(), onGuide = vi.fn(), canActivate = vi.fn(async () => true), changed = vi.fn();
    let now = 1000;
    const start = vi.fn(() => child as unknown as ChildProcessWithoutNullStreams);
    const controller = new GameBarController({ helper, platform: 'linux', onGuide, canActivate, changed, start, now: () => now, ...overrides });
    controllers.push(controller);
    return { child, controller, onGuide, canActivate, changed, start, advance: () => { now += 1000; } };
  };
  it('starts one helper with resume and exposes only device count/status', async () => {
    const f = setup(); f.controller.start(); f.controller.start(); expect(f.start).toHaveBeenCalledTimes(1);
    expect(f.controller.current).toEqual({ status: 'starting', devices: 0 }); expect(f.child.commands).toEqual(['{"command":"resume"}\n']);
    f.child.status(); expect(f.controller.current).toEqual({ status: 'listening', devices: 1 });
    f.child.press(); await flush(); expect(f.onGuide).toHaveBeenCalledTimes(1); expect(f.canActivate).toHaveBeenCalledTimes(1);
  });
  it('ignores Guide before ready, repeats, rapid duplicates and disconnected state', async () => {
    const f = setup(); f.controller.start(); f.child.press(); await flush(); expect(f.onGuide).not.toHaveBeenCalled();
    f.child.status(); f.child.press(); f.child.press(); await flush(); expect(f.onGuide).toHaveBeenCalledTimes(1);
    f.child.press(); await flush(); expect(f.onGuide).toHaveBeenCalledTimes(1);
    f.advance(); f.child.press(); await flush(); expect(f.onGuide).toHaveBeenCalledTimes(2);
    f.advance(); f.child.status(0); f.child.press(); await flush(); expect(f.onGuide).toHaveBeenCalledTimes(2);
  });
  it('publishes hotplug readiness without device names, paths or other event fields', () => {
    const f = setup(); f.controller.start(); f.child.status(1); f.child.status(0); f.child.status(2);
    expect(f.controller.current).toEqual({ status: 'listening', devices: 2 });
    expect(JSON.stringify(f.changed.mock.calls)).not.toContain('/dev/');
  });
  it('pauses on lock, rejects in-flight activation and requires fresh ready status after unlock', async () => {
    let resolve!: (value: boolean) => void;
    const f = setup({ canActivate: () => new Promise<boolean>(done => { resolve = done; }) });
    f.controller.start(); f.child.status(); f.child.press(); f.controller.setSessionBlocked(true);
    resolve(true); await flush(); expect(f.onGuide).not.toHaveBeenCalled();
    expect(f.child.commands.at(-1)).toBe('{"command":"pause"}\n');
    f.child.status(); expect(f.controller.current).toMatchObject({ devices: 0, reason: 'session-blocked' });
    f.controller.setSessionBlocked(false); expect(f.controller.current.status).toBe('starting');
    f.advance(); f.child.press(); await flush(); expect(f.onGuide).not.toHaveBeenCalled();
    expect(f.child.commands.at(-1)).toBe('{"command":"resume"}\n');
  });
  it('can be blocked before startup and never opens in locked session', async () => {
    const f = setup(); f.controller.setSessionBlocked(true); f.controller.start(); f.child.status(); f.child.press(); await flush();
    expect(f.child.commands).toEqual(['{"command":"pause"}\n']); expect(f.onGuide).not.toHaveBeenCalled();
  });
  it('fails closed on denied/failed session probes and callback failure', async () => {
    const f = setup(); f.canActivate.mockResolvedValue(false); f.controller.start(); f.child.status(); f.child.press(); await flush();
    f.advance(); f.canActivate.mockRejectedValue(Error('private error')); f.child.press(); await flush(); expect(f.onGuide).not.toHaveBeenCalled();
    f.advance(); f.canActivate.mockResolvedValue(true); f.onGuide.mockRejectedValue(Error('window failed')); f.child.press(); await flush();
    expect(f.controller.current.status).toBe('listening');
  });
  it('shutdown invalidates in-flight activation and terminates child ownership', async () => {
    let resolve!: (value: boolean) => void;
    const f = setup({ canActivate: () => new Promise<boolean>(done => { resolve = done; }) });
    f.controller.start(); f.child.status(); f.child.press(); f.controller.dispose(); resolve(true); await flush();
    expect(f.onGuide).not.toHaveBeenCalled(); expect(f.child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(f.controller.current).toEqual({ status: 'stopped', devices: 0 });
    f.child.status(); expect(f.controller.current.status).toBe('stopped');
  });
  it.each([
    { schema: 1, event: 'keyboard', key: 'A' }, { schema: 1, event: 'guide', path: '/dev/input/event0' },
    { schema: 1, event: 'status', status: 'listening', devices: 0 },
    { schema: 1, event: 'status', status: 'unavailable', devices: 2 },
    { schema: 1, event: 'status', status: 'listening', devices: 17 },
    { schema: 1, event: 'status', status: 'unavailable', devices: 0, reason: 'private raw error' },
  ])('rejects non-protocol/private/invalid helper messages %j', value => {
    const f = setup(); f.controller.start(); f.child.line(value);
    expect(f.controller.current).toEqual({ status: 'error', devices: 0, reason: 'invalid-helper-message' });
  });
  it('bounds JSON line input and handles fragmented JSON lines', () => {
    const f = setup(); f.controller.start(); f.child.stdout.write('{"schema":1,"event":"sta');
    f.child.stdout.write('tus","status":"listening","devices":1}\n'); expect(f.controller.current.status).toBe('listening');
    f.child.stdout.write('x'.repeat(8193)); expect(f.controller.current.reason).toBe('invalid-helper-message');
  });
  it('publishes spawn/exit failures without exposing raw errors', () => {
    const f = setup(); f.controller.start(); f.child.emit('error', Error('private process path'));
    expect(f.controller.current).toEqual({ status: 'error', devices: 0, reason: 'helper-failed' });
    const g = setup(); g.controller.start(); g.child.emit('close', 1); expect(g.controller.current.reason).toBe('helper-closed');
  });
  it('handles unsupported platforms and missing helper without spawning', () => {
    const f = setup({ platform: 'win32' }); f.controller.start(); expect(f.start).not.toHaveBeenCalled(); expect(f.controller.current.reason).toBe('unsupported-platform');
    const g = setup({ helper: '/not-installed/xboks-controller.py' }); g.controller.start(); expect(g.start).not.toHaveBeenCalled(); expect(g.controller.current.reason).toBe('helper-missing');
  });
  it('bounds startup and escalates only an unresponsive owned child at disposal', async () => {
    vi.useFakeTimers(); const f = setup({ startupTimeoutMs: 20 }); f.controller.start();
    await vi.advanceTimersByTimeAsync(20); expect(f.controller.current.reason).toBe('helper-timeout'); expect(f.child.kill).toHaveBeenCalledWith('SIGTERM');
    await vi.advanceTimersByTimeAsync(1500); expect(f.child.kill).toHaveBeenCalledWith('SIGKILL');
  });
});
