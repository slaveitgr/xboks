import { execFile } from 'node:child_process';
import { constants, promises as fs } from 'node:fs';
import path from 'node:path';
import { externalLauncherEnvironment } from './launcher-environment.js';
import { findSteamLaunches, readSteamShortcuts, writeSteamArtwork, type SteamLaunch } from './steam-shortcuts.js';

let importing = false;
const sentinel = '/tmp/addnonsteamgamefile';
const runUri = (appid: number) => `steam://rungameid/${(BigInt(appid) << 32n) | 0x02000000n}`;

export async function requestSteamImport(file: string): Promise<void> {
  if (!path.isAbsolute(file) || /[\0\r\n]/.test(file) || !file.endsWith('.desktop')) throw Error('Invalid Steam import launcher.');
  const source = await fs.lstat(file);
  if (!source.isFile() || source.uid !== process.getuid?.() || (source.mode & 0o022)) throw Error('Unsafe Steam import launcher.');
  // Match SteamOS's native add-to-steam handshake. Never truncate/follow an
  // unrelated file at the fixed sentinel path, and let Steam consume it.
  const handle = await fs.open(sentinel, constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.uid !== process.getuid?.() || stat.nlink !== 1 || stat.size !== 0 || (stat.mode & 0o022)) throw Error('Unsafe Steam import handshake file.');
    const now = new Date(); await handle.utimes(now, now);
  } finally { await handle.close(); }
  await new Promise<void>((resolve, reject) => {
    execFile('/usr/bin/steam', ['steam://addnonsteamgame/' + encodeURIComponent(file)], {
      env: externalLauncherEnvironment(), timeout: 5000, killSignal: 'SIGKILL', maxBuffer: 8192,
    }, error => error ? reject(Error('Could not send the shortcut to the running Steam client.')) : resolve());
  });
}

/** Steam owns its live shortcut database. Read back its actual assigned ID
 * before writing optional artwork, never manufacture a successful import. */
export async function addLiveSteamShortcut(configs: string[], launch: SteamLaunch, desktop: string,
  artwork: { cover?: Buffer; wide?: Buffer }, request = requestSteamImport, confirmationMs = 15000,
  chooseExisting?: (profiles: string[]) => Promise<string | undefined>): Promise<string> {
  if (importing) throw Error('Another Steam import is in progress. Please wait.');
  importing = true;
  try {
    const accounts = [...new Set(configs)];
    if (!accounts.length) throw Error('No native Steam profile found. Open Steam and sign in first.');
    const lookup = async (config: string) => {
      const bytes = await readSteamShortcuts(path.join(config, 'shortcuts.vdf'));
      return bytes ? findSteamLaunches(bytes, launch) : [];
    };
    const before = new Map<string, number[]>();
    for (const config of accounts) before.set(config, await lookup(config));
    const existing = accounts.filter(config => before.get(config)!.length);
    if (existing.length) {
      // A saved shortcut is not proof that its profile is currently signed in.
      // Explicitly let the user reuse it, or request a new import in Steam's
      // current session. Never infer identity from auto-login preferences.
      if (!chooseExisting) throw Error('A shortcut already exists. Choose a Steam profile to reuse it.');
      const selected = await chooseExisting(existing);
      if (selected !== undefined) {
        if (!existing.includes(selected)) throw Error('Invalid Steam profile selection.');
        const appid = (await lookup(selected))[0];
        if (appid === undefined) throw Error('The existing Steam shortcut changed. Try Add to Steam again.');
        await writeSteamArtwork(selected, appid, artwork);
        return runUri(appid);
      }
    }
    await request(desktop);
    const deadline = performance.now() + Math.min(15000, Math.max(0, confirmationMs));
    do {
      const added: { config: string; appid: number }[] = [];
      let complete = true;
      for (const config of accounts) {
        try {
          for (const appid of await lookup(config)) if (!before.get(config)!.includes(appid)) added.push({ config, appid });
        } catch { complete = false; /* Steam may be mid-write. Retry reads only. */ }
      }
      if (complete && added.length > 1) {
        const profiles = [...new Set(added.map(match => match.config))];
        if (chooseExisting && profiles.length === added.length) {
          const selected = await chooseExisting(profiles);
          const match = added.find(entry => entry.config === selected);
          if (match) {
            await writeSteamArtwork(match.config, match.appid, artwork);
            return runUri(match.appid);
          }
        }
        throw Error('Steam changed more than one matching shortcut. Check Steam, then try Add to Steam again.');
      }
      if (complete && added.length === 1) {
        await writeSteamArtwork(added[0].config, added[0].appid, artwork);
        return runUri(added[0].appid);
      }
      if (performance.now() >= deadline) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    } while (performance.now() < deadline);
    throw Error('Steam has not confirmed the shortcut yet. Check Steam, then try Add to Steam again.');
  } finally { importing = false; }
}
