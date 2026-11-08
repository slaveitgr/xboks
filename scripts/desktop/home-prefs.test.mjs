import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, execFile, spawn} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {HOME_APPS, homeLaunchSpec, normalizeHomeApp} from '../../desktop/gnome/xboks-experience@slaveitgr.github.io/home-apps.js';

const run = promisify(execFile);
const source = path.resolve('desktop/gnome/xboks-experience@slaveitgr.github.io');
let supported = true;
try {
  execFileSync('gjs', ['-c', "imports.gi.versions.Gtk='4.0'; imports.gi.versions.Adw='1'; void imports.gi.Gtk; void imports.gi.Adw; void imports.gi.GioUnix;"], {stdio: 'pipe'});
  execFileSync('gtk4-broadwayd', ['--help'], {stdio: 'pipe'});
  execFileSync('dbus-run-session', ['--version'], {stdio: 'pipe'});
  execFileSync('glib-compile-schemas', ['--version'], {stdio: 'pipe'});
} catch { supported = false; }

test('gaming home adapters require an exact installed desktop ID and never accept arbitrary commands', () => {
  assert.deepEqual(HOME_APPS.map(app => app.id), ['none', 'steam', 'xboks', 'original-xbox']);
  for (const invalid of [null, undefined, '', 'Steam', 'terminal.desktop', '__proto__', {id: 'steam'}]) {
    assert.equal(normalizeHomeApp(invalid), 'none');
    assert.equal(homeLaunchSpec(invalid, ['steam.desktop']), null);
  }
  assert.equal(homeLaunchSpec('steam', ['steam.desktop.bak']), null);
  assert.equal(homeLaunchSpec('steam', []), null);
  assert.equal(homeLaunchSpec('none', ['steam.desktop', 'xboks.desktop']), null);
  assert.deepEqual(homeLaunchSpec('steam', ['steam.desktop']), {id: 'steam', desktopId: 'steam.desktop', uris: ['steam://open/bigpicture']});
  assert.deepEqual(homeLaunchSpec('steam', new Set(['com.valvesoftware.Steam.desktop'])),
    {id: 'steam', desktopId: 'com.valvesoftware.Steam.desktop', uris: ['steam://open/bigpicture']});
  assert.deepEqual(homeLaunchSpec('xboks', ['xboks.desktop']), {id: 'xboks', desktopId: 'xboks.desktop', args: ['--fullscreen-experience']});
  assert.deepEqual(homeLaunchSpec('original-xbox', ['original-xbox-ce-wineuwp.desktop']),
    {id: 'original-xbox', desktopId: 'original-xbox-ce-wineuwp.desktop', args: []});
});

test('real GTK preferences persist choices and use Home1 without a host display, host bus or application launch', {skip: !supported, timeout: 30000}, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'linux-gaming-prefs-test-'));
  let broadway;
  try {
    for (const dir of ['schemas', 'runtime', 'config', 'data/applications', 'cache']) await fs.mkdir(path.join(root, dir), {recursive: true, mode: 0o700});
    await fs.copyFile(path.join(source, 'schemas/org.gnome.shell.extensions.linux-gaming-mode.gschema.xml'), path.join(root, 'schemas/settings.gschema.xml'));
    execFileSync('glib-compile-schemas', ['--strict', path.join(root, 'schemas')], {stdio: 'pipe'});
    await fs.copyFile(path.join(source, 'home-apps.js'), path.join(root, 'home-apps.js'));
    await fs.writeFile(path.join(root, 'base.js'), "import Gio from 'gi://Gio'; export class ExtensionPreferences {getSettings(id) {return new Gio.Settings({schema_id:id});}}\n");
    const prefs = (await fs.readFile(path.join(source, 'prefs.js'), 'utf8'))
      .replace('resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js', './base.js')
      .replaceAll('Gio.DBus.session.call(', 'globalThis.testDbusCall(');
    await fs.writeFile(path.join(root, 'prefs.js'), prefs);
    await fs.copyFile('scripts/desktop/fixtures/home-prefs-probe.js', path.join(root, 'probe.js'));
    for (const desktop of ['steam.desktop', 'xboks.desktop', 'original-xbox-ce-wineuwp.desktop']) {
      await fs.writeFile(path.join(root, 'data/applications', desktop), '[Desktop Entry]\nType=Application\nName=Fixture\nExec=/usr/bin/false\n');
    }
    await fs.writeFile(path.join(root, 'bus.conf'), '<busconfig><type>session</type><listen>unix:tmpdir=' + root + '</listen><auth>EXTERNAL</auth><policy context="default"><allow send_destination="*"/><allow receive_sender="*"/><allow own="*"/></policy></busconfig>');
    const env = {...process.env, GSETTINGS_SCHEMA_DIR: path.join(root, 'schemas'), GSETTINGS_BACKEND: 'memory',
      XDG_RUNTIME_DIR: path.join(root, 'runtime'), XDG_DATA_HOME: path.join(root, 'data'), XDG_CONFIG_HOME: path.join(root, 'config'),
      XDG_CACHE_HOME: path.join(root, 'cache'), XDG_DATA_DIRS: '/usr/local/share:/usr/share', GIO_USE_VFS: 'local',
      GDK_BACKEND: 'broadway', BROADWAY_DISPLAY: ':41', GTK_A11Y: 'none', GTK_USE_PORTAL: '0', GTK_THEME: 'Adwaita', LC_ALL: 'C.UTF-8'};
    for (const name of ['DBUS_SESSION_BUS_ADDRESS', 'DISPLAY', 'WAYLAND_DISPLAY', 'GNOME_KEYRING_CONTROL']) delete env[name];
    broadway = spawn('gtk4-broadwayd', ['--unixsocket', path.join(root, 'http.socket'), ':41'], {env, stdio: 'ignore'});
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { await fs.access(path.join(root, 'runtime/broadway42.socket')); ready = true; break; } catch { /* Broadway display 41 uses socket 42. */ }
      if (broadway.exitCode !== null) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(ready, true, 'private Broadway display started');
    const {stdout} = await run('dbus-run-session', ['--config-file', path.join(root, 'bus.conf'), '--', 'gjs', '-m', path.join(root, 'probe.js')], {env, timeout: 20000});
    const result = JSON.parse(stdout.trim());
    assert.equal(result.checks, 21);
    assert.equal(result.hostBusUsed, false);
    assert.equal(result.hostDisplayUsed, false);
    assert.equal(result.applicationLaunched, false);
    assert.deepEqual(result.calls, ['GetState', 'LaunchHome', 'GetState', 'LeaveMode', 'GetState', 'GetState']);
  } finally {
    broadway?.kill('SIGTERM');
    if (broadway && broadway.exitCode === null) await Promise.race([
      new Promise(resolve => broadway.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 1000)),
    ]);
    await fs.rm(root, {recursive: true, force: true});
  }
});
