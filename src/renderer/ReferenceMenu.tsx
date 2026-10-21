import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEventHandler, type MouseEventHandler, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useBackHandler } from './GamepadNavigation';
import './reference-menu.css';

export interface ReferenceMenuItem {
  /** Stable action identity, independent of label, order and selected game. */
  id: string;
  label: string;
  icon?: ReactNode;
  hidden?: boolean;
  disabled?: boolean;
  loading?: boolean;
  danger?: boolean;
  title?: string;
  onSelect: () => void;
}

export type ReferenceMenuAnchor =
  | { element: HTMLElement; align?: 'start' | 'end'; restoreFocusTo?: HTMLElement }
  | { x: number; y: number; restoreFocusTo?: HTMLElement };
export type ReferenceMenuDismissReason = 'select' | 'escape' | 'back' | 'outside' | 'tab' | 'empty' | 'anchor-removed';
export interface ReferenceMenuProps {
  id: string;
  label: string;
  anchor: ReferenceMenuAnchor;
  items: readonly ReferenceMenuItem[];
  onDismiss: (reason: ReferenceMenuDismissReason) => void;
  loading?: boolean;
  loadingLabel?: string;
  initialFocusId?: string;
  className?: string;
}

type Bounds = Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>;
export function referenceMenuPosition(anchor: Bounds, size: { width: number; height: number }, viewport: { width: number; height: number }, align: 'start' | 'end' = 'start', gap = 4) {
  const inset = 8;
  const clamp = (value: number, maximum: number) => Math.max(inset, Math.min(value, Math.max(inset, maximum)));
  const left = align === 'end' ? anchor.right - size.width : anchor.left;
  const below = anchor.bottom + gap;
  const above = anchor.top - gap - size.height;
  const top = below + size.height > viewport.height - inset && above >= inset ? above : below;
  return { left: clamp(left, viewport.width - size.width - inset), top: clamp(top, viewport.height - size.height - inset) };
}

export const referenceMenuItemEnabled = (item: ReferenceMenuItem) => !item.hidden && !item.disabled && !item.loading;

/** Hover is a focus request only. Activation has exactly one path, and the
 * popup dismisses before the action opens another page/dialog (F47516/17). */
export function selectReferenceMenuItem(item: ReferenceMenuItem, dismiss: () => void): boolean {
  if (!referenceMenuItemEnabled(item)) return false;
  dismiss();
  item.onSelect();
  return true;
}

export function referenceMenuNextId(items: readonly ReferenceMenuItem[], currentId: string | undefined, key: string): string | undefined {
  const enabled = items.filter(referenceMenuItemEnabled);
  if (!enabled.length) return;
  const index = enabled.findIndex(item => item.id === currentId);
  if (key === 'Home') return enabled[0].id;
  if (key === 'End') return enabled.at(-1)!.id;
  if (key === 'ArrowDown') return enabled[(index + 1) % enabled.length].id;
  if (key === 'ArrowUp') return enabled[(index < 0 ? enabled.length - 1 : (index - 1 + enabled.length) % enabled.length)].id;
}

/** Attach to the card/row or its menu button. These request its context menu;
 * they never call its primary action. Gamepad X dispatches ContextMenu here. */
export function referenceMenuTrigger({ onOpen, disabled = false }: {
  onOpen: (anchor: ReferenceMenuAnchor) => void;
  disabled?: boolean;
}): { onContextMenu: MouseEventHandler<HTMLElement>; onKeyDown: KeyboardEventHandler<HTMLElement> } {
  return {
    onContextMenu(event) {
      if (disabled || event.defaultPrevented) return;
      event.preventDefault(); event.stopPropagation();
      onOpen({ x: event.clientX, y: event.clientY, restoreFocusTo: event.currentTarget });
    },
    onKeyDown(event) {
      if (disabled || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey ||
        !(event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) return;
      event.preventDefault(); event.stopPropagation();
      onOpen({ element: event.currentTarget, restoreFocusTo: event.currentTarget });
    },
  };
}

const useMenuLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** Controlled popup: mount it while open and unmount it in onDismiss. Linux
 * rendering implements the statically traced contracts; original runtime and
 * pixel parity remain separate verification work. */
export function ReferenceMenu({ id, label, anchor, items, onDismiss, loading = false, loadingLabel = 'Loading…', initialFocusId, className = '' }: ReferenceMenuProps) {
  const menu = useRef<HTMLDivElement>(null);
  const callback = useRef(onDismiss); callback.current = onDismiss;
  const dismissed = useRef(false);
  const restore = useRef<HTMLElement>();
  const [position, setPosition] = useState<{ left: number; top: number }>();
  const element = 'element' in anchor ? anchor.element : undefined;
  const x = 'x' in anchor ? anchor.x : undefined, y = 'y' in anchor ? anchor.y : undefined;
  const align = 'align' in anchor ? anchor.align : undefined;
  const explicitRestore = anchor.restoreFocusTo;
  const positioned = Boolean(position);
  const visible = items.filter(item => !item.hidden);
  const enabledIds = visible.filter(referenceMenuItemEnabled).map(item => item.id);
  const focusSignature = JSON.stringify(enabledIds);

  const restoreFocus = () => {
    const target = restore.current, owner = menu.current?.ownerDocument ?? target?.ownerDocument;
    const focused = owner?.activeElement;
    // Opening another modal or clicking outside must not steal its new focus.
    if (target?.isConnected && !target.closest('[hidden],[inert],[aria-hidden="true"]') && !target.matches(':disabled,[aria-disabled="true"]') &&
      (!focused || focused === owner?.body || focused === owner?.documentElement || menu.current?.contains(focused))) target.focus({ preventScroll: true });
  };
  const dismiss = (reason: ReferenceMenuDismissReason) => {
    if (dismissed.current) return;
    dismissed.current = true;
    restoreFocus();
    callback.current(reason);
  };
  useBackHandler(() => { dismiss('back'); return true; }, true, () => menu.current);

  useMenuLayoutEffect(() => {
    dismissed.current = false;
    const root = menu.current;
    if (!root) return;
    const owner = root.ownerDocument, win = owner.defaultView;
    if (!win) return;
    const active = owner.activeElement;
    restore.current = explicitRestore ?? element ?? (active instanceof HTMLElement && !root.contains(active) ? active : undefined);
    const positionMenu = () => {
      if (element && !element.isConnected) { dismiss('anchor-removed'); return; }
      const anchorBox = element?.getBoundingClientRect() ?? { left: x ?? 0, right: x ?? 0, top: y ?? 0, bottom: y ?? 0 };
      const box = root.getBoundingClientRect();
      setPosition(referenceMenuPosition(anchorBox, box, { width: win.innerWidth, height: win.innerHeight }, align, element ? 4 : 0));
    };
    positionMenu();
    const resized = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(positionMenu);
    resized?.observe(root);
    if (element) resized?.observe(element);
    const detached = element && typeof MutationObserver !== 'undefined' ? new MutationObserver(() => {
      if (!element.isConnected) dismiss('anchor-removed');
    }) : undefined;
    detached?.observe(owner.body, { childList: true, subtree: true });
    win.addEventListener('resize', positionMenu);
    owner.addEventListener('scroll', positionMenu, true);
    const outside = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !root.contains(target) && !element?.contains(target)) dismiss('outside');
    };
    owner.addEventListener('pointerdown', outside, true);
    return () => {
      win.removeEventListener('resize', positionMenu);
      resized?.disconnect(); detached?.disconnect();
      owner.removeEventListener('scroll', positionMenu, true);
      owner.removeEventListener('pointerdown', outside, true);
      // Retain the captured root: React may clear the ref during unmount.
      const focused = owner.activeElement, target = restore.current;
      if (target?.isConnected && !target.closest('[hidden],[inert],[aria-hidden="true"]') && !target.matches(':disabled,[aria-disabled="true"]') &&
        (!focused || focused === owner.body || focused === owner.documentElement || root.contains(focused))) target.focus({ preventScroll: true });
    };
  // Anchor coordinates/identity, rather than a fresh object per render, define
  // this popup's lifecycle. Action/label updates preserve its origin and order.
  }, [id, element, x, y, align, explicitRestore]);

  useMenuLayoutEffect(() => {
    const root = menu.current;
    if (!root || (typeof window !== 'undefined' && !positioned)) return;
    if (!loading && visible.length === 0) { dismiss('empty'); return; }
    const active = root.ownerDocument.activeElement;
    const activeId = active instanceof HTMLElement ? active.dataset.referenceMenuItem : undefined;
    if (activeId && enabledIds.includes(activeId)) return;
    const targetId = initialFocusId && enabledIds.includes(initialFocusId) ? initialFocusId : enabledIds[0];
    const target = [...root.querySelectorAll<HTMLButtonElement>('[data-reference-menu-item]')].find(button => button.dataset.referenceMenuItem === targetId);
    (target ?? root).focus({ preventScroll: true });
  }, [id, positioned, loading, visible.length, focusSignature, initialFocusId]);

  const keyDown: KeyboardEventHandler<HTMLDivElement> = event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss('escape'); return; }
    if (event.key === 'Tab') { dismiss('tab'); return; }
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); event.stopPropagation(); return; }
    const active = menu.current?.ownerDocument.activeElement;
    const next = referenceMenuNextId(items, active instanceof HTMLElement ? active.dataset.referenceMenuItem : undefined, event.key);
    if (!next) return;
    event.preventDefault(); event.stopPropagation();
    [...(menu.current?.querySelectorAll<HTMLButtonElement>('[data-reference-menu-item]') ?? [])]
      .find(button => button.dataset.referenceMenuItem === next)?.focus({ preventScroll: true });
  };
  const content = <div id={id} ref={menu} className={`reference-menu ${className}`.trim()} data-game-menu data-reference-menu role="menu" aria-label={label}
    aria-busy={loading || undefined} tabIndex={-1} style={{ left: position?.left ?? 8, top: position?.top ?? 8, visibility: typeof window !== 'undefined' && !position ? 'hidden' : undefined }}
    onKeyDown={keyDown} onClick={event => event.stopPropagation()} onContextMenu={event => event.preventDefault()}>
    {loading ? <div className="reference-menu-loading" role="status"><span className="reference-menu-spinner" aria-hidden="true" />{loadingLabel}</div> : visible.map(item => <button
      key={item.id} type="button" role="menuitem" data-reference-menu-item={item.id} className={item.danger ? 'danger' : undefined}
      disabled={!referenceMenuItemEnabled(item)} aria-disabled={!referenceMenuItemEnabled(item) || undefined} aria-busy={item.loading || undefined} title={item.title}
      onMouseEnter={event => { if (referenceMenuItemEnabled(item)) event.currentTarget.focus({ preventScroll: true }); }}
      onClick={() => { if (!dismissed.current) selectReferenceMenuItem(item, () => dismiss('select')); }}>
      {item.loading ? <span className="reference-menu-spinner" aria-hidden="true" /> : <span className="reference-menu-icon" aria-hidden="true">{item.icon}</span>}
      <span className="reference-menu-label">{item.label}</span>
    </button>)}
  </div>;
  return typeof document === 'undefined' ? content : createPortal(content, element?.ownerDocument.body ?? document.body);
}

export type ReferenceQueueState = 'Paused' | 'Error' | 'Downloading' | 'Installing' | 'Queued' | 'Complete' | 'Cancelled';
export type ReferenceQueueActionId = 'details' | 'resume' | 'pause' | 'prioritize' | 'cancel' | 'manage-installation';
export interface ReferenceQueueContext {
  /** Keep this operation identity for mutations; productId is a different key. */
  operationId?: string;
  productId?: string;
  state?: ReferenceQueueState;
  pauseResumeCancelSupported: boolean;
  intelligentDeliverySupported: boolean;
}
export interface ReferenceQueueAction {
  id: ReferenceQueueActionId;
  target: { kind: 'operation' | 'product'; id: string };
}

/** F64026's bounded action rules. Callers must intersect the original
 * capability flags with actual Linux adapters and retain their pending/busy
 * guards. This helper does not fabricate support for a backend operation. */
export function referenceQueueActions(context: ReferenceQueueContext): ReferenceQueueAction[] {
  const { operationId, productId, state, pauseResumeCancelSupported, intelligentDeliverySupported } = context;
  if (!operationId || !state) return [];
  const result: ReferenceQueueAction[] = [];
  if (productId) result.push({ id: 'details', target: { kind: 'product', id: productId } });
  const operation = (id: ReferenceQueueActionId) => result.push({ id, target: { kind: 'operation', id: operationId } });
  if (pauseResumeCancelSupported) {
    if (state === 'Paused' || state === 'Error') operation('resume');
    if (state === 'Downloading' || state === 'Installing') operation('pause');
    if (state === 'Queued') operation('prioritize');
    if (['Downloading', 'Installing', 'Paused', 'Queued', 'Error'].includes(state)) operation('cancel');
  }
  if (intelligentDeliverySupported && productId) result.push({ id: 'manage-installation', target: { kind: 'product', id: productId } });
  return result;
}
export const queueMenuActionIds = (context: ReferenceQueueContext): ReferenceQueueActionId[] => referenceQueueActions(context).map(action => action.id);
