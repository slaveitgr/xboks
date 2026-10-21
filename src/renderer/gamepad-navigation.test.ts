import { describe, expect, it, vi } from 'vitest';
import { BackHandlerStack, dispatchBackHandlers, navigationTarget, PadInput, padDirection, registerBackHandler, revealDelta, stepGamepadRange } from './gamepad-navigation';

function pad(buttons: number[] = [], axes = [0, 0, 0, 0]) {
  return { buttons: Array.from({ length: 17 }, (_, index) => ({ pressed: buttons.includes(index), touched: false, value: buttons.includes(index) ? 1 : 0 })), axes };
}
const rect = (x: number, y: number, width = 80, height = 40) => ({ left: x, top: y, right: x + width, bottom: y + height });

describe('native range edits for controlled React inputs', () => {
  function fixture(next = '51') {
    // This fixture does not emulate numeric stepping. The browser check uses
    // real range controls; this verifies the React tracker/event boundary.
    class NativeRange {
      nativeValue = '50'; type = 'range'; disabled = false; readOnly = false;
      get value() { return this.nativeValue; }
      set value(value: string) { this.nativeValue = value; }
      ownerDocument = { defaultView: { HTMLInputElement: NativeRange, Event } };
      stepUp = vi.fn((_steps: number) => { this.nativeValue = next; });
      cloneNode = vi.fn((_deep: boolean) => probe);
      dispatchEvent = vi.fn((_event: Event) => true);
    }
    const input = new NativeRange(), probe = new NativeRange(), tracker = vi.fn();
    Object.defineProperty(input, 'value', { get: () => input.nativeValue, set: tracker });
    return { input: input as unknown as HTMLInputElement, native: input, probe, tracker };
  }
  it.each([['right',1],['left',-1]] as const)('uses native stepping for %s and bypasses the instance value tracker', (direction, steps) => {
    const { input, native, probe, tracker } = fixture(direction === 'right' ? '51' : '49');
    expect(stepGamepadRange(input,direction)).toBe(true);
    expect(probe.stepUp).toHaveBeenCalledWith(steps); expect(tracker).not.toHaveBeenCalled();
    expect(input.value).toBe(direction === 'right' ? '51' : '49');
    expect(native.dispatchEvent.mock.calls.map(([event])=>[event.type,event.bubbles])).toEqual([['input',true],['change',true]]);
  });
  it('does not emit a backend-commit-triggering change at a native min/max boundary', () => {
    const { input, native }=fixture('50');
    expect(stepGamepadRange(input,'right')).toBe(false); expect(native.dispatchEvent).not.toHaveBeenCalled();
  });
  it.each(['disabled','readOnly'] as const)('never edits a %s range', property => {
    const { input, native, probe }=fixture(); input[property]=true;
    expect(stepGamepadRange(input,'right')).toBeUndefined(); expect(probe.stepUp).not.toHaveBeenCalled(); expect(native.dispatchEvent).not.toHaveBeenCalled();
  });
  it('leaves non-range inputs and a native non-steppable range untouched', () => {
    const { input, native, probe }=fixture(); input.type='text';
    expect(stepGamepadRange(input,'right')).toBeUndefined();
    input.type='range'; probe.stepUp.mockImplementation(()=>{throw new Error('InvalidStateError');});
    expect(stepGamepadRange(input,'right')).toBe(false); expect(input.value).toBe('50'); expect(native.dispatchEvent).not.toHaveBeenCalled();
  });
});

describe('ordered consumable Back registration', () => {
  it('lets the most recently registered surface consume Back before its parent', () => {
    const stack = new BackHandlerStack(), parent = vi.fn(() => true), menu = vi.fn(() => true);
    stack.register(parent); stack.register(menu);
    expect(stack.dispatch()).toBe(true); expect(menu).toHaveBeenCalledOnce(); expect(parent).not.toHaveBeenCalled();
  });
  it('continues backward only for handlers that explicitly decline', () => {
    const stack = new BackHandlerStack(), calls: string[] = [];
    stack.register(() => { calls.push('page'); return true; });
    stack.register(() => { calls.push('menu'); return false; });
    stack.register(() => { calls.push('tooltip'); return false; });
    expect(stack.dispatch()).toBe(true); expect(calls).toEqual(['tooltip', 'menu', 'page']);
  });
  it('returns false when no surface consumes, allowing the existing page fallback', () => {
    const stack = new BackHandlerStack();
    expect(stack.dispatch()).toBe(false); stack.register(() => false); expect(stack.dispatch()).toBe(false);
  });
  it('cleans up one registration idempotently without removing another registration', () => {
    const stack = new BackHandlerStack(), handler = vi.fn(() => true);
    const remove = stack.register(handler); stack.register(handler);
    remove(); remove(); expect(stack.dispatch()).toBe(true); expect(handler).toHaveBeenCalledOnce();
  });
  it('does not invoke an older handler removed by the current handler', () => {
    const stack = new BackHandlerStack(), old = vi.fn(() => true), removeOld = stack.register(old);
    stack.register(() => { removeOld(); return false; });
    expect(stack.dispatch()).toBe(false); expect(old).not.toHaveBeenCalled();
  });
  it('does not activate a newly opened popup with the same Back press', () => {
    const stack = new BackHandlerStack(), next = vi.fn(() => true);
    const remove = stack.register(() => { remove(); stack.register(next); return true; });
    expect(stack.dispatch()).toBe(true); expect(next).not.toHaveBeenCalled();
    expect(stack.dispatch()).toBe(true); expect(next).toHaveBeenCalledOnce();
  });
  it('does not fall through to a background action if a surface handler throws', () => {
    const stack = new BackHandlerStack(), page = vi.fn(() => true);
    stack.register(page); stack.register(() => { throw new Error('Popup failure'); });
    expect(() => stack.dispatch()).toThrow('Popup failure'); expect(page).not.toHaveBeenCalled();
  });
  it('isolates handlers to their renderer window', () => {
    const first = {} as Window, second = {} as Window, handler = vi.fn(() => true), remove = registerBackHandler(first, handler);
    expect(dispatchBackHandlers(second)).toBe(false); expect(handler).not.toHaveBeenCalled();
    expect(dispatchBackHandlers(first)).toBe(true); remove(); expect(dispatchBackHandlers(first)).toBe(false);
  });
  it('does not close a registered outer surface behind an unregistered modal', () => {
    const doc = {} as Document, owner = { document: doc } as Window;
    const outer = { isConnected: true } as HTMLElement;
    const modal = { isConnected: true, contains: (element: HTMLElement) => element === modal } as HTMLElement;
    const page = vi.fn(() => true), outerClose = vi.fn(() => true);
    registerBackHandler(owner, page); registerBackHandler(owner, outerClose, () => outer);
    expect(dispatchBackHandlers(owner, modal)).toBe(false);
    expect(page).not.toHaveBeenCalled(); expect(outerClose).not.toHaveBeenCalled();
    expect(dispatchBackHandlers(owner, doc)).toBe(true); expect(page).toHaveBeenCalledOnce(); expect(outerClose).not.toHaveBeenCalled();
  });
  it('consumes only matching inner menu scope and ignores detached registrations', () => {
    const doc = {} as Document, owner = { document: doc } as Window;
    const menu = { isConnected: true, contains: (element: HTMLElement) => element === menu } as HTMLElement;
    const gone = { isConnected: false } as HTMLElement;
    const onMenu = vi.fn(() => true), stale = vi.fn(() => true);
    registerBackHandler(owner, onMenu, () => menu); registerBackHandler(owner, stale, () => gone);
    expect(dispatchBackHandlers(owner, menu)).toBe(true); expect(onMenu).toHaveBeenCalledOnce(); expect(stale).not.toHaveBeenCalled();
  });
});

describe('revealing focused controls inside the scroll viewport', () => {
  it.each([[120, 400, 0], [480, 800, 50], [20, 300, -50], [800, 1100, 350], [-400, -100, -470], [100, 1000, 30]])('reveals %s..%s with safe viewport bounds', (top, bottom, expected) => {
    expect(revealDelta(top, bottom, 70, 750)).toBe(expected);
  });
});

describe('gamepad input isolation and edge detection', () => {
  it('requires neutral after connection, so a held A never activates the launcher', () => {
    const input = new PadInput();
    expect(input.poll(pad([0]), 0).action).toBeUndefined();
    expect(input.poll(pad([0]), 2000).action).toBeUndefined();
    input.poll(pad(), 2100);
    expect(input.poll(pad([0]), 2200).action).toBe('accept');
    expect(input.poll(pad([0]), 5000).action).toBeUndefined();
  });
  it.each([[0, 'accept'], [1, 'back'], [2, 'options'], [4, 'previous-page'], [5, 'next-page']] as const)('button %s fires %s once until release', (button, action) => {
    const input = new PadInput(); input.poll(pad(), 0);
    expect(input.poll(pad([button]), 10).action).toBe(action);
    expect(input.poll(pad([button]), 5000).action).toBeUndefined();
    input.poll(pad(), 5100);
    expect(input.poll(pad([button]), 5200).action).toBe(action);
  });
  it.each([[12, 'up'], [13, 'down'], [14, 'left'], [15, 'right']] as const)('D-pad %s repeats only after delay', (button, direction) => {
    const input = new PadInput(); input.poll(pad(), 0);
    expect(input.poll(pad([button]), 10).action).toBe(direction);
    expect(input.poll(pad([button]), 389).action).toBeUndefined();
    expect(input.poll(pad([button]), 390).action).toBe(direction);
    expect(input.poll(pad([button]), 509).action).toBeUndefined();
    expect(input.poll(pad([button]), 510).action).toBe(direction);
    input.poll(pad(), 600);
    expect(input.poll(pad([button]), 610).action).toBe(direction);
  });
  it('changing direction moves immediately without carrying repeat acceleration', () => {
    const input = new PadInput(); input.poll(pad(), 0);
    input.poll(pad([12]), 10);
    expect(input.poll(pad([15]), 20).action).toBe('right');
    expect(input.poll(pad([15]), 390).action).toBeUndefined();
    expect(input.poll(pad([15]), 400).action).toBe('right');
  });
  it('focus/pointer reset requires release, preventing a delayed A click', () => {
    const input = new PadInput(); input.poll(pad(), 0); input.poll(pad([0]), 1);
    input.reset();
    expect(input.poll(pad([0]), 9000).action).toBeUndefined();
    input.poll(pad(), 9010);
    expect(input.poll(pad([0]), 9020).action).toBe('accept');
  });
  it('Steam+X belongs to Steam, not the options action', () => {
    const input = new PadInput(); input.poll(pad(), 0);
    expect(input.poll(pad([16, 2]), 10)).toEqual({ scroll: 0 });
    expect(input.poll(pad([2]), 20).action).toBeUndefined();
    input.poll(pad(), 30);
    expect(input.poll(pad([2]), 40).action).toBe('options');
  });
  it('prioritizes Back over simultaneous A without replaying A afterward', () => {
    const input = new PadInput(); input.poll(pad(), 0);
    expect(input.poll(pad([0, 1]), 1).action).toBe('back');
    expect(input.poll(pad([0]), 2).action).toBeUndefined();
  });
  it('right stick scroll has a deadzone and also requires a neutral connection', () => {
    const input = new PadInput();
    expect(input.poll(pad([], [0, 0, 0, 1]), 0).scroll).toBe(0);
    input.poll(pad(), 1);
    expect(input.poll(pad([], [0, 0, 0, 0.29]), 2).scroll).toBe(0);
    expect(input.poll(pad([], [0, 0, 0, 0.7]), 3).scroll).toBe(0.7);
  });
});

describe('direction and geometry', () => {
  it.each(['left', 'right', 'up', 'down'] as const)('never jumps diagonally when pressing %s', direction => {
    const target = direction === 'left' ? rect(0,0) : direction === 'right' ? rect(200,0) : direction === 'up' ? rect(0,0) : rect(0,200);
    expect(navigationTarget(rect(100,100), [{value:'diagonal',rect:target}], direction)).toBeUndefined();
  });
  it('prefers a distant same-row button over a close diagonal one', () => {
    expect(navigationTarget(rect(800,300), [{value:'above',rect:rect(680,245)},{value:'left',rect:rect(100,300)}], 'left')).toBe('left');
  });
  it('does not treat a five-pixel corner overlap as the same row', () => {
    expect(navigationTarget(rect(800,300), [{value:'above-corner',rect:rect(680,265)},{value:'left',rect:rect(100,300)}], 'left')).toBe('left');
  });
  it('allows small vertically offset controls only inside an explicit action row', () => {
    const from=rect(800,300), target={value:'refresh',rect:rect(680,285,20,20)};
    expect(navigationTarget(from,[target],'left')).toBeUndefined();
    expect(navigationTarget(from,[target],'left',true)).toBe('refresh');
  });
  it('keeps the same column with a tiny refresh control beside larger buttons', () => {
    expect(navigationTarget(rect(300,500), [{value:'small-diagonal',rect:rect(390,450,20,20)},{value:'above',rect:rect(300,200,100,40)}], 'up')).toBe('above');
  });
  it.each([[0.8, 0, 'right'], [-0.8, 0, 'left'], [0, 0.8, 'down'], [0, -0.8, 'up'], [0.6, 0.9, 'down']] as const)('stick %s/%s selects %s', (x, y, direction) => {
    expect(padDirection(pad([], [x, y]))).toBe(direction);
  });
  it('ignores jitter, missing and non-finite axes', () => {
    for (const axes of [[], [0.54, -0.54], [NaN, Infinity]]) expect(padDirection(pad([], axes))).toBeUndefined();
  });
  it.each(['up', 'down', 'left', 'right'] as const)('selects aligned %s control in a grid', direction => {
    const targets = [
      { value: 'up', rect: rect(100, 0) }, { value: 'down', rect: rect(100, 200) },
      { value: 'left', rect: rect(0, 100) }, { value: 'right', rect: rect(200, 100) },
      { value: 'diagonal', rect: rect(190, 190) },
    ];
    expect(navigationTarget(rect(100, 100), targets, direction)).toBe(direction);
  });
  it('does not wrap at an edge or choose the control behind the direction', () => {
    expect(navigationTarget(rect(100, 100), [{ value: 'behind', rect: rect(0, 100) }], 'right')).toBeUndefined();
  });
  it('can select an offscreen row so it can be scrolled into view', () => {
    expect(navigationTarget(rect(0, 700), [{ value: 'next-row', rect: rect(0, 1000) }], 'down')).toBe('next-row');
  });
  it.each([2, 3, 4, 5, 6])('keeps the column with %s responsive grid columns and tall cards', columns => {
    const cards = Array.from({ length: columns * 2 }, (_, value) => ({ value,
      rect: rect((value % columns) * 193, Math.floor(value / columns) * 330, 180, 317) }));
    for (let column = 0; column < columns; column++) {
      expect(navigationTarget(cards[column].rect, cards.filter(card => card.value !== column), 'down')).toBe(column + columns);
      expect(navigationTarget(cards[column + columns].rect, cards.filter(card => card.value !== column + columns), 'up')).toBe(column);
    }
    for (const [index, direction] of [[0, 'up'], [0, 'left'], [columns - 1, 'right'], [columns * 2 - 1, 'down']] as const) {
      expect(navigationTarget(cards[index].rect, cards.filter(card => card.value !== index), direction)).toBeUndefined();
    }
  });
});
