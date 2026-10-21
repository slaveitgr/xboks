export type Direction = 'up' | 'down' | 'left' | 'right';
export type PadAction = Direction | 'accept' | 'back' | 'options' | 'previous-page' | 'next-page';
export type BackHandler = () => boolean;
export type BackScope = () => HTMLElement | null;
type BackRegistration = { handler: BackHandler; scope?: BackScope };

/** Last registered handler gets the first chance to consume Back. Returning
 * false lets the previous layer try; removing a handler is safe during dispatch.
 * This is the bounded F22448/F22449 behavior, not a Windows runtime claim. */
export class BackHandlerStack {
  private handlers = new Set<BackRegistration>();
  register(handler: BackHandler, scope?: BackScope): () => void {
    const registration = { handler, scope };
    this.handlers.add(registration);
    return () => { this.handlers.delete(registration); };
  }
  dispatch(eligible: (registration: BackRegistration) => boolean = () => true): boolean {
    for (const registration of [...this.handlers].reverse()) {
      if (this.handlers.has(registration) && eligible(registration) && registration.handler()) return true;
    }
    return false;
  }
}

const backHandlers = new WeakMap<Window, BackHandlerStack>();
export function registerBackHandler(win: Window, handler: BackHandler, scope?: BackScope): () => void {
  let stack = backHandlers.get(win);
  if (!stack) { stack = new BackHandlerStack(); backHandlers.set(win, stack); }
  return stack.register(handler, scope);
}

/** DOM scope protects an outer registered popup while a newer, as-yet
 * unregistered modal is open. Its existing cancel button remains the fallback.
 * Without a scope, this is the ordered consumable dispatcher itself. */
export function dispatchBackHandlers(win: Window, activeScope?: HTMLElement | Document): boolean {
  return backHandlers.get(win)?.dispatch(registration => {
    if (!activeScope) return true;
    if (activeScope === win.document) return !registration.scope;
    const root = registration.scope?.();
    return Boolean(root?.isConnected && (root === activeScope || activeScope.contains(root)));
  }) ?? false;
}
type Rect = Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>;
type Pad = Pick<Gamepad, 'buttons' | 'axes'>;
const directions: Direction[] = ['up', 'down', 'left', 'right'];
const pressed = (pad: Pad, index: number) => pad.buttons[index]?.pressed === true || pad.buttons[index]?.value > 0.5;
const axis = (pad: Pad, index: number) => Number.isFinite(pad.axes[index]) ? Math.max(-1, Math.min(1, pad.axes[index])) : 0;

export function padDirection(pad: Pad): Direction | undefined {
  if (pressed(pad, 12)) return 'up';
  if (pressed(pad, 13)) return 'down';
  if (pressed(pad, 14)) return 'left';
  if (pressed(pad, 15)) return 'right';
  const x = axis(pad, 0), y = axis(pad, 1);
  if (Math.max(Math.abs(x), Math.abs(y)) < 0.55) return;
  return Math.abs(y) >= Math.abs(x) ? y < 0 ? 'up' : 'down' : x < 0 ? 'left' : 'right';
}

/** Only directions repeat. Connections, focus changes and pointer handoffs must
 * pass through neutral before an action, never replay a held confirmation. */
export class PadInput {
  private armed = false;
  private previous: boolean[] = [];
  private direction?: Direction;
  private repeatAt = 0;
  reset() { this.armed = false; this.previous = []; this.direction = undefined; this.repeatAt = 0; }
  poll(pad: Pad, now: number): { action?: PadAction; scroll: number } {
    const buttons = [1, 0, 2, 4, 5].map(index => pressed(pad, index));
    const direction = padDirection(pad);
    const scroll = Math.abs(axis(pad, 3)) >= 0.3 ? axis(pad, 3) : 0;
    if (pressed(pad, 16)) { this.reset(); return { scroll: 0 }; } // Steam/Guide chords belong to Steam.
    if (!this.armed) {
      this.armed = !direction && !scroll && !buttons.some(Boolean);
      this.previous = buttons;
      return { scroll: 0 };
    }
    const edge = buttons.findIndex((value, index) => value && !this.previous[index]);
    this.previous = buttons;
    let action: PadAction | undefined;
    if (edge !== -1) action = (['back', 'accept', 'options', 'previous-page', 'next-page'] as const)[edge];
    if (direction !== this.direction) {
      this.direction = direction;
      this.repeatAt = now + 380;
      action ??= direction;
    } else if (direction && now >= this.repeatAt) {
      this.repeatAt = now + 120;
      action ??= direction;
    }
    return { action, scroll };
  }
}

export function navigationTarget<T>(from: Rect, targets: readonly { value: T; rect: Rect }[], direction: Direction, allowCornerOverlap = false): T | undefined {
  const horizontal = direction === 'left' || direction === 'right';
  const sign = direction === 'up' || direction === 'left' ? -1 : 1;
  const center = (rect: Rect) => horizontal ? (rect.left + rect.right) / 2 : (rect.top + rect.bottom) / 2;
  const cross = (rect: Rect) => horizontal ? (rect.top + rect.bottom) / 2 : (rect.left + rect.right) / 2;
  let best: T | undefined, score = Infinity;
  for (const { value, rect } of targets) {
    const forward = (center(rect) - center(from)) * sign;
    if (forward < 1) continue;
    // Stay in the directional beam. A nearby diagonal must never win over
    // the visible control in the same row/column, or cause a jump at an edge.
    const overlap = horizontal ? Math.min(rect.bottom, from.bottom) - Math.max(rect.top, from.top)
      : Math.min(rect.right, from.right) - Math.max(rect.left, from.left);
    const crossDistance = Math.abs(cross(rect) - cross(from));
    const crossSize = (r: Rect) => horizontal ? r.bottom - r.top : r.right - r.left;
    if (overlap <= 1 || (!allowCornerOverlap && crossDistance > Math.max(crossSize(from), crossSize(rect)) / 2)) continue;
    const distance = forward + crossDistance * 0.35;
    if (distance < score) { best = value; score = distance; }
  }
  return best;
}

type Options = {
  mode: (active: boolean) => void; back: () => void; page: (delta: number) => void; activateOnFocus?: boolean;
  subscribeInput?: (dispatch: (action: PadAction) => void) => () => void;
  nativeControlsActive?: () => boolean;
};
const controls = 'button,a[href],input:not([type="hidden"]),select,textarea,summary,[tabindex]';

export function revealDelta(top: number, bottom: number, viewTop: number, viewBottom: number): number {
  if (bottom - top > viewBottom - viewTop || top < viewTop) return top - viewTop;
  return bottom > viewBottom ? bottom - viewBottom : 0;
}

/** undefined: not an editable range; false: native step did not change it;
 * true: changed. A detached native control owns min/max/step rounding. Bypass
 * React's instance value tracker so its real onChange sees input/change. */
export function stepGamepadRange(input: HTMLInputElement, direction: 'left' | 'right'): boolean | undefined {
  if (input.type !== 'range' || input.disabled || input.readOnly) return;
  const owner = input.ownerDocument.defaultView as (Window & typeof globalThis) | null;
  const setter = owner && Object.getOwnPropertyDescriptor(owner.HTMLInputElement.prototype, 'value')?.set;
  if (!owner || !setter) return;
  const previous = input.value, probe = input.cloneNode(false) as HTMLInputElement;
  probe.value = previous;
  try { probe.stepUp(direction === 'right' ? 1 : -1); }
  catch { return false; } // Native step='any' has no discrete step.
  if (probe.value === previous) return false;
  setter.call(input, probe.value);
  input.dispatchEvent(new owner.Event('input', { bubbles: true }));
  input.dispatchEvent(new owner.Event('change', { bubbles: true }));
  return true;
}

/** Renderer-only navigation. Never intercepts pointer/keyboard defaults, changes
 * Steam mappings, or sends gamepad events to another window/process. */
export function installGamepadNavigation(win: Window, options: Options): () => void {
  const doc = win.document;
  const inputs = new Map<string, PadInput>();
  const returns = new WeakMap<Element, HTMLElement>();
  const sidebarReturns = new WeakMap<Element, HTMLElement>();
  let active = false, stopped = false, frame = 0, previousTime = 0;
  let scope: HTMLElement | Document = doc;
  let picker: HTMLElement | undefined;
  let keyboardFromPad = false;
  let pendingDetail: { id: string; origin: HTMLElement; deadline: number } | undefined;
  let detailReturn: { id: string; origin: HTMLElement } | undefined;
  const visible = (element: HTMLElement) => {
    if (!element.isConnected || element.closest('[hidden],[inert],[aria-hidden="true"]') || !element.getClientRects().length) return false;
    const style = win.getComputedStyle(element);
    return style.visibility !== 'hidden' && style.visibility !== 'collapse' && style.display !== 'none';
  };
  const enabled = (element: HTMLElement) => visible(element) && !element.matches(':disabled,[aria-disabled="true"]');
  // A range awaiting IPC remains focusable. Keep its existing controller focus
  // while blocking edits and new selection until the write finishes. Vertical
  // navigation can leave it; completion must never restore it after leaving.
  const pendingRange = (element: HTMLElement) => visible(element) && element.matches('input[type="range"][data-gamepad-pending]:not(:disabled)');
  const candidates = (root: HTMLElement | Document) => [...root.querySelectorAll<HTMLElement>(controls)]
    .filter(element => enabled(element) && element.tabIndex >= 0 && !element.hasAttribute('data-gamepad-skip'));
  const currentScope = () => [...doc.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"],[data-game-menu]')]
    .filter(visible).at(-1) ?? doc;
  const focused = () => doc.activeElement instanceof HTMLElement ? doc.activeElement : undefined;
  const focusBox = (element: HTMLElement) => element.closest<HTMLElement>('[data-gamepad-card]') ?? element;
  const scrollParent = (element: HTMLElement) => {
    let parent = element.parentElement;
    while (parent) {
      if (parent.scrollHeight > parent.clientHeight && /auto|scroll/.test(win.getComputedStyle(parent).overflowY)) return parent;
      parent = parent.parentElement;
    }
  };
  const reveal = (element: HTMLElement) => {
    const box = focusBox(element), parent = scrollParent(box);
    if (!parent) return;
    const rect = box.getBoundingClientRect(), viewport = parent.getBoundingClientRect();
    const hints = doc.querySelector('.gamepad-hints')?.getBoundingClientRect();
    const bottomInset = parent.matches('.page-scroll') && hints ? Math.max(10, viewport.bottom - hints.top + 8) : 10;
    parent.scrollTop += revealDelta(rect.top, rect.bottom, viewport.top + parent.clientTop + 10, viewport.top + parent.clientTop + parent.clientHeight - bottomInset);
  };
  const mark = () => {
    const element = active ? focused() : undefined;
    const target = element && !element.hasAttribute('data-gamepad-auto-select') ? focusBox(element) : undefined;
    doc.querySelectorAll('[data-gamepad-focus]').forEach(element => { if (element !== target) element.removeAttribute('data-gamepad-focus'); });
    if (target && !target.hasAttribute('data-gamepad-focus')) target.setAttribute('data-gamepad-focus', '');
  };
  const focus = (element: HTMLElement | undefined, select = false) => {
    if (!element || !enabled(element)) return;
    element.focus({ preventScroll: true });
    reveal(element);
    // Only explicitly reviewed, selection-only controls may act on focus.
    // Action buttons, recents, settings and downloads always require A.
    // Library cards select on focus; opening their game page requires A.
    if (select && active && scope === doc && element.hasAttribute('data-gamepad-auto-select') && element.getAttribute('data-gamepad-auto-select') !== 'focus' && currentScope() === doc) element.click();
    win.requestAnimationFrame(() => { if (!stopped && active && focused() === element && enabled(element)) reveal(element); });
    mark();
  };
  const initial = (root: HTMLElement | Document) => candidates(root).find(element => element.hasAttribute('data-gamepad-initial'))
    ?? candidates(root).find(element => element.hasAttribute('data-gamepad-cancel'))
    ?? candidates(root).find(element => element.matches('.sidebar .active')) ?? candidates(root)[0];
  const ensureFocus = () => {
    const next = currentScope();
    if (next !== scope) {
      const previous = scope;
      scope = next;
      // A detail drawer is its own modal scope, so no inline-detail focus
      // request may survive it and swallow a quick reopen after B.
      if (pendingDetail && next instanceof HTMLElement && next.getAttribute('data-gamepad-detail') === pendingDetail.id) pendingDetail = undefined;
      const target = previous instanceof HTMLElement ? returns.get(previous) : undefined;
      const origin = focused();
      if (next instanceof HTMLElement && !returns.has(next)) {
        const restore = origin && origin !== doc.body && origin !== doc.documentElement ? origin : target;
        if (restore) returns.set(next, restore);
      }
      if (target && next.contains(target) && enabled(target)) focus(target);
      else if (!focused() || !next.contains(focused()!)) focus(initial(next));
    }
    if (pendingDetail && scope === doc) {
      const pending = pendingDetail;
      const detail = [...doc.querySelectorAll<HTMLElement>('[data-gamepad-detail]')]
        .find(element => element.getAttribute('data-gamepad-detail') === pending.id && visible(element));
      if (detail) {
        const play = detail.querySelector<HTMLElement>('[data-gamepad-play]');
        const target = play && enabled(play) ? play : candidates(detail)[0];
        pendingDetail = undefined;
        if (target) { detailReturn = pending; focus(target); }
      } else if (!pending.origin.isConnected || Date.now() >= pending.deadline) pendingDetail = undefined;
    }
    const element = focused();
    if (!element || !scope.contains(element) || (!enabled(element) && !pendingRange(element)) || !element.matches(controls)) focus(initial(scope));
    mark();
  };
  const setMode = (value: boolean) => {
    if (active === value) return;
    active = value;
    doc.documentElement.toggleAttribute('data-gamepad-navigation', value);
    options.mode(value);
    if (value) ensureFocus(); else mark();
  };
  const closePicker = (restore: boolean) => {
    if (!picker) return;
    const target = returns.get(picker);
    picker.remove(); picker = undefined;
    if (restore) focus(target);
  };
  const pointer = () => { pendingDetail = undefined; setMode(false); inputs.forEach(input => input.reset()); };
  const pointerMove = (event: PointerEvent) => { if (event.movementX || event.movementY) pointer(); };
  const keyboard = (event: KeyboardEvent) => {
    if (keyboardFromPad) return;
    if (event.key === 'Escape') {
      const consumed = picker ? (closePicker(true), true) : dispatchBackHandlers(win, currentScope());
      if (consumed) { event.preventDefault(); event.stopImmediatePropagation(); }
    }
    pointer();
  };
  const blur = () => { pointer(); closePicker(false); };
  const resume = () => {
    inputs.forEach(input => input.reset());
    if (!options.activateOnFocus || doc.hidden || !doc.hasFocus()) return;
    scope = currentScope(); setMode(true); focus(initial(scope));
  };
  const visibilityChanged = () => { if (doc.hidden) blur(); else resume(); };

  function selectPicker(select: HTMLSelectElement) {
    closePicker(false);
    const backdrop = doc.createElement('div');
    backdrop.className = 'gamepad-select-backdrop';
    const dialog = doc.createElement('section');
    dialog.className = 'gamepad-select-dialog';
    dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true');
    const title = doc.createElement('h2');
    title.textContent = select.getAttribute('aria-label') ?? select.labels?.[0]?.childNodes[0]?.textContent ?? 'Choose an option';
    dialog.setAttribute('aria-label', title.textContent);
    dialog.append(title);
    const choose = (value: string) => {
      if (select.isConnected && !select.disabled) {
        select.value = value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      closePicker(true);
    };
    for (const option of select.options) {
      if (option.hidden) continue;
      const button = doc.createElement('button');
      button.type = 'button'; button.textContent = option.label;
      button.disabled = option.disabled || Boolean(option.parentElement instanceof HTMLOptGroupElement && option.parentElement.disabled);
      button.setAttribute('aria-pressed', String(option.selected));
      if (option.selected) button.setAttribute('data-gamepad-initial', '');
      button.addEventListener('click', () => choose(option.value));
      dialog.append(button);
    }
    const cancel = doc.createElement('button');
    cancel.type = 'button'; cancel.textContent = 'Cancel'; cancel.setAttribute('data-gamepad-cancel', '');
    cancel.addEventListener('click', () => closePicker(true));
    dialog.append(cancel); backdrop.append(dialog); doc.body.append(backdrop);
    backdrop.addEventListener('pointerdown', event => { if (event.target === backdrop) closePicker(false); });
    picker = backdrop; returns.set(backdrop, select); returns.set(dialog, select);
    scope = dialog; focus(initial(dialog));
  }

  const activate = () => {
    const element = focused();
    if (!element || !scope.contains(element) || !enabled(element) || pendingDetail) return;
    if (element instanceof HTMLSelectElement) selectPicker(element);
    else if (element.hasAttribute('data-gamepad-card-activate')) {
      // A on a Store card delegates only to its real, enabled action. Selection
      // on focus and ordinary pointer/keyboard clicks never start an install.
      const target = element.closest('[data-gamepad-card]')?.querySelector<HTMLElement>('[data-gamepad-card-action]');
      if (target && scope.contains(target) && enabled(target)) target.click();
      else if (!target) element.click(); // Catalog cards without an action open their product details.
    }
    else {
      const id = element.getAttribute('data-gamepad-detail-target');
      if (id) pendingDetail = { id, origin: element, deadline: Date.now() + 1500 };
      element.click();
    }
  };
  const pageFocus = () => {
    focused()?.blur();
    // React commits the new page asynchronously. Restore its active nav item
    // without selecting the old page again during fallback/return focus.
    win.requestAnimationFrame(() => { if (!stopped && active && currentScope() === doc) focus(initial(doc)); });
  };
  const back = () => {
    if (picker) { closePicker(true); return; }
    if (dispatchBackHandlers(win, scope)) {
      if (scope === doc) { pendingDetail = undefined; detailReturn = undefined; }
      return;
    }
    if (scope instanceof HTMLElement) {
      if (scope.hasAttribute('data-game-menu')) {
        keyboardFromPad = true;
        try { win.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); }
        finally { keyboardFromPad = false; }
      } else {
        const cancel = scope.querySelector<HTMLElement>('[data-gamepad-cancel]');
        if (cancel && enabled(cancel)) cancel.click();
      }
      return; // Never act behind a modal or confirm a destructive action.
    }
    const detailBack = [...doc.querySelectorAll<HTMLElement>('[data-gamepad-detail-back]')].find(enabled);
    if (detailBack) { pendingDetail = undefined; detailReturn = undefined; detailBack.click(); return; }
    if (detailReturn && focused()?.closest('[data-gamepad-detail]')?.getAttribute('data-gamepad-detail') === detailReturn.id && enabled(detailReturn.origin)) {
      focus(detailReturn.origin); detailReturn = undefined; return;
    }
    options.back();
    pageFocus();
  };
  const action = (value: PadAction) => {
    ensureFocus();
    if (directions.includes(value as Direction)) {
      const element = focused();
      if (element) {
        const direction = value as Direction;
        if ((direction === 'left' || direction === 'right') && pendingRange(element)) return;
        if ((direction === 'left' || direction === 'right') && element instanceof HTMLInputElement && scope.contains(element) && enabled(element)) {
          const changed = stepGamepadRange(element, direction);
          if (changed !== undefined) {
            if (changed) {
              const originScope = scope, key = direction === 'right' ? 'ArrowRight' : 'ArrowLeft';
              // React must render the new controlled value before existing
              // Guide/AudioSettings keyup handlers commit it to the backend.
              win.requestAnimationFrame(() => {
                if (stopped || doc.activeElement !== element || !enabled(element) || element.readOnly || currentScope() !== originScope || !originScope.contains(element)) return;
                keyboardFromPad = true;
                try { element.dispatchEvent(new KeyboardEvent('keyup', { key, code: key, bubbles: true })); }
                finally { keyboardFromPad = false; }
              });
            }
            return; // Keep focus at the range's min/max; up/down exits it.
          }
        }
        // The sidebar and page are separate navigation regions. Their controls
        // need not line up vertically, so enter the page explicitly instead of
        // applying the strict within-region directional beam across that gap.
        if (scope === doc && direction === 'right' && element.closest('.sidebar')) {
          const content = doc.querySelector<HTMLElement>('.page-scroll');
          if (content) {
            const targets = candidates(content);
            const grid = targets.filter(target => target.closest('[data-gamepad-grid]'));
            const shell = content.closest('.content-shell');
            const previous = shell ? sidebarReturns.get(shell) : undefined;
            const entry = previous && shell?.contains(previous) && enabled(previous) ? previous : targets.find(target => target.hasAttribute('data-gamepad-play'))
              ?? grid.find(target => target.closest('[data-gamepad-card]')?.classList.contains('selected'))
              ?? grid[0] ?? targets.find(target => target.closest('[data-gamepad-filters]')) ?? initial(content);
            focus(entry, true);
          }
          return;
        }
        const actionRow = direction === 'left' || direction === 'right' ? element.closest<HTMLElement>('[data-gamepad-action-row]') : undefined;
        const region = scope === doc ? actionRow ?? element.closest<HTMLElement>('[data-gamepad-grid],[data-gamepad-filters],[data-gamepad-library-header],[data-gamepad-library-footer],[data-gamepad-detail],.page-scroll,.topbar') ?? scope : scope;
        const choose = (root: HTMLElement | Document) => navigationTarget(focusBox(element).getBoundingClientRect(), candidates(root).filter(target => target !== element)
          .map(target => ({ value: target, rect: focusBox(target).getBoundingClientRect() })), direction, root === actionRow);
        let target = choose(region);
        const library = element.closest<HTMLElement>('.library-page');
        if (!target && !library && element.closest('.store-page') && region instanceof HTMLElement && region.hasAttribute('data-gamepad-grid') && (direction === 'up' || direction === 'down')) target = choose(scope);
        if (!target && library && region instanceof HTMLElement) {
          // Cross library rows explicitly, without diagonal drift into an
          // unrelated card or control. Sidebar exit is handled separately.
          let next: string | undefined;
          if (region.hasAttribute('data-gamepad-grid') && direction === 'up') next = '[data-gamepad-filters]';
          else if (region.hasAttribute('data-gamepad-grid') && direction === 'down') next = '[data-gamepad-library-footer]';
          else if (region.hasAttribute('data-gamepad-filters') && direction === 'up') next = '[data-gamepad-library-header]';
          else if (region.hasAttribute('data-gamepad-library-header') && direction === 'down') next = '[data-gamepad-filters]';
          else if ((region.hasAttribute('data-gamepad-filters') && direction === 'down') || (region.hasAttribute('data-gamepad-library-footer') && direction === 'up')) next = '[data-gamepad-grid]';
          const root = next ? library.querySelector<HTMLElement>(next) : undefined;
          if (root) {
            target = choose(root);
            // Header actions are right-aligned, while filters span the page.
            // A vertical region crossing may need a different column, but it
            // must not weaken the strict directional beam within a card grid.
            if (!target && (region.hasAttribute('data-gamepad-library-header') || root.hasAttribute('data-gamepad-library-header'))) {
              const rect = element.getBoundingClientRect(), x = (rect.left + rect.right) / 2;
              target = candidates(root).sort((a, b) => {
                const distance = (e: HTMLElement) => { const r = e.getBoundingClientRect(); return Math.abs((r.left + r.right) / 2 - x); };
                return distance(a) - distance(b);
              })[0];
            }
          }
          if (!target && direction === 'down' && region.hasAttribute('data-gamepad-grid')) {
            const parent = scrollParent(focusBox(element));
            if (parent) parent.scrollTop += Math.min(260, parent.clientHeight * 0.5);
          }
        }
        if (!target && scope === doc && direction === 'left') {
          const shell = element.closest('.content-shell');
          const sidebar = doc.querySelector<HTMLElement>('.sidebar');
          if (shell && sidebar) {
            target = candidates(sidebar).find(item => item.matches('.nav-item.active'))
              ?? candidates(sidebar).find(item => item.matches('.nav-item'));
            if (target) {
              sidebarReturns.set(shell, element);
              // This is a focus handoff, not a page change. In particular,
              // leaving a game detail must not reselect/reset its Library page.
              focus(target);
              return;
            }
          }
        }
        focus(target, true);
      }
    } else if (value === 'accept') activate();
    else if (value === 'back') back();
    else if (value === 'options') {
      if (scope !== doc) return; // Options must not open a menu behind another popup.
      const origin = detailReturn && focused()?.closest('[data-gamepad-detail]')?.getAttribute('data-gamepad-detail') === detailReturn.id ? detailReturn.origin : focused();
      // The same card handler serves X, Shift+F10 and the keyboard Menu key.
      // Keep the existing explicit library trigger for unmigrated surfaces.
      if (origin) {
        keyboardFromPad = true;
        try {
          if (!origin.dispatchEvent(new KeyboardEvent('keydown', { key: 'ContextMenu', code: 'ContextMenu', bubbles: true, cancelable: true }))) return;
        } finally { keyboardFromPad = false; }
      }
      const trigger = origin?.closest('.library-card-wrap')?.querySelector<HTMLElement>('[data-game-menu-trigger]');
      if (trigger && enabled(trigger)) trigger.click();
    } else if (scope instanceof HTMLElement && scope.hasAttribute('data-gamepad-gallery')) {
      // Shoulder buttons change only the active gallery, never the page behind it.
      const target = scope.querySelector<HTMLElement>(value === 'previous-page' ? '[data-gamepad-gallery-previous]' : '[data-gamepad-gallery-next]');
      if (target && enabled(target)) target.click();
    } else if (scope instanceof HTMLElement && scope.hasAttribute('data-gamepad-sections')) {
      const origin = scope;
      options.page(value === 'previous-page' ? -1 : 1);
      const selectedTab = (remaining: number) => {
        if (stopped || !active || doc.hidden || !doc.hasFocus() && !options.nativeControlsActive?.() || currentScope() !== origin) return;
        const tab = origin.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
        if (tab) focus(tab);
        // A favorite on another toolbar page needs a second React commit.
        // Wait boundedly for that real selected tab instead of focusing Close.
        else if (remaining > 0) win.requestAnimationFrame(() => selectedTab(remaining - 1));
      };
      win.requestAnimationFrame(() => selectedTab(3));
    } else if (scope === doc) {
      const sections = [...doc.querySelectorAll<HTMLElement>('[data-gamepad-section-tabs]')].find(visible);
      const tabs = sections ? [...sections.querySelectorAll<HTMLElement>('[role="tab"]')].filter(enabled) : [];
      if (tabs.length) {
        const current = Math.max(0, tabs.findIndex(tab => tab.getAttribute('aria-selected') === 'true'));
        const target = tabs[(current + (value === 'previous-page' ? -1 : 1) + tabs.length) % tabs.length];
        target.click(); focus(target); return;
      }
      options.page(value === 'previous-page' ? -1 : 1);
      pageFocus();
    }
  };
  const scroll = (value: number, elapsed: number) => {
    const canScroll = (element: HTMLElement) => element.scrollHeight > element.clientHeight && /auto|scroll/.test(win.getComputedStyle(element).overflowY);
    let element = focused();
    while (element && !canScroll(element)) element = element.parentElement ?? undefined;
    element ??= [...scope.querySelectorAll<HTMLElement>('pre,.page-scroll,.game-dialog')].find(canScroll);
    if (element) element.scrollTop += value * elapsed * 0.75;
  };
  const tick = (now: number) => {
    if (stopped) return;
    const elapsed = Math.min(40, Math.max(0, now - previousTime)); previousTime = now;
    try {
      if (options.nativeControlsActive?.()) {
        // Main admits these inputs only for its visible focused UI surface.
        // Never also poll Chromium's copy of the same controller event.
        inputs.forEach(input => input.reset());
        if (doc.hidden) { if (active) blur(); }
        else if (active) ensureFocus();
      } else if (doc.hidden || !doc.hasFocus()) {
        if (active) blur();
        inputs.forEach(input => input.reset());
      } else {
        const pads = [...(win.navigator.getGamepads?.() ?? [])].filter((pad): pad is Gamepad => Boolean(pad?.connected && pad.mapping === 'standard'));
        const present = new Set<string>();
        let handled = false;
        for (const pad of pads) {
          const key = `${pad.index}:${pad.id}`; present.add(key);
          if (!inputs.has(key)) inputs.set(key, new PadInput());
          const next = inputs.get(key)!.poll(pad, now);
          if (!handled && (next.action || next.scroll)) {
            handled = true; setMode(true);
            if (next.action) action(next.action);
            if (next.scroll) scroll(next.scroll, elapsed);
          }
        }
        for (const key of inputs.keys()) if (!present.has(key)) inputs.delete(key);
        if (!pads.length) { setMode(false); closePicker(false); }
        if (active) ensureFocus();
      }
    } catch { blur(); inputs.clear(); } // Unsupported browser/device must not break mouse UI.
    frame = win.requestAnimationFrame(tick);
  };
  const experienceChanged = (event: Event) => {
    const enabled = (event as CustomEvent<boolean>).detail === true;
    inputs.forEach(input => input.reset());
    if (enabled) { setMode(true); scope = currentScope(); focus(initial(scope), false); ensureFocus(); }
    else setMode(false);
  };
  win.addEventListener('xboks-fullscreen-experience', experienceChanged);
  win.addEventListener('pointerdown', pointer, true);
  win.addEventListener('pointermove', pointerMove, true);
  win.addEventListener('keydown', keyboard, true);
  win.addEventListener('blur', blur);
  win.addEventListener('focus', resume);
  doc.addEventListener('visibilitychange', visibilityChanged);
  const unsubscribeInput = options.subscribeInput?.(value => {
    if (stopped || doc.hidden || !options.nativeControlsActive?.() ||
        ![...directions, 'accept', 'back', 'options', 'previous-page', 'next-page'].includes(value)) return;
    // Unlike untrusted browser polling, this stream has already passed main's
    // native window-focus and session-lock guards. It does not depend on the
    // Chromium Gamepad mapping or its device-exposure activation heuristic.
    setMode(true); action(value);
  });
  resume();
  frame = win.requestAnimationFrame(tick);
  return () => {
    stopped = true; unsubscribeInput?.(); win.cancelAnimationFrame(frame); closePicker(false); setMode(false); inputs.clear();
    win.removeEventListener('pointerdown', pointer, true);
    win.removeEventListener('pointermove', pointerMove, true);
    win.removeEventListener('keydown', keyboard, true);
    win.removeEventListener('xboks-fullscreen-experience', experienceChanged);
    win.removeEventListener('blur', blur); win.removeEventListener('focus', resume); doc.removeEventListener('visibilitychange', visibilityChanged);
  };
}
