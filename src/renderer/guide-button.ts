import type { DesktopSettingsStatus } from '../shared/types';

type ControllerStatus = DesktopSettingsStatus['gameBarController'];
const nativeOwnsGuide = (controller: ControllerStatus) => controller?.status === 'starting' || controller?.reason === 'session-blocked' ||
  controller?.status === 'listening' && controller.devices > 0;

/** Browser fallback only. A native listener owns Guide globally when it has
 * an admitted device. Ownership/focus changes must pass neutral before a new
 * browser edge, so a held button cannot close a newly opened native Guide. */
export class GuideButtonFallback {
  private armed = false;
  private held = false;
  poll(pressed: boolean, focused: boolean, visible: boolean, controller: ControllerStatus): boolean {
    if (!focused || !visible || nativeOwnsGuide(controller)) {
      this.armed = false; this.held = false;
      return false;
    }
    if (!this.armed) {
      this.armed = !pressed;
      this.held = pressed;
      return false;
    }
    const edge = pressed && !this.held;
    this.held = pressed;
    return edge;
  }
}

/** The native service owns global Guide. Browser fallback work belongs only to
 * this visible focused window, and resumes through neutral after every handoff. */
export function installGuideButtonFallback(win: Window, controller: ControllerStatus, guide: () => void): () => void {
  const doc = win.document, input = new GuideButtonFallback();
  let timer: number | undefined, stopped = false;
  const eligible = () => !stopped && !doc.hidden && doc.hasFocus() && !nativeOwnsGuide(controller);
  const suspend = () => {if (timer !== undefined) win.clearInterval(timer); timer = undefined; input.poll(false, false, false, controller);};
  const poll = () => {
    if (!eligible()) {suspend(); return false;}
    try {
      const pressed = Array.from(win.navigator.getGamepads?.() ?? []).some(pad => pad?.buttons[16]?.pressed);
      if (input.poll(pressed, true, true, controller)) guide();
      return true;
    } catch {suspend(); return false;}
  };
  const resume = () => {
    if (!eligible()) {suspend(); return;}
    if (timer !== undefined) return;
    if (poll() && eligible()) timer = win.setInterval(poll, 100);
  };
  win.addEventListener('focus', resume); win.addEventListener('blur', suspend); doc.addEventListener('visibilitychange', resume);
  resume();
  return () => {stopped = true; suspend(); win.removeEventListener('focus', resume); win.removeEventListener('blur', suspend); doc.removeEventListener('visibilitychange', resume);};
}
