import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ReferenceMenu, queueMenuActionIds, referenceMenuNextId, referenceMenuPosition, referenceMenuTrigger,
  referenceQueueActions, selectReferenceMenuItem, type ReferenceMenuItem, type ReferenceQueueContext,
} from './ReferenceMenu';

const item = (id: string, extra: Partial<ReferenceMenuItem> = {}): ReferenceMenuItem => ({ id, label: id, onSelect: vi.fn(), ...extra });

describe('shared reference menu action contract', () => {
  it('dismisses the owner before opening the action surface', () => {
    const calls: string[] = [];
    const action = item('details', { onSelect: () => calls.push('open-details') });
    expect(selectReferenceMenuItem(action, () => calls.push('dismiss'))).toBe(true);
    expect(calls).toEqual(['dismiss', 'open-details']);
  });
  it.each(['hidden', 'disabled', 'loading'] as const)('never activates a %s item or dismisses on its behalf', state => {
    const action = item('cancel', { [state]: true }), dismiss = vi.fn();
    expect(selectReferenceMenuItem(action, dismiss)).toBe(false);
    expect(dismiss).not.toHaveBeenCalled(); expect(action.onSelect).not.toHaveBeenCalled();
  });
  it('dismisses even when an action fails, and does not call another action', () => {
    const dismiss = vi.fn();
    expect(() => selectReferenceMenuItem(item('failed', { onSelect: () => { throw new Error('Action failed'); } }), dismiss)).toThrow('Action failed');
    expect(dismiss).toHaveBeenCalledOnce();
  });
  it('omits hidden actions and represents disabled/loading independently', () => {
    const html = renderToStaticMarkup(<ReferenceMenu id="game-options" label="Game options" anchor={{ x: 10, y: 20 }} onDismiss={() => {}}
      items={[item('details'), item('hidden-operation', { hidden: true }), item('cancel', { disabled: true, title: 'Cancelling…' }), item('checking', { loading: true })]} />);
    expect(html).toContain('role="menu"'); expect(html).toContain('aria-label="Game options"');
    expect(html).toContain('data-game-menu'); expect(html).not.toContain('hidden-operation');
    expect(html).toMatch(/data-reference-menu-item="cancel"[^>]*disabled=""[^>]*aria-disabled="true"/);
    expect(html).toMatch(/data-reference-menu-item="checking"[^>]*disabled=""[^>]*aria-busy="true"/);
    expect(html).toContain('title="Cancelling…"');
  });
  it('renders an explicit pending surface without resolved actions', () => {
    const action = item('details');
    const html = renderToStaticMarkup(<ReferenceMenu id="pending" label="Pending options" anchor={{ x: 0, y: 0 }} loading items={[action]} onDismiss={() => {}} />);
    expect(html).toContain('role="status"'); expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain('role="menuitem"'); expect(action.onSelect).not.toHaveBeenCalled();
  });
});

describe('stable action focus and viewport anchors', () => {
  const actions = [item('hidden', { hidden: true }), item('details'), item('busy', { loading: true }), item('unavailable', { disabled: true }), item('manage')];
  it.each([
    ['details', 'ArrowDown', 'manage'], ['manage', 'ArrowDown', 'details'],
    ['details', 'ArrowUp', 'manage'], ['manage', 'ArrowUp', 'details'],
    ['manage', 'Home', 'details'], ['details', 'End', 'manage'],
    [undefined, 'ArrowDown', 'details'], [undefined, 'ArrowUp', 'manage'],
    ['removed-action', 'ArrowDown', 'details'], ['details', 'Enter', undefined],
  ])('moves from %s on %s to %s without invoking an action', (from, key, expected) => {
    expect(referenceMenuNextId(actions, from, key!)).toBe(expected);
    for (const action of actions) expect(action.onSelect).not.toHaveBeenCalled();
  });
  it('does not create a focus target when every item is disabled or hidden', () => {
    expect(referenceMenuNextId([item('a', { disabled: true }), item('b', { hidden: true })], undefined, 'ArrowDown')).toBeUndefined();
  });
  it('keeps focus identity when action order changes', () => {
    expect(referenceMenuNextId([item('manage'), item('details'), item('cancel')], 'details', 'ArrowDown')).toBe('cancel');
  });
  it('opens below its anchor and supports trailing-edge alignment', () => {
    const anchor = { left: 500, right: 540, top: 200, bottom: 240 };
    expect(referenceMenuPosition(anchor, { width: 288, height: 200 }, { width: 1000, height: 800 })).toEqual({ left: 500, top: 244 });
    expect(referenceMenuPosition(anchor, { width: 288, height: 200 }, { width: 1000, height: 800 }, 'end')).toEqual({ left: 252, top: 244 });
  });
  it('flips above a bottom anchor and clamps its trailing viewport edge', () => {
    expect(referenceMenuPosition({ left: 980, right: 1000, top: 730, bottom: 760 }, { width: 288, height: 200 }, { width: 1000, height: 800 }))
      .toEqual({ left: 704, top: 526 });
  });
  it('keeps a tall or offscreen menu origin inside the viewport', () => {
    expect(referenceMenuPosition({ left: -20, right: -10, top: -20, bottom: -10 }, { width: 288, height: 900 }, { width: 500, height: 600 }))
      .toEqual({ left: 8, top: 8 });
  });
  it('uses client coordinates for a pointer anchor without an extra gap', () => {
    expect(referenceMenuPosition({ left: 40, right: 40, top: 50, bottom: 50 }, { width: 288, height: 100 }, { width: 800, height: 600 }, 'start', 0))
      .toEqual({ left: 40, top: 50 });
  });
});

describe('context trigger inputs', () => {
  const event = (extra: object = {}) => ({ currentTarget: { id: 'original-card' }, key: '', clientX: 321, clientY: 123,
    preventDefault: vi.fn(), stopPropagation: vi.fn(), defaultPrevented: false, ...extra });
  it.each([{ key: 'ContextMenu' }, { key: 'F10', shiftKey: true }])('opens from %j at the originating card', key => {
    const onOpen = vi.fn(), input = event(key);
    referenceMenuTrigger({ onOpen }).onKeyDown(input as never);
    expect(input.preventDefault).toHaveBeenCalledOnce(); expect(input.stopPropagation).toHaveBeenCalledOnce();
    expect(onOpen).toHaveBeenCalledWith({ element: input.currentTarget, restoreFocusTo: input.currentTarget });
  });
  it('opens right-click at client coordinates and retains the exact origin', () => {
    const onOpen = vi.fn(), input = event();
    referenceMenuTrigger({ onOpen }).onContextMenu(input as never);
    expect(onOpen).toHaveBeenCalledWith({ x: 321, y: 123, restoreFocusTo: input.currentTarget });
    expect(input.preventDefault).toHaveBeenCalledOnce();
  });
  it.each([{ key: 'F10' }, { key: 'Enter' }, { key: ' ' }, { key: 'ContextMenu', altKey: true }, { key: 'F10', shiftKey: true, ctrlKey: true }, { key: 'ContextMenu', defaultPrevented: true }])('does not turn unrelated/consumed input %j into an action', key => {
    const onOpen = vi.fn(), input = event(key);
    referenceMenuTrigger({ onOpen }).onKeyDown(input as never);
    expect(onOpen).not.toHaveBeenCalled(); expect(input.preventDefault).not.toHaveBeenCalled();
  });
  it('does not open a disabled menu from pointer or keyboard', () => {
    const onOpen = vi.fn(), trigger = referenceMenuTrigger({ onOpen, disabled: true });
    trigger.onContextMenu(event() as never); trigger.onKeyDown(event({ key: 'ContextMenu' }) as never);
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe('queue state rules and operation identity', () => {
  const base: ReferenceQueueContext = { operationId: 'install-op-123', productId: '9PRODUCTID', state: 'Downloading', pauseResumeCancelSupported: true, intelligentDeliverySupported: false };
  it.each([
    ['Paused', ['details', 'resume', 'cancel']], ['Error', ['details', 'resume', 'cancel']],
    ['Downloading', ['details', 'pause', 'cancel']], ['Installing', ['details', 'pause', 'cancel']],
    ['Queued', ['details', 'prioritize', 'cancel']], ['Complete', ['details']], ['Cancelled', ['details']],
  ] as const)('derives %s actions with a verified operation adapter', (state, expected) => {
    expect(queueMenuActionIds({ ...base, state })).toEqual(expected);
  });
  it('does not gate product details or independent content management on pause capability', () => {
    expect(queueMenuActionIds({ ...base, pauseResumeCancelSupported: false })).toEqual(['details']);
    expect(queueMenuActionIds({ ...base, pauseResumeCancelSupported: false, intelligentDeliverySupported: true })).toEqual(['details', 'manage-installation']);
  });
  it('binds mutating operations to operation identity and details/content to product identity', () => {
    expect(referenceQueueActions({ ...base, intelligentDeliverySupported: true })).toEqual([
      { id: 'details', target: { kind: 'product', id: '9PRODUCTID' } },
      { id: 'pause', target: { kind: 'operation', id: 'install-op-123' } },
      { id: 'cancel', target: { kind: 'operation', id: 'install-op-123' } },
      { id: 'manage-installation', target: { kind: 'product', id: '9PRODUCTID' } },
    ]);
  });
  it('needs operation identity and resolved state, and never substitutes product identity', () => {
    expect(referenceQueueActions({ ...base, operationId: undefined })).toEqual([]);
    expect(referenceQueueActions({ ...base, state: undefined })).toEqual([]);
    expect(referenceQueueActions({ ...base, productId: undefined, intelligentDeliverySupported: true })).toEqual([
      { id: 'pause', target: { kind: 'operation', id: 'install-op-123' } },
      { id: 'cancel', target: { kind: 'operation', id: 'install-op-123' } },
    ]);
  });
});
