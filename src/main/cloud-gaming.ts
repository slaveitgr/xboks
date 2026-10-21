import { BrowserWindow, WebContentsView, powerSaveBlocker } from 'electron';
import { CLOUD_GAMING_TOOLBAR_HEIGHT, type CloudGamingCommand, type CloudGamingState } from '../shared/cloud-gaming.js';

export const CLOUD_GAMING_URL = 'https://www.xbox.com/play';
const origins = new Set(['https://xbox.com', 'https://www.xbox.com', 'https://login.live.com', 'https://account.live.com',
  'https://signup.live.com', 'https://login.microsoftonline.com', 'https://account.microsoft.com', 'https://sisu.xboxlive.com']);

/** Exact official top-level origins; no arbitrary Xbox subdomain or external protocol. */
export function cloudGamingNavigation(value: string): boolean {
  try { const url = new URL(value); return !url.username && !url.password && !url.port && origins.has(url.origin); }
  catch { return false; }
}
export function cloudGamingPermission(permission: string, value: string, isMainFrame: boolean): boolean {
  if (!isMainFrame) return false;
  try {
    const url = new URL(value);
    return url.origin === 'https://www.xbox.com' && !url.username && !url.password && !url.port &&
      /^\/(?:[a-z]{2}-[a-z]{2}\/)?play(?:\/|$)/i.test(url.pathname) && ['fullscreen', 'pointerLock'].includes(permission);
  } catch { return false; }
}
export function cloudGamingBounds(width: number, height: number) {
  return {x: 0, y: CLOUD_GAMING_TOOLBAR_HEIGHT, width: Math.max(0, Math.floor(width)), height: Math.max(0, Math.floor(height) - CLOUD_GAMING_TOOLBAR_HEIGHT)};
}

/** The official Xbox website owns login, catalogue and streaming. This class
 * never receives launcher tokens, starts a game or initiates a purchase. */
export class CloudGaming {
  private owner?: BrowserWindow;
  private view?: WebContentsView;
  private blocker?: number;
  private obscured = false;
  private generation = 0;
  private navigation = 0;
  private current: CloudGamingState = {open: false, phase: 'closed', canGoBack: false};
  private resize = () => {
    if (this.owner && !this.owner.isDestroyed() && this.view) {
      const [width, height] = this.owner.getContentSize(); this.view.setBounds(cloudGamingBounds(width, height));
    }
  };
  private ownerClosed = () => this.destroy();
  private removeDownloadGuard?: () => void;
  constructor(private options: {changed?: (state: CloudGamingState) => void; toggleFullscreen?: (owner: BrowserWindow) => unknown} = {}) {}
  get state(): CloudGamingState { return {...this.current}; }
  private publish(patch: Partial<CloudGamingState>) { this.current = {...this.current, ...patch}; this.options.changed?.(this.state); }
  private visible() { this.view?.setVisible(!this.obscured && this.current.phase === 'ready'); }
  private history() {
    const contents = this.view?.webContents;
    if (!contents || contents.isDestroyed()) return;
    let origin: string | undefined;
    try { const value = contents.getURL(); if (cloudGamingNavigation(value)) origin = new URL(value).origin; } catch { /* No committed page. */ }
    this.publish({canGoBack: contents.navigationHistory.canGoBack(), origin});
  }
  private ready(generation: number) {
    if (generation !== this.generation || !this.view || this.view.webContents.isDestroyed()) return;
    this.publish({phase: 'ready', error: undefined}); this.history(); this.visible();
    if (!this.obscured && this.owner?.isFocused()) this.view.webContents.focus();
  }
  private failed(generation: number, error = 'load') {
    if (generation !== this.generation || !this.view) return;
    this.publish({phase: 'error', error}); this.visible();
    if (this.owner && !this.owner.isDestroyed()) this.owner.webContents.focus();
  }
  async open(owner: BrowserWindow): Promise<void> {
    if (owner.isDestroyed()) throw Error('The launcher window is unavailable.');
    if (this.view && !this.view.webContents.isDestroyed() && this.owner === owner) {
      owner.show(); owner.focus(); this.visible();
      if (!this.obscured && this.current.phase === 'ready') this.view.webContents.focus();
      return;
    }
    this.destroy(); this.owner = owner; const generation = ++this.generation;
    const view = new WebContentsView({webPreferences: {partition: 'persist:xboks-cloud-gaming', sandbox: true, contextIsolation: true,
      nodeIntegration: false, webSecurity: true, autoplayPolicy: 'user-gesture-required'}});
    this.view = view; view.setBackgroundColor('#101410'); view.setVisible(false);
    owner.contentView.addChildView(view); this.resize(); owner.on('resize', this.resize); owner.once('closed', this.ownerClosed);
    this.blocker = powerSaveBlocker.start('prevent-display-sleep');
    const contents = view.webContents, session = contents.session;
    session.setPermissionRequestHandler((sender, permission, callback, details) => callback(this.view === view && sender === contents && cloudGamingPermission(permission, details.requestingUrl, details.isMainFrame)));
    session.setPermissionCheckHandler((sender, permission, origin, details) => this.view === view && sender === contents && cloudGamingPermission(permission, details.requestingUrl ?? origin, details.isMainFrame));
    const download = (_event: Electron.Event, item: Electron.DownloadItem, sender: Electron.WebContents) => { if (sender === contents) item.cancel(); };
    session.on('will-download', download); this.removeDownloadGuard = () => {
      session.removeListener('will-download', download);
      session.setPermissionRequestHandler(null); session.setPermissionCheckHandler(null);
    };
    const guard = (event: Electron.Event, url: string) => {
      if (!cloudGamingNavigation(url)) { event.preventDefault(); if (this.view === view) this.publish({blockedNavigation: true}); }
    };
    contents.on('will-navigate', guard);
    contents.on('will-redirect', (event, url, _inPlace, mainFrame) => { if (mainFrame) guard(event, url); });
    contents.setWindowOpenHandler(({url}) => {
      if (this.view === view && cloudGamingNavigation(url)) void this.navigate(url);
      else if (this.view === view) this.publish({blockedNavigation: true});
      return {action: 'deny'};
    });
    contents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
      if (mainFrame && !inPlace && generation === this.generation) { this.publish({phase: 'loading', error: undefined, blockedNavigation: false}); this.visible(); }
    });
    contents.on('did-navigate', () => this.history()); contents.on('did-navigate-in-page', () => this.history());
    contents.on('did-finish-load', () => this.ready(generation));
    contents.on('did-fail-load', (_event, code, _description, _url, mainFrame) => { if (mainFrame && code !== -3) this.failed(generation); });
    contents.on('render-process-gone', () => this.failed(generation, 'crashed'));
    contents.on('destroyed', () => { if (this.view === view) this.destroy(); });
    contents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      if (input.key === 'F6' && input.control) { event.preventDefault(); if (!owner.isDestroyed()) owner.webContents.focus(); }
      else if (input.key === 'F11') {
        event.preventDefault();
        if (!owner.isDestroyed() && this.options.toggleFullscreen) {
          try { void Promise.resolve(this.options.toggleFullscreen(owner)).catch(() => {}); } catch { /* Native integration may refuse. */ }
        }
      }
    });
    this.publish({open: true, phase: 'loading', canGoBack: false, origin: undefined, error: undefined, blockedNavigation: false});
    void this.navigate(CLOUD_GAMING_URL); owner.show(); owner.focus();
  }
  private async navigate(url: string): Promise<void> {
    const view = this.view;
    if (!view || view.webContents.isDestroyed() || !cloudGamingNavigation(url)) return;
    const generation = this.generation, navigation = ++this.navigation;
    this.publish({phase: 'loading', error: undefined, blockedNavigation: false}); this.visible();
    try { await view.webContents.loadURL(url); if (navigation === this.navigation) this.ready(generation); }
    catch (error) { if (navigation === this.navigation && (error as {code?: string})?.code !== 'ERR_ABORTED') this.failed(generation); }
  }
  async control(command: CloudGamingCommand): Promise<CloudGamingState> {
    if (!['back', 'home', 'retry', 'close'].includes(command)) throw Error('Invalid Cloud gaming action.');
    if (command === 'close') { this.destroy(); return this.state; }
    const contents = this.view?.webContents; if (!contents || contents.isDestroyed()) return this.state;
    if (command === 'back') { if (contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack(); else this.destroy(); }
    else if (command === 'home') void this.navigate(CLOUD_GAMING_URL);
    else { const url = contents.getURL(); void this.navigate(cloudGamingNavigation(url) ? url : CLOUD_GAMING_URL); }
    return this.state;
  }
  setObscured(value: boolean): void {
    this.obscured = value; this.visible();
    if (this.owner && !this.owner.isDestroyed() && this.owner.isFocused()) {
      if (value) this.owner.webContents.focus(); else if (this.current.phase === 'ready') this.view?.webContents.focus();
    }
  }
  destroy(): void {
    const owner = this.owner, view = this.view; this.owner = undefined; this.view = undefined;
    this.generation++; this.navigation++; this.obscured = false; this.removeDownloadGuard?.(); this.removeDownloadGuard = undefined;
    if (owner) {
      owner.removeListener('resize', this.resize); owner.removeListener('closed', this.ownerClosed);
      if (!owner.isDestroyed() && view) { try { owner.contentView.removeChildView(view); } catch { /* Already detached. */ } }
    }
    if (view && !view.webContents.isDestroyed()) {
      view.webContents.close({waitForBeforeUnload: false});
    }
    if (this.blocker !== undefined) { if (powerSaveBlocker.isStarted(this.blocker)) powerSaveBlocker.stop(this.blocker); this.blocker = undefined; }
    if (this.current.open) this.publish({open: false, phase: 'closed', canGoBack: false, origin: undefined, error: undefined, blockedNavigation: false});
    if (owner && !owner.isDestroyed() && owner.isFocused()) owner.webContents.focus();
  }
}
