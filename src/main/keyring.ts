import { execFile } from 'node:child_process';
import type { KeyringStatus } from '../shared/types.js';
import { externalLauncherEnvironment } from './launcher-environment.js';

type Execute = (command: string, args: string[]) => Promise<string>;
const secretService = 'org.freedesktop.secrets';
const busService = ['org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus'];
const serviceObject = '/org/freedesktop/secrets';
// KDE 6 can advertise its compatibility activation name rather than the
// standard name. Never start another provider when one already owns secrets.
const activationNames = [secretService, 'org.kde.secretservicecompat', 'org.kde.kwalletd6', 'org.kde.kwalletd5'];

/** Metadata only. No credential reads/writes, unlock requests or session changes. */
export class KeyringSupport {
  private checking?: Promise<KeyringStatus>;
  private starting?: Promise<KeyringStatus>;
  private readonly execute: Execute;
  private readonly gameMode: boolean;

  constructor(environment: NodeJS.ProcessEnv = process.env, execute?: Execute, private readonly platform = process.platform) {
    this.gameMode = Boolean(environment.XDG_CURRENT_DESKTOP?.split(':').some(s => s.toLowerCase() === 'gamescope'));
    const env = externalLauncherEnvironment(environment);
    this.execute = execute ?? ((command, args) => new Promise((resolve, reject) => {
      execFile(command, args, { env, timeout: 3500, killSignal: 'SIGKILL', maxBuffer: 128_000 }, (error, stdout) => {
        // Provider stderr and config paths never cross the renderer boundary.
        if (error) reject(new Error('Keyring metadata check unavailable.'));
        else resolve(stdout);
      });
    }));
  }

  check(): Promise<KeyringStatus> {
    if (this.starting) return this.starting;
    return this.checking ??= this.inspect().then(r => r.status).finally(() => { this.checking = undefined; });
  }

  start(): Promise<KeyringStatus> {
    return this.starting ??= (async () => {
      if (this.checking) await this.checking;
      const before = await this.inspect();
      if (!before.target || !before.status.canStart) return before.status;
      try {
        // Only explicit UI action reaches activation. Never enable a disabled
        // wallet, replace a provider, create a collection or weaken a password.
        const reply = await this.bus('u', [...busService, 'StartServiceByName', 'su', before.target, '0']);
        if (reply !== 1 && reply !== 2) throw Error('Unexpected activation reply');
        const after = await this.inspect();
        return after.status.state === 'stopped'
          ? this.status('unavailable', 'The keyring did not become available. Open your desktop wallet settings, then check again.') : after.status;
      } catch {
        return this.status('unavailable', 'The installed keyring could not be started. Open your desktop wallet settings, enable and unlock it, then check again.');
      }
    })().finally(() => { this.starting = undefined; });
  }

  private status(state: KeyringStatus['state'], message: string, canStart = false): KeyringStatus {
    return { state, message, canStart, gameMode: this.gameMode };
  }

  private async bus(type: string, args: string[]): Promise<unknown> {
    const raw = await this.execute('busctl', ['--user', '--json=short', '--auto-start=no', '--allow-interactive-authorization=no', '--timeout=2s', 'call', ...args]);
    const response = JSON.parse(raw) as { type?: unknown; data?: unknown };
    if (response.type !== type || !Array.isArray(response.data) || response.data.length !== 1) throw Error('Unexpected metadata reply');
    return response.data[0];
  }

  private async inspect(): Promise<{ status: KeyringStatus; target?: string }> {
    if (this.platform !== 'linux') return { status: this.status('unavailable', 'System-keyring setup is available on Linux.') };
    try {
      const owned = await this.bus('b', [...busService, 'NameHasOwner', 's', secretService]);
      if (typeof owned !== 'boolean') throw Error('Invalid owner');
      if (owned) {
        const collection = await this.bus('o', [secretService, serviceObject, 'org.freedesktop.Secret.Service', 'ReadAlias', 's', 'default']);
        if (typeof collection !== 'string' || !/^\/(?:[A-Za-z0-9_]+\/?)*$/.test(collection)) throw Error('Invalid collection');
        if (collection === '/') return { status: this.status('needs-setup', 'The keyring is running, but has no default wallet. Complete wallet setup in Desktop Mode, then check again.') };
        const property = await this.bus('v', [secretService, collection, 'org.freedesktop.DBus.Properties', 'Get', 'ss', 'org.freedesktop.Secret.Collection', 'Locked']);
        // busctl represents a variant as a nested typed value.
        const value = property as { type?: unknown; data?: unknown };
        if (value?.type !== 'b' || typeof value.data !== 'boolean') throw Error('Invalid lock state');
        return { status: value.data
          ? this.status('locked', 'Your default wallet is locked. Unlock it in Desktop Mode, then check again. Keep its password enabled.')
          : this.status('ready', 'The default system wallet is running and unlocked. Sign-in will still verify that credentials can be saved.') };
      }
      const names = await this.bus('as', [...busService, 'ListActivatableNames']);
      if (!Array.isArray(names) || names.some(name => typeof name !== 'string')) throw Error('Invalid service list');
      const target = activationNames.find(name => names.includes(name));
      if (target?.startsWith('org.kde.')) {
        for (const command of ['kreadconfig6', 'kreadconfig5']) {
          try {
            const groups = target === 'org.kde.secretservicecompat' ? [['KSecretD', 'Enabled'], ['org.freedesktop.secrets', 'apiEnabled']] : [['Wallet', 'Enabled']];
            for (const [group, key] of groups) {
              const enabled = (await this.execute(command, ['--file', 'kwalletrc', '--group', group, '--key', key, '--default', 'UNSET'])).trim();
              if (/^(false|0)$/i.test(enabled)) return { status: this.status('disabled', 'KDE Wallet or its Secret Service is disabled. In Desktop Mode, open System Settings > KDE Wallet, enable the wallet subsystem and unlock your wallet. Then check again.') };
            }
            break;
          } catch { /* Older/non-KDE desktops may have no KConfig tools. */ }
        }
      }
      if (target) return { target, status: this.status('stopped', 'An installed keyring can be started for your user session. This does not change wallet passwords or security settings.', true) };
      return { status: this.status('missing', 'No compatible Secret Service is running or available for activation. Install or enable your desktop keyring provider, then check again.') };
    } catch {
      return { status: this.status('unavailable', 'Keyring status could not be checked. Ensure your user D-Bus session and busctl are available, and that your desktop wallet is enabled and unlocked.') };
    }
  }
}
