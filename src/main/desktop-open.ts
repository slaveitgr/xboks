import { execFile } from 'node:child_process';
import { externalLauncherEnvironment, launcherSteamImeActive } from './launcher-environment.js';

/** Electron shell APIs cannot pass a child environment. Leave desktop behavior
 * unchanged; only the launcher IME fallback needs an explicit Linux opener. */
export async function openDesktopTarget(target: string, fallback: () => Promise<string | void>,
  environment: NodeJS.ProcessEnv = process.env): Promise<string | void> {
  if (!launcherSteamImeActive(environment)) return fallback();
  await new Promise<void>((resolve, reject) => {
    execFile('xdg-open', [target], { env: externalLauncherEnvironment(environment), maxBuffer: 16_384 },
      error => error ? reject(new Error('Could not open this item with the system application.')) : resolve());
  });
}
