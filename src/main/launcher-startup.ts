import path from 'node:path';

/** Preserve the packaged font/preload wrapper when creating future launch entries. */
export function launcherExecutablePath(executable: string, packaged: boolean): string {
  const name = path.basename(executable);
  return packaged && (name === 'xboks.bin' || name === 'xodus-nexus.bin')
    ? path.join(path.dirname(executable), name.slice(0, -4)) : executable;
}

/** A locked wallet must never keep the whole launcher behind Steam's spinner. */
export async function showBeforeAccountCheck(show: () => Promise<void>, refresh: () => Promise<unknown>, failed: () => void): Promise<void> {
  await show();
  // Deliberately not awaited. A native wallet prompt must not hide the launcher.
  void Promise.resolve().then(refresh).catch(failed);
}
