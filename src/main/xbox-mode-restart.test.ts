import { describe, expect, it, vi } from 'vitest';
import { resumeXboxModeStartup, XboxModeRestart } from './xbox-mode-restart.js';

function fixture() {
  const rollback = vi.fn(async () => {});
  const options = {
    startup: { status: vi.fn(async () => ({ available: true })), prepare: vi.fn(async () => ({ rollback })) },
    activity: vi.fn<() => string | undefined>(() => undefined), authorized: vi.fn(() => true),
    integration: vi.fn(async () => true), rebootCapability: vi.fn(async () => ({ available: true })),
    reboot: vi.fn(async (): Promise<{ ok: boolean; error?: string }> => ({ ok: true })),
  };
  return { options, rollback, restart: new XboxModeRestart(options) };
}
describe('explicit restart into Xbox mode', () => {
  it('opening and preparing are read-only; only a fresh confirmation publishes startup then requests reboot', async () => {
    const f = fixture();
    expect(await f.restart.status(1)).toEqual({ available: true });
    const confirmation = await f.restart.prepare(1);
    expect(f.options.startup.prepare).not.toHaveBeenCalled(); expect(f.options.reboot).not.toHaveBeenCalled();
    await f.restart.restart(1, confirmation.token);
    expect(f.options.startup.prepare).toHaveBeenCalledOnce(); expect(f.options.reboot).toHaveBeenCalledOnce(); expect(f.rollback).not.toHaveBeenCalled();
    await expect(f.restart.restart(1, confirmation.token)).rejects.toThrow('Confirm');
  });
  it('rejects another window and missing confirmation without changing startup', async () => {
    const f = fixture(), confirmation = await f.restart.prepare(1);
    await expect(f.restart.restart(2, confirmation.token)).rejects.toThrow('Confirm');
    await expect(f.restart.restart(1, undefined)).rejects.toThrow('Confirm');
    expect(f.options.startup.prepare).not.toHaveBeenCalled(); expect(f.options.reboot).not.toHaveBeenCalled();
  });
  it('blocks unavailable integration or a nonpersistent launch path', async () => {
    const f = fixture(); f.options.integration.mockResolvedValue(false);
    expect((await f.restart.status(1)).available).toBe(false);
    f.options.integration.mockResolvedValue(true); f.options.startup.status.mockResolvedValue({ available: false });
    await expect(f.restart.prepare(1)).rejects.toThrow('unavailable');
    expect(f.options.reboot).not.toHaveBeenCalled();
  });
  it('rechecks activity that starts during a capability read', async () => {
    const f = fixture(); f.options.rebootCapability.mockImplementation(async () => { f.options.activity.mockReturnValue('A game started.'); return { available: true }; });
    await expect(f.restart.prepare(1)).rejects.toThrow('A game started'); expect(f.options.startup.prepare).not.toHaveBeenCalled();
  });
  it('rolls back if focus or activity changes during startup publication', async () => {
    const f = fixture(), confirmation = await f.restart.prepare(1);
    f.options.startup.prepare.mockImplementation(async () => { f.options.authorized.mockReturnValue(false); return { rollback: f.rollback }; });
    await expect(f.restart.restart(1, confirmation.token)).rejects.toThrow('focused launcher');
    expect(f.rollback).toHaveBeenCalledOnce(); expect(f.options.reboot).not.toHaveBeenCalled();
  });
  it('rolls back rejected and thrown power requests', async () => {
    const f = fixture(); f.options.reboot.mockResolvedValue({ ok: false, error: 'Restart denied.' });
    await expect(f.restart.restart(1, (await f.restart.prepare(1)).token)).rejects.toThrow('Restart denied');
    f.options.reboot.mockRejectedValue(Error('Power service disconnected.'));
    await expect(f.restart.restart(1, (await f.restart.prepare(1)).token)).rejects.toThrow('disconnected');
    expect(f.rollback).toHaveBeenCalledTimes(2);
  });
  it('serializes restart requests while publishing the intent', async () => {
    const f = fixture(), confirmation = await f.restart.prepare(1);
    let publish!: () => void;
    f.options.startup.prepare.mockImplementation(() => new Promise(resolve => { publish = () => resolve({ rollback: f.rollback }); }));
    const pending = f.restart.restart(1, confirmation.token);
    await vi.waitFor(() => expect(publish).toBeTypeOf('function'));
    await expect(f.restart.restart(1, confirmation.token)).rejects.toThrow('already in progress');
    expect((await f.restart.status(1)).available).toBe(false);
    publish(); await pending; expect(f.options.reboot).toHaveBeenCalledOnce();
  });
});

describe('one-shot Xbox mode startup', () => {
  it('shows once, waits for login bridge readiness and enters once', async () => {
    let now = 0;
    const options = { show: vi.fn(async () => {}), valid: () => true, focused: () => true,
      integration: vi.fn(async () => now >= 500), enter: vi.fn(async () => {}), now: () => now,
      wait: async () => { now += 250; } };
    expect(await resumeXboxModeStartup(options)).toBe(true);
    expect(options.show).toHaveBeenCalledOnce(); expect(options.enter).toHaveBeenCalledOnce();
  });
  it('never enters after the window closes or focus is lost during bridge readiness', async () => {
    let focused = true;
    const enter = vi.fn(async () => {});
    expect(await resumeXboxModeStartup({ show: async () => {}, valid: () => true, focused: () => focused,
      integration: async () => { focused = false; return true; }, enter })).toBe(false);
    expect(enter).not.toHaveBeenCalled();
  });
  it('bounds unavailable startup without repeated focus requests', async () => {
    let now = 0;
    const show = vi.fn(async () => {}), enter = vi.fn(async () => {});
    expect(await resumeXboxModeStartup({ show, valid: () => true, focused: () => false, integration: async () => true,
      enter, now: () => now, wait: async () => { now += 250; }, timeoutMs: 500 })).toBe(false);
    expect(now).toBe(500); expect(show).toHaveBeenCalledOnce(); expect(enter).not.toHaveBeenCalled();
  });
  it('rejects integration readiness delivered after the startup deadline', async () => {
    let now = 0;
    const enter = vi.fn(async () => {});
    expect(await resumeXboxModeStartup({ show: async () => {}, valid: () => true, focused: () => true,
      integration: async () => { now = 1001; return true; }, enter, now: () => now, timeoutMs: 1000 })).toBe(false);
    expect(enter).not.toHaveBeenCalled();
  });
});
