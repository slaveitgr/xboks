import { describe, expect, it, vi } from 'vitest';
import vm from 'node:vm';
import { browserBindingAllowed, browserRequestHeaders, installBrowserAuthBridge } from './auth-browser';
const frame = { type: 'open' as const, session: 1, url: 'https://login.live.com/ppsecure/InlineLogin.srf', headers: { hostapp: 'CloudExperienceHost' } };
describe('browser auth trust boundaries', () => {
  it('accepts only the active top-level main-world Microsoft context', () => {
    const context = { origin: 'https://login.live.com', auxData: { isDefault: true, frameId: 'own-frame' } };
    expect(browserBindingAllowed(context, 'own-frame', frame)).toBe(true);
    for (const value of [{ ...context, origin: 'https://login.live.com.evil.invalid' }, { ...context, origin: 'http://login.live.com' }, { ...context, auxData: { isDefault: false, frameId: 'own-frame' } }, { ...context, auxData: { isDefault: true, frameId: 'sub-frame' } }, undefined]) expect(browserBindingAllowed(value, 'own-frame', frame)).toBe(false);
    expect(browserBindingAllowed(context, 'own-frame', undefined)).toBe(false);
  });
  it('adds initial headers only to the exact backend URL and document', () => {
    const request = { frameId: 'own-frame', resourceType: 'Document', request: { url: frame.url, headers: { HostApp: 'old', Accept: 'text/html' } } };
    expect(browserRequestHeaders(request, 'own-frame', frame)).toEqual([{ name: 'Accept', value: 'text/html' }, { name: 'hostapp', value: 'CloudExperienceHost' }]);
    for (const other of [{ ...request, frameId: 'iframe' }, { ...request, resourceType: 'XHR' }, { ...request, request: { ...request.request, url: 'https://login.live.com/redirect' } }, { ...request, request: { ...request.request, url: 'https://example.invalid' } }]) expect(browserRequestHeaders(other, 'own-frame', frame)).toBeUndefined();
    expect(browserRequestHeaders(request, 'own-frame', undefined)).toBeUndefined();
  });
  it('preserves WebAuthn and forwards only bounded notifications, with no launcher API', () => {
    const send = vi.fn(), get = vi.fn(); const handlers = new Map<string, () => void>();
    const window: any = { external: {}, ServerData: { sDAToken: 'synthetic-in-memory' }, addEventListener: (name: string, cb: () => void) => handlers.set(name, cb) }; window.top = window;
    const sandbox = { window, location: { protocol: 'https:', port: '', hostname: 'login.live.com', pathname: '/ppsecure/post.srf' }, navigator: { credentials: { get } }, syntheticChannel: send };
    vm.runInNewContext(`(${installBrowserAuthBridge.toString()})('syntheticChannel',['login.live.com'])`, sandbox);
    window.external.notify('synthetic'); window.external.notify({ untrusted: true }); window.external.notify('x'.repeat(65537));
    handlers.get('DOMContentLoaded')!();
    expect(send.mock.calls.map(call => call[0])).toEqual(['synthetic', JSON.stringify(window.ServerData)]);
    expect(sandbox.navigator.credentials.get).toBe(get); expect(window.launcher).toBeUndefined();
  });
  it('never installs the host bridge on another website or an iframe', () => {
    for (const iframe of [true, false]) {
      const window: any = { external: {} }; window.top = iframe ? {} : window;
      vm.runInNewContext(`(${installBrowserAuthBridge.toString()})('missingChannel',['login.live.com'])`, { window, location: { protocol: 'https:', port: '', hostname: iframe ? 'login.live.com' : 'example.invalid' } });
      expect(window.external.notify).toBeUndefined();
    }
  });
});
