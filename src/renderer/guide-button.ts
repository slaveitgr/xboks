import type { DesktopSettingsStatus } from '../shared/types';

type ControllerStatus = DesktopSettingsStatus['gameBarController'];

/** Browser fallback only. A native listener owns Guide globally when it has
 * an admitted device. Ownership/focus changes must pass neutral before a new
 * browser edge, so a held button cannot close a newly opened native Guide. */
export class GuideButtonFallback {
  private armed = false;
  private held = false;
  poll(pressed: boolean, focused: boolean, visible: boolean, controller: ControllerStatus): boolean {
    if (!focused || !visible || controller?.status === 'starting' || controller?.reason === 'session-blocked' ||
        controller?.status === 'listening' && controller.devices > 0) {
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
