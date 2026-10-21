/** Offscreen browser for renderer fixtures. Not included in application builds.
 * Only one explicit 127.0.0.1 fixture origin is allowed to access the network. */
import { app, BrowserWindow, session } from 'electron';
import { appendFileSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
const option = name => process.argv.find(value => value.startsWith(name + '='))?.slice(name.length + 1);
const profile = option('--user-data-dir');
const origin = option('--xboks-fixture-origin');
if (!profile || !isAbsolute(profile) || !origin || !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw Error('An isolated profile and localhost fixture origin are required.');
app.setPath('userData', profile); app.setPath('sessionData', profile);
const allowed = new Set([origin, origin.replace(/^http/, 'ws')]);
void app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (request, callback) => {
    const cancel = !allowed.has(new URL(request.url).origin);
    if (cancel) appendFileSync(join(profile, 'fixture-network-denials.jsonl'), JSON.stringify({ url: request.url, blocked: true }) + '\n');
    callback({ cancel });
  });
  const window = new BrowserWindow({ show: false, width: 1920, height: 1080, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false } });
  await window.loadURL('about:blank');
});
app.on('window-all-closed', () => app.quit());
