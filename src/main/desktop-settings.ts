import { constants, promises as fs } from 'node:fs';
import path from 'node:path';
import type { DesktopSettingsStatus, Settings } from '../shared/types.js';

const autostartName = 'gr.slave.xboks.desktop';
const startupKeys = ['launchOnLogin', 'launchInBackground', 'minimizeToTray'] as const;

export function desktopConfigRoot(environment: NodeJS.ProcessEnv, home: string): string {
  const configured = environment.XDG_CONFIG_HOME;
  return configured && path.isAbsolute(configured) ? configured : path.join(home, '.config');
}

export function desktopSession(environment: NodeJS.ProcessEnv): Pick<DesktopSettingsStatus,
  'fullscreenExperience' | 'fullscreenExperienceSource' | 'sessionType' | 'desktop'> {
  // A fullscreen BrowserWindow or a gaming-oriented desktop name is not an OS FSE session.
  const fullscreenExperience = environment.XBOKS_FULLSCREEN_EXPERIENCE === '1';
  return {
    fullscreenExperience,
    fullscreenExperienceSource: fullscreenExperience ? 'environment' : 'none',
    sessionType: environment.XDG_SESSION_TYPE || undefined,
    desktop: environment.XDG_CURRENT_DESKTOP || undefined,
  };
}

/** Probe existing directories only. Merely opening Settings must not create autostart files. */
export async function inspectDesktopSettings(configRoot: string, environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform): Promise<DesktopSettingsStatus> {
  const session = desktopSession(environment);
  if (platform !== 'linux') return { ...session, canSetAutostart: false, autostartReason: 'Desktop autostart is available on Linux.' };
  try {
    if (!path.isAbsolute(configRoot)) throw new Error('The desktop configuration path must be absolute.');
    let directory = path.join(configRoot, 'autostart');
    for (;;) {
      try {
        if (!(await fs.stat(directory)).isDirectory()) throw new Error('The autostart path is not a directory.');
        await fs.access(directory, constants.W_OK | constants.X_OK);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        const parent = path.dirname(directory);
        if (parent === directory) throw error;
        directory = parent;
      }
    }
    const file = path.join(configRoot, 'autostart', autostartName);
    try {
      const stat = await fs.lstat(file);
      if (!stat.isFile()) throw new Error('The XBOKS autostart entry is not a regular file.');
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    return { ...session, canSetAutostart: true };
  } catch (error) {
    return { ...session, canSetAutostart: false, autostartReason: `Autostart cannot be changed: ${(error as Error).message}` };
  }
}

export function autostartArguments(args: readonly string[], launchInBackground: boolean): string[] {
  return [...args.filter(argument => argument !== '--background'), ...(launchInBackground ? ['--background'] : [])];
}

export function backgroundStartupRequested(args: readonly string[], session: Pick<DesktopSettingsStatus, 'fullscreenExperience'>): boolean {
  return args.includes('--background') && !session.fullscreenExperience;
}

/** Keep a tray for every running launcher. Closing to it remains a separate preference. */
export async function startDesktopLauncher(args: readonly string[], session: Pick<DesktopSettingsStatus, 'fullscreenExperience'>, launcher: {
  ensureTray: () => void;
  show: () => Promise<void>;
  background: () => Promise<void>;
  trayUnavailable: (error: unknown) => void;
}): Promise<void> {
  let trayAvailable = true;
  try { launcher.ensureTray(); }
  catch (error) { trayAvailable = false; launcher.trayUnavailable(error); }
  // A tray construction failure must not strand an explicitly hidden launcher.
  if (!backgroundStartupRequested(args, session) || !trayAvailable) { await launcher.show(); return; }
  await launcher.background();
}

/** Desktop Entry quoting differs from shell quoting: values are never executed through a shell. */
export function desktopExec(args: string[]): string {
  return args.map(value => '"' + value.replace(/[%]/g, '%%').replace(/[\\"`$]/g, '\\$&').replace(/[\r\n]/g, '') + '"').join(' ');
}
export async function setAutostart(configRoot: string, args: string[], enabled: boolean): Promise<void> {
  const file = path.join(configRoot, 'autostart', autostartName);
  if (!enabled) { await fs.rm(file, { force: true }); return; }
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await fs.writeFile(temporary, `[Desktop Entry]\nType=Application\nName=XBOKS\nExec=${desktopExec(args)}\nTerminal=false\nX-GNOME-Autostart-enabled=true\n`, { mode: 0o600 });
  await fs.rename(temporary, file);
}

interface DesktopSettingsUpdate {
  status: DesktopSettingsStatus;
  configRoot: string;
  launchArguments: readonly string[];
  ensureTray: () => void;
  releaseTray: () => void;
  hasTray: () => boolean;
  persist: (patch: Partial<Settings>) => Promise<Settings>;
}

/** Apply OS changes and the saved preference as one operation, undoing OS changes if saving fails. */
export async function applyDesktopSettings(current: Settings, patch: Partial<Settings>, update: DesktopSettingsUpdate): Promise<Settings> {
  const changed = (key: typeof startupKeys[number]) => typeof patch[key] === 'boolean' && patch[key] !== (current[key] === true);
  if (startupKeys.some(changed) && update.status.fullscreenExperience) throw new Error('Startup and tray options are managed by the Fullscreen Experience session.');
  if (changed('launchOnLogin') && !update.status.canSetAutostart) throw new Error(update.status.autostartReason || 'Desktop autostart cannot be changed.');
  const nextAutostart = patch.launchOnLogin ?? current.launchOnLogin ?? false;
  if (changed('launchInBackground') && (!nextAutostart || !update.status.canSetAutostart)) throw new Error('Enable desktop autostart before changing launch in background.');
  const changeAutostart = changed('launchOnLogin') || (changed('launchInBackground') && nextAutostart);
  const file = path.join(update.configRoot, 'autostart', autostartName);
  let previousFile: Buffer | undefined;
  let previousMode = 0o600;
  if (changeAutostart) {
    try {
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.size > 64 * 1024) throw new Error('The existing XBOKS autostart entry cannot be safely updated.');
      previousMode = stat.mode & 0o777;
      previousFile = await fs.readFile(file);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  const hadTray = update.hasTray();
  let autostartTouched = false;
  let trayTouched = false;
  try {
    if (changeAutostart) {
      autostartTouched = true;
      await setAutostart(update.configRoot, autostartArguments(update.launchArguments, patch.launchInBackground ?? current.launchInBackground ?? false), nextAutostart);
    }
    if (changed('minimizeToTray') && patch.minimizeToTray) {
      trayTouched = true;
      update.ensureTray();
    }
    return await update.persist(patch);
  } catch (error) {
    const failures: string[] = [];
    if (autostartTouched) {
      try {
        if (previousFile === undefined) await fs.rm(file, { force: true });
        else {
          const temporary = `${file}.tmp`;
          await fs.writeFile(temporary, previousFile, { mode: previousMode });
          await fs.chmod(temporary, previousMode);
          await fs.rename(temporary, file);
        }
      } catch (rollback) { failures.push(`autostart: ${(rollback as Error).message}`); }
    }
    if (trayTouched) {
      try { if (hadTray) update.ensureTray(); else update.releaseTray(); }
      catch (rollback) { failures.push(`tray: ${(rollback as Error).message}`); }
    }
    if (failures.length) throw new Error(`${(error as Error).message}; could not restore ${failures.join('; ')}`);
    throw error;
  }
}
export async function batteryPercentage(root = '/sys/class/power_supply'): Promise<number | null> {
  try {
    const values = await Promise.all((await fs.readdir(root)).map(async entry => {
      const directory = path.join(root, entry);
      try {
        if ((await fs.readFile(path.join(directory, 'type'), 'utf8')).trim() !== 'Battery') return null;
        const value = Number((await fs.readFile(path.join(directory, 'capacity'), 'utf8')).trim());
        return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
      } catch { return null; }
    }));
    const batteries = values.filter((value): value is number => value !== null);
    return batteries.length ? Math.round(batteries.reduce((sum, value) => sum + value, 0) / batteries.length) : null;
  } catch { return null; }
}
