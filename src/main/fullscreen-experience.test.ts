import { expect, it, vi } from 'vitest';
import { FullscreenExperience } from './fullscreen-experience.js';
import type { ExperienceLease } from './experience-client.js';
function fixture(initial: Partial<ExperienceLease> = {}, session = false) {
  let window = false;
  const state: ExperienceLease = { available: true, active: false, owned: false, ...initial };
  const bridge = { current: state, request: vi.fn(async (method: string) => {
    if (method === 'enter') Object.assign(state, { active: true, owned: true });
    if (method === 'leave') Object.assign(state, { active: false, owned: false });
    return { ...state };
  }), dispose: vi.fn(() => { Object.assign(state, { available: false, owned: false, active: false }); }) };
  const native = vi.fn(async (enabled: boolean) => { window = enabled; });
  const changed = vi.fn();
  const controller = new FullscreenExperience({ bridge, session, windowFullscreen: () => window, setWindowFullscreen: native, changed });
  return { controller, bridge, native, changed, state, window: () => window };
}
it('coordinates native fullscreen with an acknowledged owned lease and restores desktop', async () => {
  const f = fixture();
  expect(await f.controller.setWindow(true)).toBe(true);
  expect(f.bridge.request.mock.calls.map(args => args[0])).toEqual(['state', 'enter']);
  expect(f.controller.current).toMatchObject({ available: true, active: true, source: 'gnome-extension' });
  expect(await f.controller.setWindow(false)).toBe(false);
  expect(f.bridge.request).toHaveBeenLastCalledWith('leave');
  expect(f.controller.current.active).toBe(false);
});
it('keeps window-only fullscreen distinct from an integrated shell experience', async () => {
  const f = fixture({ available: false, reason: 'Extension absent' });
  f.bridge.request.mockRejectedValue(Error('Extension absent'));
  expect(await f.controller.setWindow(true)).toBe(true);
  expect(f.controller.current).toMatchObject({ available: false, active: false, source: 'none' });
  expect(f.bridge.request).not.toHaveBeenCalledWith('enter');
  await f.controller.setWindow(false);
  await expect(f.controller.setWindow(true, true)).rejects.toThrow('Extension absent');
  expect(f.window()).toBe(false);
});
it('never treats another application lease as owned or leaves it', async () => {
  const f = fixture({ active: true, owned: false });
  expect(f.controller.current.active).toBe(false);
  await f.controller.setWindow(false);
  expect(f.bridge.request).not.toHaveBeenCalledWith('leave');
  expect(f.state.active).toBe(true);
});
it('drops uncertain Enter ownership and rolls back native fullscreen on failure', async () => {
  const f = fixture();
  f.bridge.request.mockImplementation(async method => {
    if (method === 'enter') { f.state.owned = true; f.state.active = true; throw Error('Lost reply'); }
    return { ...f.state };
  });
  await expect(f.controller.setWindow(true)).rejects.toThrow('Lost reply');
  expect(f.bridge.dispose).toHaveBeenCalledOnce(); expect(f.window()).toBe(false);
  expect(f.controller.current.active).toBe(false);
});
it('does not hide shell chrome if native fullscreen fails', async () => {
  const f = fixture(); f.native.mockRejectedValue(Error('Compositor refused'));
  await expect(f.controller.setWindow(true)).rejects.toThrow('Compositor refused');
  expect(f.bridge.request).not.toHaveBeenCalledWith('enter');
});
it('returns the native window to desktop after an emergency/lock lease loss', async () => {
  const f = fixture(); await f.controller.setWindow(true);
  f.state.owned = false; f.state.active = false; f.controller.shellChanged();
  await Promise.resolve(); expect(f.window()).toBe(false);
});
it('honors emergency release in the same transport chunk as a successful Enter reply', async () => {
  const f = fixture();
  f.bridge.request.mockImplementation(async method => {
    if (method === 'enter') {
      Object.assign(f.state, { active: true, owned: true }); f.controller.shellChanged();
      const reply = { ...f.state };
      Object.assign(f.state, { active: false, owned: false }); f.controller.shellChanged();
      return reply;
    }
    return { ...f.state };
  });
  await expect(f.controller.setWindow(true)).rejects.toThrow('interrupted');
  expect(f.window()).toBe(false);
  expect(f.controller.current.active).toBe(false);
  expect(f.controller.transitioning).toBe(false);
});
it('does not downgrade a required integration when the extension disappears during native fullscreen', async () => {
  const f = fixture(), native = f.native.getMockImplementation()!;
  f.native.mockImplementation(async enabled => {
    await native(enabled);
    if (enabled) {
      Object.assign(f.state, { available: false, active: false, owned: false });
      f.controller.shellChanged();
    }
  });
  f.bridge.request.mockImplementation(async method => {
    if (method === 'enter') throw Error('Extension disappeared during fullscreen');
    return { ...f.state };
  });
  await expect(f.controller.setWindow(true, true)).rejects.toThrow('Extension disappeared');
  expect(f.bridge.request).toHaveBeenCalledWith('enter');
  expect(f.bridge.dispose).toHaveBeenCalledOnce();
  expect(f.window()).toBe(false);
  expect(f.controller.current.active).toBe(false);
  expect(f.controller.transitioning).toBe(false);
});
it('drops ownership if Leave acknowledges without releasing the lease', async () => {
  const f = fixture(); await f.controller.setWindow(true);
  f.bridge.request.mockImplementation(async () => ({ ...f.state }));
  expect(await f.controller.setWindow(false)).toBe(false);
  expect(f.bridge.dispose).toHaveBeenCalledOnce();
  expect(f.controller.current.active).toBe(false);
});
it('does not masquerade an application window exit as a standalone session switch', async () => {
  const f = fixture({}, true);
  expect(f.controller.current).toEqual({ available: true, active: true, source: 'session' });
  await expect(f.controller.setWindow(false)).rejects.toThrow('distribution session switcher');
  expect(f.bridge.request).not.toHaveBeenCalled();
});
