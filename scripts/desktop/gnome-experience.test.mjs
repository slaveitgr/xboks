import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ExperienceLease, ReversibleChanges, authorizedApplication } from '../../desktop/gnome/xboks-experience@slaveitgr.github.io/state.js';
import { shellFixture } from './fixtures/experience-shell.mjs';
import { policyFixture } from './fixtures/window-policy-shell.mjs';
import { switcherFixture } from './fixtures/switcher-shell.mjs';
import { SwitcherSelection, boundedLabel, primaryModifier, cardGeometry } from '../../desktop/gnome/xboks-experience@slaveitgr.github.io/switcher-state.js';
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
  execFileSync(process.execPath, ['--check', `${directory}/switcher.js`]);
  execFileSync(process.execPath, ['--check', `${directory}/switcher-theme.js`]);
  execFileSync(process.execPath, ['--check', `${directory}/window-policy.js`]);
  execFileSync(process.execPath, ['--check', 'assets/desktop/experience-client.js']);
  const extension = await fs.readFile(`${directory}/extension.js`, 'utf8');
  assert.doesNotMatch(extension, /set_boolean|set_strv|set_string|spawn_command|Subprocess|kill\(/);
  const theme = await fs.readFile(`${directory}/switcher-theme.js`, 'utf8');
  assert.doesNotMatch(theme, /set_boolean|set_strv|set_string|set_enum|spawn_command|Subprocess/);
});

test('staging copies verified source outside live directory and refuses replacement', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xboks-extension-stage-'));
  try {
    const output = path.join(root, 'staged'), data = path.join(root, 'data');
    const args = ['scripts/desktop/stage-gnome-experience.py', '--output', output];
    execFileSync('python3', args, { env: { ...process.env, XDG_DATA_HOME: data } });
    const manifest = JSON.parse(await fs.readFile(path.join(output, 'stage-manifest.json')));
    assert.equal(manifest.uuid, 'xboks-experience@slaveitgr.github.io'); assert.equal(Object.keys(manifest.sha256).length, 9);
    assert.ok(manifest.sha256['switcher-theme.js']);
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

test('v2 bare Super switches only inside the owned lease and restores the exact overview method', async () => {
  const f = await shellFixture();
  assert.deepEqual((await f.invoke('GetCapabilities')).value,[3]);
  assert.equal(f.Main.overview.toggle(),'original toggle');
  assert.equal((await f.invoke('Switch',':1.1',['open'])).error,'not-authorized');
  await f.invoke('Enter');assert.equal(f.Main.overview.toggle(),true);
  assert.equal(f.extension._switcher.visible,true);assert.equal(f.output.at(-1).name,'SwitcherChanged');
  assert.equal((await f.invoke('Switch',':1.2',['next'])).error,'not-authorized');
  assert.deepEqual((await f.invoke('Switch',':1.1',['next'])).value,[true]);
  assert.equal((await f.invoke('Switch',':1.1',['arbitrary-window-command'])).error,'not-authorized');
  await f.invoke('Leave');assert.equal(f.Main.overview.toggle(),'original toggle');
  assert.ok(f.output.some(item=>item.name==='SwitcherChanged'&&item.state[0]===false));f.extension.disable();
});

test('Alt+Tab dispatch leases existing popup show methods and restores exact inherited/third-party ownership', async () => {
 const f=await shellFixture(), app=f.AltTab.AppSwitcherPopup.prototype, windows=f.AltTab.WindowSwitcherPopup.prototype;
 const inherited=app.show, own=()=> 'existing-own-popup'; windows.show=own;
 assert.equal(Object.hasOwn(app,'show'),false);assert.equal(new f.AltTab.AppSwitcherPopup().show(false,'switch-applications',8),'stock-popup');
 await f.invoke('Enter');
 for(const [Popup,binding,backward] of [[f.AltTab.AppSwitcherPopup,'switch-applications',false],[f.AltTab.AppSwitcherPopup,'switch-applications-backward',true],
  [f.AltTab.WindowSwitcherPopup,'switch-windows',false],[f.AltTab.WindowSwitcherPopup,'switch-windows-backward',true]]){
  assert.equal(new Popup().show(false,binding,8),false,'existing WM destroys its unused popup');
  assert.deepEqual(f.extension._switcher.actions.at(-1),{backward,mask:8});
 }
 assert.equal(new f.AltTab.AppSwitcherPopup().show(false,'switch-group',8),'stock-popup','other switcher bindings delegate');
 f.Main.sessionMode.isLocked=true;
 assert.equal(new f.AltTab.AppSwitcherPopup().show(false,'switch-applications',8),'stock-popup','a non-user session cannot enter our switcher');
 f.Main.sessionMode.isLocked=false;
 await f.invoke('Leave');assert.equal(Object.hasOwn(app,'show'),false);assert.equal(app.show,inherited);assert.equal(windows.show,own);
 await f.invoke('Enter');const later=()=> 'later-extension';app.show=later;await f.invoke('Leave');assert.equal(app.show,later);
 assert.equal(windows.show,own);f.extension.disable();
});

for (const title of ['XBOKS Game Bar', 'xboks Game Bar']) test(`foreground and Guide focus retain current/legacy title compatibility and bind the actual parent: ${title}`, async () => {
  const f=await shellFixture(),external={get_pid:()=>200,get_wm_class:()=> 'Steam',get_title:()=> 'A game\nwindow',appId:'steam.desktop',appName:'Steam'};
  const guide={get_pid:()=>100,get_wm_class:()=> 'xboks',get_title:()=> title};
  const impostor={...guide,get_pid:()=>999};f.windows.push(impostor,guide,external);f.display.focus_window=external;
  const foreground=await f.invoke('GetForegroundApp');assert.deepEqual(JSON.parse(foreground.value[0]),{desktopId:'steam.desktop',name:'Steam',title:'A gamewindow'});
  await f.invoke('FocusGuide');assert.equal(f.display.focus_window,guide);
  assert.equal(JSON.parse((await f.invoke('GetForegroundApp')).value[0]).desktopId,'steam.desktop');
  f.Main.sessionMode.isLocked=true;assert.equal((await f.invoke('GetForegroundApp')).error,'not-authorized');
  assert.equal((await f.invoke('FocusGuide')).error,'guide-unavailable');f.extension.disable();
});

test('foreground bridge denies unknown background processes and wrong-user proc credentials', async () => {
  const f=await shellFixture();f.windows.length=0;
  assert.equal((await f.invoke('GetForegroundApp')).error,'not-authorized');
  f.windows.push(f.display.focus_window);f.GLib.file_get_contents=()=>[true,new TextEncoder().encode('PPid:\t100\nUid:\t0\t0\t0\t0\n')];
  assert.equal((await f.invoke('GetForegroundApp')).error,'not-authorized');f.extension.disable();
});

test('unavailable foreground is null without losing the lease, and native metadata is bounded and sanitized', async()=>{
 const f=await shellFixture();await f.invoke('Enter');f.display.focus_window=null;
 assert.equal(JSON.parse((await f.invoke('GetForegroundApp')).value[0]),null);
 assert.deepEqual((await f.invoke('GetState')).value,[true,true]);
 f.display.focus_window={get_pid:()=>200,get_wm_class:()=>'',get_title:()=>`\n${'T'.repeat(800)}\u0000`,appId:`id\n${'D'.repeat(800)}`,appName:''};
 const data=JSON.parse((await f.invoke('GetForegroundApp')).value[0]);
 assert.equal(data.name,'Application');assert.equal(data.desktopId.length,256);assert.equal(data.title.length,256);
 assert.doesNotMatch(data.desktopId+data.name+data.title,/[\u0000-\u001f\u007f]/);
 assert.deepEqual((await f.invoke('GetState')).value,[true,true]);f.extension.disable();
});

test('window selection preserves surviving IDs, bounds inventory, and separates bottom modes from app cycling',()=>{
 const model=new SwitcherSelection();model.update([{id:'1'},{id:'2'},{id:'3'}],'2');assert.equal(model.index,1);
 model.action('next');assert.equal(model.index,2);model.action('next');assert.equal(model.index,0);
 model.action('previous');assert.equal(model.index,2);model.update([{id:'2'},{id:'3'}]);assert.equal(model.entries[model.index].id,'3');
 model.action('down');model.action('right');assert.equal(model.action('accept'),'desktop');
 model.action('left');assert.equal(model.action('accept'),'xbox');model.action('up');assert.equal(model.action('accept'),'activate');
 model.update([]);assert.equal(model.action('accept'),undefined);assert.equal(model.action('close-window'),undefined);
 model.update(Array.from({length:50},(_,id)=>({id:String(id)})));assert.equal(model.entries.length,32);
 model.update([{id:'1'},{id:'1'},{id:2}]);assert.equal(model.entries.length,1);
 assert.throws(()=>model.action('kill-process'),/invalid/);assert.equal(boundedLabel('a\n\0b'),'ab');assert.equal(boundedLabel('x'.repeat(1000)).length,256);
});

test('actual native switcher creates live clones, switches existing windows, and releases modal/timer actors',async()=>{
 const f=await switcherFixture();assert.equal(f.switcher.open(),true);assert.equal(f.modal,1);assert.equal(f.chrome.size,1);assert.ok(f.clones.length>=2);
 assert.ok(f.clones.every(clone=>clone.source));assert.deepEqual(f.changes,[true]);assert.equal(f.switcher._root.x,1920);
 f.switcher.action('next');f.switcher.action('accept');assert.deepEqual(f.activated,[{id:2,timestamp:42}]);
 assert.equal(f.switcher.visible,false);assert.equal(f.modal,0);assert.equal(f.chrome.size,0);assert.equal(f.timers.size,0);
 f.switcher.destroy();assert.equal(f.modal,0);
});

test('desktop theme updates native switcher colors in place and releases every subscription on hide/reopen',async()=>{
 const f=await switcherFixture({desktopPreference:'prefer-dark'});f.switcher.open();
 const root=f.switcher._root;f.switcher.action('next');
 const selected=f.switcher.selection.entries[f.switcher.selection.index],currentChildren=[...root.children],clones=f.clones.length;
 assert.match(root.style_class,/xboks-theme-dark/);assert.equal(f.desktop.signals.size,1);assert.equal(f.system.signals.size,1);
 f.theme('prefer-light',1);assert.match(root.style_class,/xboks-theme-light/);assert.doesNotMatch(root.style_class,/xboks-theme-dark/);
 assert.equal(f.switcher._root,root);assert.deepEqual(root.children,currentChildren);assert.equal(f.clones.length,clones);
 assert.equal(f.switcher.selection.entries[f.switcher.selection.index],selected);assert.equal(f.modal,1);assert.equal(f.activated.length,0);
 f.theme('prefer-dark',1);assert.match(root.style_class,/xboks-theme-dark/);
 f.theme('default',1);assert.match(root.style_class,/xboks-theme-light/,'the light desktop default overrides Shell chrome defaults');
 f.switcher.hide();assert.equal(f.desktop.signals.size,0);assert.equal(f.system.signals.size,0);
 assert.equal(f.display.signals.size,0);assert.equal(f.layout.signals.size,0);assert.equal(f.timers.size,0);
 const classes=root.style_class;f.theme('prefer-dark',1);assert.equal(root.style_class,classes,'hidden actors receive no notifications');
 f.switcher.open();assert.match(f.switcher._root.style_class,/xboks-theme-dark/);assert.equal(f.desktop.signals.size,1);assert.equal(f.system.signals.size,1);
 f.switcher.destroy();assert.equal(f.desktop.signals.size,0);assert.equal(f.system.signals.size,0);
});

test('St color-scheme is a native fallback and failed modal creation disconnects theme settings',async()=>{
 const f=await switcherFixture({desktopSettingsAvailable:false,systemPreference:1});f.switcher.open();assert.match(f.switcher._root.style_class,/xboks-theme-dark/);
 f.theme(undefined,2);assert.match(f.switcher._root.style_class,/xboks-theme-light/);f.switcher.hide();assert.equal(f.system.signals.size,0);
 const failed=await switcherFixture({modalAvailable:false});assert.throws(()=>failed.switcher.open(),/modal-unavailable/);
 assert.equal(failed.desktop.signals.size,0);assert.equal(failed.system.signals.size,0);assert.equal(failed.timers.size,0);assert.equal(failed.chrome.size,0);
});

test('native switcher modal failure rolls back, keyboard stays scoped, and lock never activates a window',async()=>{
 const failed=await switcherFixture({modalAvailable:false});assert.throws(()=>failed.switcher.open(),/modal-unavailable/);
 assert.equal(failed.modal,0);assert.equal(failed.chrome.size,0);
 const f=await switcherFixture();f.switcher.open();assert.equal(f.press(0x67),false,'unknown keys, including G combinations, propagate');
 assert.equal(f.press(f.Clutter.KEY_Escape,f.Clutter.ModifierType.CONTROL_MASK|f.Clutter.ModifierType.SUPER_MASK),false,'emergency shortcut is never consumed');
 assert.equal(f.switcher.visible,true);
 assert.equal(f.press(f.Clutter.KEY_Right),true);assert.equal(f.switcher.selection.index,1);
 f.allowed=false;f.switcher.action('accept');assert.deepEqual(f.activated,[]);assert.equal(f.modal,0);
});

test('native switcher handles polite window close, monitor changes and Desktop/Xbox without terminating apps',async()=>{
 const f=await switcherFixture();f.switcher.open();f.switcher.action('close-window');assert.deepEqual(f.deleted,[{id:1,timestamp:42}]);
 f.runIdle();assert.equal(f.switcher.selection.entries.length,1);f.layout.emit('monitors-changed');assert.equal(f.modal,0);
 f.switcher.open();f.switcher.action('down');f.switcher.action('right');f.switcher.action('accept');assert.equal(f.leaves,1);assert.equal(f.modal,0);
 f.switcher.open();f.switcher.action('xbox');assert.equal(f.xbox,1);assert.equal(f.modal,0);
});

test('native Alt+Tab repeats, translates Alt+Shift+Tab, commits on modifier release and resets to foreground',async()=>{
 const f=await switcherFixture(),{MOD1_MASK:alt,SHIFT_MASK:shift}=f.Clutter.ModifierType;
 f.switcher.keyboardSwitch(false,alt);assert.equal(f.switcher.selection.index,1);assert.equal(f.activated.length,0);
 assert.equal(f.press(f.Clutter.KEY_Tab,alt),true);assert.equal(f.switcher.selection.index,0);
 assert.equal(f.press(f.Clutter.KEY_Tab,alt|shift),true);assert.equal(f.switcher.selection.index,1);
 assert.equal(f.press(f.Clutter.KEY_ISO_Left_Tab,alt|shift),true);assert.equal(f.switcher.selection.index,0);
 f.modifiers(shift);assert.deepEqual(f.activated,[{id:1,timestamp:42}]);assert.equal(f.modal,0);
 f.display.focus_window=f.windows[1];f.pointerModifiers=alt;
 f.switcher.keyboardSwitch(true,alt);assert.equal(f.switcher.selection.index,0);f.modifiers(0);
 assert.equal(f.activated.at(-1).id,1);assert.equal(f.modal,0);
});

test('native shortcut release before modal completion commits, while bare Super and lease loss do not',async()=>{
 const fast=await switcherFixture();fast.pointerModifiers=0;
 assert.equal(fast.switcher.keyboardSwitch(false,fast.Clutter.ModifierType.MOD1_MASK),false);
 assert.deepEqual(fast.activated,[{id:2,timestamp:42}]);assert.equal(fast.modal,0);
 const f=await switcherFixture();f.switcher.open();assert.equal(f.modifiers(0),false);assert.equal(f.switcher.visible,true);
 assert.equal(f.press(f.Clutter.KEY_Tab,f.Clutter.ModifierType.CONTROL_MASK|f.Clutter.ModifierType.MOD1_MASK),false);
 f.pointerModifiers=f.Clutter.ModifierType.MOD1_MASK;f.switcher.keyboardSwitch(false,f.Clutter.ModifierType.MOD1_MASK);
 f.allowed=false;f.modifiers(0);assert.deepEqual(f.activated,[]);assert.equal(f.modal,0);
});

test('reference geometry follows native window proportions and top icon slots use actual 32px app icons',async()=>{
 const wide=cardGeometry(1920,1080,16/9),compact=cardGeometry(1920,1080,795/510);
 assert.equal(wide.height,591);assert.ok(Math.abs(wide.width-926)<1);assert.ok(Math.abs(wide.left-497)<1);assert.ok(Math.abs(wide.top-245)<1);
 assert.equal(compact.width,815);assert.ok(Math.abs(compact.left-553)<1);assert.equal(compact.height,591);
 const small=cardGeometry(800,600,32/9);assert.ok(small.width<=800);assert.ok(small.top>0);
 assert.equal(primaryModifier(8|1),8);assert.equal(primaryModifier(0),0);
 const f=await switcherFixture();f.switcher.open();const bar=f.switcher._root.children[0],slots=bar.children.slice(1,-1);
 assert.equal(slots.length,2);assert.ok(slots.every(slot=>slot.width===72&&slot.height===72&&slot.children[0].iconSize===32));
 assert.equal(f.clones.at(-1).height,510);f.switcher.hide();
});

test('Shell51 revoked modal releases switcher chrome and timers once',async()=>{
 const f=await switcherFixture();f.switcher.open();f.revoke();
 assert.equal(f.switcher.visible,false);assert.equal(f.modal,0);assert.equal(f.chrome.size,0);assert.equal(f.timers.size,0);
 f.revoke();assert.equal(f.modal,0);assert.deepEqual(f.changes,[true,false]);
});

test('owned native policy enforces fullscreen and no minimize, restoring each original fullscreen/maximize-axis/minimize state',async()=>{
 const f=await policyFixture(),normal=f.create(1),full=f.create(2,{fullscreen:true,flags:3}),partial=f.create(3,{flags:1}),minimized=f.create(4,{minimized:true,mapped:false});
 f.display.focus_window=normal;f.policy.start();
 assert.ok(f.windows.every(window=>window.fullscreen&&!window.minimized));assert.equal(f.display.focus_window,normal);assert.deepEqual(f.activated,[1]);
 normal.minimize();assert.equal(normal.minimized,false);normal.unmake_fullscreen();assert.equal(normal.fullscreen,true);
 full.setFlags(1);partial.setFlags(2);f.policy.stop();f.policy.stop();
 assert.deepEqual(f.windows.map(window=>[window.fullscreen,window.flags,window.minimized]),[[false,0,false],[true,3,false],[false,1,false],[false,0,true]]);
 assert.ok(f.windows.every(window=>window.signals.size===0));assert.equal(f.timers.size,0);
 assert.equal(f.display.signals.size,0);assert.equal(f.wm.signals.size,0);assert.equal(f.tracker.signals.size,0);
});

test('native policy excludes Guide, taskbar-skipped, attached/transient/modal/dialog/system and untracked windows',async()=>{
 const f=await policyFixture(),normal=f.create(1);
 for(const options of [{title:'XBOKS Game Bar'},{skip_taskbar:true},{attached:true},{transient:normal},{type:f.Meta.WindowType.DIALOG},
  {type:f.Meta.WindowType.MODAL_DIALOG},{type:f.Meta.WindowType.DESKTOP},{override:true},{app:null}])f.create(f.windows.length+1,options);
 f.policy.start();assert.equal(normal.fullscreen,true);assert.ok(f.windows.slice(1).every(window=>!window.fullscreen&&window.calls.length===0));
 normal.change('title','XBOKS Game Bar');assert.equal(normal.fullscreen,false,'a newly identified auxiliary window immediately restores');
 f.policy.stop();assert.equal(normal.signals.size,0);
});

test('new native app windows wait for mapping/app tracking and never activate another app',async()=>{
 const f=await policyFixture(),original=f.create(1);f.display.focus_window=original;f.policy.start();
 const later=f.create(2,{mapped:false});f.display.emit('window-created',later);f.idle();assert.equal(later.calls.length,0);
 later.change('mapped',true);assert.equal(later.fullscreen,false);f.idle();assert.equal(later.fullscreen,true);
 const untracked=f.create(3,{app:null});f.wm.emit('map',{meta_window:untracked});f.idle();assert.equal(untracked.calls.length,0);
 untracked.app={};f.tracker.emit('tracked-windows-changed');f.idle();assert.equal(untracked.fullscreen,true);
 assert.equal(f.display.focus_window,original);assert.deepEqual(f.activated,[1]);assert.ok(f.raised.every(id=>id===1));f.policy.stop();assert.ok(f.windows.every(window=>!window.fullscreen));
});

test('window policy retains entry focus, uses truthful maximize fallback, and tolerates closed windows and restoration errors',async()=>{
 const f=await policyFixture(),original=f.create(1),refused=f.create(2,{rejectFullscreen:true,flags:1}),fixed=f.create(3,{rejectFullscreen:true,fixed:true}),thrown=f.create(4,{throwFullscreen:true}),steals=f.create(5,{stealFocus:true});
 f.display.focus_window=original;f.policy.start();assert.equal(f.display.focus_window,original);assert.deepEqual(f.activated,[1,1]);
 assert.equal(refused.fullscreen,false);assert.equal(refused.flags,3);refused.setFlags(0);assert.equal(refused.flags,3);
 assert.equal(fixed.fullscreen,false);assert.equal(fixed.flags,0);assert.equal(thrown.flags,3);assert.ok(f.warnings.length>=3);
 const closed=f.create(6);f.wm.emit('map',{meta_window:closed});f.idle();closed.close();assert.equal(closed.signals.size,0);
 steals.unmake_fullscreen=()=>{throw Error('restore-failed');};f.policy.stop();
 assert.equal(original.fullscreen,false);assert.equal(refused.flags,1);assert.equal(thrown.flags,0);assert.ok(f.warnings.some(w=>w.includes('restore-failed')));
});

test('restoring an original fullscreen background app retains the surviving focused app stack without activation',async()=>{
 const f=await policyFixture(),focused=f.create(1),background=f.create(2,{fullscreen:true});
 f.display.focus_window=focused;f.policy.start();f.activated.length=0;f.raised.length=0;
 f.allowed=false;background.fullscreen=false;f.policy.stop();
 assert.equal(background.fullscreen,true);assert.equal(f.raised.at(-1),focused.id);assert.deepEqual(f.activated,[]);
 const closed=await policyFixture(),closing=closed.create(1);closed.display.focus_window=closing;closed.policy.start();closed.raised.length=0;closing.close();closed.policy.stop();assert.deepEqual(closed.raised,[]);
 const minimized=await policyFixture(),hidden=minimized.create(1,{minimized:true});minimized.display.focus_window=hidden;minimized.policy.start();minimized.raised.length=0;minimized.policy.stop();assert.deepEqual(minimized.raised,[]);
});

test('window policy cancels deferred work on lease/lock loss and rolls back partial initial failure',async()=>{
 const f=await policyFixture(),window=f.create(1);f.policy.start();const later=f.create(2);f.display.emit('window-created',later);
 f.allowed=false;window.unmake_fullscreen();assert.equal(window.fullscreen,false);f.policy.stop();f.idle();assert.equal(later.calls.length,0);
 assert.equal(f.timers.size,0);assert.equal(window.signals.size,0);
 const failed=await policyFixture(),first=failed.create(1),second=failed.create(2,{minimized:true});
 second.connect=()=>{throw Error('subscription-failed');};assert.throws(()=>failed.policy.start(),/subscription-failed/);
 assert.equal(first.fullscreen,false);assert.equal(second.minimized,true);assert.equal(first.signals.size,0);assert.equal(failed.display.signals.size,0);
});

let hasGjs = true;
try { execFileSync('gjs', ['--version'], { stdio: 'pipe' }); execFileSync('dbus-run-session', ['--version'], { stdio: 'pipe' }); } catch { hasGjs = false; }
let hasShell51 = hasGjs;
try { await fs.access('/usr/lib/x86_64-linux-gnu/mutter-51/Clutter-51.typelib'); await fs.access('/usr/lib/gnome-shell/Shell-51.typelib'); } catch { hasShell51 = false; }
test('actual installed Shell51 typelibs provide the exact native controller/clone/revocable-grab APIs', {skip: !hasShell51}, () => {
  const stdout = execFileSync('gjs', ['scripts/desktop/fixtures/gnome51-api-probe.js'], {encoding: 'utf8', timeout: 5000,
    env: {...process.env, GI_TYPELIB_PATH: '/usr/lib/x86_64-linux-gnu/mutter-51:/usr/lib/gnome-shell',
      LD_LIBRARY_PATH: '/usr/lib/x86_64-linux-gnu/mutter-51:/usr/lib/gnome-shell'}});
  const result = JSON.parse(stdout.trim()); assert.equal(result.status, 'passed'); assert.equal(result.nativeSessionChanged, false); assert.equal(result.fullscreenCapabilityQuery, false);
  assert.equal(Object.keys(result.checks).length, 28); assert.ok(Object.values(result.checks).every(Boolean));
});
for (const legacyOnly of [false, true]) test(`actual GJS transport preserves ownership/EOF/SIGTERM and bus loss on isolated fake service: legacy signals=${legacyOnly}`, { skip: !hasGjs }, () => {
  const stdout = execFileSync('dbus-run-session', ['--', process.execPath, 'scripts/desktop/fixtures/experience-protocol.mjs', ...(legacyOnly ? ['--legacy-unix-signals'] : [])],
    { encoding: 'utf8', timeout: 20000, env: { ...process.env, GIO_USE_VFS: 'local' } });
  const result = JSON.parse(stdout.trim()); assert.equal(result.status, 'passed'); assert.equal(result.hostShellEntered, false);
  assert.equal(result.unixSignals, legacyOnly ? 'legacy-only' : 'native');
});

test('actual Gio/St settings update both switcher palettes, restore private settings and disconnect observers', {skip: !hasShell51}, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xboks-switcher-theme-'));
  try {
    const stdout = execFileSync('dbus-run-session', ['--', 'gjs', '-m', 'scripts/desktop/fixtures/switcher-theme-settings.js'], {
      encoding: 'utf8', timeout: 10000, env: {...process.env, GSETTINGS_BACKEND: 'memory', GIO_USE_VFS: 'local',
        DISPLAY: '', WAYLAND_DISPLAY: '', XDG_CONFIG_HOME: path.join(root, 'config'), XDG_CACHE_HOME: path.join(root, 'cache'), XDG_DATA_HOME: path.join(root, 'data'),
        GI_TYPELIB_PATH: '/usr/lib/x86_64-linux-gnu/mutter-51:/usr/lib/gnome-shell', LD_LIBRARY_PATH: '/usr/lib/x86_64-linux-gnu/mutter-51:/usr/lib/gnome-shell'},
    });
    const result = JSON.parse(stdout.trim()); assert.equal(result.status, 'passed'); assert.equal(result.backend, 'memory');
    assert.equal(result.nativeSessionChanged, false); assert.equal(result.restored, true); assert.equal(result.nativeStylesheetParsed, true);
    assert.deepEqual(result.variants, ['dark', 'light', 'light', 'dark']);
    assert.deepEqual(result.schemeValues, {'prefer-dark': 1, 'prefer-light': 2, default: 0});
  } finally { await fs.rm(root, {recursive: true, force: true}); }
});
