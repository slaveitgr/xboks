import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ windows: [] as any[], display: { x: 1920, y: 0, width: 1920, height: 1080 } }));
vi.mock('electron', () => ({
  screen: { getCursorScreenPoint: () => ({ x: 2000, y: 50 }), getDisplayNearestPoint: () => ({ bounds: state.display }) },
  BrowserWindow: class {
    visible = false; destroyed = false;
    events: Record<string, (...args: any[]) => void> = {};
    webContents = { setWindowOpenHandler: vi.fn(), on: vi.fn() };
    constructor(public options: any) { state.windows.push(this); }
    setTitle = vi.fn(); setAlwaysOnTop = vi.fn(); setVisibleOnAllWorkspaces = vi.fn(); setBounds = vi.fn(); focus = vi.fn();
    loadFile = vi.fn(async () => {}); loadURL = vi.fn(async () => {});
    on(name: string, fn: (...args: any[]) => void) { this.events[name] = fn; }
    isDestroyed() { return this.destroyed; } isVisible() { return this.visible; }
    show() { this.visible = true; } hide() { this.visible = false; }
    destroy() { this.destroyed = true; }
  },
}));
import { DesktopGuide } from './desktop-guide';
describe('desktop Game Bar surface', () => {
  beforeEach(() => { state.windows = []; delete process.env.VITE_DEV_SERVER_URL; });
  it('opens independently of the launcher on the display under the pointer, and toggles without recreating', async () => {
    const guide = new DesktopGuide('/app/dist-electron/main');
    await guide.toggle(); const win = state.windows[0];
    expect(win.options).toMatchObject({ ...state.display, transparent: true, frame: false, alwaysOnTop: true });
    expect(win.options.parent).toBeUndefined();
    expect(win.options.webPreferences).toMatchObject({ sandbox: true, nodeIntegration: false, contextIsolation: true });
    expect(win.loadFile).toHaveBeenCalledWith('/app/dist/index.html', { hash: 'desktop-guide' });
    expect(win.visible).toBe(true);
    await guide.toggle(); expect(win.visible).toBe(false);
    await guide.toggle(); expect(state.windows).toHaveLength(1); expect(win.visible).toBe(true);
    guide.destroy(); expect(win.destroyed).toBe(true);
  });
  it('delivers Escape to the renderer for scoped Back while Ctrl+G still hides immediately', async () => {
    const guide = new DesktopGuide('/app/dist-electron/main'); await guide.toggle();
    const win = state.windows[0], preventDefault = vi.fn();
    const handler = win.webContents.on.mock.calls.find((call: any[]) => call[0] === 'before-input-event')[1];
    handler({ preventDefault }, { type: 'keyDown', key: 'Escape' });
    expect(preventDefault).not.toHaveBeenCalled(); expect(win.visible).toBe(true);
    handler({ preventDefault }, { type: 'keyDown', key: 'g', control: false });
    handler({ preventDefault }, { type: 'keyUp', key: 'g', control: true });
    expect(preventDefault).not.toHaveBeenCalled(); expect(win.visible).toBe(true);
    handler({ preventDefault }, { type: 'keyDown', key: 'G', control: true });
    expect(preventDefault).toHaveBeenCalledOnce(); expect(win.visible).toBe(false);
    await guide.toggle(); win.events.close({ preventDefault }); expect(win.visible).toBe(false);
  });
});
