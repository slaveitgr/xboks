import { BrowserWindow, screen, shell } from 'electron';
import path from 'node:path';

/** A top-level desktop surface, deliberately not a child of the launcher. */
export class DesktopGuide {
  private window: BrowserWindow | null = null;
  private opening: Promise<void> | undefined;
  private generation = 0;
  private loading?: { window: BrowserWindow; promise: Promise<void> };
  constructor(private readonly root: string, private readonly releaseCapture: (ownerId: number) => void = () => {}, private readonly visibilityChanged: (visible: boolean) => void = () => {}, private readonly focusChanged: () => void = () => {}) {}
  get webContents() { return this.window?.isDestroyed() ? undefined : this.window?.webContents; }
  /** Call again after an acknowledged compositor activation on Wayland. A
   * BrowserWindow focus request alone need not focus Chromium's input target. */
  focusContents(): void {
    const win = this.window;
    if (win && !win.isDestroyed() && win.isVisible()) win.webContents.focus();
  }
  hide() {
    this.generation++; this.opening = undefined;
    if (this.window && !this.window.isDestroyed()) this.window.hide();
  }
  async toggle(): Promise<void> {
    if (this.opening) return this.opening;
    if (this.window?.isVisible()) { this.hide(); return; }
    const opening = this.show(++this.generation);
    this.opening = opening;
    try { await opening; }
    finally { if (this.opening === opening) this.opening = undefined; }
  }
  private async show(generation: number): Promise<void> {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    let win = this.window;
    try {
    if (!win || win.isDestroyed()) {
      win = this.window = new BrowserWindow({
        ...display.bounds, show: false, frame: false, transparent: true,
        backgroundColor: '#00000000', alwaysOnTop: true, skipTaskbar: true,
        resizable: false, movable: false, hasShadow: false, title: 'xboks Game Bar',
        webPreferences: { preload: path.join(this.root, '..', 'preload', 'index.cjs'),
          contextIsolation: true, nodeIntegration: false, sandbox: true },
      });
      win.setAlwaysOnTop(true, 'screen-saver');
      // destroyed is emitted after Electron invalidates the native contents.
      // Capture the numeric ownership token while the window is still alive.
      const captureOwnerId = win.webContents.id;
      const releaseCapture = () => this.releaseCapture(captureOwnerId);
      win.on('hide', releaseCapture);
      const owner = win;
      const focused = () => { if (this.window === owner) this.focusChanged(); };
      win.on('focus', focused); win.on('blur', focused);
      const hidden = () => { if (this.window === owner) this.visibilityChanged(false); };
      win.on('hide', hidden);
      win.on('closed', hidden);
      win.webContents.on('did-start-navigation', releaseCapture);
      win.webContents.on('render-process-gone', releaseCapture);
      win.webContents.on('destroyed', releaseCapture);
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      win.on('close', event => { event.preventDefault(); if (this.window === owner) this.hide(); });
      win.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('https://')) void shell.openExternal(url).catch(console.error);
        return { action: 'deny' };
      });
      win.webContents.on('will-navigate', event => event.preventDefault());
      win.webContents.on('before-input-event', (event, input) => {
        // Escape belongs to the renderer's nearest menu/subpage first. Only
        // the explicit guide shortcut bypasses that scoped Back ownership.
        if (input.type === 'keyDown' && input.key.toLowerCase() === 'g' && input.control) {
          event.preventDefault(); if (this.window === owner) this.hide();
        }
      });
      this.loading = { window: win, promise: process.env.VITE_DEV_SERVER_URL
        ? win.loadURL(`${process.env.VITE_DEV_SERVER_URL}#desktop-guide`)
        : win.loadFile(path.join(this.root, '..', '..', 'dist', 'index.html'), { hash: 'desktop-guide' }) };
    }
    if (this.loading?.window === win) await this.loading.promise;
    // Lock/suspend/hide/destroy wins over a lazy renderer load. A delayed old
    // continuation must neither reveal nor destroy a replacement Guide.
    if (generation !== this.generation || this.window !== win || win.isDestroyed()) return;
    win.setTitle('xboks Game Bar');
    win.setBounds(display.bounds);
    win.show(); win.focus();
    this.focusContents();
    this.visibilityChanged(true);
    } catch (error) {
      if (generation !== this.generation || this.window !== win || win?.isDestroyed()) return;
      this.destroy(); throw error;
    }
  }
  destroy() {
    this.generation++; this.opening = undefined; this.loading = undefined;
    const window = this.window; this.window = null;
    if (window && !window.isDestroyed()) window.destroy();
    this.visibilityChanged(false);
  }
}
