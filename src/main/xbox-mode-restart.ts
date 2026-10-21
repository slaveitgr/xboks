import { GuidePowerConfirmations } from './guide-power.js';
import type { GuidePowerConfirmation } from '../shared/guide-system.js';
import type { XboxModeRestartStatus } from '../shared/fullscreen-experience.js';

interface StartupIntent {
  status(): Promise<XboxModeRestartStatus>;
  prepare(): Promise<{ rollback(): Promise<void> }>;
}

/** A visible, explicit restart is separate from opening the entry dialog.
 * Every await that precedes the power request rechecks the originating window
 * and activity. A rejected request removes only this transaction's intent. */
export class XboxModeRestart {
  private busy = false;
  private confirmations: GuidePowerConfirmations;
  constructor(private options: {
    startup: StartupIntent;
    activity(): string | undefined;
    authorized(owner: number): boolean;
    integration(): Promise<boolean>;
    rebootCapability(): Promise<XboxModeRestartStatus>;
    reboot(owner: number): Promise<{ ok: boolean; error?: string }>;
  }) { this.confirmations = new GuidePowerConfirmations(options.activity); }
  private assertOwner(owner: number): void {
    if (!this.options.authorized(owner)) throw Error('Open Xbox mode from the focused launcher window.');
    const activity = this.options.activity();
    if (activity) throw Error(activity);
  }
  private async probe(owner: number): Promise<XboxModeRestartStatus> {
    this.assertOwner(owner);
    if (!await this.options.integration()) return { available: false, reason: 'Enable the xboks GNOME extension before restarting into Xbox mode.' };
    this.assertOwner(owner);
    const startup = await this.options.startup.status();
    this.assertOwner(owner);
    if (!startup.available) return startup;
    const reboot = await this.options.rebootCapability();
    this.assertOwner(owner);
    return reboot;
  }
  async status(owner: number): Promise<XboxModeRestartStatus> {
    if (this.busy) return { available: false, reason: 'An Xbox mode restart is already in progress.' };
    try { return await this.probe(owner); }
    catch (error) { return { available: false, reason: error instanceof Error ? error.message : 'Xbox mode restart is unavailable.' }; }
  }
  async prepare(owner: number): Promise<GuidePowerConfirmation> {
    const status = await this.status(owner);
    if (!status.available) throw Error(status.reason || 'Xbox mode restart is unavailable.');
    this.assertOwner(owner);
    return this.confirmations.prepare('reboot', owner);
  }
  async restart(owner: number, token: unknown): Promise<void> {
    if (this.busy) throw Error('An Xbox mode restart is already in progress.');
    this.assertOwner(owner);
    this.confirmations.consume('reboot', owner, token);
    this.busy = true;
    let intent: Awaited<ReturnType<StartupIntent['prepare']>> | undefined;
    try {
      const status = await this.probe(owner);
      if (!status.available) throw Error(status.reason || 'Xbox mode restart is unavailable.');
      intent = await this.options.startup.prepare();
      this.assertOwner(owner);
      const result = await this.options.reboot(owner);
      if (!result.ok) throw Error(result.error || 'The desktop did not accept the restart.');
      // Accepted does not mean shutdown completed. Let the OS perform its
      // normal shutdown; never simulate a restart by quitting this process.
    } catch (error) {
      await intent?.rollback();
      throw error;
    } finally { this.busy = false; }
  }
}

/** One visible startup attempt. Wait for login's Shell bridge without issuing
 * repeated activation requests or retrying after the bounded startup window. */
export async function resumeXboxModeStartup(options: {
  show(): Promise<void>; valid(): boolean; focused(): boolean; integration(): Promise<boolean>;
  enter(): Promise<void>; now?: () => number; wait?: () => Promise<void>; timeoutMs?: number;
}): Promise<boolean> {
  await options.show();
  const now = options.now ?? Date.now, deadline = now() + (options.timeoutMs ?? 10_000);
  const wait = options.wait ?? (() => new Promise<void>(resolve => setTimeout(resolve, 250)));
  do {
    if (!options.valid()) return false;
    if (options.focused() && await options.integration().catch(() => false)) {
      if (now() > deadline || !options.valid() || !options.focused()) return false;
      await options.enter(); return true;
    }
    if (now() >= deadline) return false;
    await wait();
  } while (now() <= deadline);
  return false;
}
