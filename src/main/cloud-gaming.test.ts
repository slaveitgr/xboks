import {EventEmitter} from 'node:events';
import {beforeEach, expect, it, vi} from 'vitest';
const f = vi.hoisted(() => ({views: [] as any[], defer: false, fail: false,
  pending: [] as Array<{resolve(): void; reject(error: Error): void}>, start: vi.fn(() => 7), stop: vi.fn()}));
vi.mock('electron', async () => {
  const {EventEmitter} = await import('node:events');
  class Contents extends EventEmitter {
    destroyed = false; url = ''; history = false; popup: any;
    session = Object.assign(new EventEmitter(), {setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn()});
    navigationHistory = {canGoBack: () => this.history, goBack: vi.fn()};
    focus = vi.fn(); setWindowOpenHandler = vi.fn((callback: any) => {this.popup = callback;});
    loadURL = vi.fn(async (url: string) => {
      this.url = url; this.emit('did-start-navigation', {}, url, false, true);
      if (f.defer) await new Promise<void>((resolve, reject) => f.pending.push({resolve, reject}));
      else if (f.fail) throw Error('network');
      this.emit('did-finish-load');
    });
    getURL() {return this.url;} isDestroyed() {return this.destroyed;}
    close = vi.fn(() => {this.destroyed = true; this.emit('destroyed');});
  }
  return {BrowserWindow: class {}, WebContentsView: class {
    webContents = new Contents(); setBackgroundColor = vi.fn(); setVisible = vi.fn(); setBounds = vi.fn();
    constructor(public options: any) {f.views.push(this);}
  }, powerSaveBlocker: {start: f.start, stop: f.stop, isStarted: () => true}};
});
import {CloudGaming, CLOUD_GAMING_URL, cloudGamingBounds, cloudGamingNavigation, cloudGamingPermission} from './cloud-gaming';
class Owner extends EventEmitter {
  destroyed = false; focused = true; size = [1280, 800];
  contentView = {addChildView: vi.fn(), removeChildView: vi.fn()}; webContents = {focus: vi.fn()};
  isDestroyed() {return this.destroyed;} isFocused() {return this.focused;} getContentSize() {return this.size;}
  show = vi.fn(); focus = vi.fn();
}
const owner = () => new Owner() as unknown as Electron.BrowserWindow;
const flush = async () => {await Promise.resolve(); await Promise.resolve(); await Promise.resolve();};
beforeEach(() => {f.views = []; f.pending = []; f.defer = false; f.fail = false; f.start.mockClear(); f.stop.mockClear();});

it('restricts navigation to exact official TLS Xbox and Microsoft sign-in origins', () => {
  for (const url of [CLOUD_GAMING_URL, 'https://xbox.com/el-GR/play', 'https://www.xbox.com/auth/msa?state=private', 'https://login.live.com/oauth20_authorize.srf', 'https://sisu.xboxlive.com/connect/XboxLive', 'https://signup.live.com/']) expect(cloudGamingNavigation(url)).toBe(true);
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'http://www.xbox.com/play', 'https://www.xbox.com.evil.test/', 'https://evil.xbox.com/play', 'https://user@www.xbox.com/play', 'https://www.xbox.com:9999/play', 'https://account.live.com.evil.test/', 'https://127.0.0.1/', 'ms-xbox://play', 'data:text/html,test']) expect(cloudGamingNavigation(url)).toBe(false);
});
it('allows only player fullscreen/pointer lock, never media/LAN/login/subframe access', () => {
  for (const permission of ['fullscreen', 'pointerLock']) {
    expect(cloudGamingPermission(permission, CLOUD_GAMING_URL, true)).toBe(true);
    expect(cloudGamingPermission(permission, 'https://www.xbox.com/el-GR/play/launch/game', true)).toBe(true);
    for (const url of ['https://login.live.com/', 'https://xbox.com/play', 'https://www.xbox.com/store', 'https://evil.xbox.com/play']) expect(cloudGamingPermission(permission, url, true)).toBe(false);
    expect(cloudGamingPermission(permission, CLOUD_GAMING_URL, false)).toBe(false);
  }
  for (const permission of ['media', 'camera', 'microphone', 'local-network', 'local-network-access', 'loopback-network', 'notifications', 'clipboard-read', 'fileSystem', 'hid', 'usb']) expect(cloudGamingPermission(permission, CLOUD_GAMING_URL, true)).toBe(false);
});
it('does nothing until explicit open, then uses one sandboxed session separate from launcher and Remote Play', async () => {
  const cloud = new CloudGaming(), main = owner();
  expect(cloud.state).toEqual({open: false, phase: 'closed', canGoBack: false}); expect(f.views).toHaveLength(0); expect(f.start).not.toHaveBeenCalled();
  await cloud.open(main); await flush(); await cloud.open(main);
  expect(f.views).toHaveLength(1); const view = f.views[0];
  expect(view.options.webPreferences).toEqual({partition: 'persist:xboks-cloud-gaming', sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, autoplayPolicy: 'user-gesture-required'});
  expect(view.options.webPreferences.preload).toBeUndefined(); expect(view.webContents.loadURL.mock.calls).toEqual([[CLOUD_GAMING_URL]]);
  expect(cloud.state).toMatchObject({phase: 'ready', origin: 'https://www.xbox.com', open: true});
  expect(view.setBounds).toHaveBeenCalledWith({x: 0, y: 64, width: 1280, height: 736});
  cloud.destroy(); expect(view.webContents.close).toHaveBeenCalledWith({waitForBeforeUnload: false}); expect(f.stop).toHaveBeenCalledWith(7);
  expect(main.listenerCount('resize')).toBe(0); expect(main.listenerCount('closed')).toBe(0);
});
it('keeps the trusted toolbar visible and clips small content sizes', () => {
  expect(cloudGamingBounds(1280, 800)).toEqual({x: 0, y: 64, width: 1280, height: 736});
  expect(cloudGamingBounds(300, 40)).toEqual({x: 0, y: 64, width: 300, height: 0});
});
it('blocks off-site navigation and popups while keeping Microsoft sign-in in the isolated view', async () => {
  const cloud = new CloudGaming(); await cloud.open(owner()); await flush(); const contents = f.views[0].webContents;
  const event = {preventDefault: vi.fn()}; contents.emit('will-navigate', event, 'https://evil.test/');
  expect(event.preventDefault).toHaveBeenCalledOnce(); expect(cloud.state).toMatchObject({phase: 'ready', blockedNavigation: true});
  contents.emit('will-redirect', event, 'file:///etc/passwd', false, true); expect(event.preventDefault).toHaveBeenCalledTimes(2);
  expect(contents.popup({url: 'https://evil.test/'})).toEqual({action: 'deny'}); expect(contents.loadURL).toHaveBeenCalledTimes(1);
  expect(contents.popup({url: 'https://login.live.com/oauth20_authorize.srf?state=private&code=secret'})).toEqual({action: 'deny'}); await flush();
  expect(contents.loadURL).toHaveBeenLastCalledWith('https://login.live.com/oauth20_authorize.srf?state=private&code=secret');
  expect(cloud.state.origin).toBe('https://login.live.com'); expect(JSON.stringify(cloud.state)).not.toMatch(/private|secret|oauth20/); cloud.destroy();
});
it('binds permissions and downloads to this view and releases session handlers on close', async () => {
  const cloud = new CloudGaming(); await cloud.open(owner()); await flush(); const contents = f.views[0].webContents, session = contents.session;
  const request = session.setPermissionRequestHandler.mock.calls[0][0], check = session.setPermissionCheckHandler.mock.calls[0][0], callback = vi.fn();
  request(contents, 'fullscreen', callback, {requestingUrl: CLOUD_GAMING_URL, isMainFrame: true}); expect(callback).toHaveBeenLastCalledWith(true);
  request({}, 'fullscreen', callback, {requestingUrl: CLOUD_GAMING_URL, isMainFrame: true}); expect(callback).toHaveBeenLastCalledWith(false);
  expect(check(contents, 'local-network', 'https://www.xbox.com', {requestingUrl: CLOUD_GAMING_URL, isMainFrame: true})).toBe(false);
  const cancel = vi.fn(); session.emit('will-download', {}, {cancel}, contents); expect(cancel).toHaveBeenCalledOnce();
  cloud.destroy(); expect(session.listenerCount('will-download')).toBe(0); expect(session.setPermissionRequestHandler).toHaveBeenLastCalledWith(null); expect(session.setPermissionCheckHandler).toHaveBeenLastCalledWith(null);
  request(contents, 'fullscreen', callback, {requestingUrl: CLOUD_GAMING_URL, isMainFrame: true}); expect(callback).toHaveBeenLastCalledWith(false);
});
it('provides retry/home/back/close without automatically starting a game or losing the error host', async () => {
  f.defer = true; const cloud = new CloudGaming(); await cloud.open(owner()); expect(cloud.state.phase).toBe('loading');
  f.pending[0].reject(Error('offline')); await flush(); expect(cloud.state.phase).toBe('error'); expect(f.views[0].setVisible).toHaveBeenLastCalledWith(false);
  f.defer = false; await cloud.control('retry'); await flush(); expect(cloud.state.phase).toBe('ready'); const contents = f.views[0].webContents;
  contents.history = true; await cloud.control('back'); expect(contents.navigationHistory.goBack).toHaveBeenCalledOnce();
  await cloud.control('home'); await flush(); expect(contents.loadURL).toHaveBeenLastCalledWith(CLOUD_GAMING_URL);
  await expect(cloud.control('launch-game' as any)).rejects.toThrow('Invalid');
  contents.history = false; await cloud.control('back'); expect(cloud.state.phase).toBe('closed'); expect(contents.close).toHaveBeenCalledOnce();
});
it('preserves an open page across Guide/modal obscuring, resize and same-document navigation', async () => {
  const cloud = new CloudGaming(), main = owner(); await cloud.open(main); await flush(); const view = f.views[0];
  cloud.setObscured(true); view.webContents.emit('did-finish-load'); expect(view.setVisible).toHaveBeenLastCalledWith(false);
  cloud.setObscured(false); expect(view.setVisible).toHaveBeenLastCalledWith(true); expect(view.webContents.loadURL).toHaveBeenCalledTimes(1);
  view.webContents.history = true; view.webContents.emit('did-start-navigation', {}, CLOUD_GAMING_URL + '/launch/game', true, true); view.webContents.emit('did-navigate-in-page');
  expect(cloud.state).toMatchObject({phase: 'ready', canGoBack: true}); (main as any).size = [1920, 1080]; main.emit('resize'); expect(view.setBounds).toHaveBeenLastCalledWith({x: 0, y: 64, width: 1920, height: 1016}); cloud.destroy();
});
it('leaves game keys with the player and gives Ctrl+F6/F11 trusted host behavior', async () => {
  const toggleFullscreen = vi.fn(), cloud = new CloudGaming({toggleFullscreen}), main = owner(); await cloud.open(main); await flush();
  const contents = f.views[0].webContents, preventDefault = vi.fn();
  for (const key of ['Escape', 'b']) contents.emit('before-input-event', {preventDefault}, {type: 'keyDown', key});
  expect(preventDefault).not.toHaveBeenCalled(); expect(cloud.state.open).toBe(true);
  contents.emit('before-input-event', {preventDefault}, {type: 'keyDown', key: 'F6', control: true}); expect(main.webContents.focus).toHaveBeenCalled();
  contents.emit('before-input-event', {preventDefault}, {type: 'keyDown', key: 'F11'}); expect(toggleFullscreen).toHaveBeenCalledWith(main);
  main.emit('closed'); expect(contents.close).toHaveBeenCalledOnce(); expect(cloud.state.open).toBe(false);
});
it('ignores late old-view failures after closing and reopening', async () => {
  f.defer = true; const cloud = new CloudGaming(), main = owner(); await cloud.open(main); const old = f.views[0]; cloud.destroy();
  f.defer = false; await cloud.open(main); await flush(); f.pending[0].reject(Error('late')); old.webContents.emit('render-process-gone'); await flush();
  expect(cloud.state.phase).toBe('ready'); expect(cloud.state.error).toBeUndefined(); cloud.destroy();
});
