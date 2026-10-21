import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ExperienceLease, ReversibleChanges, authorizedApplication } from '../../desktop/gnome/xboks-experience@slaveitgr.github.io/state.js';
import { shellFixture } from './fixtures/experience-shell.mjs';
const directory = 'desktop/gnome/xboks-experience@slaveitgr.github.io';

test('lease belongs to one sender; another client cannot enter or leave, and only owner loss restores', () => {
  let applied = 0, restored = 0; const changes = [];
  const lease = new ExperienceLease(() => { applied++; }, () => { restored++; }, value => changes.push(value));
  assert.throws(() => lease.enter(':1.1', false), /not-authorized/);
  lease.enter(':1.1', true); lease.enter(':1.1', false);
  assert.deepEqual(lease.state(':1.1'), { active: true, owned: true });
  assert.deepEqual(lease.state(':1.2'), { active: true, owned: false });
  assert.throws(() => lease.enter(':1.2', true), /busy/);
  assert.throws(() => lease.leave(':1.2'), /not-authorized/);
  lease.ownerVanished(':1.2'); assert.equal(lease.active, true);
  lease.ownerVanished(':1.1'); lease.forceLeave();
  assert.equal(lease.active, false); assert.equal(applied, 1); assert.equal(restored, 1);
  assert.deepEqual(changes, [true, false]);
});

test('partial apply failure restores and never claims active', () => {
  let restored = 0; const changes = [];
  const lease = new ExperienceLease(() => { throw new Error('Emergency key unavailable'); }, () => { restored++; }, state => changes.push(state));
  assert.throws(() => lease.enter(':1.1', true), /Emergency/);
  assert.equal(lease.active, false); assert.equal(restored, 1); assert.deepEqual(changes, []);
});

test('lock/disable/emergency restore is idempotent and resets sender ownership', () => {
  let restored = 0; const lease = new ExperienceLease(() => {}, () => { restored++; });
  for (const cause of ['lock', 'disable', 'emergency']) {
    lease.enter(':1.3', true); lease.forceLeave(); lease.forceLeave();
    assert.deepEqual(lease.state(':1.3'), { active: false, owned: false }, cause);
  }
  assert.equal(restored, 3);
});

test('authorization binds focused xboks identity to caller or direct child and unlocked user session', () => {
  const valid = { senderPid: 101, parentPid: 100, focusedPid: 100, applicationId: 'xboks.desktop', wmClass: 'xboks', userSession: true };
  assert.equal(authorizedApplication(valid), true);
  assert.equal(authorizedApplication({ ...valid, senderPid: 100, parentPid: 99 }), true);
  for (const patch of [{ senderPid: 102, parentPid: 99 }, { focusedPid: 0 }, { userSession: false },
    { applicationId: 'unrelated.desktop', wmClass: 'terminal' }, { senderPid: -1 }])
    assert.equal(authorizedApplication({ ...valid, ...patch }), false);
});

class Actor {
  constructor(visible) { this.visible = visible; this.signals = new Map(); this.next = 1; }
  connect(signal, callback) { const id = this.next++; this.signals.set(id, { signal, callback }); return id; }
  disconnect(id) { this.signals.delete(id); }
  emit(signal) { for (const entry of this.signals.values()) if (entry.signal === signal) entry.callback(); }
  hide() { this.visible = false; }
}
test('actor visibility restores the original hidden/visible state and handles destroyed actors', () => {
  const changes = new ReversibleChanges(), visible = new Actor(true), hidden = new Actor(false), destroyed = new Actor(true);
  changes.hideActor(visible); changes.hideActor(hidden); changes.hideActor(destroyed); changes.hideActor(visible);
  assert.equal(visible.visible, false); assert.equal(visible.signals.size, 2);
  visible.visible = true; visible.emit('notify::visible'); assert.equal(visible.visible, false);
  destroyed.emit('destroy');
  assert.deepEqual(changes.restore(), []);
  assert.equal(visible.visible, true); assert.equal(hidden.visible, false); assert.equal(visible.signals.size, 0);
  assert.deepEqual(changes.restore(), []);
});

test('restoration preserves inherited methods and does not clobber a subsequent extension override', () => {
  const prototype = { show() { return 'original'; } }, object = Object.create(prototype), changes = new ReversibleChanges();
  changes.method(object, 'show', () => 'suppressed'); assert.equal(object.show(), 'suppressed');
  changes.restore(); assert.equal(Object.hasOwn(object, 'show'), false); assert.equal(object.show(), 'original');
  changes.method(object, 'show', () => 'suppressed'); object.show = () => 'later extension'; changes.restore();
  assert.equal(object.show(), 'later extension');
});

test('all cleanup actions are attempted after one restoration failure', () => {
  const changes = new ReversibleChanges(), restored = [];
  changes.add(() => restored.push('first')); changes.add(() => { throw new Error('disposed'); }); changes.add(() => restored.push('last'));
  assert.equal(changes.restore().length, 1); assert.deepEqual(restored, ['last', 'first']);
});

test('metadata targets only inspected Shell51; extension and helper parse without importing live Shell', async () => {
  const metadata = JSON.parse(await fs.readFile(`${directory}/metadata.json`));
  assert.deepEqual(metadata['shell-version'], ['51']); assert.deepEqual(metadata['session-modes'], ['user']);
  execFileSync(process.execPath, ['--check', `${directory}/extension.js`]);
  execFileSync(process.execPath, ['--check', 'assets/desktop/experience-client.js']);
  const extension = await fs.readFile(`${directory}/extension.js`, 'utf8');
  assert.doesNotMatch(extension, /set_boolean|set_strv|set_string|spawn_command|Subprocess|kill\(/);
});

test('staging copies verified source outside live directory and refuses replacement', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xboks-extension-stage-'));
  try {
    const output = path.join(root, 'staged'), data = path.join(root, 'data');
    const args = ['scripts/desktop/stage-gnome-experience.py', '--output', output];
    execFileSync('python3', args, { env: { ...process.env, XDG_DATA_HOME: data } });
    const manifest = JSON.parse(await fs.readFile(path.join(output, 'stage-manifest.json')));
    assert.equal(manifest.uuid, 'xboks-experience@slaveitgr.github.io'); assert.equal(Object.keys(manifest.sha256).length, 4);
    await assert.rejects(fs.access(path.join(data, 'gnome-shell/extensions')));
    assert.throws(() => execFileSync('python3', args, { stdio: 'pipe' }));
    assert.throws(() => execFileSync('python3', ['scripts/desktop/stage-gnome-experience.py', '--output', path.join(data, 'gnome-shell/extensions/forbidden')], { env: { ...process.env, XDG_DATA_HOME: data }, stdio: 'pipe' }));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('actual extension applies/restores panel/dock/overview/swipe state and preserves hotcorner barriers and owner watches', async () => {
  const f = await shellFixture();
  try {
    assert.deepEqual((await f.invoke('GetState')).value, [false, false]);
    assert.deepEqual((await f.invoke('Enter')).value, []);
    assert.deepEqual(f.display.grabbed, ['<Control><Super>Escape']);
    assert.equal(f.panel.visible, false); assert.equal(f.dash.visible, false); assert.equal(f.dock.visible, false);
    assert.equal(f.Main.overview.show(), undefined); assert.equal(f.Main.overview._swipeTracker.enabled, false);
    f.corner.setBarrierSize(99); assert.equal(f.corner.sizes.at(-1), 99);
    assert.equal(f.Main.overview.shouldToggleByCornerOrButton(), false);
    assert.deepEqual((await f.invoke('GetState', ':1.2')).value, [true, false]);
    assert.equal((await f.invoke('Leave', ':1.2')).error, 'not-authorized');
    assert.equal((await f.invoke('Enter', ':1.2')).error, 'busy');
    const dock = new f.Actor(true, 'dashtodockContainer'); f.Main.layoutManager.uiGroup.children.push(dock);
    f.Main.layoutManager.uiGroup.emit('child-added', dock); assert.equal(dock.visible, false);
    const corner = new f.Corner(); f.Main.layoutManager.hotCorners.push(corner);
    corner.setBarrierSize(0); f.Main.layoutManager.emit('hot-corners-changed'); assert.equal(corner.sizes.at(-1), 0);
    f.ownerLost(':1.2'); assert.equal(f.panel.visible, false);
    f.ownerLost(':1.1');
    assert.equal(f.panel.visible, true); assert.equal(f.dash.visible, false); assert.equal(f.dock.visible, true); assert.equal(dock.visible, true);
    assert.equal(f.Main.overview.show(), 'original overview'); assert.equal(f.Main.overview._swipeTracker.enabled, true);
    assert.equal(f.Main.overview.shouldToggleByCornerOrButton(), true);
    assert.equal(f.corner.sizes.at(-1), 99); assert.equal(corner.sizes.at(-1), 0); assert.equal(f.watches.size, 0);
    assert.deepEqual(f.display.ungrabbed, [42]);
  } finally { f.extension.disable(); f.nameLost(); }
});

test('actual extension restores on lock, emergency key and disable without automatic reentry', async () => {
  for (const cause of ['lock', 'emergency', 'disable']) {
    const f = await shellFixture(); await f.invoke('Enter');
    if (cause === 'lock') { f.Main.sessionMode.isLocked = true; f.Main.sessionMode.emit('updated'); }
    if (cause === 'emergency') f.display.emit('accelerator-activated', 42);
    if (cause === 'disable') f.extension.disable();
    assert.equal(f.panel.visible, true, cause); assert.equal(f.dock.visible, true, cause);
    assert.equal(f.Main.overview._swipeTracker.enabled, true, cause);
    assert.equal(f.watches.size, 0, cause);
    if (cause === 'lock') { f.Main.sessionMode.isLocked = false; f.Main.sessionMode.emit('updated'); assert.equal(f.extension._lease.active, false); }
    f.extension.disable(); f.nameLost();
  }
});

test('actual extension refuses missing escape/focus and rolls back partial apply', async () => {
  for (const options of [{ emergencyAvailable: false }, { failApply: true }, { badFocus: true }]) {
    const f = await shellFixture(options);
    if (options.badFocus) f.display.focus_window = { get_pid: () => 999, get_wm_class: () => 'terminal' };
    const result = await f.invoke('Enter');
    assert.equal(result.error, options.emergencyAvailable === false ? 'emergency-unavailable' : options.badFocus ? 'not-authorized' : 'shell-error');
    assert.equal(f.panel.visible, true); assert.equal(f.dock.visible, true); assert.equal(f.Main.overview._swipeTracker.enabled, true);
    assert.deepEqual((await f.invoke('GetState')).value, [false, false]);
    f.extension.disable();
  }
});

test('concurrent Enter from one sender creates one owner watch and disable clears it', async () => {
  const f = await shellFixture();
  const responses = await Promise.all([f.invoke('Enter'), f.invoke('Enter')]);
  assert.deepEqual(responses.map(result => result.value), [[], []]);
  assert.equal(f.watches.size, 1);
  f.extension.disable(); assert.equal(f.watches.size, 0); f.nameLost();
});

test('an asynchronous Enter completing after extension disable cannot change Shell state', async () => {
  const f = await shellFixture();
  const pending = f.invoke('Enter'); f.extension.disable();
  assert.equal((await pending).error, 'unavailable');
  assert.equal(f.panel.visible, true); assert.equal(f.dock.visible, true); assert.equal(f.watches.size, 0);
});

let hasGjs = true;
try { execFileSync('gjs', ['--version'], { stdio: 'pipe' }); execFileSync('dbus-run-session', ['--version'], { stdio: 'pipe' }); } catch { hasGjs = false; }
test('actual GJS transport preserves ownership/EOF/SIGTERM and bus loss on isolated fake service', { skip: !hasGjs }, () => {
  const stdout = execFileSync('dbus-run-session', ['--', process.execPath, 'scripts/desktop/fixtures/experience-protocol.mjs'],
    { encoding: 'utf8', timeout: 20000, env: { ...process.env, GIO_USE_VFS: 'local' } });
  const result = JSON.parse(stdout.trim()); assert.equal(result.status, 'passed'); assert.equal(result.hostShellEntered, false);
});
