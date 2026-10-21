import { constants, promises as fs } from 'node:fs';
import path from 'node:path';
import { commandWords, normalizeLaunchTools, parseLaunchOptions } from '../shared/launch-tools.js';
import type { GameLaunchTools } from '../shared/types.js';

const quote = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`;

async function executable(command: string, env: NodeJS.ProcessEnv, cwd: string): Promise<string> {
  const candidates = command.includes('/') ? [path.resolve(cwd, command)] :
    (env.PATH ?? '').split(path.delimiter).filter(Boolean).map(dir => path.resolve(cwd, dir, command));
  for (const file of candidates) {
    try { if ((await fs.stat(file)).isFile()) { await fs.access(file, constants.X_OK); return file; } }
    catch { /* Try the next PATH entry. */ }
  }
  throw Error(`Launch tool "${command}" was not found or is not executable. Install it or disable it in this game's settings.`);
}

export interface GameWrapper { command: string; cleanup(): Promise<void> }

/** Inspect only wrapper syntaxes whose command position is known. An opaque
 * wrapper's filenames/arguments cannot prove that it invokes GameMode. */
function customRequestsGameMode(words: string[]): boolean {
  let index = 0;
  while (index < words.length) {
    const command = path.basename(words[index++]);
    if (command === 'gamemoderun') return true;
    if (command === 'env') {
      let options = true;
      while (index < words.length) {
        const word = words[index];
        if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) { index++; continue; }
        if (options && word === '--') { options = false; index++; continue; }
        if (options && ['-i', '--ignore-environment', '-0', '--null'].includes(word)) { index++; continue; }
        if (options && ['-u', '--unset', '-C', '--chdir'].includes(word)) {
          if (index + 1 >= words.length) return false;
          index += 2; continue;
        }
        if (options && /^(?:--unset|--chdir)=/.test(word)) { index++; continue; }
        if (options && word.startsWith('-')) return false;
        break;
      }
    } else if (command === 'mangohud') {
      if (words[index] === '--dlsym') index++;
      if (words[index]?.startsWith('-')) return false;
    } else if (command === 'gamescope') {
      const separator = words.indexOf('--', index);
      if (separator < 0) return false;
      index = separator + 1;
    } else return false;
  }
  return false;
}

/** Only wraps the game's Wine entry point. Auth, service, prefix setup and Stop stay outside. */
export async function prepareGameWrapper(wine: string, value: GameLaunchTools | undefined,
  root: string, env: NodeJS.ProcessEnv = process.env, cwd = process.cwd(), onWarning?: (message: string) => void): Promise<GameWrapper> {
  const tools = normalizeLaunchTools(value);
  const { prefix: custom, environment, gameArgs } = parseLaunchOptions(tools.launchOptions);
  if (tools.dualSenseCompatibility) {
    const disabled = environment.PROTON_DISABLE_HIDRAW ?? env.PROTON_DISABLE_HIDRAW ?? '';
    // Keep other device overrides and a deliberate all-device opt-out intact.
    environment.PROTON_DISABLE_HIDRAW = disabled === '1' || /0x054c\/0x0ce6/i.test(disabled)
      ? disabled : [disabled === '0' ? '' : disabled, '0x054c/0x0ce6'].filter(Boolean).join(',');
  }
  let gameModeCommand: string | undefined;
  // Existing custom wrappers keep their order and semantics. The opt-in adds
  // GameMode only once and only around the Wine payload, inside Gamescope.
  const customGameMode = customRequestsGameMode(custom);
  if (tools.gameMode && !customGameMode) {
    try { gameModeCommand = await executable('gamemoderun', env, cwd); }
    catch { onWarning?.('GameMode was requested, but gamemoderun was not found or is not executable. Starting this game without GameMode.'); }
  }
  if (!gameModeCommand && !tools.mangoHud && !tools.gamescope && custom.length === 0 && !Object.keys(environment).length && !gameArgs.length) return { command: wine, cleanup: async () => {} };
  const words: string[] = [];
  if (Object.keys(environment).length) words.push(await executable('env', env, cwd), ...Object.entries(environment).map(([key, value]) => `${key}=${value}`));
  if (custom.length) {
    words.push(await executable(custom[0], env, cwd), ...custom.slice(1));
  }
  if (tools.gamescope) {
    words.push(await executable('gamescope', env, cwd), ...commandWords(tools.gamescopeArgs));
    if (tools.mangoHud) {
      await executable('mangoapp', env, cwd);
      words.push('--mangoapp');
    }
    words.push('--');
  } else if (tools.mangoHud) words.push(await executable('mangohud', env, cwd));
  if (gameModeCommand) words.push(gameModeCommand);
  words.push(wine);
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const directory = await fs.mkdtemp(path.join(root, 'game-tools-'));
  const command = path.join(directory, 'wine-wrapper');
  const cleanup = () => fs.rm(directory, { recursive: true, force: true });
  try {
    await fs.writeFile(command, `#!/bin/sh\nexec ${words.map(quote).join(' ')} "$@" ${gameArgs.map(quote).join(' ')}\n`, { mode: 0o700, flag: 'wx' });
    return { command, cleanup };
  } catch (error) { await cleanup(); throw error; }
}
