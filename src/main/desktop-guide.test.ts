import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ windows: [] as any[], display: { x: 1920, y: 0, width: 1920, height: 1080 },
  delayLoad: false, loads: [] as { resolve: () => void; reject: (error: Error) => void }[] }));
vi.mock('electron', () => ({
  screen: { getCursorScreenPoint: () => ({ x: 2000, y: 50 }), getDisplayNearestPoint: () => ({ bounds: state.display }) },
  BrowserWindow: class {
    visible = false; destroyed = false;
    events: Record<string, (...args: any[]) => void> = {};
    private contents = { id: 0, setWindowOpenHandler: vi.fn(), on: vi.fn(), focus: vi.fn() };
    get webContents() { if (this.destroyed) throw Error('Object has been destroyed'); return this.contents; }
    constructor(public options: any) { this.contents.id = 101 + state.windows.length; state.windows.push(this); }
    setTitle = vi.fn(); setAlwaysOnTop = vi.fn(); setVisibleOnAllWorkspaces = vi.fn(); setBounds = vi.fn(); focus = vi.fn();
    private load() { return state.delayLoad ? new Promise<void>((resolve, reject) => state.loads.push({ resolve, reject })) : Promise.resolve(); }
    loadFile = vi.fn(() => this.load()); loadURL = vi.fn(() => this.load());
    on(name: string, fn: (...args: any[]) => void) { const previous = this.events[name]; this.events[name] = previous ? (...args) => { previous(...args); fn(...args); } : fn; }
    isDestroyed() { return this.destroyed; } isVisible() { return this.visible; }
    show = vi.fn(() => { this.visible = true; }); hide() { this.visible = false; this.events.hide?.(); }
    destroy() { this.destroyed = true; for (const [name, callback] of this.contents.on.mock.calls) if (name === 'destroyed') callback(); this.events.closed?.(); }
  },
}));
import { DesktopGuide } from './desktop-guide';
describe('desktop Game Bar surface', () => {
  beforeEach(() => { state.windows = []; state.loads = []; state.delayLoad = false; delete process.env.VITE_DEV_SERVER_URL; });
  it('opens independently of the launcher on the display under the pointer, and toggles without recreating', async () => {
    const guide = new DesktopGuide('/app/dist-electron/main');
    await guide.toggle(); const win = state.windows[0];
    expect(win.options).toMatchObject({ ...state.display, transparent: true, frame: false, alwaysOnTop: true });
    expect(win.options.parent).toBeUndefined();
    expect(win.options.webPreferences).toMatchObject({ sandbox: true, nodeIntegration: false, contextIsolation: true });
    expect(win.loadFile).toHaveBeenCalledWith('/app/dist/index.html', { hash: 'desktop-guide' });
    expect(win.visible).toBe(true);
    expect(win.webContents.focus).toHaveBeenCalledOnce();
    await guide.toggle(); expect(win.visible).toBe(false);
    await guide.toggle(); expect(state.windows).toHaveLength(1); expect(win.visible).toBe(true);
    expect(win.webContents.focus).toHaveBeenCalledTimes(2);
    guide.destroy(); expect(win.destroyed).toBe(true);
  });
  it('only focuses visible live Guide contents after a compositor acknowledgement', async () => {
    const guide = new DesktopGuide('/app/dist-electron/main');
    expect(() => guide.focusContents()).not.toThrow(); await guide.toggle();
    const win = state.windows[0], contents = win.webContents;
    guide.focusContents(); expect(contents.focus).toHaveBeenCalledTimes(2);
    guide.hide(); guide.focusContents(); expect(contents.focus).toHaveBeenCalledTimes(2);
    guide.destroy(); expect(() => guide.focusContents()).not.toThrow(); expect(contents.focus).toHaveBeenCalledTimes(2);
  });
  it('notifies input ownership on focus/blur only for the current native surface', async () => {
    const changed = vi.fn(), guide = new DesktopGuide('/app', () => {}, () => {}, changed);
    await guide.toggle(); const previous = state.windows[0];
    previous.events.focus(); previous.events.blur(); expect(changed).toHaveBeenCalledTimes(2);
    guide.destroy(); await guide.toggle();
    previous.events.focus(); previous.events.blur(); expect(changed).toHaveBeenCalledTimes(2);
    state.windows[1].events.focus(); expect(changed).toHaveBeenCalledTimes(3); guide.destroy();
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

  it('lets hide during lazy loading cancel visibility and focus, then permits an explicit later opening', async () => {
    state.delayLoad = true;
    const visibility = vi.fn(), guide = new DesktopGuide('/app/dist-electron/main', undefined, visibility);
    const opening = guide.toggle(), win = state.windows[0];
    guide.hide(); state.loads[0].resolve(); await opening;
    expect(win.show).not.toHaveBeenCalled(); expect(win.focus).not.toHaveBeenCalled(); expect(visibility).not.toHaveBeenCalledWith(true);
    await guide.toggle(); expect(win.visible).toBe(true); expect(win.focus).toHaveBeenCalledOnce();
    guide.destroy();
  });

  it('shares an unfinished renderer load with a newer explicit opening instead of showing an unloaded document', async () => {
    state.delayLoad = true;
    const guide = new DesktopGuide('/app/dist-electron/main'), first = guide.toggle(), win = state.windows[0];
    guide.hide(); const second = guide.toggle();
    expect(win.show).not.toHaveBeenCalled(); expect(win.loadFile).toHaveBeenCalledOnce();
    state.loads[0].resolve(); await Promise.all([first, second]);
    expect(win.show).toHaveBeenCalledOnce(); expect(win.focus).toHaveBeenCalledOnce();
    guide.destroy();
  });

  it.each(['resolve', 'reject'] as const)('ignores an old destroyed window load that later %ss without destroying or clearing the new opening', async result => {
    state.delayLoad = true;
    const guide = new DesktopGuide('/app/dist-electron/main'), first = guide.toggle(), old = state.windows[0];
    guide.destroy(); const second = guide.toggle(), replacement = state.windows[1];
    if (result === 'resolve') state.loads[0].resolve(); else state.loads[0].reject(Error('Cancelled old load'));
    await expect(first).resolves.toBeUndefined();
    expect(replacement.destroyed).toBe(false); expect(replacement.show).not.toHaveBeenCalled();
    const repeated = guide.toggle(); expect(state.windows).toHaveLength(2);
    state.loads[1].resolve(); await Promise.all([second, repeated]);
    expect(old.show).not.toHaveBeenCalled(); expect(old.focus).not.toHaveBeenCalled();
    expect(replacement.show).toHaveBeenCalledOnce(); expect(replacement.focus).toHaveBeenCalledOnce();
    // Stale native close/keyboard callbacks must not hide the new owner.
    old.events.close({ preventDefault() {} });
    expect(replacement.visible).toBe(true);
    guide.destroy();
  });

  it('suppresses load rejection after intentional hide while retaining real current-load errors', async () => {
    state.delayLoad = true;
    const guide = new DesktopGuide('/app/dist-electron/main'), cancelled = guide.toggle();
    guide.hide(); state.loads[0].reject(Error('Cancelled hidden load'));
    await expect(cancelled).resolves.toBeUndefined();
    guide.destroy();
    const failed = guide.toggle(), current = state.windows[1];
    state.loads[1].reject(Error('Actual renderer failure'));
    await expect(failed).rejects.toThrow('Actual renderer failure');
    expect(current.destroyed).toBe(true); expect(current.show).not.toHaveBeenCalled();
  });

  it('invalidates pending load when native Ctrl+G closes the Guide before it is visible', async () => {
    state.delayLoad = true;
    const guide = new DesktopGuide('/app/dist-electron/main'), opening = guide.toggle(), win = state.windows[0];
    const input = win.webContents.on.mock.calls.find((call: any[]) => call[0] === 'before-input-event')[1], preventDefault = vi.fn();
    input({ preventDefault }, { type: 'keyDown', key: 'g', control: true });
    state.loads[0].resolve(); await opening;
    expect(preventDefault).toHaveBeenCalledOnce(); expect(win.show).not.toHaveBeenCalled(); expect(win.focus).not.toHaveBeenCalled();
    guide.destroy();
  });
});
