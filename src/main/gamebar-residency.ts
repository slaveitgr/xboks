import { promises as fs } from 'node:fs';
import path from 'node:path';

/** A normal desktop launch can join the same persistent process that the user
 * enabled for login. Merely inspecting this never creates/enables a service. */
export async function gameBarServiceEnabled(configRoot: string): Promise<boolean> {
  const unit = path.join(configRoot, 'systemd/user/xboks-gamebar.service');
  const link = path.join(configRoot, 'systemd/user/graphical-session.target.wants/xboks-gamebar.service');
  try {
    const stat = await fs.lstat(unit);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.geteuid?.() || stat.size > 16_384) return false;
    if (!(await fs.readFile(unit, 'utf8')).startsWith('# X-Xboks-GameBar-Service=1\n')) return false;
    return (await fs.lstat(link)).isSymbolicLink() && await fs.realpath(link) === await fs.realpath(unit);
  } catch { return false; }
}

export class GameBarResidency {
  private enabled: boolean;
  constructor(args: readonly string[]) { this.enabled = args.includes('--gamebar-service'); }
  get active(): boolean { return this.enabled; }
  activate(): void { this.enabled = true; }
  /** Explicit Quit still exits. A window's close action only hides its UI. */
  keepsRunning(quitting: boolean): boolean { return this.enabled && !quitting; }
  shouldQuitWithoutWindows(platform: NodeJS.Platform, shortcutOnly: boolean): boolean {
    return platform !== 'darwin' && !shortcutOnly && !this.enabled;
  }
}
