import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

let root: string | undefined;
afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); root = undefined; });

function launch(environment: NodeJS.ProcessEnv = {}, args = ['argument with spaces', "it's quoted", '', '$literal;value']) {
  root = mkdtempSync(path.join(os.tmpdir(), 'nexus-bootstrap-'));
  const app = path.join(root, "launcher with spaces and 'quote");
  mkdirSync(app);
  const wrapper = path.join(app, 'xodus-nexus');
  copyFileSync('scripts/launcher-font-wrapper.sh', wrapper);
  const capture = path.join(root, 'capture.jsonl');
  // This executable records both the Node font-bootstrap and final exec boundary.
  writeFileSync(path.join(app, 'xodus-nexus.bin'), `#!${process.execPath}
const fs = require('node:fs');
const bootstrap = process.argv[2]?.endsWith('/font-bootstrap/bootstrap.mjs');
const selected = ['LD_PRELOAD', 'LD_LIBRARY_PATH', 'SteamAppId', 'SteamGameId',
  'STEAM_COMPAT_APP_ID', 'DISPLAY', 'WAYLAND_DISPLAY', 'ELECTRON_RUN_AS_NODE',
  'FONTCONFIG_FILE', 'XODUS_NEXUS_FONTCONFIG', 'XODUS_NEXUS_FONTCONFIG_ORIGINAL',
  'XODUS_NEXUS_FONTCONFIG_ORIGINAL_SET', 'GTK_IM_MODULE', 'QT_IM_MODULE',
  'XDG_CURRENT_DESKTOP', 'XODUS_NEXUS_STEAM_IME'];
fs.appendFileSync(process.env.NEXUS_TEST_CAPTURE, JSON.stringify({
  bootstrap: !!bootstrap, pid: process.pid, args: process.argv.slice(2),
  env: Object.fromEntries(selected.map(key => [key, process.env[key] ?? null]))
}) + '\\n');
if (bootstrap) process.stdout.write(process.env.NEXUS_TEST_FONT_CONFIG || '');
else process.exitCode = Number(process.env.NEXUS_TEST_EXIT || 0);
`);
  chmodSync(path.join(app, 'xodus-nexus.bin'), 0o755);
  // A matching file must never cause wildcard tokens to expand.
  writeFileSync(path.join(root, 'custom1.so'), 'not a library');
  const env: NodeJS.ProcessEnv = { ...process.env, NEXUS_TEST_CAPTURE: capture };
  for (const key of ['LD_PRELOAD', 'ELECTRON_RUN_AS_NODE', 'FONTCONFIG_FILE',
    'XODUS_NEXUS_FONTCONFIG', 'XODUS_NEXUS_FONTCONFIG_ORIGINAL',
    'XODUS_NEXUS_FONTCONFIG_ORIGINAL_SET', 'GTK_IM_MODULE', 'QT_IM_MODULE',
    'XDG_CURRENT_DESKTOP', 'XODUS_NEXUS_STEAM_IME']) delete env[key];
  Object.assign(env, environment);
  const result = spawnSync('/bin/sh', [wrapper, ...args], { env, cwd: root, encoding: 'utf8', timeout: 10_000 });
  expect(result.error).toBeUndefined();
  const records = existsSync(capture) ? readFileSync(capture, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
  expect(records.length, result.stderr).toBeGreaterThan(0);
  return { result, records, main: records.at(-1), app, args };
}

describe('packaged Linux launcher bootstrap', () => {
  it.each(['gamescope', 'Gamescope', 'steam:GaMeScOpE'])
  ('selects simple IME before Electron starts only in Game Mode: %s', desktop => {
    const { records, main, args, result } = launch({ XDG_CURRENT_DESKTOP: desktop,
      GTK_IM_MODULE: 'Steam', QT_IM_MODULE: 'steam', SteamGameId: '456' });
    expect(result.status).toBe(0);
    for (const record of records) {
      expect(record.env.GTK_IM_MODULE).toBe('simple');
      expect(record.env.XODUS_NEXUS_STEAM_IME).toBe('1');
      expect(record.env.QT_IM_MODULE).toBe('steam');
      expect(record.env.SteamGameId).toBe('456');
    }
    expect(main.args).toEqual(args);
    expect(main.pid).toBe(result.pid);
  });

  it.each(['KDE', 'GNOME', 'KDE:gamescope-nested', 'notgamescope', ''])
  ('does not change desktop input even when Steam is running: %s', desktop => {
    const { main } = launch({ XDG_CURRENT_DESKTOP: desktop, GTK_IM_MODULE: 'Steam',
      SteamGameId: '456', XODUS_NEXUS_STEAM_IME: '1' });
    expect(main.env.GTK_IM_MODULE).toBe('Steam');
    expect(main.env.XODUS_NEXUS_STEAM_IME).toBeNull();
  });

  it.each([undefined, '', 'simple', 'ibus', 'fcitx', 'steam', 'Steam;$(false)'])
  ('preserves custom or unset IME in Game Mode: %j', ime => {
    const { main } = launch({ XDG_CURRENT_DESKTOP: 'gamescope', GTK_IM_MODULE: ime });
    expect(main.env.GTK_IM_MODULE).toBe(ime ?? null);
    expect(main.env.XODUS_NEXUS_STEAM_IME).toBeNull();
  });

  it('does not change native Node helper input or arguments', () => {
    const { records, main } = launch({ ELECTRON_RUN_AS_NODE: '1',
      XDG_CURRENT_DESKTOP: 'gamescope', GTK_IM_MODULE: 'Steam' }, ['--native-helper']);
    expect(records).toHaveLength(1);
    expect(main.env.GTK_IM_MODULE).toBe('Steam');
    expect(main.env.XODUS_NEXUS_STEAM_IME).toBeNull();
    expect(main.args).toEqual(['--native-helper']);
  });

  it('preserves an unset preload, arguments, exit code and exec process identity', () => {
    const { result, main, args, records } = launch({ NEXUS_TEST_EXIT: '37' });
    expect(result.status).toBe(37);
    expect(main.env.LD_PRELOAD).toBeNull();
    expect(main.args).toEqual(args);
    expect(main.pid).toBe(result.pid);
    expect(records).toHaveLength(2);
  });

  it.each(['', '  :: ', '/custom/libMangoHud.so', 'custom[12].so:$ORIGIN/$LIB/custom.so', '/literal/trailing\n'])
  ('leaves non-overlay preload bytes unchanged: %j', preload => {
    const { main, result } = launch({ LD_PRELOAD: preload });
    expect(result.status).toBe(0);
    expect(main.env.LD_PRELOAD).toBe(preload);
  });

  it.each(['gameoverlayrenderer.so', '/steam/ubuntu12_32/gameoverlayrenderer.so /steam/ubuntu12_64/gameoverlayrenderer.so',
    ':/steam/ubuntu12_64/gameoverlayrenderer.so::gameoverlayrenderer.so:'])
  ('removes every Steam overlay before both Electron invocations: %j', preload => {
    const { records, result } = launch({ LD_PRELOAD: preload });
    expect(result.status).toBe(0);
    expect(records).toHaveLength(2);
    for (const record of records) expect(record.env.LD_PRELOAD).toBeNull();
  });

  it('keeps other library order and loader tokens with mixed delimiters', () => {
    const { records } = launch({ LD_PRELOAD: '/custom/libMangoHud.so :/steam/gameoverlayrenderer.so::$ORIGIN/$LIB/custom.so custom[12].so' });
    for (const record of records)
      expect(record.env.LD_PRELOAD).toBe('/custom/libMangoHud.so:$ORIGIN/$LIB/custom.so:custom[12].so');
  });

  it('matches only the exact overlay basename, not substrings or directory names', () => {
    const retained = '/gameoverlayrenderer.so/custom.so:/custom/gameoverlayrenderer.so.old:libgameoverlayrenderer.so';
    const { main } = launch({ LD_PRELOAD: `${retained}:/steam/gameoverlayrenderer.so` });
    expect(main.env.LD_PRELOAD).toBe(retained);
  });

  it('never evaluates shell syntax or expands globbed preload entries', () => {
    const retained = '$(touch${IFS}unexpected-file):custom*.so';
    const { main } = launch({ LD_PRELOAD: `${retained}:/steam/gameoverlayrenderer.so` });
    expect(main.env.LD_PRELOAD).toBe(retained);
    expect(existsSync(path.join(root!, 'unexpected-file'))).toBe(false);
  });

  it('retains Steam tracking and display/library environment without adding sandbox flags', () => {
    const env = { LD_PRELOAD: '/steam/gameoverlayrenderer.so', LD_LIBRARY_PATH: '/custom/libs:/steam/libs',
      SteamAppId: '123', SteamGameId: '456', STEAM_COMPAT_APP_ID: '789', DISPLAY: ':1', WAYLAND_DISPLAY: 'gamescope-0' };
    const { main, args } = launch(env);
    for (const [key, value] of Object.entries(env)) if (key !== 'LD_PRELOAD') expect(main.env[key]).toBe(value);
    expect(main.args).toEqual(args);
    expect(main.args).not.toContain('--no-sandbox');
  });

  it('filters before native Node helper mode and skips font bootstrap as before', () => {
    const { records, main } = launch({ ELECTRON_RUN_AS_NODE: '1', LD_PRELOAD: '/steam/gameoverlayrenderer.so:/custom/keep.so' }, ['--native-helper']);
    expect(records).toHaveLength(1);
    expect(main.bootstrap).toBe(false);
    expect(main.args).toEqual(['--native-helper']);
    expect(main.env.ELECTRON_RUN_AS_NODE).toBe('1');
    expect(main.env.LD_PRELOAD).toBe('/custom/keep.so');
  });

  it('preserves font bootstrap and original user font configuration', () => {
    const { main, records } = launch({ LD_PRELOAD: '/steam/gameoverlayrenderer.so',
      FONTCONFIG_FILE: '/original/fonts.conf', NEXUS_TEST_FONT_CONFIG: '/private/fonts.conf' });
    expect(records[0].bootstrap).toBe(true);
    expect(records[0].env.FONTCONFIG_FILE).toBe('/original/fonts.conf');
    expect(main.env.FONTCONFIG_FILE).toBe('/private/fonts.conf');
    expect(main.env.XODUS_NEXUS_FONTCONFIG_ORIGINAL).toBe('/original/fonts.conf');
    expect(main.env.XODUS_NEXUS_FONTCONFIG_ORIGINAL_SET).toBe('x');
    expect(main.env.LD_PRELOAD).toBeNull();
  });
});
