import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { enterWindowFullscreen, formatShellClock, observeWindowFullscreen, observeXboxModeEntryRequests, shellIsFullscreen, ShellHeaderControls, type FullscreenDocument, type WindowFullscreenState } from './ShellHeaderControls';

afterEach(() => vi.unstubAllGlobals());
function fixture() {
  const listeners = new Set<EventListenerOrEventListenerObject>();
  const document = { fullscreenElement: null as object | null, fullscreenEnabled: true,
    documentElement: { requestFullscreen: vi.fn(async () => {}) },
    addEventListener: vi.fn((_name: string, listener: EventListenerOrEventListenerObject) => listeners.add(listener)),
    removeEventListener: vi.fn((_name: string, listener: EventListenerOrEventListenerObject) => listeners.delete(listener)),
  };
  return { document: document as unknown as FullscreenDocument, enter: document.documentElement.requestFullscreen,
    change(value: boolean) { document.fullscreenElement = value ? {} : null; for (const listener of listeners) if (typeof listener === 'function') listener(new Event('fullscreenchange')); }, listeners };
}
describe('shell header surfaces', () => {
  it('has only the named Xbox mode entry in desktop tools, without clock, power or Game Bar', () => {
    const html = renderToStaticMarkup(<ShellHeaderControls sessionFullscreen={false} onError={() => {}} />);
    expect(html).toContain('data-shell-display-mode="desktop"');
    expect(html.match(/<button/g)).toHaveLength(1); expect(html).toContain('>Xbox mode</span>');
    for (const absent of ['shell-clock', 'shell-battery', 'Open Game Bar', 'Connected to desktop session', 'Fullscreen Experience']) expect(html).not.toContain(absent);
  });
  it('uses the exact requested Greek desktop label', () => {
    vi.stubGlobal('localStorage', { getItem: () => 'el' });
    const html = renderToStaticMarkup(<ShellHeaderControls sessionFullscreen={false} onError={() => {}} />);
    expect(html).toContain('aria-label="Λειτουργία Xbox"'); expect(html).toContain('>Λειτουργία Xbox</span>');
  });
  it('formats the Greek clock with the reference hour and period abbreviation', () => {
    expect(formatShellClock(new Date(2026, 9, 21, 16, 24), 'el')).toBe('4:24 μμ');
  });
  it('renders status only for an existing fullscreen session without requiring a click', () => {
    const html = renderToStaticMarkup(<ShellHeaderControls sessionFullscreen onError={() => {}} />);
    expect(html).toContain('data-shell-display-mode="fullscreen"'); expect(html).toContain('<time');
    expect(html).not.toContain('<button'); expect(html).not.toContain('Open Game Bar');
  });
  it('recognizes an existing DOM fullscreen window and keeps a session active after a window exit', () => {
    vi.stubGlobal('document', { fullscreenElement: {} });
    expect(renderToStaticMarkup(<ShellHeaderControls sessionFullscreen={false} onError={() => {}} />)).toContain('data-shell-display-mode="fullscreen"');
    expect(shellIsFullscreen(true, { documentFullscreen: false, nativeFullscreen: false })).toBe(true);
    expect(shellIsFullscreen(false, { documentFullscreen: false, nativeFullscreen: false })).toBe(false);
  });
});
describe('fullscreen observations and entry', () => {
  it('responds to DOM entry and exit while retaining an independent native state', async () => {
    const f = fixture(), states: WindowFullscreenState[] = [];
    let native!: (value: boolean) => void;
    const observer = observeWindowFullscreen(f.document, { onWindowFullscreenChanged: callback => { native = callback; return () => {}; } }, state => states.push(state));
    f.change(true); native(true); f.change(false);
    expect(states.at(-1)).toEqual({ documentFullscreen: false, nativeFullscreen: true });
    native(false); expect(shellIsFullscreen(false, states.at(-1)!)).toBe(false); observer.stop();
  });
  it('does not let a stale initial native read overwrite a newer entry or exit event', async () => {
    const f = fixture(), states: WindowFullscreenState[] = [];
    let finish!: (value: boolean) => void, native!: (value: boolean) => void;
    const observer = observeWindowFullscreen(f.document, { getWindowFullscreen: () => new Promise(resolve => { finish = resolve; }), onWindowFullscreenChanged: callback => { native = callback; return () => {}; } }, state => states.push(state));
    native(true); native(false); finish(true); await Promise.resolve();
    expect(states.at(-1)).toEqual({ documentFullscreen: false, nativeFullscreen: false }); observer.stop();
  });
  it('accepts the native initial state without a renderer click', async () => {
    const f = fixture(), states: WindowFullscreenState[] = [];
    const observer = observeWindowFullscreen(f.document, { getWindowFullscreen: async () => true }, state => states.push(state));
    await Promise.resolve(); expect(states.at(-1)?.nativeFullscreen).toBe(true); observer.stop();
  });
  it('removes listeners and ignores late native reads or events after disposal', async () => {
    const f = fixture(), changed = vi.fn(), unsubscribe = vi.fn();
    let finish!: (value: boolean) => void, native!: (value: boolean) => void;
    const observer = observeWindowFullscreen(f.document, { getWindowFullscreen: () => new Promise(resolve => { finish = resolve; }), onWindowFullscreenChanged: callback => { native = callback; return unsubscribe; } }, changed);
    observer.stop(); const calls = changed.mock.calls.length; native(true); finish(true); await Promise.resolve();
    expect(changed).toHaveBeenCalledTimes(calls); expect(unsubscribe).toHaveBeenCalledOnce(); expect(f.listeners.size).toBe(0);
  });
  it('uses the native bridge when available, without invoking document fullscreen', async () => {
    const f = fixture(), setWindowFullscreen = vi.fn(async () => true);
    expect(await enterWindowFullscreen(f.document, { setWindowFullscreen })).toBe('native');
    expect(setWindowFullscreen).toHaveBeenCalledWith(true); expect(f.enter).not.toHaveBeenCalled();
  });
  it('uses the document API only as a browser fallback and reports native refusal accurately', async () => {
    const f = fixture(); expect(await enterWindowFullscreen(f.document)).toBe('document'); expect(f.enter).toHaveBeenCalledOnce();
    f.enter.mockClear(); await expect(enterWindowFullscreen(f.document, { setWindowFullscreen: async () => false })).rejects.toThrow('could not be opened');
    expect(f.enter).not.toHaveBeenCalled();
    f.document.fullscreenEnabled = false; await expect(enterWindowFullscreen(f.document)).rejects.toThrow('unavailable');
  });
});

describe('Game Bar entry request freshness', () => {
  function handoff() {
    let receive!: () => void, focused = true, permitted = true;
    const surface = { fullscreenElement: null as object | null, hasFocus: () => focused };
    const reads: Array<{ resolve(value: boolean): void; reject(error: Error): void }> = [];
    const unsubscribe = vi.fn(), opened = vi.fn();
    const stop = observeXboxModeEntryRequests(surface, {
      onXboxModeEntryRequested: callback => { receive = callback; return unsubscribe; },
      getWindowFullscreen: () => new Promise<boolean>((resolve, reject) => reads.push({ resolve, reject })),
    }, () => permitted, opened);
    return { receive: () => receive(), reads, surface, opened, stop, unsubscribe,
      focus: (value: boolean) => { focused = value; }, permit: (value: boolean) => { permitted = value; } };
  }
  it('opens choices only after a fresh native read confirms the focused desktop window', async () => {
    const f = handoff(); f.receive(); expect(f.opened).not.toHaveBeenCalled();
    f.reads[0].resolve(false); await Promise.resolve(); expect(f.opened).toHaveBeenCalledOnce(); f.stop();
  });
  it('drops requests while unfocused or a mode transition is in progress', () => {
    const f = handoff(); f.focus(false); f.receive(); f.focus(true); f.permit(false); f.receive();
    expect(f.reads).toHaveLength(0); expect(f.opened).not.toHaveBeenCalled(); f.stop();
  });
  it.each(['focus', 'permission', 'document', 'native', 'dispose', 'error'] as const)
    ('does not open after %s changes during the native read', async change => {
      const f = handoff(); f.receive();
      if (change === 'focus') f.focus(false);
      if (change === 'permission') f.permit(false);
      if (change === 'document') f.surface.fullscreenElement = {};
      if (change === 'dispose') f.stop();
      if (change === 'error') f.reads[0].reject(Error('native read unavailable'));
      else f.reads[0].resolve(change === 'native');
      await Promise.resolve(); await Promise.resolve(); expect(f.opened).not.toHaveBeenCalled(); f.stop();
    });
  it('a newer request invalidates an older native read and cleanup removes the listener', async () => {
    const f = handoff(); f.receive(); f.receive(); f.reads[0].resolve(false); await Promise.resolve();
    expect(f.opened).not.toHaveBeenCalled(); f.reads[1].resolve(false); await Promise.resolve();
    expect(f.opened).toHaveBeenCalledOnce(); f.stop(); expect(f.unsubscribe).toHaveBeenCalledOnce();
    f.receive(); expect(f.reads).toHaveLength(2);
  });
});
