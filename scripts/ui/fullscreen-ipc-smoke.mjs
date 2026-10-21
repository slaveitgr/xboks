/** Actual production Electron main/preload IPC in an isolated demo profile.
 * Run after build: electron scripts/ui/fullscreen-ipc-smoke.mjs [output-dir]
 * Only this test's native windows enter fullscreen. GNOME/GJS, accounts,
 * downloads, network, and the user's saved profile are never used. */
import { app, BrowserWindow, session } from 'electron';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const scriptIndex = process.argv.findIndex(value => !value.startsWith('-') && resolve(value) === fileURLToPath(import.meta.url));
const output = resolve(root, (scriptIndex >= 0 ? process.argv[scriptIndex + 1] : undefined) ?? 'outputs/fullscreen-ipc-2026-10-21');
const profile = await mkdtemp(join(tmpdir(), 'xboks-fullscreen-ipc-'));
for (const name of ['profile', 'config', 'data', 'cache', 'logs']) await mkdir(join(profile, name));
app.setPath('userData', join(profile, 'profile'));
app.setPath('sessionData', join(profile, 'profile'));
app.setPath('cache', join(profile, 'cache'));
app.setPath('logs', join(profile, 'logs'));
process.env.XBOKS_DEMO = '1';
process.env.XBOKS_FULLSCREEN_EXPERIENCE = '0';
process.env.XDG_CONFIG_HOME = join(profile, 'config');
process.env.XDG_DATA_HOME = join(profile, 'data');
for (const key of ['VITE_DEV_SERVER_URL', 'XBOKS_SMOKE_SCREENSHOT', 'XODUS_NEXUS_SMOKE_SCREENSHOT', 'XBOKS_DEMO_CAPTURE_DIR', 'XODUS_DEMO_CAPTURE_DIR', 'XODUS_NEXUS_SMOKE_STORE', 'XODUS_NEXUS_SMOKE_STORE_QUERY']) delete process.env[key];
app.commandLine.appendSwitch('disable-background-networking');
const report = { startedAt: new Date().toISOString(), actualElectron: true, productionMainAndPreload: true,
  demoProfileOnly: true, realGnomeShellChanged: false, realNetworkAllowed: false, physicalDevicesUsed: false,
  electron: process.versions.electron, sessionType: process.env.XDG_SESSION_TYPE ?? 'unknown',
  checks: [], nativeEvents: [], attemptedGjsProcesses: [], blockedRequests: [], rendererErrors: [] };
const check = (condition, label) => { if (!condition) throw Error(label); report.checks.push(label); console.log(`PASS ${label}`); };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function wait(predicate, label, timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await predicate()) return; await pause(80); }
  throw Error(`Timed out: ${label}`);
}
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw Error('Network disabled in isolated fullscreen IPC smoke.'); };
const originalSpawn = childProcess.spawn;
childProcess.spawn = function (command, ...args) {
  if (/(?:^|\/)gjs(?:-[\d.]+)?$/.test(String(command))) {
    report.attemptedGjsProcesses.push(String(command));
    throw Error('GNOME/GJS execution forbidden in fullscreen IPC smoke.');
  }
  return originalSpawn.call(this, command, ...args);
};
syncBuiltinESMExports();
// Registered before importing index: deny renderer network before it loads.
void app.whenReady().then(() => session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (details, callback) => {
  report.blockedRequests.push(details.url); callback({ cancel: true });
}));
app.on('browser-window-created', (_event, window) => {
  window.webContents.on('render-process-gone', (_event, details) => report.rendererErrors.push(details.reason));
});
let main, rogue, guide;
const evaluate = (window, source) => window.webContents.executeJavaScript(source);
const watchdog = setTimeout(() => { console.error('Fullscreen IPC smoke timed out'); app.exit(1); }, 60000);
await import(pathToFileURL(join(root, 'dist-electron/main/index.js')).href);
async function run() {
  try {
    await wait(() => { main = BrowserWindow.getAllWindows().find(window => window.getTitle() === 'xboks'); return main && !main.webContents.isLoading(); }, 'production main window load', 15000);
    await wait(() => evaluate(main, `typeof window.launcher?.setWindowFullscreen === 'function'`), 'production preload API');
    main.on('enter-full-screen', () => report.nativeEvents.push('enter'));
    main.on('leave-full-screen', () => report.nativeEvents.push('leave'));
    await evaluate(main, `window.__fullscreenIpcEvents=[];window.launcher.onWindowFullscreenChanged(value=>window.__fullscreenIpcEvents.push(value));true;`);
    check(await evaluate(main, 'window.launcher.getWindowFullscreen()') === false && !main.isFullScreen(), 'native getter initially reports a windowed main launcher');
    const initial = await evaluate(main, 'window.launcher.getFullscreenExperience()');
    check(initial.available === false && initial.active === false && initial.source === 'none', 'demo mode reports no system integration instead of probing GNOME');
    check(await evaluate(main, `window.launcher.setWindowFullscreen('yes').then(()=>false,error=>error.message.includes('boolean'))`), 'trusted IPC rejects a non-boolean fullscreen request');

    const rogueDocument = join(profile, 'untrusted.html');
    await writeFile(rogueDocument, '<!doctype html><html><meta charset="utf-8"><title>Untrusted fullscreen test window</title><body>Isolated IPC sender test</body></html>');
    rogue = new BrowserWindow({ width: 500, height: 300, show: false, title: 'Untrusted fullscreen test window', webPreferences: {
      preload: join(root, 'dist-electron/preload/index.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false,
    } });
    await rogue.loadFile(rogueDocument);
    check(await evaluate(rogue, `window.launcher.getWindowFullscreen().then(()=>false,error=>error.message.includes('Invalid launcher window'))`), 'an unregistered window cannot read trusted fullscreen IPC');
    check(await evaluate(rogue, `window.launcher.setWindowFullscreen(true).then(()=>false,error=>error.message.includes('Invalid launcher window'))`), 'an unregistered window cannot change fullscreen through the real preload');
    rogue.show(); rogue.focus();
    await wait(() => rogue.isFocused() && !main.isFocused(), 'separate window receives native focus');
    check(await evaluate(main, `window.launcher.setWindowFullscreen(true).then(()=>false,error=>error.message.includes('focused launcher'))`), 'entry from a valid but unfocused main window is rejected');
    check(!main.isFullScreen() && report.nativeEvents.length === 0, 'rejected requests produce no native fullscreen transition');
    rogue.hide();

    // Create the real trusted Guide once, then hide it before focused entry.
    await evaluate(main, 'window.desktopGuide.toggle()');
    await wait(() => { guide = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('#desktop-guide')); return guide && !guide.webContents.isLoading(); }, 'trusted desktop guide load');
    await evaluate(guide, `window.__fullscreenIpcEvents=[];window.launcher.onWindowFullscreenChanged(value=>window.__fullscreenIpcEvents.push(value));true;`);
    check(await evaluate(guide, `window.launcher.setWindowFullscreen(true).then(()=>false,error=>error.message.includes('focused launcher'))`), 'the trusted desktop Guide cannot enter Xbox mode on behalf of the main window');
    await evaluate(guide, 'window.desktopGuide.close()');
    main.show(); main.focus(); await wait(() => main.isFocused(), 'main window regains native focus');

    check(await evaluate(main, 'window.launcher.setWindowFullscreen(true)') === true && main.isFullScreen(), 'focused native entry resolves only after the compositor acknowledges fullscreen');
    await wait(() => evaluate(main, 'window.__fullscreenIpcEvents.includes(true)'), 'main renderer receives native entry');
    await wait(() => evaluate(guide, 'window.__fullscreenIpcEvents.includes(true)'), 'Guide receives main-window entry');
    check(report.nativeEvents.includes('enter') && await evaluate(guide, 'window.launcher.getWindowFullscreen()') === true, 'native event and both trusted window getters agree after entry');
    const integrated = await evaluate(main, 'window.launcher.getFullscreenExperience()');
    check(integrated.active === false && integrated.available === false, 'native window fullscreen never masquerades as acknowledged system Xbox mode');

    // A compositor/F11-style exit must be forwarded even without an IPC setter.
    main.setFullScreen(false);
    await wait(() => !main.isFullScreen() && report.nativeEvents.includes('leave'), 'external native exit acknowledgment');
    await wait(() => evaluate(main, 'window.__fullscreenIpcEvents.at(-1)===false'), 'main receives external exit');
    await wait(() => evaluate(guide, 'window.__fullscreenIpcEvents.at(-1)===false'), 'Guide receives external exit');
    check(await evaluate(main, 'window.launcher.getWindowFullscreen()') === false, 'external native exit updates the IPC getter and both renderer subscriptions');

    main.show(); main.focus(); await wait(() => main.isFocused(), 'main refocus before second entry');
    check(await evaluate(main, 'window.launcher.setWindowFullscreen(true)') === true, 'a later focused entry remains usable after an external exit');
    await evaluate(main, 'window.desktopGuide.toggle()');
    await wait(() => guide.isVisible(), 'desktop Guide is visible for Return to desktop');
    check(await evaluate(guide, 'window.launcher.setWindowFullscreen(false)') === false && !main.isFullScreen(), 'trusted Guide IPC returns the main native window to desktop');
    check(!guide.isVisible() && !guide.isFullScreen(), 'return hides the Guide and never makes its separate window fullscreen');
    await pause(250);
    check(!main.isFullScreen(), 'the main window remains windowed after native Guide focus restoration');
    check(report.attemptedGjsProcesses.length === 0, 'all native IPC checks completed without a GNOME/GJS process or shell lease');
    check(report.rendererErrors.length === 0, 'both production renderers remained alive during native transitions');
    report.status = 'passed';
  } catch (error) { report.status = 'failed'; report.error = error.stack ?? String(error); console.error(report.error); }
  finally {
    try { if (main && !main.isDestroyed() && main.isFullScreen()) { main.setFullScreen(false); await pause(250); } } catch {}
    report.finishedAt = new Date().toISOString(); report.passed = report.checks.length;
    try {
      mkdirSync(output, { recursive: true });
      writeFileSync(join(output, 'electron-fullscreen-ipc-report.json'), JSON.stringify(report, null, 2) + '\n');
    } finally {
      // An explicit listener suppresses Electron's default automatic quit.
      // Keep Node alive until the isolated profile and artifacts are flushed.
      app.removeAllListeners('window-all-closed');
      app.on('window-all-closed', () => {});
      for (const window of BrowserWindow.getAllWindows()) window.destroy();
      globalThis.fetch = originalFetch; childProcess.spawn = originalSpawn; syncBuiltinESMExports();
      // The last renderer can stop Chromium's asynchronous file-work pump;
      // finish this small disposable profile synchronously before app.exit.
      rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      clearTimeout(watchdog);
      console.log(`Native Electron fullscreen IPC checks: ${report.passed}; ${report.status}. Artifacts: ${output}`);
      const code = report.status === 'passed' ? 0 : 1;
      app.exit(code);
      // This is a disposable test process with every native window already
      // destroyed. Avoid production quit listeners retaining a test runner.
      process.reallyExit(code);
    }
  }
}
// Never await ready at ESM top level: Electron waits for module evaluation.
void app.whenReady().then(run);
