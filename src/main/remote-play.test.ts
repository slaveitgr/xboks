import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ windows: [] as any[], fail: false, stop: vi.fn() }));
vi.mock('electron', () => ({
  powerSaveBlocker: { start: () => 1, isStarted: () => true, stop: state.stop },
  BrowserWindow: class {
    destroyed = false; events: Record<string, () => void> = {};
    webContents = { on: vi.fn(), setWindowOpenHandler: vi.fn(), session: { setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn() } };
    constructor(public options: any) { state.windows.push(this); }
    loadURL = vi.fn(async () => { if (state.fail) throw Error('network'); });
    show = vi.fn(); focus = vi.fn();
    once(name: string, callback: () => void) { this.events[name] = callback; }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this.events.closed?.(); }
  },
}));
import { RemotePlay, remotePlayNavigation, REMOTE_PLAY_URL } from './remote-play';
beforeEach(() => { state.windows = []; state.fail = false; state.stop.mockClear(); });
it('only permits HTTPS Xbox and explicit Microsoft sign-in origins', () => {
  for (const url of ['https://www.xbox.com/play/consoles', 'https://login.live.com/oauth20_authorize.srf']) expect(remotePlayNavigation(url)).toBe(true);
  for (const url of ['file:///tmp/index.html', 'javascript:alert(1)', 'https://xbox.com.evil.test/', 'http://xbox.com/', 'https://login.live.com.evil.test/', 'garbage']) expect(remotePlayNavigation(url)).toBe(false);
});
it('reuses an isolated streaming window without exposing a preload, and releases its display blocker', async () => {
  const remote = new RemotePlay(); await remote.open(true); await remote.open();
  expect(state.windows).toHaveLength(1);
  const window = state.windows[0];
  expect(window.options.webPreferences).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'persist:xboks-remote-play' });
  expect(window.options.webPreferences.preload).toBeUndefined();
  expect(window.loadURL).toHaveBeenCalledWith(REMOTE_PLAY_URL);
  expect(window.options.fullscreen).toBe(true);
  const navigation = window.webContents.on.mock.calls.find((call: any[]) => call[0] === 'will-navigate')[1];
  const preventDefault = vi.fn(); navigation({ preventDefault }, 'file:///etc/passwd'); expect(preventDefault).toHaveBeenCalledOnce();
  remote.destroy(); expect(state.stop).toHaveBeenCalledWith(1);
});
it('destroys failed loads and allows retry instead of retaining a blank window', async () => {
  const remote = new RemotePlay(); state.fail = true;
  await expect(remote.open()).rejects.toThrow('Check your internet');
  expect(state.windows[0].destroyed).toBe(true);
  state.fail = false; await remote.open(); expect(state.windows).toHaveLength(2);
});
