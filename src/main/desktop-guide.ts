import { BrowserWindow, screen, shell } from 'electron';
import path from 'node:path';

/** A top-level desktop surface, deliberately not a child of the launcher. */
export class DesktopGuide {
  private window: BrowserWindow | null = null;
  private opening: Promise<void> | undefined;
  constructor(private readonly root: string, private readonly releaseCapture: (ownerId: number) => void = () => {}, private readonly visibilityChanged: (visible: boolean) => void = () => {}) {}
  get webContents() { return this.window?.isDestroyed() ? undefined : this.window?.webContents; }
  hide() { if (this.window && !this.window.isDestroyed()) this.window.hide(); }
  async toggle(): Promise<void> {
    if (this.opening) return this.opening;
    if (this.window?.isVisible()) { this.hide(); return; }
    this.opening = this.show().catch(error => { this.destroy(); throw error; }).finally(() => { this.opening = undefined; });
    return this.opening;
  }
  private async show(): Promise<void> {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    if (!this.window || this.window.isDestroyed()) {
      const win = this.window = new BrowserWindow({
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
      win.on('hide', () => this.visibilityChanged(false));
      win.on('closed', () => this.visibilityChanged(false));
      win.webContents.on('did-start-navigation', releaseCapture);
      win.webContents.on('render-process-gone', releaseCapture);
      win.webContents.on('destroyed', releaseCapture);
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      win.on('close', event => { event.preventDefault(); win.hide(); });
      win.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('https://')) void shell.openExternal(url).catch(console.error);
        return { action: 'deny' };
      });
      win.webContents.on('will-navigate', event => event.preventDefault());
      win.webContents.on('before-input-event', (event, input) => {
        // Escape belongs to the renderer's nearest menu/subpage first. Only
        // the explicit guide shortcut bypasses that scoped Back ownership.
        if (input.type === 'keyDown' && input.key.toLowerCase() === 'g' && input.control) {
          event.preventDefault(); win.hide();
        }
      });
      if (process.env.VITE_DEV_SERVER_URL) await win.loadURL(`${process.env.VITE_DEV_SERVER_URL}#desktop-guide`);
      else await win.loadFile(path.join(this.root, '..', '..', 'dist', 'index.html'), { hash: 'desktop-guide' });
    }
    this.window.setTitle('xboks Game Bar');
    this.window.setBounds(display.bounds);
    this.window.show(); this.window.focus();
    this.visibilityChanged(true);
  }
  destroy() { const window = this.window; this.window = null; if (window && !window.isDestroyed()) window.destroy(); }
}
