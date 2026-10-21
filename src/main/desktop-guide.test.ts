import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ windows: [] as any[], display: { x: 1920, y: 0, width: 1920, height: 1080 } }));
vi.mock('electron', () => ({
  screen: { getCursorScreenPoint: () => ({ x: 2000, y: 50 }), getDisplayNearestPoint: () => ({ bounds: state.display }) },
  BrowserWindow: class {
    visible = false; destroyed = false;
    events: Record<string, (...args: any[]) => void> = {};
    private contents = { id: 0, setWindowOpenHandler: vi.fn(), on: vi.fn() };
    get webContents() { if (this.destroyed) throw Error('Object has been destroyed'); return this.contents; }
    constructor(public options: any) { this.contents.id = 101 + state.windows.length; state.windows.push(this); }
    setTitle = vi.fn(); setAlwaysOnTop = vi.fn(); setVisibleOnAllWorkspaces = vi.fn(); setBounds = vi.fn(); focus = vi.fn();
    loadFile = vi.fn(async () => {}); loadURL = vi.fn(async () => {});
    on(name: string, fn: (...args: any[]) => void) { const previous = this.events[name]; this.events[name] = previous ? (...args) => { previous(...args); fn(...args); } : fn; }
    isDestroyed() { return this.destroyed; } isVisible() { return this.visible; }
    show() { this.visible = true; } hide() { this.visible = false; this.events.hide?.(); }
    destroy() { this.destroyed = true; for (const [name, callback] of this.contents.on.mock.calls) if (name === 'destroyed') callback(); this.events.closed?.(); }
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
  it('releases the captured owner after native destruction without reading destroyed Electron objects, including after reopen', async () => {
    const release = vi.fn(), visibility = vi.fn(), guide = new DesktopGuide('/app/dist-electron/main', release, visibility);
    await guide.toggle(); const first = state.windows[0], firstContents = first.webContents, firstOwner = firstContents.id;
    await guide.toggle(); expect(release).toHaveBeenLastCalledWith(firstOwner); expect(visibility).toHaveBeenLastCalledWith(false);
    await guide.toggle();
    const destroyed = firstContents.on.mock.calls.find((call: any[]) => call[0] === 'destroyed')[1];
    expect(() => guide.destroy()).not.toThrow();
    expect(() => first.webContents).toThrow('Object has been destroyed');
    expect(release).toHaveBeenLastCalledWith(firstOwner); expect(guide.webContents).toBeUndefined();
    await guide.toggle(); const second = state.windows[1], secondOwner = second.webContents.id;
    expect(secondOwner).not.toBe(firstOwner);
    // A delayed callback from the old native surface must never release the
    // replacement window's microphone ownership or access its destroyed peer.
    expect(() => destroyed()).not.toThrow(); expect(release).toHaveBeenLastCalledWith(firstOwner);
    expect(() => guide.destroy()).not.toThrow(); expect(release).toHaveBeenLastCalledWith(secondOwner);
    expect(() => second.webContents).toThrow('Object has been destroyed'); expect(guide.webContents).toBeUndefined();
  });
});
