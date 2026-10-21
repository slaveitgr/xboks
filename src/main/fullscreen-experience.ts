import type { FullscreenExperienceStatus } from '../shared/fullscreen-experience.js';
import type { ExperienceBridge } from './experience-client.js';

/** Native fullscreen is a window fact; only an acknowledged owned shell lease
 * or distribution session marks an integrated Fullscreen Experience active. */
export class FullscreenExperience {
  private busy = false;
  private previouslyOwned = false;
  private releasePending = false;
  constructor(private options: {
    bridge: ExperienceBridge;
    session: boolean;
    windowFullscreen(): boolean;
    setWindowFullscreen(enabled: boolean): Promise<void>;
    changed(): void;
  }) {}
  get transitioning(): boolean { return this.busy; }
  get current(): FullscreenExperienceStatus {
    if (this.options.session) return { available: true, active: true, source: 'session' };
    const state = this.options.bridge.current;
    return { available: state.available, active: state.available && state.active && state.owned,
      source: state.available ? 'gnome-extension' : 'none', reason: state.reason };
  }
  async refresh(): Promise<FullscreenExperienceStatus> {
    if (!this.options.session) await this.options.bridge.request('state').catch(() => {});
    this.previouslyOwned = this.options.bridge.current.owned;
    this.options.changed(); return this.current;
  }
  shellChanged(): void {
    const owned = this.options.bridge.current.owned;
    const released = this.previouslyOwned && !owned;
    this.previouslyOwned = owned;
    if (released && !this.options.session) {
      if (this.busy) this.releasePending = true;
      else void this.setWindow(false).catch(() => {});
    }
    this.options.changed();
  }
  async setWindow(enabled: boolean, requireIntegration = false): Promise<boolean> {
    if (typeof enabled !== 'boolean') throw Error('Fullscreen mode must be a boolean.');
    if (this.busy) throw Error('An Xbox mode transition is already in progress.');
    if (this.options.session && !enabled) throw Error('Returning from this gaming session requires the distribution session switcher.');
    this.busy = true;
    this.releasePending = false;
    const previous = this.options.windowFullscreen();
    try {
      if (enabled) {
        if (!this.options.session) await this.refresh();
        if (requireIntegration && !this.current.available) throw Error(this.current.reason || 'Install and enable the XBOKS GNOME extension first.');
        await this.options.setWindowFullscreen(true);
        // Required integration cannot silently become window-only fullscreen
        // if the extension vanishes while the native transition is awaited.
        if (!this.options.session && (requireIntegration || this.current.available)) {
          try {
            const lease = await this.options.bridge.request('enter');
            if (!lease.active || !lease.owned) throw Error('The GNOME extension did not acknowledge Xbox mode.');
            // A release event can follow the reply in the same transport chunk,
            // before this await resumes. The captured reply is then stale.
            if (!this.current.active || this.releasePending) throw Error('Xbox mode was interrupted by the desktop.');
          } catch (error) {
            this.options.bridge.dispose();
            await this.options.setWindowFullscreen(this.releasePending ? false : previous).catch(() => {});
            throw error;
          }
        }
      } else {
        if (this.options.bridge.current.owned) {
          try {
            const lease = await this.options.bridge.request('leave');
            if (lease.owned || this.options.bridge.current.owned) throw Error('The GNOME extension did not release Xbox mode.');
          }
          catch { this.options.bridge.dispose(); }
        }
        await this.options.setWindowFullscreen(false);
      }
      this.previouslyOwned = this.options.bridge.current.owned;
    } finally {
      // Lock/emergency/owner loss always wins over an in-flight native change.
      // Keep transitions serialized until native restoration has finished.
      try {
        if (this.releasePending && !this.options.session) {
          if (this.options.bridge.current.owned) this.options.bridge.dispose();
          await this.options.setWindowFullscreen(false);
        }
      } finally {
        this.releasePending = false;
        this.busy = false;
        this.options.changed();
      }
    }
    return this.options.windowFullscreen();
  }
  dispose(): void { this.options.bridge.dispose(); }
}
