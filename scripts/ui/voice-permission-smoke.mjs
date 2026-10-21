/** Run with `electron scripts/ui/voice-permission-smoke.mjs [output-dir]` after
 * compiling Electron sources. Capture uses Chromium's fake device exclusively;
 * no physical microphone, recording, account or network operation is used. */
import { app, BrowserWindow, session } from 'electron';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { VoiceCapturePermissions, voiceDocumentAllowed } from '../../dist-electron/main/voice-capture.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const output = resolve(root, process.argv[2] ?? 'outputs/voice-2026-10-21');
const profile = await mkdtemp(join(tmpdir(), 'xboks-voice-permission-'));
app.setPath('userData', join(profile, 'profile'));
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.commandLine.appendSwitch('mute-audio');
app.commandLine.appendSwitch('disable-background-networking');
const report = { fakeMediaOnly: true, realMicrophoneOpened: false, realNetworkAllowed: false, checks: [], permissionRequests: [] };
let window, broker;
const check = (condition, label) => { if (!condition) throw Error(label); report.checks.push(label); console.log(`PASS ${label}`); };
const watchdog = setTimeout(() => { console.error('Synthetic voice permission test timed out'); app.exit(1); }, 30_000);
async function run() {
try {
  await mkdir(output, { recursive: true });
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_details, callback) => callback({ cancel: true }));
  const html = join(profile, 'test.html'); await writeFile(html, '<!doctype html><html><meta charset="utf-8"><title>xboks synthetic microphone permission test</title><body>Fake microphone permission checks</body></html>');
  window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const doc = pathToFileURL(html).href;
  broker = new VoiceCapturePermissions(contents => contents === window.webContents, url => voiceDocumentAllowed(url, doc));
  const accept = broker.accept.bind(broker);
  broker.accept = (contents, permission, details) => {
    const allowed = accept(contents, permission, details);
    report.permissionRequests.push({ permission, mediaTypes: details.mediaTypes, allowed });
    return allowed;
  };
  broker.install(session.defaultSession);
  console.log('Loading synthetic media document');
  await window.loadFile(html);
  const evaluate = source => window.webContents.executeJavaScript(source);
  check(await evaluate('isSecureContext && !!navigator.mediaDevices?.getUserMedia'), 'packaged file document exposes secure media API');
  check(await evaluate(`navigator.mediaDevices.getUserMedia({audio:true,video:false}).then(s=>{s.getTracks().forEach(t=>t.stop());return false},()=>true)`), 'no explicit lease denies microphone');
  broker.request(window.webContents);
  check(await evaluate(`navigator.mediaDevices.getUserMedia({audio:true,video:false}).then(s=>{window.testStream=s;return s.getAudioTracks().length===1&&s.getVideoTracks().length===0},()=>false)`), 'explicit lease grants fake audio-only stream');
  check(report.permissionRequests.some(event => event.permission === 'media' && event.allowed && event.mediaTypes?.length === 1 && event.mediaTypes[0] === 'audio'), 'Electron request handler acknowledged the exact audio lease');
  check(await evaluate(`navigator.mediaDevices.getUserMedia({audio:false,video:true}).then(s=>{s.getTracks().forEach(t=>t.stop());return false},()=>true)`), 'active audio lease still denies camera');
  check(await evaluate(`navigator.mediaDevices.getUserMedia({audio:true,video:true}).then(s=>{s.getTracks().forEach(t=>t.stop());return false},()=>true)`), 'combined camera and microphone request is denied');
  broker.release(window.webContents.id);
  await evaluate('window.testStream.getTracks().forEach(t=>t.stop())');
  check(await evaluate('window.testStream.getTracks().every(t=>t.readyState==="ended")'), 'stopping releases every synthetic track');
  check(await evaluate(`navigator.mediaDevices.getUserMedia({audio:true,video:false}).then(s=>{s.getTracks().forEach(t=>t.stop());return false},()=>true)`), 'released lease denies later capture');
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = error.stack ?? String(error); }
finally {
  broker?.release(); window?.destroy();
  report.passed = report.checks.length;
  await mkdir(output, { recursive: true }); await writeFile(join(output, 'electron-permission-report.json'), JSON.stringify(report, null, 2) + '\n');
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  clearTimeout(watchdog);
  console.log(JSON.stringify(report)); app.exit(report.status === 'passed' ? 0 : 1);
}
}
// Electron delays ready until ESM evaluation completes; never await ready at
// module top level, or the test would wait on its own module initialization.
void app.whenReady().then(run);
