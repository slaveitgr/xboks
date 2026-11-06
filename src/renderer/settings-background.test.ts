import { afterEach, describe, expect, it, vi } from 'vitest';
import { inertSettingsBackground } from './SettingsFrame';

afterEach(() => vi.unstubAllGlobals());

function fixture() {
  let notify = () => {};
  const observe = vi.fn(), disconnect = vi.fn();
  vi.stubGlobal('MutationObserver', class {
    constructor(changed: () => void) { notify = changed; }
    observe = observe;
    disconnect = disconnect;
  });
  const shell = { inert: false, children: [] as Array<{ inert: boolean }>, querySelectorAll() { return this.children; } };
  return { shell, observe, disconnect, changed: () => notify(), open: () => inertSettingsBackground(shell as unknown as HTMLElement) };
}

describe('Settings background ownership across shell replacements', () => {
  it('makes every current background surface inert and restores each original state', () => {
    const f = fixture(), header = { inert: false }, sidebar = { inert: true }, content = { inert: false };
    f.shell.children = [header, sidebar, content];
    const close = f.open();
    expect(f.shell.children.every(child => child.inert)).toBe(true);
    expect(f.observe).toHaveBeenCalledWith(f.shell, { childList: true });
    close();
    expect([header.inert, sidebar.inert, content.inert]).toEqual([false, true, false]);
    expect(f.disconnect).toHaveBeenCalledTimes(1);
  });
  it('owns new mode surfaces while Settings remains mounted and releases removed ones', () => {
    const f = fixture(), desktopHeader = { inert: false }, desktopSidebar = { inert: false }, content = { inert: false }, consoleSidebar = { inert: false };
    f.shell.children = [desktopHeader, desktopSidebar, content];
    const close = f.open();
    f.shell.children = [consoleSidebar, content]; f.changed();
    expect(consoleSidebar.inert).toBe(true); expect(content.inert).toBe(true);
    expect(desktopHeader.inert).toBe(false); expect(desktopSidebar.inert).toBe(false);
    f.shell.children = [desktopHeader, desktopSidebar, content]; f.changed();
    expect(desktopHeader.inert).toBe(true); expect(desktopSidebar.inert).toBe(true); expect(consoleSidebar.inert).toBe(false);
    close();
    expect(f.shell.children.every(child => !child.inert)).toBe(true);
  });
  it('leaves a separate owner of the enclosing app inert state unchanged', () => {
    const f = fixture(), content = { inert: false };
    f.shell.children = [content];
    const close = f.open();
    f.shell.inert = true;
    f.changed(); close();
    expect(f.shell.inert).toBe(true); expect(content.inert).toBe(false);
  });
  it('supports the absent shell without creating an observer', () => {
    const f = fixture();
    inertSettingsBackground(null)();
    expect(f.observe).not.toHaveBeenCalled();
  });
});
