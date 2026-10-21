import { describe, expect, it } from 'vitest';
import { GuidePowerConfirmations } from './guide-power';

describe('system power confirmation boundary', () => {
  it('requires the same window, action and single-use confirmation', () => {
    const guard = new GuidePowerConfirmations(() => undefined);
    const confirmation = guard.prepare('reboot', 1);
    expect(() => guard.consume('poweroff', 1, confirmation.token)).toThrow('Confirm');
    expect(() => guard.consume('reboot', 2, confirmation.token)).toThrow('Confirm');
    expect(() => guard.consume('reboot', 1, confirmation.token)).not.toThrow();
    expect(() => guard.consume('reboot', 1, confirmation.token)).toThrow('Confirm');
  });
  it('expires and supersedes pending confirmations without any system mutation', () => {
    let now = 1_000;
    const guard = new GuidePowerConfirmations(() => undefined, () => now);
    const old = guard.prepare('logout', 1), current = guard.prepare('suspend', 1);
    expect(() => guard.consume('logout', 1, old.token)).toThrow('Confirm');
    now += 60_000;
    expect(() => guard.consume('suspend', 1, current.token)).toThrow('expired');
  });
  it('rechecks activity immediately before execution and allows screen lock', () => {
    let reason: string | undefined;
    const guard = new GuidePowerConfirmations(() => reason);
    const confirmation = guard.prepare('poweroff', 1);
    reason = 'A game is running.';
    expect(() => guard.consume('poweroff', 1, confirmation.token)).toThrow(reason);
    expect(() => guard.prepare('suspend', 1)).toThrow(reason);
    const lock = guard.prepare('lock', 1);
    expect(() => guard.consume('lock', 1, lock.token)).not.toThrow();
    expect(() => guard.consume('poweroff', 1, confirmation.token)).toThrow('Confirm');
  });
  it('rejects arbitrary commands and drops confirmations on shutdown', () => {
    const guard = new GuidePowerConfirmations(() => undefined);
    expect(() => guard.prepare('reboot;command', 1)).toThrow('Invalid');
    const confirmation = guard.prepare('lock', 1); guard.clear();
    expect(() => guard.consume('lock', 1, confirmation.token)).toThrow('Confirm');
  });
});
