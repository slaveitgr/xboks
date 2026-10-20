import { describe, expect, it, vi } from 'vitest';
import { fallbackAuthViewFactory } from './auth-fallback';
import type { AuthView, AuthViewFactory } from './auth-transport';
const frame = { type: 'open' as const, session: 1, url: 'https://login.live.com/', headers: {} };
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(yes => resolve = yes); return { resolve, promise }; };
function fixture(resolveBrowser?: () => Promise<AuthViewFactory>) {
  let request!: () => Promise<void>, oldSend!: (id: number, payload: string) => void, oldCancel!: (id: number) => void;
  const events: string[] = [];
  const embedded: AuthView = { open: vi.fn(async () => { events.push('old-open'); }), context: vi.fn(async () => {}), close: vi.fn(), dispose: vi.fn(async () => { events.push('old-disposed'); }) };
  const browser: AuthView = { open: vi.fn(async () => { events.push('browser-open'); }), context: vi.fn(async () => {}), close: vi.fn(), dispose: vi.fn(async () => {}) };
  const factory: AuthViewFactory = () => { events.push('browser-created'); return browser; };
  const send = vi.fn(), cancel = vi.fn(), fail = vi.fn();
  const view = fallbackAuthViewFactory(callback => {
    request = callback; return (s, c) => { oldSend = s; oldCancel = c; return embedded; };
  }, resolveBrowser ?? (async () => factory))(send, cancel, fail);
  return { view, request: () => request(), oldSend: () => oldSend(1, 'stale'), oldCancel: () => oldCancel(1), embedded, browser, factory, events, send, cancel, fail };
}
describe('explicit browser fallback', () => {
  it('fully closes the old view first, keeps the same session and drops old events', async () => {
    const f = fixture(); await f.view.open(frame); await f.request();
    expect(f.events).toEqual(['old-open', 'old-disposed', 'browser-created', 'browser-open']);
    expect(f.browser.open).toHaveBeenCalledWith(frame);
    f.oldSend(); f.oldCancel(); expect(f.send).not.toHaveBeenCalled(); expect(f.cancel).not.toHaveBeenCalled();
    await f.view.context(1, 'opaque-context'); expect(f.browser.context).toHaveBeenCalledWith(1, 'opaque-context');
    await f.request(); expect(f.browser.open).toHaveBeenCalledOnce(); await f.view.dispose();
  });
  it('does not close embedded sign-in if no supported browser is available', async () => {
    const f = fixture(async () => { throw Error('missing'); }); await f.view.open(frame);
    await expect(f.request()).rejects.toThrow('missing'); expect(f.embedded.dispose).not.toHaveBeenCalled();
    f.oldSend(); expect(f.send).toHaveBeenCalledOnce(); await f.view.dispose();
  });
  it('does not open a browser if the attempt closes during discovery', async () => {
    const gate = deferred(); let f: ReturnType<typeof fixture>;
    f = fixture(async () => { await gate.promise; return f.factory; }); await f.view.open(frame);
    const switching = f.request(); f.view.close(1); gate.resolve(); await switching;
    expect(f.browser.open).not.toHaveBeenCalled(); await f.view.dispose();
  });
  it('does not resurrect a disposed attempt', async () => {
    const gate = deferred(); let f: ReturnType<typeof fixture>;
    f = fixture(async () => { await gate.promise; return f.factory; }); await f.view.open(frame);
    const switching = f.request(); await f.view.dispose(); gate.resolve(); await switching;
    expect(f.browser.open).not.toHaveBeenCalled();
  });
  it('waits for embedded disposal before opening Chrome and delivering context', async () => {
    const f = fixture(), gate = deferred(); await f.view.open(frame);
    vi.mocked(f.embedded.dispose).mockImplementation(async () => { await gate.promise; f.events.push('old-disposed'); });
    const switching = f.request(); await Promise.resolve();
    const context = f.view.context(1, 'opaque-context'); expect(f.browser.open).not.toHaveBeenCalled();
    gate.resolve(); await switching; await context;
    expect(f.browser.context).toHaveBeenCalledOnce(); await f.view.dispose();
  });
});
