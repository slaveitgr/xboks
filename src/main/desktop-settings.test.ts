import { afterEach, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { applyDesktopSettings, autostartArguments, backgroundStartupRequested, batteryPercentage, desktopConfigRoot, desktopExec, desktopSession, inspectDesktopSettings, setAutostart, startDesktopLauncher } from './desktop-settings';
import type { Settings } from '../shared/types';

const directories: string[] = [];
async function temporaryRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xboks-desktop-test-'));
  directories.push(root); return root;
}
afterEach(async () => { await Promise.all(directories.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
const preferences: Settings = {
  installRoot: '/unused', market: 'neutral', parallelDownloads: 4, winePath: '',
  externalXodusRoot: '', runtimeRoot: '/unused', verboseLogs: false,
  launchOnLogin: false, launchInBackground: false, minimizeToTray: false,
};
function transaction(configRoot: string, current: Settings = preferences) {
  let tray = false;
  return {
    status: { canSetAutostart: true, fullscreenExperience: false, fullscreenExperienceSource: 'none' as const },
    configRoot, launchArguments: ['/test/Electron', '/test/source'],
    hasTray: () => tray,
    ensureTray: vi.fn(() => { tray = true; }),
    releaseTray: vi.fn(() => { tray = false; }),
    persist: vi.fn(async (patch: Partial<Settings>) => ({ ...current, ...patch })),
  };
}

it('writes and removes only the xboks autostart entry, preserving unrelated entries', async () => {
  const root = await temporaryRoot();
  await fs.mkdir(path.join(root, 'autostart')); await fs.writeFile(path.join(root, 'autostart', 'other.desktop'), 'keep');
  await setAutostart(root, ['/tmp/My App/xboks', '/tmp/source'], true);
  const content = await fs.readFile(path.join(root, 'autostart', 'gr.slave.xboks.desktop'), 'utf8');
  expect(content).toContain('Exec="/tmp/My App/xboks" "/tmp/source"');
  await setAutostart(root, [], false);
  expect(await fs.readdir(path.join(root, 'autostart'))).toEqual(['other.desktop']);
});
it('escapes desktop entry field codes and reserved characters without shell execution', () => {
  expect(desktopExec(['/tmp/100%/app', '$HOME', 'a"b', '`id`'])).toBe('"/tmp/100%%/app" "\\$HOME" "a\\"b" "\\`id\\`"');
});
it('adds a single background flag to autostart, independently of the executable/source arguments', () => {
  expect(autostartArguments(['/App Image/xboks'], true)).toEqual(['/App Image/xboks', '--background']);
  expect(autostartArguments(['/Electron', '/source', '--background'], true)).toEqual(['/Electron', '/source', '--background']);
  expect(autostartArguments(['/Electron', '/source', '--background'], false)).toEqual(['/Electron', '/source']);
});
it('recognizes only the explicit OS Fullscreen Experience signal, preserving actual desktop facts', () => {
  const gamingDesktop = { XDG_SESSION_TYPE: 'wayland', XDG_CURRENT_DESKTOP: 'gamescope', STEAM_GAMEPADUI: '1' };
  expect(desktopSession(gamingDesktop)).toEqual({ fullscreenExperience: false, fullscreenExperienceSource: 'none', sessionType: 'wayland', desktop: 'gamescope' });
  for (const value of ['true', '0', '', undefined]) expect(desktopSession({ XBOKS_FULLSCREEN_EXPERIENCE: value }).fullscreenExperience).toBe(false);
  expect(desktopSession({ ...gamingDesktop, XBOKS_FULLSCREEN_EXPERIENCE: '1' })).toMatchObject({ fullscreenExperience: true, fullscreenExperienceSource: 'environment' });
  expect(backgroundStartupRequested(['--background'], { fullscreenExperience: true })).toBe(false);
  expect(backgroundStartupRequested(['--background'], { fullscreenExperience: false })).toBe(true);
  expect(backgroundStartupRequested([], { fullscreenExperience: false })).toBe(false);
});
it('uses an absolute XDG_CONFIG_HOME and falls back for invalid relative paths', () => {
  expect(desktopConfigRoot({ XDG_CONFIG_HOME: '/test/config' }, '/test/home')).toBe('/test/config');
  expect(desktopConfigRoot({ XDG_CONFIG_HOME: 'relative' }, '/test/home')).toBe('/test/home/.config');
});
it('keeps a tray for hidden, ordinary and OS FSE launches without changing visibility preferences', async () => {
  const order: string[] = [];
  const launcher = { ensureTray: vi.fn(() => { order.push('tray'); }), show: vi.fn(async () => { order.push('visible'); }), background: vi.fn(async () => { order.push('hidden'); }), trayUnavailable: vi.fn() };
  await startDesktopLauncher(['--background'], { fullscreenExperience: false }, launcher);
  expect(order).toEqual(['tray', 'hidden']); order.length = 0;
  await startDesktopLauncher([], { fullscreenExperience: false }, launcher);
  expect(order).toEqual(['tray', 'visible']); order.length = 0;
  await startDesktopLauncher(['--background'], { fullscreenExperience: true }, launcher);
  expect(order).toEqual(['tray', 'visible']);
});
it('falls back to a visible window when tray construction fails during background startup', async () => {
  const error = new Error('synthetic tray unavailable');
  const launcher = { ensureTray: () => { throw error; }, show: vi.fn(async () => {}), background: vi.fn(async () => {}), trayUnavailable: vi.fn() };
  await startDesktopLauncher(['--background'], { fullscreenExperience: false }, launcher);
  expect(launcher.show).toHaveBeenCalledOnce(); expect(launcher.background).not.toHaveBeenCalled();
  expect(launcher.trayUnavailable).toHaveBeenCalledWith(error);
});
it('still opens an ordinary launch when its desktop has no tray implementation', async () => {
  const launcher = { ensureTray: vi.fn(() => { throw Error('Unavailable tray host'); }), show: vi.fn(async () => {}), background: vi.fn(async () => {}), trayUnavailable: vi.fn() };
  await startDesktopLauncher([], { fullscreenExperience: false }, launcher);
  expect(launcher.show).toHaveBeenCalledOnce(); expect(launcher.background).not.toHaveBeenCalled();
  expect(launcher.trayUnavailable).toHaveBeenCalledOnce();
});
it('probes a writable existing ancestor without creating any configuration directories', async () => {
  const root = await temporaryRoot();
  const config = path.join(root, 'missing', 'config');
  expect(await inspectDesktopSettings(config, { XDG_SESSION_TYPE: 'x11' }, 'linux')).toMatchObject({ canSetAutostart: true, sessionType: 'x11' });
  expect(await fs.readdir(root)).toEqual([]);
  expect(await inspectDesktopSettings(config, {}, 'win32')).toMatchObject({ canSetAutostart: false });
  expect(await fs.readdir(root)).toEqual([]);
});
it('reports blocked desktop paths and nonregular entries as unavailable', async () => {
  const root = await temporaryRoot();
  await fs.writeFile(path.join(root, 'autostart'), 'not a directory');
  expect(await inspectDesktopSettings(root, {}, 'linux')).toMatchObject({ canSetAutostart: false });
  await fs.rm(path.join(root, 'autostart')); await fs.mkdir(path.join(root, 'autostart'));
  await fs.symlink('/does/not/exist', path.join(root, 'autostart', 'gr.slave.xboks.desktop'));
  expect(await inspectDesktopSettings(root, {}, 'linux')).toMatchObject({ canSetAutostart: false });
});
it('saves independent background preference and rewrites enabled autostart Exec with the new flag', async () => {
  const root = await temporaryRoot();
  await setAutostart(root, ['/test/Electron', '/test/source'], true);
  const current = { ...preferences, launchOnLogin: true };
  const update = transaction(root, current);
  expect(await applyDesktopSettings(current, { launchInBackground: true }, update)).toMatchObject({ launchOnLogin: true, launchInBackground: true });
  expect(await fs.readFile(path.join(root, 'autostart', 'gr.slave.xboks.desktop'), 'utf8')).toContain('Exec="/test/Electron" "/test/source" "--background"');
});
it('retains the background preference when disabling autostart and removes its desktop entry', async () => {
  const root = await temporaryRoot();
  await setAutostart(root, ['/test/xboks', '--background'], true);
  const current = { ...preferences, launchOnLogin: true, launchInBackground: true };
  expect(await applyDesktopSettings(current, { launchOnLogin: false }, transaction(root, current))).toMatchObject({ launchOnLogin: false, launchInBackground: true });
  await expect(fs.access(path.join(root, 'autostart', 'gr.slave.xboks.desktop'))).rejects.toMatchObject({ code: 'ENOENT' });
});
it('enforces the original disabled rules before creating files, tray icons or saved preferences', async () => {
  const root = await temporaryRoot();
  const fse = transaction(root); fse.status.fullscreenExperience = true;
  for (const patch of [{ launchOnLogin: true }, { launchInBackground: true }, { minimizeToTray: true }]) await expect(applyDesktopSettings(preferences, patch, fse)).rejects.toThrow('Fullscreen Experience');
  expect(fse.persist).not.toHaveBeenCalled(); expect(fse.ensureTray).not.toHaveBeenCalled();
  const unavailable = transaction(root); unavailable.status.canSetAutostart = false;
  await expect(applyDesktopSettings(preferences, { launchOnLogin: true }, unavailable)).rejects.toThrow('autostart');
  await expect(applyDesktopSettings(preferences, { launchInBackground: true }, transaction(root))).rejects.toThrow('Enable desktop autostart');
  expect(await fs.readdir(root)).toEqual([]);
  // An unchanged preference and an unrelated display setting remain writable in FSE.
  await applyDesktopSettings(preferences, { launchOnLogin: false, downloadSpeedUnit: 'bits' }, fse);
  expect(fse.persist).toHaveBeenCalledOnce();
});
it('restores the exact prior autostart content, mode and tray state if persistence fails', async () => {
  const root = await temporaryRoot(); await fs.mkdir(path.join(root, 'autostart'));
  const file = path.join(root, 'autostart', 'gr.slave.xboks.desktop');
  const previous = '[Desktop Entry]\nExec="/old/version"\n# custom comment\n';
  await fs.writeFile(file, previous, { mode: 0o640 });
  const update = transaction(root, { ...preferences, launchOnLogin: true });
  update.persist.mockRejectedValueOnce(new Error('synthetic disk failure'));
  await expect(applyDesktopSettings({ ...preferences, launchOnLogin: true }, { launchInBackground: true, minimizeToTray: true }, update)).rejects.toThrow('synthetic disk failure');
  expect(await fs.readFile(file, 'utf8')).toBe(previous);
  expect((await fs.stat(file)).mode & 0o777).toBe(0o640);
  expect(update.hasTray()).toBe(false);
});
it('removes a newly created autostart entry if tray construction fails, without persisting a false success', async () => {
  const root = await temporaryRoot();
  const update = transaction(root); update.ensureTray.mockImplementationOnce(() => { throw new Error('synthetic tray unavailable'); });
  await expect(applyDesktopSettings(preferences, { launchOnLogin: true, launchInBackground: true, minimizeToTray: true }, update)).rejects.toThrow('synthetic tray unavailable');
  await expect(fs.access(path.join(root, 'autostart', 'gr.slave.xboks.desktop'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(update.persist).not.toHaveBeenCalled();
  expect(update.hasTray()).toBe(false);
});
it('retains the resident tray when disabling close-to-tray, including a failed preference save', async () => {
  const root = await temporaryRoot();
  const current = { ...preferences, minimizeToTray: true }; const update = transaction(root, current);
  update.ensureTray(); update.persist.mockRejectedValueOnce(new Error('synthetic save failure'));
  await expect(applyDesktopSettings(current, { minimizeToTray: false }, update)).rejects.toThrow('synthetic save failure');
  expect(update.hasTray()).toBe(true);
  expect(update.releaseTray).not.toHaveBeenCalled();
  expect(await applyDesktopSettings(current, { minimizeToTray: false }, update)).toMatchObject({ minimizeToTray: false });
  expect(update.hasTray()).toBe(true); expect(update.releaseTray).not.toHaveBeenCalled();
});
it('reads real battery capacity while ignoring power adapters and invalid device data', async () => {
  const root = await temporaryRoot();
  for (const [name, type, capacity] of [['BAT0', 'Battery', '62'], ['AC', 'Mains', '100'], ['BAD', 'Battery', 'garbage']]) {
    await fs.mkdir(path.join(root, name)); await fs.writeFile(path.join(root, name, 'type'), type); await fs.writeFile(path.join(root, name, 'capacity'), capacity);
  }
  expect(await batteryPercentage(root)).toBe(62);
  expect(await batteryPercentage(path.join(root, 'missing'))).toBe(null);
});
