import { describe, expect, it, vi } from 'vitest';
import { GuideButtonFallback, installGuideButtonFallback } from './guide-button';
import type {DesktopSettingsStatus} from '../shared/types';

describe('browser Guide button fallback ownership', () => {
  it('opens exactly once for each neutral-to-pressed edge', () => {
    const input = new GuideButtonFallback();
    expect(input.poll(false, true, true, undefined)).toBe(false);
    expect(input.poll(true, true, true, undefined)).toBe(true);
    expect(input.poll(true, true, true, undefined)).toBe(false);
    expect(input.poll(false, true, true, undefined)).toBe(false);
    expect(input.poll(true, true, true, undefined)).toBe(true);
  });

  it('never toggles beside an admitted native listener', () => {
    const input = new GuideButtonFallback(), native = { status: 'listening', devices: 1 } as const;
    input.poll(false, true, true, undefined);
    for (const pressed of [true, false, true, true]) expect(input.poll(pressed, true, true, native)).toBe(false);
    // Losing native ownership while the button is held must not replay it.
    expect(input.poll(true, true, true, { status: 'unavailable', devices: 0 })).toBe(false);
    input.poll(false, true, true, undefined);
    expect(input.poll(true, true, true, undefined)).toBe(true);
  });

  it.each(['unavailable', 'error', 'stopped', 'listening'] as const)('retains focused fallback without admitted devices (%s)', status => {
    const input = new GuideButtonFallback(), state = { status, devices: 0 };
    input.poll(false, true, true, state);
    expect(input.poll(true, true, true, state)).toBe(true);
  });

  it.each([{ status: 'starting', devices: 0 }, { status: 'unavailable', devices: 0, reason: 'session-blocked' }] as const)('never bypasses native startup or session blocking (%j)', state => {
    const input = new GuideButtonFallback();
    input.poll(false, true, true, undefined);
    expect(input.poll(true, true, true, state)).toBe(false);
    expect(input.poll(true, true, true, undefined)).toBe(false);
  });

  it.each([[false, true], [true, false], [false, false]])('does not react in a background or hidden document (focus=%s visible=%s)', (focused, visible) => {
    const input = new GuideButtonFallback();
    input.poll(false, true, true, undefined);
    expect(input.poll(true, focused, visible, undefined)).toBe(false);
    expect(input.poll(true, true, true, undefined)).toBe(false);
    input.poll(false, true, true, undefined);
    expect(input.poll(true, true, true, undefined)).toBe(true);
  });

  it('does not replay a button already held when the renderer mounts', () => {
    const input = new GuideButtonFallback();
    expect(input.poll(true, true, true, undefined)).toBe(false);
    expect(input.poll(true, true, true, undefined)).toBe(false);
    input.poll(false, true, true, undefined);
    expect(input.poll(true, true, true, undefined)).toBe(true);
  });
});

describe('Guide fallback scheduler', () => {
  function fixture(controller?: DesktopSettingsStatus['gameBarController'], initial: {focused?: boolean; hidden?: boolean} = {}) {
    let focused = initial.focused ?? true, pressed = false, serial = 0;
    const timers = new Map<number, () => void>();
    const doc = Object.assign(new EventTarget(), {hidden: initial.hidden ?? false, hasFocus: () => focused});
    const getGamepads = vi.fn(() => [{buttons: Array.from({length: 17}, (_, index) => ({pressed: index === 16 && pressed}))}] as unknown as Gamepad[]), guide = vi.fn();
    const win = Object.assign(new EventTarget(), {document: doc, navigator: {getGamepads}, setInterval: (callback: () => void) => {const id = ++serial; timers.set(id, callback); return id;}, clearInterval: (id: number) => {timers.delete(id);}});
    const stop = installGuideButtonFallback(win as unknown as Window, controller, guide);
    return {getGamepads, guide, stop, timers,
      tick(count = 1) {for (let i = 0; i < count; i++) for (const callback of [...timers.values()]) callback();},
      press(value: boolean) {pressed = value;},
      focus(value: boolean) {focused = value; win.dispatchEvent(new Event(value ? 'focus' : 'blur'));},
      visible(value: boolean) {doc.hidden = !value; doc.dispatchEvent(new Event('visibilitychange'));},
    };
  }
  it.each([{focused: false}, {hidden: true}])('arms no timer or browser gamepad read while inactive (%j)', state => {
    const f = fixture(undefined, state); f.tick(100); expect(f.timers.size).toBe(0); expect(f.getGamepads).not.toHaveBeenCalled();
    f.visible(true); f.focus(true); expect(f.timers.size).toBe(1); expect(f.getGamepads).toHaveBeenCalledOnce(); f.stop();
  });
  it.each([{status: 'listening', devices: 1}, {status: 'starting', devices: 0}, {status: 'unavailable', devices: 0, reason: 'session-blocked'}] as const)('does no browser work while native ownership or session blocking applies (%j)', controller => {
    const f = fixture(controller); f.tick(100); f.focus(true); f.visible(true);
    expect(f.timers.size).toBe(0); expect(f.getGamepads).not.toHaveBeenCalled(); expect(f.guide).not.toHaveBeenCalled(); f.stop();
  });
  it('keeps one foreground interval and stops it completely on blur or hide', () => {
    const f = fixture(); expect(f.timers.size).toBe(1); f.tick(100); expect(f.getGamepads).toHaveBeenCalledTimes(101);
    f.focus(false); f.tick(100); expect(f.timers.size).toBe(0); expect(f.getGamepads).toHaveBeenCalledTimes(101);
    f.focus(true); f.focus(true); f.visible(true); expect(f.timers.size).toBe(1); expect(f.getGamepads).toHaveBeenCalledTimes(102);
    f.visible(false); f.tick(100); expect(f.getGamepads).toHaveBeenCalledTimes(102); f.stop();
  });
  it('requires neutral after resuming so a held Guide cannot close a newly opened native overlay', () => {
    const f = fixture(); f.focus(false); f.press(true); f.focus(true); f.tick(3); expect(f.guide).not.toHaveBeenCalled();
    f.press(false); f.tick(); f.press(true); f.tick(3); expect(f.guide).toHaveBeenCalledOnce(); f.stop();
  });
  it('removes every wakeup source on disposal', () => {
    const f = fixture(); f.stop(); const reads = f.getGamepads.mock.calls.length;
    f.focus(false); f.focus(true); f.visible(false); f.visible(true); f.tick(100);
    expect(f.timers.size).toBe(0); expect(f.getGamepads).toHaveBeenCalledTimes(reads); expect(f.guide).not.toHaveBeenCalled();
  });
});
