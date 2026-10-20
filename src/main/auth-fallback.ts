import type { AuthFrame } from './auth-protocol.js';
import type { AuthView, AuthViewFactory } from './auth-transport.js';

/** Move the same backend login session to a fresh browser view, never copy cookies. */
export function fallbackAuthViewFactory(embedded: (requestBrowser: () => Promise<void>) => AuthViewFactory, browser: () => Promise<AuthViewFactory>): AuthViewFactory {
  return (send, cancel, fail) => {
    let frame: Extract<AuthFrame, { type: 'open' }> | undefined;
    let disposed = false, generation = 0, usingBrowser = false;
    let switching: Promise<void> | undefined;
    const create = (factory: AuthViewFactory) => {
      const own = generation;
      const current = () => !disposed && generation === own;
      return factory((id, payload) => { if (current()) send(id, payload); }, id => { if (current()) cancel(id); }, () => { if (current()) fail(); });
    };
    async function requestBrowser(): Promise<void> {
      if (disposed || usingBrowser || switching || !frame) return;
      const active = frame, own = generation;
      // Resolve availability before closing the embedded window. Missing Chrome
      // leaves the working view and pending Microsoft request alone.
      const factory = await browser();
      if (disposed || usingBrowser || switching || frame !== active || generation !== own) return;
      switching = (async () => {
        generation++; // Invalidate all events from the old window before destroying it.
        await view.dispose();
        if (disposed) return;
        usingBrowser = true;
        view = create(factory);
        if (frame === active) await view.open(active);
      })();
      try { await switching; } catch { fail(); throw Error('Browser sign-in could not be opened.'); }
      finally { switching = undefined; }
    }
    let view: AuthView = create(embedded(requestBrowser));
    return {
      async open(value) {
        await switching; if (disposed) return; frame = value;
        const own = generation, current = view;
        try { await current.open(value); } catch (error) { if (!disposed && generation === own) throw error; }
      },
      close(id) { if (frame?.session === id) { frame = undefined; view.close(id); } },
      async context(id, context) {
        await switching; if (disposed || frame?.session !== id) return;
        const own = generation, current = view;
        try { await current.context(id, context); } catch (error) { if (!disposed && generation === own) throw error; }
      },
      async dispose() { if (disposed) return; disposed = true; generation++; frame = undefined; await view.dispose(); await switching?.catch(() => {}); },
    };
  };
}
