/** Native production-main/preload IPC smoke, isolated demo profile only.
 * Run after build: node_modules/electron/dist/electron --no-sandbox
 *   scripts/desktop/newguide-widgets-ipc-smoke.mjs [ignored-output-folder]
 * The test-only Electron facade forces every product BrowserWindow offscreen;
 * it does not alter production handler/preload code or enable host controls. */
import electron, { app, BrowserWindow as NativeWindow, ipcMain, session, shell } from 'electron';
import childProcess from 'node:child_process';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { promises as fs, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const index = process.argv.findIndex(value => resolve(value) === fileURLToPath(import.meta.url));
const output = resolve(root, (index >= 0 ? process.argv[index + 1] : undefined) ?? 'work/guide-widgets-ipc');
const profile = await fs.mkdtemp(join(tmpdir(), 'xboks-guide-widgets-ipc-'));
for (const folder of ['profile', 'config', 'data', 'cache', 'logs', 'pictures']) await fs.mkdir(join(profile, folder));
for (const [key, value] of Object.entries({ userData: 'profile', sessionData: 'profile', cache: 'cache', logs: 'logs', pictures: 'pictures' })) app.setPath(key, join(profile, value));
process.env.XBOKS_DEMO = '1'; process.env.XBOKS_FULLSCREEN_EXPERIENCE = '0';
process.env.XDG_CONFIG_HOME = join(profile, 'config'); process.env.XDG_DATA_HOME = join(profile, 'data'); process.env.XDG_CACHE_HOME = join(profile, 'cache');
process.env.DBUS_SESSION_BUS_ADDRESS = `unix:path=${join(profile, 'no-host-session-bus')}`;
process.env.PIPEWIRE_REMOTE = 'xboks-ipc-test-no-host-pipewire'; process.env.GIO_USE_VFS = 'local';
for (const key of ['VITE_DEV_SERVER_URL', 'XBOKS_SMOKE_SCREENSHOT', 'XODUS_NEXUS_SMOKE_SCREENSHOT', 'XBOKS_DEMO_CAPTURE_DIR', 'XODUS_DEMO_CAPTURE_DIR', 'XODUS_NEXUS_SMOKE_STORE', 'XODUS_NEXUS_SMOKE_STORE_QUERY']) delete process.env[key];
app.commandLine.appendSwitch('disable-background-networking'); app.commandLine.appendSwitch('disable-gpu'); app.commandLine.appendSwitch('mute-audio');
const report = { startedAt: new Date().toISOString(), actualElectron: true, productionHandlerAndPreloadBytes: true,
  testOnlyOffscreenWindowFacade: true, isolatedDemoProfile: true, hostControlCommandsIssued: false, nativeSpotifyPlaybackVerified: false,
  checks: [], attemptedHelpers: [], blockedRequests: [], rendererErrors: [], pngWrites: [], physicalCounterReads: [], externalOpens: [], nativeWindows: [] };
const check = (condition, label) => { if (!condition) throw Error(label); report.checks.push(label); console.log(`PASS ${label}`); };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function wait(predicate, label, timeout = 8000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await predicate()) return; await pause(50); } throw Error(`Timed out: ${label}`); }
const fetchOriginal = globalThis.fetch; globalThis.fetch = async () => { throw Error('Network disabled in isolated guide IPC smoke.'); };
const originals = {};
for (const method of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync']) {
  originals[method] = childProcess[method];
  childProcess[method] = function (command, ...args) {
    if (/(?:^|\/)(?:gjs(?:-[\d.]+)?|wpctl|pw-dump|playerctl|spotify|xboks-engine|xodus-cli|xodus-service)$/.test(String(command))) {
      report.attemptedHelpers.push({ method, command: String(command) }); throw Error('Host helper execution forbidden in guide IPC smoke.');
    }
    return originals[method].call(this, command, ...args);
  };
}
const writeOriginal = fs.writeFile, readOriginal = fs.readFile, openOriginal = shell.openPath;
fs.writeFile = async function (file, ...args) { if (String(file).endsWith('.png')) { report.pngWrites.push(String(file)); throw Error('PNG writes forbidden in guide IPC smoke.'); } return writeOriginal.call(this, file, ...args); };
fs.readFile = async function (file, ...args) { if (String(file) === '/proc/meminfo' || String(file).startsWith('/sys/class/drm/')) { report.physicalCounterReads.push(String(file)); throw Error('Physical counters forbidden in guide IPC smoke.'); } return readOriginal.call(this, file, ...args); };
shell.openPath = async function (target) { report.externalOpens.push(String(target)); throw Error('External applications forbidden in guide IPC smoke.'); };
syncBuiltinESMExports();
const facade = join(profile, 'offscreen-electron.mjs');
await fs.writeFile(facade, `import {BrowserWindow as NativeWindow} from 'electron';\nexport * from 'electron';\nexport function BrowserWindow(options={}){const window=new NativeWindow({...options,show:false,focusable:false,webPreferences:{...options.webPreferences,offscreen:true}});window.show=()=>{};window.showInactive=()=>{};window.focus=()=>{};window.setFocusable=()=>{};window.isFocused=()=>false;return window;}\nObject.setPrototypeOf(BrowserWindow,NativeWindow);BrowserWindow.prototype=NativeWindow.prototype;\n`);
const prefix = pathToFileURL(join(root, 'dist-electron') + sep).href;
const hooks = registerHooks({ resolve(specifier, context, next) { if (specifier === 'electron' && context.parentURL?.startsWith(prefix)) return { url: pathToFileURL(facade).href, shortCircuit: true }; return next(specifier, context); } });
void app.whenReady().then(() => session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (details, callback) => { report.blockedRequests.push(details.url); callback({ cancel: true }); }));
app.on('browser-window-created', (_event, window) => { report.nativeWindows.push(window.id); window.webContents.on('render-process-gone', (_event, details) => report.rendererErrors.push(details.reason)); });
const evaluate = (window, source) => window.webContents.executeJavaScript(source);
const blocked = (target, call, reason) => target.executeJavaScript(`(${call}).then(()=>false,error=>error.message.includes(${JSON.stringify(reason)}))`);
const methods = ['getSpotifyState', 'getGuideMixer', 'getGuidePerformance', 'getGuideGallery'];
const validCapture = 'xboks-1792526400000-aabbccdd.png';
const mutations = [
  ['Spotify open', `window.launcher.controlSpotify({action:'open'})`], ['Spotify playback', `window.launcher.controlSpotify({action:'play-pause'})`],
  ['mixer volume', `window.launcher.controlGuideMixer({action:'volume',id:10,serial:'110',volumePercent:25})`],
  ['mixer mute', `window.launcher.controlGuideMixer({action:'mute',id:10,serial:'110',muted:true})`],
  ['mixer default', `window.launcher.controlGuideMixer({action:'default',id:10,serial:'110'})`],
  ['capture open', `window.launcher.openGuideCapture('${validCapture}')`], ['capture deletion', `window.launcher.deleteGuideCapture('${validCapture}')`],
  ['screenshot capture', `window.launcher.captureLauncher()`],
];
let main, guide, rogue, auth;
const watchdog = setTimeout(() => { console.error('Guide widget IPC smoke timed out.'); app.exit(1); process.reallyExit(1); }, 35_000);
await import(pathToFileURL(join(root, 'dist-electron/main/index.js')).href);
async function run() {
  try {
    await wait(() => { main = NativeWindow.getAllWindows().find(window => window.getTitle() === 'XBOKS'); return main && !main.webContents.isLoading(); }, 'production launcher', 15_000);
    await wait(() => evaluate(main, `typeof window.launcher?.getSpotifyState==='function'&&typeof window.launcher?.getGuideMixer==='function'`), 'current production preload');
    check(main.webContents.isOffscreen() === true && !main.isVisible(), 'production main runs offscreen without focus or a visible native window');
    const actual = await evaluate(main, `Promise.all([window.launcher.getSpotifyState(),window.launcher.getGuideMixer(),window.launcher.getGuidePerformance(),window.launcher.getGuideGallery()])`);
    check(actual[0].status === 'unsupported' && actual[0].source === 'linux-mpris' && Object.values(actual[0].capabilities).every(value => value === false) && !actual[0].track, 'Spotify demo IPC exposes no player, account or enabled transport');
    check(actual[1].status === 'unsupported' && actual[1].source === 'pipewire' && actual[1].outputs.length === 0 && actual[1].inputs.length === 0 && actual[1].applications.length === 0, 'mixer demo IPC exposes no real devices or streams');
    check(actual[2].status === 'unavailable' && actual[2].cpuPercent === undefined && actual[2].memory === undefined, 'performance demo IPC reads no physical counters');
    check(actual[3].status === 'unavailable' && actual[3].items.length === 0, 'gallery demo IPC exposes no host capture or picture entries');
    for (const [label, call] of mutations) check(await blocked(main.webContents, call, 'disabled in demo mode'), `trusted main rejects ${label} before external work`);
    await evaluate(main, `(()=>{const frame=document.createElement('iframe');frame.srcdoc='<p>Production child-frame fixture</p>';document.body.append(frame);return true;})()`);
    await wait(() => main.webContents.mainFrame.frames.length > 0, 'production child frame');
    check(await main.webContents.mainFrame.frames[0].executeJavaScript(`typeof window.launcher==='undefined'`), 'production subframe receives no privileged launcher bridge');
    await evaluate(main, 'window.desktopGuide.toggle()');
    await wait(() => { guide = NativeWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('#desktop-guide')); return guide && !guide.webContents.isLoading(); }, 'trusted desktop Guide');
    await wait(() => evaluate(guide, `typeof window.launcher?.getGuideGallery==='function'`), 'Guide preload');
    check(!guide.isVisible() && guide.webContents.isOffscreen() === true, 'trusted Guide remains offscreen throughout integration checks');
    check((await evaluate(guide, 'window.launcher.getSpotifyState()')).status === 'unsupported', 'real trusted Guide can read the disabled Spotify demo state');
    for (const [label, call] of mutations) check(await blocked(guide.webContents, call, 'disabled in demo mode'), `trusted Guide rejects ${label} before external work`);
    const document = join(profile, 'untrusted.html'), childDocument = join(profile, 'child.html');
    await fs.writeFile(document, '<!doctype html><title>Unregistered fixture</title><iframe src="child.html"></iframe>');
    await fs.writeFile(childDocument, '<!doctype html><title>Untrusted child fixture</title>');
    const productionPreload = await fs.readFile(join(root, 'dist-electron/preload/index.cjs'), 'utf8'), probePreload = join(profile, 'probe-preload.cjs');
    await fs.writeFile(probePreload, productionPreload + `\nrequire('electron').contextBridge.exposeInMainWorld('__widgetFrameProbe',()=>require('electron').ipcRenderer.invoke('fixture-widget-frame-probe'));\n`);
    ipcMain.handle('fixture-widget-frame-probe', event => ({ isMainFrame: event.senderFrame === event.sender.mainFrame, webContentsId: event.sender.id }));
    const { BrowserWindow: HiddenWindow } = await import(pathToFileURL(facade).href);
    rogue = new HiddenWindow({ title: 'Untrusted fixture', webPreferences: { preload: probePreload, sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInSubFrames: true } });
    await rogue.loadFile(document);
    for (const method of methods) check(await blocked(rogue.webContents, `window.launcher.${method}()`, 'Invalid launcher window'), `unregistered window rejects ${method} through real preload IPC`);
    for (const [label, call] of mutations) check(await blocked(rogue.webContents, call, 'Invalid launcher window'), `unregistered window rejects ${label}`);
    await wait(() => rogue.webContents.mainFrame.frames.length === 1, 'untrusted native child frame');
    const frame = rogue.webContents.mainFrame.frames[0];
    await wait(() => frame.executeJavaScript(`typeof window.__widgetFrameProbe==='function'`), 'child production preload with test-only frame probe');
    const identity = await frame.executeJavaScript('window.__widgetFrameProbe()');
    check(identity.isMainFrame === false && identity.webContentsId === rogue.webContents.id, 'native child IPC carries a genuine non-main senderFrame identity');
    for (const method of methods) check(await blocked(frame, `window.launcher.${method}()`, 'Invalid launcher window'), `untrusted native child frame rejects ${method}`);
    auth = new HiddenWindow({ title: 'Authentication fixture', webPreferences: { preload: join(root, 'dist-electron/preload/index.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false } });
    await auth.loadFile(childDocument);
    for (const method of methods) check(await blocked(auth.webContents, `window.launcher.${method}()`, 'Invalid launcher window'), `separate authentication-style window rejects ${method}`);
    check(report.attemptedHelpers.length === 0, 'no Spotify, GJS, PipeWire or backend helper was launched');
    check(report.pngWrites.length === 0 && (await fs.readdir(join(profile, 'pictures'))).length === 0, 'screenshot and gallery checks created no PNG or capture folder');
    check(report.externalOpens.length === 0 && report.physicalCounterReads.length === 0, 'checks opened no host file/application and read no physical performance counters');
    check(NativeWindow.getAllWindows().every(window => !window.isVisible()), 'every native fixture and production window remained hidden');
    check(report.rendererErrors.length === 0, 'production main and Guide renderers remained alive');
    report.status = 'passed';
  } catch (error) { report.status = 'failed'; report.error = error.stack ?? String(error); console.error(report.error); }
  finally {
    report.finishedAt = new Date().toISOString(); report.passed = report.checks.length;
    mkdirSync(output, { recursive: true }); writeFileSync(join(output, 'electron-guide-widgets-ipc-report.json'), JSON.stringify(report, null, 2) + '\n');
    app.removeAllListeners('window-all-closed'); app.on('window-all-closed', () => {});
    for (const window of NativeWindow.getAllWindows()) window.destroy();
    globalThis.fetch = fetchOriginal; fs.writeFile = writeOriginal; fs.readFile = readOriginal; shell.openPath = openOriginal;
    for (const [method, original] of Object.entries(originals)) childProcess[method] = original;
    syncBuiltinESMExports(); hooks.deregister();
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); clearTimeout(watchdog);
    const code = report.status === 'passed' ? 0 : 1; console.log(`Native guide widget IPC: ${report.passed} checks; ${report.status}. ${output}`);
    app.exit(code); process.reallyExit(code);
  }
}
void app.whenReady().then(run);
