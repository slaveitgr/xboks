import { BrowserWindow, powerSaveBlocker } from 'electron';

export const REMOTE_PLAY_URL = 'https://www.xbox.com/play/consoles';
/** Navigation only: resources keep Chromium's normal origin and TLS checks. */
export function remotePlayNavigation(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'xbox.com' || url.hostname.endsWith('.xbox.com')
      || ['login.live.com', 'account.live.com', 'login.microsoftonline.com', 'account.microsoft.com'].includes(url.hostname));
  } catch { return false; }
}

/** The official web client owns authentication, console discovery and WebRTC.
 * No launcher preload or Xodus credentials are exposed to remote content. */
export class RemotePlay {
  private window?: BrowserWindow;
  private loading?: Promise<void>;
  async open(fullscreen = false): Promise<void> {
    if (this.loading) return this.loading;
    if (this.window && !this.window.isDestroyed()) {
      this.window.show(); this.window.focus();
      return;
    }
    const window = new BrowserWindow({ width: 1280, height: 800, minWidth: 800, minHeight: 600,
      title: 'xboks · Remote Play', backgroundColor: '#1a1b1e', autoHideMenuBar: true,
      fullscreen, webPreferences: { partition: 'persist:xboks-remote-play', sandbox: true,
        contextIsolation: true, nodeIntegration: false, webSecurity: true, autoplayPolicy: 'no-user-gesture-required' } });
    this.window = window;
    const blocker = powerSaveBlocker.start('prevent-display-sleep');
    window.once('closed', () => {
      if (powerSaveBlocker.isStarted(blocker)) powerSaveBlocker.stop(blocker);
      if (this.window === window) this.window = undefined;
    });
    const session = window.webContents.session;
    session.setPermissionRequestHandler((_contents, permission, callback) => callback(permission === 'fullscreen'));
    session.setPermissionCheckHandler((_contents, permission) => permission === 'fullscreen');
    window.webContents.on('will-navigate', (event, url) => { if (!remotePlayNavigation(url)) event.preventDefault(); });
    window.webContents.on('will-redirect', (event, url) => { if (!remotePlayNavigation(url)) event.preventDefault(); });
    // Keep sign-in in the same isolated window; never create an unsandboxed popup.
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (remotePlayNavigation(url)) void window.loadURL(url).catch(() => {});
      return { action: 'deny' };
    });
    window.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'F11') { event.preventDefault(); window.setFullScreen(!window.isFullScreen()); }
    });
    this.loading = window.loadURL(REMOTE_PLAY_URL).catch(() => {
      if (!window.isDestroyed()) window.destroy();
      throw new Error('Remote Play could not load. Check your internet connection and try again.');
    }).finally(() => { this.loading = undefined; });
    return this.loading;
  }
  destroy(): void { this.window?.destroy(); }
}
