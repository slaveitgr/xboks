import {afterEach, describe, expect, it, vi} from 'vitest';
import {installGamepadNavigation, type PadAction} from './gamepad-navigation';

function fixture(initial: {focused?: boolean; hidden?: boolean; native?: boolean; controls?: boolean; activateOnFocus?: boolean} = {}) {
  let focused = initial.focused ?? true, native = initial.native ?? false, frameId = 0, elapsed = 0, callbacks = 0;
  const frames = new Map<number, FrameRequestCallback>(), observers: FakeObserver[] = [];
  class FakeElement {
    constructor(readonly tag = 'div') {}
    isConnected = true; tabIndex = 0; parentElement = null; scrollHeight = 0; clientHeight = 0;
    attributes = new Map<string, string>(); dataset: Record<string, string> = {};
    getClientRects() {return [{}];} closest() {return null;} querySelectorAll() {return [];} querySelector() {return null;}
    matches(selector: string) {return this.tag === 'button' && (selector === 'button' || selector.startsWith('button,'));}
    hasAttribute(name: string) {return this.attributes.has(name);} getAttribute(name: string) {return this.attributes.get(name) ?? null;}
    setAttribute(name: string, value: string) {this.attributes.set(name, value);} removeAttribute(name: string) {this.attributes.delete(name);}
    toggleAttribute(name: string, value: boolean) {if (value) this.setAttribute(name, ''); else this.removeAttribute(name);}
    contains(value: unknown) {return value === this;}
    focus = vi.fn(() => {doc.activeElement = this;});
    blur() {doc.activeElement = body;}
    click = vi.fn();
  }
  const body = new FakeElement(), root = new FakeElement(), button = new FakeElement('button');
  let controls = initial.controls ? [button] : [];
  const doc = Object.assign(new EventTarget(), {
    hidden: initial.hidden ?? false, documentElement: root, body, activeElement: body,
    hasFocus: () => focused, contains: (value: unknown) => value === body || controls.includes(value as FakeElement),
    querySelector: () => null,
    querySelectorAll: (selector: string) => selector.startsWith('button,') ? controls : selector === '[data-gamepad-focus]' ? controls.filter(node => node.hasAttribute('data-gamepad-focus')) : [],
  });
  const getGamepads = vi.fn((): (Gamepad | null)[] => []), back = vi.fn(), mode = vi.fn();
  let dispatch: ((action: PadAction) => void) | undefined;
  const win = Object.assign(new EventTarget(), {
    document: doc, navigator: {getGamepads},
    getComputedStyle: () => ({visibility: 'visible', display: 'block', overflowY: 'visible'}),
    requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {const id = ++frameId; frames.set(id, callback); return id;}),
    cancelAnimationFrame: vi.fn((id: number) => {frames.delete(id);}),
  });
  class FakeObserver {
    target?: unknown; active = true;
    constructor(readonly callback: () => void) {observers.push(this);}
    observe(target: unknown) {this.target = target;} disconnect() {this.active = false;}
  }
  vi.stubGlobal('HTMLElement', FakeElement); vi.stubGlobal('HTMLInputElement', class {}); vi.stubGlobal('HTMLSelectElement', class {}); vi.stubGlobal('HTMLTextAreaElement', class {}); vi.stubGlobal('MutationObserver', FakeObserver);
  const stop = installGamepadNavigation(win as unknown as Window, {mode, back, page: () => {}, activateOnFocus: initial.activateOnFocus,
    nativeControlsActive: () => native, subscribeInput: callback => {dispatch = callback; return () => {dispatch = undefined;};}});
  const mutate = (target: unknown) => observers.filter(observer => observer.active && observer.target === target).forEach(observer => observer.callback());
  return {getGamepads, back, mode, stop, frames, button, doc,
    run(count: number) {const start = callbacks; for (let i = 0; i < count; i++) {const pending = [...frames.values()]; frames.clear(); elapsed += 1000 / 60; for (const callback of pending) {callbacks++; callback(elapsed);}} return callbacks - start;},
    focus(value: boolean) {focused = value; win.dispatchEvent(new Event(value ? 'focus' : 'blur'));},
    visible(value: boolean) {doc.hidden = !value; doc.dispatchEvent(new Event('visibilitychange'));},
    native(value: boolean) {native = value; win.dispatchEvent(new Event('focus'));},
    stream(value?: string) {if (value) root.dataset.cloudStreamInput = value; else delete root.dataset.cloudStreamInput; mutate(root);},
    input(value: PadAction) {dispatch?.(value);},
    replaceControl() {const next = new FakeElement('button'); controls = [next]; doc.activeElement = body; mutate(body); return next;},
    mutate: () => mutate(body),
    get callbackCount() {return callbacks;},
  };
}
afterEach(() => vi.unstubAllGlobals());

describe('background gamepad work suspension', () => {
  it('runs no callbacks or gamepad reads across600 simulated frames after blur, then rearms exactly one loop', () => {
    const f = fixture(); expect(f.run(600)).toBe(600); expect(f.getGamepads).toHaveBeenCalledTimes(600);
    f.focus(false); const reads = f.getGamepads.mock.calls.length;
    expect(f.run(600)).toBe(0); expect(f.getGamepads).toHaveBeenCalledTimes(reads);
    f.focus(true); f.focus(true); expect(f.frames.size).toBe(1); expect(f.run(60)).toBe(60); expect(f.getGamepads).toHaveBeenCalledTimes(reads + 60); f.stop();
  });
  it.each([{hidden: true}, {focused: false}])('does not arm an initially inactive renderer (%j)', state => {
    const f = fixture(state); expect(f.run(600)).toBe(0); expect(f.getGamepads).not.toHaveBeenCalled();
    f.visible(true); f.focus(true); expect(f.frames.size).toBe(1); f.run(1); expect(f.getGamepads).toHaveBeenCalledOnce(); f.stop();
  });
  it('suspends hidden documents and waits for both visibility and focus before polling again', () => {
    const f = fixture(); f.run(1); f.visible(false); expect(f.run(600)).toBe(0);
    f.focus(false); f.visible(true); expect(f.frames.size).toBe(0); f.focus(true); f.run(1); expect(f.getGamepads).toHaveBeenCalledTimes(2); f.stop();
  });
  it('suspends while the stream owns game input and recovers when the stream menu returns ownership', () => {
    const f = fixture(); f.run(1); f.stream('active'); expect(f.run(600)).toBe(0); expect(f.getGamepads).toHaveBeenCalledOnce();
    f.stream('menu'); expect(f.frames.size).toBe(1); f.run(1); expect(f.getGamepads).toHaveBeenCalledTimes(2);
    f.stream(); expect(f.frames.size).toBe(1); f.stop();
  });
  it('does not replay a confirmation held across focus loss', () => {
    const f = fixture(); let pressed = false;
    f.getGamepads.mockImplementation(() => [{connected: true, mapping: 'standard', index: 0, id: 'sample', axes: [0,0,0,0], buttons: Array.from({length: 17}, (_, index) => ({pressed: index === 1 && pressed, value: index === 1 && pressed ? 1 : 0}))} as unknown as Gamepad]);
    f.run(1); f.focus(false); pressed = true; f.focus(true); f.run(2); expect(f.back).not.toHaveBeenCalled();
    pressed = false; f.run(1); pressed = true; f.run(1); expect(f.back).toHaveBeenCalledOnce(); f.stop();
  });
  it('stops a broken gamepad API instead of retrying on every frame', () => {
    const f = fixture(); f.getGamepads.mockImplementation(() => {throw Error('Unsupported device');});
    expect(f.run(600)).toBe(1); expect(f.getGamepads).toHaveBeenCalledOnce(); f.focus(true); f.run(1); expect(f.getGamepads).toHaveBeenCalledTimes(2); f.stop();
  });
  it('keeps native navigation event-driven and repairs post-render focus without a recurring loop', () => {
    const f = fixture({native: true, controls: true, activateOnFocus: true}); f.run(5);
    expect(f.run(600)).toBe(0); expect(f.getGamepads).not.toHaveBeenCalled();
    const next = f.replaceControl(); f.run(5); expect(next.focus).toHaveBeenCalled(); expect(f.doc.activeElement).toBe(next); expect(f.run(600)).toBe(0);
    f.input('back'); f.run(5); expect(f.back).toHaveBeenCalledOnce(); expect(f.run(600)).toBe(0); expect(f.getGamepads).not.toHaveBeenCalled(); f.stop();
  });
  it('resumes fallback after native ownership is released without also sampling native input', () => {
    const f = fixture({native: true}); expect(f.run(600)).toBe(0); f.input('back'); f.run(5); expect(f.back).toHaveBeenCalledOnce(); expect(f.getGamepads).not.toHaveBeenCalled();
    f.native(false); expect(f.frames.size).toBe(1); f.run(2); expect(f.getGamepads).toHaveBeenCalledTimes(2);
    f.native(true); f.run(2); expect(f.getGamepads).toHaveBeenCalledTimes(2); expect(f.frames.size).toBe(0); f.stop();
  });
  it('cannot rearm or repair focus after disposal or while hidden', () => {
    const f = fixture({native: true, controls: true}); f.input('back'); f.visible(false); expect(f.run(600)).toBe(0); const calls = f.back.mock.calls.length;
    f.input('back'); expect(f.back).toHaveBeenCalledTimes(calls); f.stop(); f.visible(true); f.focus(true); f.mutate(); f.input('back'); expect(f.run(600)).toBe(0);
  });
});
