import { execFile } from 'node:child_process';
import { constants, promises as fs } from 'node:fs';
import path from 'node:path';
import { externalLauncherEnvironment } from './launcher-environment.js';

/** Only a top-level Gamescope session needs this repair, not nested desktop games. */
export function gameModeDisplayEnvironment(environment: NodeJS.ProcessEnv, platform = process.platform): Record<string, string> | undefined {
  if (platform !== 'linux' || !environment.XDG_CURRENT_DESKTOP?.split(':').some(value => value.toLowerCase() === 'gamescope')) return;
  // Never publish an SSH/remote display or guess a display belonging to another session.
  if (!environment.DBUS_SESSION_BUS_ADDRESS || !/^:\d{1,5}(?:\.\d{1,3})?$/.test(environment.DISPLAY ?? '')) return;
  const authority = environment.XAUTHORITY ?? '';
  const wayland = environment.WAYLAND_DISPLAY ?? '';
  if (authority && (!path.isAbsolute(authority) || authority.length > 4096 || /[\x00-\x1f\x7f]/.test(authority))) return;
  if (wayland && (!/^[a-zA-Z0-9_.-]{1,255}$/.test(wayland) || wayland === '.' || wayland === '..')) return;
  // Empty values clear stale desktop-session endpoints instead of retaining a
  // dead Wayland socket or an old Xauthority file after switching to Game Mode.
  return { DISPLAY: environment.DISPLAY!, XAUTHORITY: authority, WAYLAND_DISPLAY: wayland };
}

/** Prepare graphical D-Bus activation before any backend keyring access. */
export async function prepareGameModeKeyring(environment: NodeJS.ProcessEnv = process.env,
  platform = process.platform): Promise<'skipped' | 'updated' | 'unavailable'> {
  const display = gameModeDisplayEnvironment(environment, platform);
  if (!display) return 'skipped';
  try {
    const number = display.DISPLAY.slice(1).split('.')[0];
    const socket = await fs.lstat(`/tmp/.X11-unix/X${number}`);
    if (!socket.isSocket() || socket.uid !== process.getuid?.()) return 'unavailable';
    if (display.XAUTHORITY) await fs.access(display.XAUTHORITY, constants.R_OK);
    if (display.WAYLAND_DISPLAY) {
      if (!environment.XDG_RUNTIME_DIR || !path.isAbsolute(environment.XDG_RUNTIME_DIR)) return 'unavailable';
      const wayland = await fs.lstat(path.join(environment.XDG_RUNTIME_DIR, display.WAYLAND_DISPLAY));
      if (!wayland.isSocket() || wayland.uid !== process.getuid?.()) return 'unavailable';
    }
    await new Promise<void>((resolve, reject) => {
      execFile('/usr/bin/dbus-update-activation-environment', ['--systemd',
        ...Object.entries(display).map(([key, value]) => `${key}=${value}`)], {
        env: externalLauncherEnvironment(environment), timeout: 2000, killSignal: 'SIGKILL', maxBuffer: 4096,
      }, error => error ? reject(error) : resolve());
    });
    return 'updated';
  } catch {
    // Keep normal launch/authentication error handling, never replace a keyring,
    // weaken its permissions or log subprocess output containing session data.
    return 'unavailable';
  }
}
