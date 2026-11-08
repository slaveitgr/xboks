import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, execFile, spawn} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const run = promisify(execFile), helper = path.resolve('assets/desktop/apps-client.js');
let supported = true, graphicsSupported = true;
try { execFileSync('gjs', ['-c', 'void imports.gi.GioUnix;'], {stdio: 'pipe'}); execFileSync('dbus-run-session', ['--version'], {stdio: 'pipe'}); }
catch { supported = false; }
try { execFileSync('gtk4-broadwayd', ['--help'], {stdio: 'pipe'}); }
catch { graphicsSupported = false; }

test('desktop helper resolves exact visible launchers and launches only a selected disposable fixture', {skip: !supported, timeout: 30000}, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xboks-desktop-apps-'));
  let broadway;
  try {
    for (const dir of ['data/applications', 'data/icons', 'system', 'runtime', 'config', 'cache']) await fs.mkdir(path.join(root, dir), {recursive: true, mode: 0o700});
    const marker = path.join(root, 'selected-app-started');
    const launcher = (name, extra = '', exec = '/usr/bin/false') => `[Desktop Entry]\nType=Application\nName=${name}\nExec=${exec}\n${extra}\n`;
    await fs.writeFile(path.join(root, 'data/applications/visible.desktop'), launcher('Visible sample', 'Comment=Disposable test launcher', '/usr/bin/touch ' + marker));
    await fs.writeFile(path.join(root, 'data/applications/hidden.desktop'), launcher('Hidden sample', 'Hidden=true'));
    await fs.writeFile(path.join(root, 'data/applications/no-display.desktop'), launcher('NoDisplay sample', 'NoDisplay=true'));
    await fs.writeFile(path.join(root, 'data/applications/other-desktop.desktop'), launcher('Other desktop sample', 'OnlyShowIn=Unrelated;'));
    await fs.writeFile(path.join(root, 'bus.conf'), '<busconfig><type>session</type><listen>unix:tmpdir=' + root + '</listen><auth>EXTERNAL</auth><policy context="default"><allow send_destination="*"/><allow receive_sender="*"/><allow own="*"/></policy></busconfig>');
    const env = {...process.env, XDG_RUNTIME_DIR: path.join(root, 'runtime'), XDG_DATA_HOME: path.join(root, 'data'), XDG_DATA_DIRS: path.join(root, 'system'),
      XDG_CONFIG_HOME: path.join(root, 'config'), XDG_CACHE_HOME: path.join(root, 'cache'), XDG_CURRENT_DESKTOP: 'GNOME', GIO_USE_VFS: 'local',
      GDK_BACKEND: 'broadway', BROADWAY_DISPLAY: ':43', GTK_A11Y: 'none', GTK_USE_PORTAL: '0', LC_ALL: 'C.UTF-8'};
    for (const key of ['DBUS_SESSION_BUS_ADDRESS', 'DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'GNOME_KEYRING_CONTROL']) delete env[key];
    const invoke = async (...args) => {
      const {stdout} = await run('dbus-run-session', ['--config-file', path.join(root, 'bus.conf'), '--', 'gjs', '-m', helper, ...args], {env, timeout: 8000, maxBuffer: 2 * 1024 * 1024});
      return JSON.parse(stdout.trim());
    };
    const list = await invoke('list');
    assert.equal(list.available, true); assert.deepEqual(list.apps.map(app => app.id), ['visible.desktop']);
    assert.equal(list.apps[0].description, 'Disposable test launcher'); await assert.rejects(fs.access(marker));
    for (const id of ['hidden.desktop', 'no-display.desktop', 'other-desktop.desktop', 'missing.desktop']) assert.deepEqual(await invoke('launch', id), {ok: false, error: 'not-available'});
    for (const id of ['../visible.desktop', '/tmp/visible.desktop', 'visible.desktop;touch marker']) assert.deepEqual(await invoke('launch', id), {ok: false, error: 'invalid-id'});
    assert.deepEqual(await invoke('launch', 'visible.desktop'), {ok: true});
    for (let index = 0; index < 100; index++) { try { await fs.access(marker); break; } catch { await new Promise(resolve => setTimeout(resolve, 10)); } }
    await fs.access(marker);
    await fs.unlink(path.join(root, 'data/applications/visible.desktop')); assert.deepEqual(await invoke('launch', 'visible.desktop'), {ok: false, error: 'not-available'});
    if (graphicsSupported) {
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHTYAAAAASUVORK5CYII=', 'base64');
      const icon = path.join(root, 'data/icons/fixture.png'), outside = path.join(root, 'not-an-icon-directory.png');
      await fs.writeFile(icon, png); await fs.writeFile(outside, png); await fs.symlink(outside, path.join(root, 'data/icons/linked.png'));
      for (const [id, iconPath] of [['visible-icon', icon], ['outside-icon', outside], ['symlink-icon', path.join(root, 'data/icons/linked.png')]])
        await fs.writeFile(path.join(root, 'data/applications/' + id + '.desktop'), launcher(id, 'Icon=' + iconPath));
      broadway = spawn('gtk4-broadwayd', ['--unixsocket', path.join(root, 'http.socket'), ':43'], {env, stdio: 'ignore'});
      for (let index = 0; index < 100; index++) { try { await fs.access(path.join(root, 'runtime/broadway44.socket')); break; } catch { await new Promise(resolve => setTimeout(resolve, 20)); } }
      await fs.access(path.join(root, 'runtime/broadway44.socket'));
      const icons = (await invoke('list')).apps;
      assert.match(icons.find(app => app.id === 'visible-icon.desktop').iconDataUrl, /^data:image\/png;base64,/);
      assert.equal(icons.find(app => app.id === 'outside-icon.desktop').iconDataUrl, undefined);
      assert.equal(icons.find(app => app.id === 'symlink-icon.desktop').iconDataUrl, undefined);
    }
  } finally {
    broadway?.kill('SIGTERM');
    if (broadway?.exitCode === null) await Promise.race([new Promise(resolve => broadway.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 1000))]);
    await fs.rm(root, {recursive: true, force: true});
  }
});
