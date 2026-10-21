import { randomUUID } from 'node:crypto';
import type { GuidePowerAction, GuidePowerConfirmation } from '../shared/guide-system.js';

const actions = new Set(['lock', 'logout', 'suspend', 'reboot', 'poweroff']);
export function validGuidePowerAction(action: unknown): action is GuidePowerAction {
  return typeof action === 'string' && actions.has(action);
}

/** A confirmation belongs to one window, one action and one short-lived click.
 * Activity is checked again on consumption; preparing never changes the OS. */
export class GuidePowerConfirmations {
  private pending = new Map<string, { owner: number; action: GuidePowerAction; expires: number }>();
  constructor(private activity: () => string | undefined, private now = Date.now, private token = randomUUID) {}
  private assertIdle(action: GuidePowerAction): void {
    const reason = action === 'lock' ? undefined : this.activity();
    if (reason) throw Error(reason);
  }
  prepare(action: unknown, owner: number): GuidePowerConfirmation {
    if (!validGuidePowerAction(action) || !Number.isSafeInteger(owner) || owner < 1) throw Error('Invalid system action.');
    this.assertIdle(action);
    for (const [key, value] of this.pending) if (value.expires <= this.now() || value.owner === owner) this.pending.delete(key);
    if (this.pending.size >= 16) this.pending.delete(this.pending.keys().next().value!);
    const token = this.token(), expires = this.now() + 60_000;
    this.pending.set(token, { owner, action, expires });
    return { token, expiresAt: new Date(expires).toISOString() };
  }
  consume(action: unknown, owner: number, token: unknown): void {
    if (!validGuidePowerAction(action) || typeof token !== 'string' || token.length > 128) throw Error('Confirm the system action first.');
    const value = this.pending.get(token);
    if (!value || value.owner !== owner || value.action !== action) throw Error('Confirm the system action first.');
    this.pending.delete(token);
    if (value.expires <= this.now()) throw Error('Confirmation expired. Open the power menu and try again.');
    this.assertIdle(action);
  }
  clear(): void { this.pending.clear(); }
}
