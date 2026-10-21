import { constants, promises as fs } from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import path from 'node:path';
import { stripAnsi } from '../shared/utils.js';
import { externalLauncherEnvironment } from './launcher-environment.js';
import type { GuideBluetoothState, GuideNetworkState, GuidePowerAction, GuidePowerState, GuideSystemAction, GuideSystemActionResult, GuideSystemCapability, GuideSystemSettingsSection, GuideSystemState } from '../shared/guide-system.js';

const READ_TIMEOUT = 3_500;
const ACTION_TIMEOUT = 12_000;
const MAX_OUTPUT = 64 * 1024;
const MAX_DEVICES = 64;
const MAC = /^(?:[0-9A-F]{2}:){5}[0-9A-F]{2}$/i;
const powerActions: GuidePowerAction[] = ['lock', 'logout', 'suspend', 'reboot', 'poweroff'];
const sections: GuideSystemSettingsSection[] = ['network', 'bluetooth', 'power'];
const unavailable = (reason: string): GuideSystemCapability => ({ available: false, reason });
const available = (): GuideSystemCapability => ({ available: true });
const safeText = (value: string) => stripAnsi(value).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').trim().slice(0, 512);

export interface GuideSystemCommandOptions { timeoutMs: number; maxBuffer: number; env: NodeJS.ProcessEnv }
export interface GuideSystemCommandResult { code: number; stdout: string; stderr?: string }
export type GuideSystemRunner = (command: string, args: readonly string[], options: GuideSystemCommandOptions) => Promise<GuideSystemCommandResult>;
export type GuideSystemOpener = (command: string, args: readonly string[], options: GuideSystemCommandOptions) => Promise<void>;
interface SettingsTarget { command: string; args: string[] }
export interface GuideSystemOptions {
  run?: GuideSystemRunner;
  open?: GuideSystemOpener;
  resolveCommand?: (name: string) => Promise<string | undefined>;
  environment?: NodeJS.ProcessEnv;
  platform?: string;
  now?: () => Date;
  /** Synchronous final activity check, after asynchronous probes and before the OS request starts. */
  beforePower?: (action: GuidePowerAction) => void;
}

/** Uses execFile without a shell, with finite output and wall-clock bounds. */
const runBounded: GuideSystemRunner = (command, args, options) => new Promise((resolve, reject) => {
  execFile(command, [...args], { shell: false, encoding: 'utf8', timeout: options.timeoutMs, maxBuffer: options.maxBuffer,
    env: options.env, windowsHide: true }, (error, stdout, stderr) => {
    if (error && (error.killed || typeof error.code !== 'number')) { reject(new Error(error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? 'The system service response exceeded the output limit.' : error.killed ? 'The system service timed out.' : 'The system command could not be started.')); return; }
    resolve({ code: error ? Number(error.code) : 0, stdout, stderr });
  });
});
/** Settings applications remain open; only their spawn acknowledgement is bounded. */
const openBounded: GuideSystemOpener = (command, args, options) => new Promise((resolve, reject) => {
  const child = spawn(command, [...args], { shell: false, detached: true, stdio: 'ignore', env: options.env, windowsHide: true });
  const timer = setTimeout(() => { child.kill(); reject(new Error('The desktop settings launcher timed out.')); }, options.timeoutMs);
  child.once('error', () => { clearTimeout(timer); reject(new Error('The desktop settings application could not be started.')); });
  child.once('spawn', () => { clearTimeout(timer); child.unref(); resolve(); });
});

export function unavailableGuideSystem(reason: string, platform: string = process.platform): GuideSystemState {
  return { platform, sampledAt: new Date().toISOString(),
    network: { available: false, reason, devices: [], settings: unavailable(reason) },
    bluetooth: { available: false, reason, toggle: unavailable(reason), devices: [], settings: unavailable(reason) },
    power: { available: false, reason, actions: Object.fromEntries(powerActions.map(action => [action, unavailable(reason)])) as GuidePowerState['actions'], settings: unavailable(reason) } };
}

/** nmcli --terse --escape yes escapes ':' and '\\'; do not split SSIDs/connection names naively. */
function nmcliRows(output: string, fields: number): string[][] {
  if (!output.trim()) return [];
  return output.trimEnd().split('\n').map(line => {
    const values: string[] = []; let value = '', escaped = false;
    for (const character of line.replace(/\r$/, '')) {
      if (escaped) { if (character !== ':' && character !== '\\') throw new Error('Unsupported NetworkManager escaping.'); value += character; escaped = false; }
      else if (character === '\\') escaped = true;
      else if (character === ':') { values.push(value); value = ''; }
      else value += character;
    }
    if (escaped) throw new Error('Incomplete NetworkManager escaping.');
    values.push(value);
    if (values.length !== fields) throw new Error('Unsupported NetworkManager response.');
    return values;
  });
}
function booleanProperty(output: string, property: string): boolean {
  const value = new RegExp(`^\\s*${property}:\\s*(yes|no)\\s*$`, 'm').exec(stripAnsi(output));
  if (!value) throw new Error(`Bluetooth ${property.toLowerCase()} state is unavailable.`);
  return value[1] === 'yes';
}
function bluetoothDevices(output: string): Map<string, string> {
  const devices = new Map<string, string>();
  for (const line of stripAnsi(output).split(/\r?\n/).map(value => value.trim()).filter(Boolean)) {
    if (/^\[(CHG|NEW|DEL)\]/.test(line)) continue;
    const match = /^Device ((?:[0-9A-F]{2}:){5}[0-9A-F]{2})(?: (.*))?$/i.exec(line);
    if (!match) throw new Error('This BlueZ version did not return a supported paired-device list.');
    devices.set(match[1].toUpperCase(), safeText(match[2] || match[1]));
  }
  return devices;
}
function permission(value: string | undefined, label: string): GuideSystemCapability {
  return value === 'yes' ? available() : value === 'auth' || value === 'challenge' ? { available: true, requiresAuthorization: true }
    : unavailable(value === 'no' ? `${label} is not permitted for this user.` : value === 'na' ? `${label} is not supported by this system.` : `${label} permission is unavailable.`);
}
function validateAction(value: unknown): asserts value is GuideSystemAction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid system action.');
  const action = value as Record<string, unknown>;
  const keys = Object.keys(action).sort().join(',');
  if ((action.type === 'wifi' || action.type === 'bluetooth') && keys === 'enabled,type' && typeof action.enabled === 'boolean') return;
  if (action.type === 'bluetooth-device' && keys === 'address,connected,type' && typeof action.address === 'string' && MAC.test(action.address) && typeof action.connected === 'boolean') return;
  if (action.type === 'power' && keys === 'action,type' && powerActions.includes(action.action as GuidePowerAction)) return;
  if (action.type === 'open-settings' && keys === 'section,type' && sections.includes(action.section as GuideSystemSettingsSection)) return;
  throw new Error('Invalid system action.');
}

/** NetworkManager/BlueZ/logind adapter. readState never scans, pairs, connects or changes settings.
 * execute is called only after the IPC owner validates the user's action; power confirmation,
 * sender-bound nonce and active-game/download guards belong at that IPC boundary. */
export class GuideSystemAdapter {
  private readonly runner: GuideSystemRunner;
  private readonly opener: GuideSystemOpener;
  private readonly resolver: (name: string) => Promise<string | undefined>;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly platform: string;
  private readonly now: () => Date;
  private readonly beforePower?: (action: GuidePowerAction) => void;
  private busy = false;
  private targets: Partial<Record<GuideSystemSettingsSection, SettingsTarget>> = {};
  private commands: Partial<Record<'nmcli' | 'bluetoothctl' | 'gdbus', string>> = {};
  private lockTarget?: { service: string; object: string };
  private logoutAvailable = false;

  constructor(options: GuideSystemOptions = {}) {
    this.runner = options.run ?? runBounded; this.opener = options.open ?? openBounded;
    this.environment = { ...externalLauncherEnvironment(options.environment ?? process.env), LC_ALL: 'C', LANG: 'C', TERM: 'dumb', NO_COLOR: '1' };
    this.platform = options.platform ?? process.platform; this.now = options.now ?? (() => new Date());
    this.beforePower = options.beforePower;
    this.resolver = options.resolveCommand ?? (async name => {
      for (const directory of (this.environment.PATH ?? '/usr/bin:/bin').split(path.delimiter).filter(value => path.isAbsolute(value))) {
        const file = path.join(directory, name);
        try { if ((await fs.stat(file)).isFile()) { await fs.access(file, constants.X_OK); return file; } } catch { /* Try the next installed path. */ }
      }
      return undefined;
    });
  }
  private async command(command: string, args: string[], mutation = false): Promise<string> {
    const result = await this.runner(command, args, { timeoutMs: mutation ? ACTION_TIMEOUT : READ_TIMEOUT, maxBuffer: MAX_OUTPUT, env: this.environment });
    if (Buffer.byteLength(result.stdout) > MAX_OUTPUT || Buffer.byteLength(result.stderr ?? '') > MAX_OUTPUT) throw new Error('The system service response exceeded the output limit.');
    if (result.code !== 0) throw new Error(safeText(result.stderr || result.stdout) || 'The system service rejected this request.');
    return stripAnsi(result.stdout);
  }
  private async dbus(bus: 'system' | 'session', destination: string, object: string, method: string, parameters: string[] = [], mutation = false): Promise<string> {
    if (!this.commands.gdbus) throw new Error('The gdbus utility is not installed.');
    return this.command(this.commands.gdbus, ['call', `--${bus}`, '--dest', destination, '--object-path', object, '--method', method,
      '--timeout', mutation ? '10' : '3', ...(mutation ? ['--interactive'] : []), ...parameters], mutation);
  }
  private async nameOwned(name: string): Promise<boolean> {
    try { return /^\(true,\)\s*$/.test(await this.dbus('session', 'org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus.NameHasOwner', [name])); }
    catch { return false; }
  }
  private async settingsCapabilities(): Promise<Record<GuideSystemSettingsSection, GuideSystemCapability>> {
    this.targets = {};
    const reason = 'Desktop settings navigation is not supported by the current desktop.';
    const capabilities = { network: unavailable(reason), bluetooth: unavailable(reason), power: unavailable(reason) };
    const desktop = (this.environment.XDG_CURRENT_DESKTOP ?? '').toLowerCase().split(':');
    if (!desktop.some(name => ['gnome', 'ubuntu', 'unity'].includes(name)) || (!this.environment.DISPLAY && !this.environment.WAYLAND_DISPLAY)) return capabilities;
    const command = await this.resolver('gnome-control-center');
    if (!command) return { network: unavailable('GNOME Settings is not installed.'), bluetooth: unavailable('GNOME Settings is not installed.'), power: unavailable('GNOME Settings is not installed.') };
    try {
      const output = await this.command(command, ['--list']);
      const panels = new Set(output.split(/\r?\n/).map(value => value.trim()).filter(value => /^[a-z][a-z0-9-]*$/.test(value)));
      for (const section of sections) if (panels.has(section)) { this.targets[section] = { command, args: [section] }; capabilities[section] = available(); }
      return capabilities;
    } catch (error) { return { network: unavailable(safeText((error as Error).message)), bluetooth: unavailable(safeText((error as Error).message)), power: unavailable(safeText((error as Error).message)) }; }
  }
  private async readNetwork(settings: GuideSystemCapability): Promise<GuideNetworkState> {
    const command = this.commands.nmcli;
    if (!command) return { available: false, reason: 'NetworkManager needs the nmcli utility.', devices: [], settings };
    const prefix = ['--colors', 'no', '--terse', '--escape', 'yes'];
    try {
      const [general, devices, permissions] = await Promise.all([
        this.command(command, [...prefix, '--fields', 'STATE,CONNECTIVITY,WIFI-HW,WIFI', 'general', 'status']),
        this.command(command, [...prefix, '--fields', 'DEVICE,TYPE,STATE,CONNECTION', 'device', 'status']),
        this.command(command, [...prefix, '--fields', 'PERMISSION,VALUE', 'general', 'permissions']).catch(() => ''),
      ]);
      const rows = nmcliRows(general, 4);
      if (rows.length !== 1 || !['enabled', 'disabled'].includes(rows[0][2]) || !['enabled', 'disabled'].includes(rows[0][3])) throw new Error('NetworkManager radio state is unavailable.');
      const [state, connectivity, hardware, software] = rows[0];
      const permissionRows = nmcliRows(permissions, 2);
      const devicesRows = nmcliRows(devices, 4).slice(0, MAX_DEVICES);
      const hasWifi = devicesRows.some(row => row[1] === 'wifi');
      const toggle = !hasWifi ? unavailable('No Wi-Fi adapter was reported.') : hardware !== 'enabled' ? unavailable('Wi-Fi is disabled by a hardware switch.') : permission(permissionRows.find(row => row[0] === 'org.freedesktop.NetworkManager.enable-disable-wifi')?.[1], 'Wi-Fi control');
      return { available: true, state: safeText(state), connectivity: safeText(connectivity), wifi: { enabled: software === 'enabled', hardwareEnabled: hardware === 'enabled', toggle },
        devices: devicesRows.map(([device, type, status, connection]) => ({ interface: safeText(device), type: safeText(type), state: safeText(status), connection: connection && connection !== '--' ? safeText(connection) : undefined })), settings };
    } catch (error) { return { available: false, reason: safeText((error as Error).message), devices: [], settings }; }
  }
  private async readBluetooth(settings: GuideSystemCapability): Promise<GuideBluetoothState> {
    const command = this.commands.bluetoothctl;
    if (!command) return { available: false, reason: 'Bluetooth needs BlueZ and bluetoothctl.', toggle: unavailable('BlueZ is unavailable.'), devices: [], settings };
    try {
      const [controller, pairedOutput, connectedOutput] = await Promise.all([
        this.command(command, ['--timeout', '3', 'show']), this.command(command, ['--timeout', '3', 'devices', 'Paired']), this.command(command, ['--timeout', '3', 'devices', 'Connected']),
      ]);
      const address = /^Controller ((?:[0-9A-F]{2}:){5}[0-9A-F]{2})(?:\s|$)/im.exec(controller)?.[1];
      if (!address) throw new Error('No supported Bluetooth controller was reported.');
      const powered = booleanProperty(controller, 'Powered');
      const name = /^\s*Alias:\s*(.+)$/m.exec(controller)?.[1] ?? /^\s*Name:\s*(.+)$/m.exec(controller)?.[1] ?? address;
      const paired = bluetoothDevices(pairedOutput), connected = bluetoothDevices(connectedOutput);
      const toggle = { available: true, requiresAuthorization: true };
      return { available: true, controller: { address: address.toUpperCase(), name: safeText(name), powered }, toggle,
        reason: paired.size > MAX_DEVICES ? `Showing the first ${MAX_DEVICES} paired devices. Open Bluetooth settings for the complete list.` : undefined,
        devices: [...paired].slice(0, MAX_DEVICES).map(([device, label]) => ({ address: device, name: label, paired: true, connected: connected.has(device),
          connect: !powered ? unavailable('Turn on Bluetooth before connecting.') : connected.has(device) ? unavailable('This device is already connected.') : { available: true, requiresAuthorization: true },
          disconnect: !powered ? unavailable('Bluetooth is turned off.') : connected.has(device) ? { available: true, requiresAuthorization: true } : unavailable('This device is not connected.') })), settings };
    } catch (error) { const reason = safeText((error as Error).message); return { available: false, reason, toggle: unavailable(reason), devices: [], settings }; }
  }
  private async readPower(settings: GuideSystemCapability): Promise<GuidePowerState> {
    const actions = Object.fromEntries(powerActions.map(action => [action, unavailable('The desktop power service is unavailable.')])) as GuidePowerState['actions'];
    this.lockTarget = undefined; this.logoutAvailable = false;
    if (!this.commands.gdbus) return { available: false, reason: 'Power controls need gdbus and the desktop/logind services.', actions, settings };
    await Promise.all((['suspend', 'reboot', 'poweroff'] as const).map(async action => {
      try {
        const method = { suspend: 'CanSuspend', reboot: 'CanReboot', poweroff: 'CanPowerOff' }[action];
        const result = await this.dbus('system', 'org.freedesktop.login1', '/org/freedesktop/login1', `org.freedesktop.login1.Manager.${method}`);
        actions[action] = permission(/^\('([^']+)',\)\s*$/.exec(result)?.[1], action);
      } catch (error) { actions[action] = unavailable(safeText((error as Error).message)); }
    }));
    const [freedesktopLock, gnomeLock, gnomeSession] = await Promise.all([this.nameOwned('org.freedesktop.ScreenSaver'), this.nameOwned('org.gnome.ScreenSaver'), this.nameOwned('org.gnome.SessionManager')]);
    if (freedesktopLock) this.lockTarget = { service: 'org.freedesktop.ScreenSaver', object: '/org/freedesktop/ScreenSaver' };
    else if (gnomeLock) this.lockTarget = { service: 'org.gnome.ScreenSaver', object: '/org/gnome/ScreenSaver' };
    if (this.lockTarget) actions.lock = available();
    else actions.lock = unavailable('No supported screen-lock service is running.');
    this.logoutAvailable = gnomeSession;
    actions.logout = gnomeSession ? available() : unavailable('Normal logout needs a supported running desktop session manager.');
    const any = Object.values(actions).some(value => value.available);
    return { available: any, reason: any ? undefined : 'No permitted desktop power action was reported.', actions, settings };
  }
  async readState(): Promise<GuideSystemState> {
    if (this.platform !== 'linux') return unavailableGuideSystem('These system controls are available on supported Linux desktops.', this.platform);
    try {
      const [nmcli, bluetoothctl, gdbus] = await Promise.all(['nmcli', 'bluetoothctl', 'gdbus'].map(name => this.resolver(name)));
      this.commands = { nmcli, bluetoothctl, gdbus };
      const settings = await this.settingsCapabilities();
      const [network, bluetooth, power] = await Promise.all([this.readNetwork(settings.network), this.readBluetooth(settings.bluetooth), this.readPower(settings.power)]);
      return { platform: this.platform, sampledAt: this.now().toISOString(), network, bluetooth, power };
    } catch (error) { return unavailableGuideSystem(safeText((error as Error).message), this.platform); }
  }
  async openSettings(section: GuideSystemSettingsSection): Promise<GuideSystemActionResult> { return this.execute({ type: 'open-settings', section }); }
  async execute(action: GuideSystemAction): Promise<GuideSystemActionResult> {
    try { validateAction(action); }
    catch (error) { return { ok: false, error: (error as Error).message, state: unavailableGuideSystem('Invalid system request.', this.platform) }; }
    if (this.busy) return { ok: false, error: 'Another system action is still running.', state: await this.readState() };
    this.busy = true;
    let before = unavailableGuideSystem('System state has not been sampled.', this.platform);
    let transferStateMayHaveChanged = false;
    try {
      before = await this.readState();
      let capability: GuideSystemCapability;
      if (action.type === 'open-settings') capability = before[action.section].settings;
      else if (action.type === 'wifi') capability = before.network.wifi?.toggle ?? unavailable(before.network.reason ?? 'Wi-Fi is unavailable.');
      else if (action.type === 'bluetooth') capability = before.bluetooth.toggle;
      else if (action.type === 'power') capability = before.power.actions[action.action];
      else {
        const device = before.bluetooth.devices.find(device => device.address === action.address.toUpperCase());
        capability = device ? action.connected ? device.connect : device.disconnect : unavailable('Only a currently paired Bluetooth device can be connected or disconnected.');
      }
      if (!capability.available) throw new Error(capability.reason || 'This system action is unavailable.');
      if (action.type === 'open-settings') {
        const target = this.targets[action.section];
        if (!target) throw new Error('Desktop settings are unavailable.');
        await this.opener(target.command, target.args, { timeoutMs: READ_TIMEOUT, maxBuffer: MAX_OUTPUT, env: this.environment });
        return { ok: true, state: before };
      }
      if (action.type === 'power') {
        if (action.action === 'lock') {
          if (!this.lockTarget) throw new Error('Screen locking is unavailable.');
          this.beforePower?.(action.action);
          await this.dbus('session', this.lockTarget.service, this.lockTarget.object, `${this.lockTarget.service}.Lock`, [], true);
        } else if (action.action === 'logout') {
          if (!this.logoutAvailable) throw new Error('Normal desktop logout is unavailable.');
          // Mode 0 retains the desktop's normal confirmation and application inhibitors. Never force-kill a session.
          this.beforePower?.(action.action);
          await this.dbus('session', 'org.gnome.SessionManager', '/org/gnome/SessionManager', 'org.gnome.SessionManager.Logout', ['0'], true);
        } else {
          const method = { suspend: 'Suspend', reboot: 'Reboot', poweroff: 'PowerOff' }[action.action];
          this.beforePower?.(action.action);
          await this.dbus('system', 'org.freedesktop.login1', '/org/freedesktop/login1', `org.freedesktop.login1.Manager.${method}`, ['true'], true);
        }
        // A successful method reply means the OS accepted the request, not that shutdown/sleep completed.
        return { ok: true, state: before };
      }
      const command = action.type === 'wifi' ? this.commands.nmcli : this.commands.bluetoothctl;
      if (!command) throw new Error('The system command is unavailable.');
      if (action.type === 'bluetooth-device') {
        // Confirm the selected device itself remains paired; do not rely solely
        // on a list filter or a snapshot that may predate an external unpair.
        const address = action.address.toUpperCase();
        const info = await this.command(command, ['--timeout', '3', 'info', address]);
        const reported = /^Device ((?:[0-9A-F]{2}:){5}[0-9A-F]{2})(?:\s|$)/im.exec(info)?.[1].toUpperCase();
        if (reported !== address || !booleanProperty(info, 'Paired')) throw new Error('The selected Bluetooth device is no longer confirmed as paired. Open system Bluetooth settings to pair it.');
      }
      transferStateMayHaveChanged = true;
      const output = action.type === 'wifi'
        ? await this.command(command, ['--colors', 'no', '--wait', '10', 'radio', 'wifi', action.enabled ? 'on' : 'off'], true)
        : action.type === 'bluetooth'
          ? await this.command(command, ['--timeout', '10', 'power', action.enabled ? 'on' : 'off'], true)
          : await this.command(command, ['--timeout', '10', action.connected ? 'connect' : 'disconnect', action.address.toUpperCase()], true);
      if (/Failed to|org\.bluez\.Error\.|No default controller|Invalid command|not available/i.test(output)) throw new Error(safeText(output));
      const state = await this.readState();
      const observed = action.type === 'wifi' ? state.network.wifi?.enabled : action.type === 'bluetooth' ? state.bluetooth.controller?.powered
        : state.bluetooth.devices.find(device => device.address === action.address.toUpperCase())?.connected;
      const expected = action.type === 'bluetooth-device' ? action.connected : action.enabled;
      if (observed !== expected) return { ok: false, state, error: 'The service accepted the request, but the requested state was not observed. Refresh or open system settings.' };
      return { ok: true, state };
    } catch (error) {
      // A timeout or failed command can still have partially changed a radio/device.
      // Return a fresh observation instead of re-publishing the pre-action snapshot.
      return { ok: false, state: transferStateMayHaveChanged ? await this.readState() : before, error: safeText((error as Error).message) || 'The system action failed.' };
    }
    finally { this.busy = false; }
  }
}
