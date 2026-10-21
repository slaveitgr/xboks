import { useEffect, useRef, useState } from 'react';
import { installGamepadNavigation, registerBackHandler, type BackHandler, type BackScope, type PadAction } from './gamepad-navigation';

/** A handler must return true only when it handled Back. Supplying the popup's
 * ref keeps it behind any newer modal scope; callback changes retain its order. */
export function useBackHandler(handler: BackHandler, enabled = true, scope?: BackScope) {
  const callback = useRef(handler); callback.current = handler;
  const scopeRef = useRef(scope); scopeRef.current = scope;
  const scoped = Boolean(scope);
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    return registerBackHandler(window, () => callback.current(), scoped ? () => scopeRef.current?.() ?? null : undefined);
  }, [enabled, scoped]);
}

export function GamepadNavigation({ back, page, activateOnFocus = false, subscribeInput, nativeControlsActive = false }: {
  back: () => void; page: (delta: number) => void; activateOnFocus?: boolean;
  subscribeInput?: (dispatch: (action: PadAction) => void) => () => void; nativeControlsActive?: boolean;
}) {
  const callbacks = useRef({ back, page, subscribeInput, nativeControlsActive }); callbacks.current = { back, page, subscribeInput, nativeControlsActive };
  const [active, setActive] = useState(false);
  useEffect(() => installGamepadNavigation(window, {
    mode: setActive, back: () => callbacks.current.back(), page: delta => callbacks.current.page(delta), activateOnFocus,
    subscribeInput: subscribeInput ? dispatch => callbacks.current.subscribeInput!(dispatch) : undefined,
    nativeControlsActive: () => callbacks.current.nativeControlsActive,
  }), [activateOnFocus, Boolean(subscribeInput)]);
  return active ? <div className="gamepad-hints" aria-label="Gamepad controls">
    <span>D-pad / L stick: Move</span><span>A: Select</span><span>B: Back</span><span>X: Options</span>
    <span>LB / RB: Pages</span><span>R stick: Scroll</span><span>Steam + X: Keyboard</span>
  </div> : null;
}
