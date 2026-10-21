import { describe, expect, it, vi } from 'vitest';
import { GuideSystemAdapter, unavailableGuideSystem, type GuideSystemCommandOptions, type GuideSystemCommandResult } from './guide-system.js';
import type { GuideSystemAction } from '../shared/guide-system.js';

// Every command/action in this file uses the fake runner/opener. No desktop,
// network, Bluetooth device or power mutation is executed on the host.
function fixture() {
  const state = {
    wifi: true, hardware: true, wifiPermission: 'yes', bluetooth: true,
    devices: 'wlan0:wifi:connected:Home\\:Office\\\\Desk\nenp1s0:ethernet:disconnected:--\n',
    paired: new Map([['AA:BB:CC:DD:EE:01', 'Game controller'], ['AA:BB:CC:DD:EE:02', 'Headphones']]),
    unpairedAfterList: new Set<string>(),
    connected: new Set(['AA:BB:CC:DD:EE:02']),
    powers: { CanSuspend: 'yes', CanReboot: 'challenge', CanPowerOff: 'no' } as Record<string, string>,
    owners: new Set(['org.freedesktop.ScreenSaver', 'org.gnome.SessionManager']),
    panels: ['network', 'bluetooth', 'power'],
    reject: undefined as undefined | ((command: string, args: readonly string[]) => GuideSystemCommandResult | undefined),
    beforeMutation: undefined as undefined | (() => Promise<void>),
    ignoreMutation: false,
  };
  const calls: { command: string; args: readonly string[]; options: GuideSystemCommandOptions }[] = [];
  const mutations: { command: string; args: readonly string[] }[] = [];
  const open = vi.fn(async (_command: string, _args: readonly string[], _options: GuideSystemCommandOptions) => {});
  const resolve = vi.fn(async (name: string) => `/fake/bin/${name}`);
  const run = vi.fn(async (command: string, args: readonly string[], options: GuideSystemCommandOptions): Promise<GuideSystemCommandResult> => {
    calls.push({ command, args, options });
    const rejected = state.reject?.(command, args); if (rejected) return rejected;
    const ok = (stdout: string) => ({ code: 0, stdout });
    if (command.endsWith('/gnome-control-center')) return ok('Available panels:\n' + state.panels.map(value => '\t' + value).join('\n'));
    if (command.endsWith('/nmcli')) {
      if (args.includes('radio')) {
        mutations.push({ command, args }); await state.beforeMutation?.();
        if (!state.ignoreMutation) state.wifi = args.at(-1) === 'on';
        return ok('');
      }
      const fields = args[args.indexOf('--fields') + 1];
      if (fields === 'STATE,CONNECTIVITY,WIFI-HW,WIFI') return ok(`connected:full:${state.hardware ? 'enabled' : 'disabled'}:${state.wifi ? 'enabled' : 'disabled'}\n`);
      if (fields === 'DEVICE,TYPE,STATE,CONNECTION') return ok(state.devices);
      if (fields === 'PERMISSION,VALUE') return ok(`org.freedesktop.NetworkManager.enable-disable-wifi:${state.wifiPermission}\n`);
    }
    if (command.endsWith('/bluetoothctl')) {
      if (args.includes('show')) return ok(`Controller 11:22:33:44:55:66 (public)\n\tName: Test adapter\n\tAlias: Test adapter\n\tPowered: ${state.bluetooth ? 'yes' : 'no'}\n`);
      if (args.includes('devices')) {
        const selected = args.at(-1) === 'Paired' ? [...state.paired] : [...state.paired].filter(([address]) => state.connected.has(address));
        return ok(selected.map(([address, name]) => `Device ${address} ${name}`).join('\n'));
      }
      if (args.includes('info')) {
        const address = args.at(-1)!;
        return ok(`Device ${address} (public)\n\tPaired: ${state.paired.has(address) && !state.unpairedAfterList.has(address) ? 'yes' : 'no'}\n\tConnected: ${state.connected.has(address) ? 'yes' : 'no'}\n`);
      }
      mutations.push({ command, args }); await state.beforeMutation?.();
      if (!state.ignoreMutation) {
        if (args.includes('power')) state.bluetooth = args.at(-1) === 'on';
        else if (args.includes('connect')) state.connected.add(args.at(-1)!);
        else if (args.includes('disconnect')) state.connected.delete(args.at(-1)!);
      }
      return ok('Changing requested state succeeded\n');
    }
    if (command.endsWith('/gdbus')) {
      const method = args[args.indexOf('--method') + 1];
      if (method === 'org.freedesktop.DBus.NameHasOwner') return ok(`(${state.owners.has(args.at(-1)!) ? 'true' : 'false'},)`);
      const name = method.split('.').at(-1)!;
      if (name.startsWith('Can')) return ok(`('${state.powers[name]}',)`);
      mutations.push({ command, args }); return ok('()');
    }
    throw new Error('Unexpected fake command: ' + command + ' ' + args.join(' '));
  });
  const options = { run, open, resolveCommand: resolve, platform: 'linux', now: () => new Date('2026-10-21T12:00:00Z'), environment: { PATH: '/fake/bin', XDG_CURRENT_DESKTOP: 'ubuntu:GNOME', WAYLAND_DISPLAY: 'fixture-display' } };
  return { state, calls, mutations, run, open, resolve, options, adapter: new GuideSystemAdapter(options) };
}

describe('read-only Linux system capabilities', () => {
  it('reads real CLI contracts without scans/secrets/mutations and decodes escaped NetworkManager fields', async () => {
    const f = fixture(), result = await f.adapter.readState();
    expect(result.sampledAt).toBe('2026-10-21T12:00:00.000Z');
    expect(result.network).toMatchObject({ available: true, state: 'connected', connectivity: 'full', wifi: { enabled: true, hardwareEnabled: true, toggle: { available: true } } });
    expect(result.network.devices[0]).toMatchObject({ interface: 'wlan0', type: 'wifi', connection: 'Home:Office\\Desk' });
    expect(result.network.devices[1].connection).toBeUndefined();
    expect(result.bluetooth).toMatchObject({ available: true, controller: { address: '11:22:33:44:55:66', powered: true } });
    expect(result.bluetooth.devices).toEqual([
      expect.objectContaining({ address: 'AA:BB:CC:DD:EE:01', paired: true, connected: false, connect: { available: true, requiresAuthorization: true } }),
      expect.objectContaining({ address: 'AA:BB:CC:DD:EE:02', paired: true, connected: true, disconnect: { available: true, requiresAuthorization: true } }),
    ]);
    expect(result.power.actions).toMatchObject({ lock: { available: true }, logout: { available: true }, suspend: { available: true }, reboot: { available: true, requiresAuthorization: true }, poweroff: { available: false } });
    expect(f.mutations).toEqual([]); expect(f.open).not.toHaveBeenCalled();
    for (const call of f.calls) {
      expect(call.options.timeoutMs).toBeGreaterThan(0); expect(call.options.timeoutMs).toBeLessThanOrEqual(12_000);
      expect(call.options.maxBuffer).toBe(65_536); expect(call.options.env.LC_ALL).toBe('C');
      expect(call.args.some(arg => ['scan', 'pair', 'trust', '--show-secrets', '--ask', 'radio'].includes(arg))).toBe(false);
    }
  });
  it.each(['no', 'na', 'unknown'])('does not invent Wi-Fi or power permission from %s', async permission => {
    const f = fixture(); f.state.wifiPermission = permission; f.state.powers.CanSuspend = permission;
    const result = await f.adapter.readState();
    expect(result.network.available).toBe(true); expect(result.network.wifi?.toggle.available).toBe(false);
    expect(result.power.actions.suspend.available).toBe(false);
    expect((await f.adapter.execute({ type: 'wifi', enabled: false })).ok).toBe(false);
    expect(f.mutations).toEqual([]);
  });
  it('keeps authorization challenges distinct from denial and respects a hardware Wi-Fi switch', async () => {
    const f = fixture(); f.state.wifiPermission = 'auth';
    expect((await f.adapter.readState()).network.wifi?.toggle).toEqual({ available: true, requiresAuthorization: true });
    f.state.hardware = false;
    expect((await f.adapter.readState()).network.wifi?.toggle).toMatchObject({ available: false, reason: expect.stringContaining('hardware') });
    expect((await f.adapter.execute({ type: 'wifi', enabled: true })).ok).toBe(false);
    expect(f.mutations).toEqual([]);
  });
  it('does not offer Wi-Fi control on an Ethernet-only host', async () => {
    const f = fixture(); f.state.devices = 'enp1s0:ethernet:connected:Wired\n';
    const result = await f.adapter.readState();
    expect(result.network.available).toBe(true); expect(result.network.wifi?.toggle).toMatchObject({ available: false, reason: 'No Wi-Fi adapter was reported.' });
  });
  it('reports missing tools and unsupported platforms without running any command', async () => {
    const f = fixture();
    const missing = new GuideSystemAdapter({ ...f.options, resolveCommand: async () => undefined });
    const result = await missing.readState();
    expect(result.network.available).toBe(false); expect(result.bluetooth.available).toBe(false); expect(result.power.available).toBe(false);
    expect(f.run).not.toHaveBeenCalled();
    const unsupported = new GuideSystemAdapter({ ...f.options, platform: 'darwin' });
    const before = f.resolve.mock.calls.length;
    expect((await unsupported.execute({ type: 'power', action: 'reboot' })).ok).toBe(false);
    expect(f.resolve.mock.calls).toHaveLength(before); expect(f.run).not.toHaveBeenCalled();
  });
  it('keeps unavailable response data separate from a working settings navigator', async () => {
    const f = fixture();
    f.state.reject = (command) => command.endsWith('/nmcli') ? { code: 8, stdout: '', stderr: 'NetworkManager is not running.' } : undefined;
    const result = await f.adapter.readState();
    expect(result.network).toMatchObject({ available: false, reason: 'NetworkManager is not running.', settings: { available: true } });
    expect(result.bluetooth.available).toBe(true);
  });
  it('fails closed on malformed/truncated responses and bounded excessive output', async () => {
    const f = fixture(); f.state.devices = 'wlan0:wifi:bad:unterminated\\';
    expect((await f.adapter.readState()).network.available).toBe(false);
    f.state.reject = command => command.endsWith('/bluetoothctl') ? { code: 0, stdout: 'X'.repeat(65_537) } : undefined;
    expect((await f.adapter.readState()).bluetooth).toMatchObject({ available: false, reason: expect.stringContaining('output limit') });
  });
  it('does not label an unsupported BlueZ command or unpaired device as paired', async () => {
    const f = fixture();
    f.state.reject = (command, args) => command.endsWith('/bluetoothctl') && args.at(-1) === 'Paired' ? { code: 0, stdout: 'Invalid command in menu main: devices Paired\n' } : undefined;
    const result = await f.adapter.readState();
    expect(result.bluetooth.available).toBe(false); expect(result.bluetooth.devices).toEqual([]);
    expect((await f.adapter.execute({ type: 'bluetooth-device', address: 'AA:BB:CC:DD:EE:03', connected: true })).ok).toBe(false);
    expect(f.mutations).toEqual([]);
  });
  it('limits reported devices and retains only the paired subset of connected devices', async () => {
    const f = fixture();
    f.state.paired = new Map(Array.from({ length: 70 }, (_, index) => [`AA:BB:CC:DD:EE:${index.toString(16).padStart(2, '0').toUpperCase()}`, `Paired ${index}`]));
    const result = await f.adapter.readState();
    expect(result.bluetooth.devices).toHaveLength(64); expect(result.bluetooth.reason).toContain('first 64');
    expect(result.bluetooth.devices.every(device => device.paired)).toBe(true);
  });
  it('does not infer normal logout or lock availability from logind power permissions', async () => {
    const f = fixture(); f.state.owners.clear();
    const result = await f.adapter.readState();
    expect(result.power.actions.suspend.available).toBe(true);
    expect(result.power.actions.lock.available).toBe(false); expect(result.power.actions.logout.available).toBe(false);
    expect((await f.adapter.execute({ type: 'power', action: 'logout' })).ok).toBe(false);
    expect(f.mutations).toEqual([]);
  });
  it('provides an explicitly unavailable demo state without observing the host', () => {
    const result = unavailableGuideSystem('Demo adapter disabled.');
    expect(result.network.available).toBe(false); expect(result.bluetooth.available).toBe(false);
    expect(Object.values(result.power.actions).every(value => !value.available)).toBe(true);
  });
});

describe('explicit Linux system actions with a fake runner', () => {
  it('changes Wi-Fi only through the fixed radio command and refreshes actual state', async () => {
    const f = fixture();
    const result = await f.adapter.execute({ type: 'wifi', enabled: false });
    expect(result.ok).toBe(true); expect(result.state.network.wifi?.enabled).toBe(false);
    expect(f.mutations).toEqual([{ command: '/fake/bin/nmcli', args: ['--colors', 'no', '--wait', '10', 'radio', 'wifi', 'off'] }]);
  });
  it('changes Bluetooth power without enabling discovery or pairing', async () => {
    const f = fixture();
    const result = await f.adapter.execute({ type: 'bluetooth', enabled: false });
    expect(result.ok).toBe(true); expect(result.state.bluetooth.controller?.powered).toBe(false);
    expect(f.mutations).toEqual([{ command: '/fake/bin/bluetoothctl', args: ['--timeout', '10', 'power', 'off'] }]);
    expect(result.state.bluetooth.devices.every(device => !device.connect.available)).toBe(true);
  });
  it('connects/disconnects only fresh paired addresses, passing canonical MAC as one argument', async () => {
    const f = fixture();
    expect((await f.adapter.execute({ type: 'bluetooth-device', address: 'aa:bb:cc:dd:ee:01', connected: true })).ok).toBe(true);
    expect(f.mutations.at(-1)?.args).toEqual(['--timeout', '10', 'connect', 'AA:BB:CC:DD:EE:01']);
    expect((await f.adapter.execute({ type: 'bluetooth-device', address: 'AA:BB:CC:DD:EE:01', connected: false })).ok).toBe(true);
    expect(f.mutations.at(-1)?.args).toEqual(['--timeout', '10', 'disconnect', 'AA:BB:CC:DD:EE:01']);
    f.state.paired.delete('AA:BB:CC:DD:EE:01');
    const before = f.mutations.length;
    expect((await f.adapter.execute({ type: 'bluetooth-device', address: 'AA:BB:CC:DD:EE:01', connected: true })).ok).toBe(false);
    expect(f.mutations).toHaveLength(before);
  });
  it.each([true, false])('rechecks the selected device Paired property before connected=%s', async connected => {
    const f = fixture(), address = connected ? 'AA:BB:CC:DD:EE:01' : 'AA:BB:CC:DD:EE:02';
    f.state.unpairedAfterList.add(address);
    const result = await f.adapter.execute({ type: 'bluetooth-device', address, connected });
    expect(result.ok).toBe(false); expect(result.error).toContain('no longer confirmed as paired');
    expect(f.calls.some(call => call.args.includes('info') && call.args.at(-1) === address)).toBe(true);
    expect(f.mutations).toEqual([]);
  });
  it.each([
    { type: 'wifi', enabled: 'false' }, { type: 'wifi', enabled: true, command: 'shutdown' },
    { type: 'bluetooth-device', address: 'AA:BB:CC:DD:EE:01;reboot', connected: true },
    { type: 'bluetooth-device', address: '--help', connected: true }, { type: 'power', action: 'halt --force' },
    { type: 'open-settings', section: '../power' }, null,
  ])('rejects malformed requests before any observation or mutation: %j', async action => {
    const f = fixture();
    expect((await f.adapter.execute(action as GuideSystemAction)).ok).toBe(false);
    expect(f.run).not.toHaveBeenCalled(); expect(f.open).not.toHaveBeenCalled(); expect(f.mutations).toEqual([]);
  });
  it('returns actual denial/error and never publishes the desired toggle optimistically', async () => {
    const f = fixture();
    f.state.reject = (command, args) => command.endsWith('/nmcli') && args.includes('radio') ? { code: 4, stdout: '', stderr: 'Not authorized to control Wi-Fi.' } : undefined;
    const result = await f.adapter.execute({ type: 'wifi', enabled: false });
    expect(result).toMatchObject({ ok: false, error: 'Not authorized to control Wi-Fi.', state: { network: { wifi: { enabled: true } } } });
    f.state.reject = undefined; f.state.ignoreMutation = true;
    const unchanged = await f.adapter.execute({ type: 'wifi', enabled: false });
    expect(unchanged.ok).toBe(false); expect(unchanged.error).toContain('not observed'); expect(unchanged.state.network.wifi?.enabled).toBe(true);
  });
  it('handles BlueZ textual failures even when the tool returns exit status zero', async () => {
    const f = fixture();
    f.state.reject = (command, args) => command.endsWith('/bluetoothctl') && args.includes('connect') ? { code: 0, stdout: 'Failed to connect: org.bluez.Error.NotReady\n' } : undefined;
    const result = await f.adapter.execute({ type: 'bluetooth-device', address: 'AA:BB:CC:DD:EE:01', connected: true });
    expect(result.ok).toBe(false); expect(result.error).toContain('NotReady'); expect(result.state.bluetooth.devices[0].connected).toBe(false);
  });
  it('refreshes observed state after an action error that partially changed the service', async () => {
    const f = fixture();
    f.state.reject = (command, args) => {
      if (command.endsWith('/nmcli') && args.includes('radio')) {
        f.state.wifi = false;
        return { code: 4, stdout: '', stderr: 'Synthetic failure after property change.' };
      }
      return undefined;
    };
    const result = await f.adapter.execute({ type: 'wifi', enabled: false });
    expect(result.ok).toBe(false); expect(result.error).toContain('after property change');
    expect(result.state.network.wifi?.enabled).toBe(false);
  });
  it('serializes user actions by refusing a second mutation while one is pending', async () => {
    const f = fixture(); let release!: () => void;
    f.state.beforeMutation = () => new Promise<void>(resolve => { release = resolve; });
    const first = f.adapter.execute({ type: 'wifi', enabled: false });
    await vi.waitFor(() => expect(f.mutations).toHaveLength(1));
    const second = await f.adapter.execute({ type: 'bluetooth', enabled: false });
    expect(second.ok).toBe(false); expect(second.error).toContain('still running'); expect(f.mutations).toHaveLength(1);
    release(); expect((await first).ok).toBe(true);
  });
  it.each(['suspend', 'reboot'] as const)('asks logind to authorize %s, preserving normal inhibitors', async action => {
    const f = fixture(); const result = await f.adapter.execute({ type: 'power', action });
    expect(result.ok).toBe(true); expect(f.mutations).toHaveLength(1);
    const call = f.mutations[0];
    expect(call.command).toBe('/fake/bin/gdbus'); expect(call.args).toContain('--system'); expect(call.args).toContain('--interactive'); expect(call.args.at(-1)).toBe('true');
    expect(call.args).toContain('org.freedesktop.login1.Manager.' + (action === 'suspend' ? 'Suspend' : 'Reboot'));
    expect(call.args.some(arg => ['--force', 'TerminateSession', 'KillSession'].includes(arg))).toBe(false);
  });
  it.each(['lock', 'logout', 'suspend', 'reboot', 'poweroff'] as const)('checks the injected live activity guard after probes and prevents %s when it throws', async action => {
    const f = fixture(); f.state.powers.CanPowerOff = 'yes';
    const beforePower = vi.fn(() => {
      expect(f.calls.some(call => call.args.includes('org.freedesktop.login1.Manager.CanSuspend'))).toBe(true);
      throw new Error('A game started during system preflight.');
    });
    const adapter = new GuideSystemAdapter({ ...f.options, beforePower });
    const result = await adapter.execute({ type: 'power', action });
    expect(result).toMatchObject({ ok: false, error: 'A game started during system preflight.' });
    expect(beforePower).toHaveBeenCalledOnce(); expect(beforePower).toHaveBeenCalledWith(action);
    expect(f.mutations).toEqual([]);
  });
  it('uses normal logout mode 0 and a running screen-lock service without forcing session termination', async () => {
    const f = fixture();
    expect((await f.adapter.execute({ type: 'power', action: 'logout' })).ok).toBe(true);
    expect(f.mutations.at(-1)?.args).toContain('org.gnome.SessionManager.Logout'); expect(f.mutations.at(-1)?.args.at(-1)).toBe('0');
    expect((await f.adapter.execute({ type: 'power', action: 'lock' })).ok).toBe(true);
    expect(f.mutations.at(-1)?.args).toContain('org.freedesktop.ScreenSaver.Lock');
  });
  it('opens only a verified desktop settings panel and propagates launcher failure', async () => {
    const f = fixture(); f.state.panels = ['network', 'power'];
    expect((await f.adapter.openSettings('bluetooth')).ok).toBe(false); expect(f.open).not.toHaveBeenCalled();
    expect((await f.adapter.openSettings('network')).ok).toBe(true);
    expect(f.open).toHaveBeenCalledWith('/fake/bin/gnome-control-center', ['network'], expect.objectContaining({ timeoutMs: 3_500, maxBuffer: 65_536 }));
    f.open.mockRejectedValueOnce(new Error('Synthetic settings launch failure'));
    expect(await f.adapter.openSettings('power')).toMatchObject({ ok: false, error: 'Synthetic settings launch failure' });
  });
  it('does not launch GNOME settings on an unsupported or headless desktop', async () => {
    const f = fixture();
    const kde = new GuideSystemAdapter({ ...f.options, environment: { XDG_CURRENT_DESKTOP: 'KDE', DISPLAY: ':99' } });
    expect((await kde.openSettings('network')).ok).toBe(false); expect(f.open).not.toHaveBeenCalled();
    const headless = new GuideSystemAdapter({ ...f.options, environment: { XDG_CURRENT_DESKTOP: 'GNOME' } });
    expect((await headless.openSettings('power')).ok).toBe(false); expect(f.open).not.toHaveBeenCalled();
  });
  it('handles bounded runner timeouts as unavailable capability instead of success', async () => {
    const f = fixture(); f.run.mockRejectedValue(new Error('Synthetic command timeout'));
    const state = await f.adapter.readState();
    expect(state.network.available).toBe(false); expect(state.bluetooth.available).toBe(false); expect(state.power.available).toBe(false);
    expect((await f.adapter.execute({ type: 'bluetooth', enabled: false })).ok).toBe(false); expect(f.mutations).toEqual([]);
  });
});
