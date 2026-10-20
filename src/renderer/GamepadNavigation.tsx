import { useEffect, useRef, useState } from 'react';
import { installGamepadNavigation } from './gamepad-navigation';

export function GamepadNavigation({ back, page }: { back: () => void; page: (delta: number) => void }) {
  const callbacks = useRef({ back, page }); callbacks.current = { back, page };
  const [active, setActive] = useState(false);
  useEffect(() => installGamepadNavigation(window, {
    mode: setActive, back: () => callbacks.current.back(), page: delta => callbacks.current.page(delta),
  }), []);
  return active ? <div className="gamepad-hints" aria-label="Gamepad controls">
    <span>D-pad / L stick: Move</span><span>A: Select</span><span>B: Back</span><span>X: Options</span>
    <span>LB / RB: Pages</span><span>R stick: Scroll</span><span>Steam + X: Keyboard</span>
  </div> : null;
}
