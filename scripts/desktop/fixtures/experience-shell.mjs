import fs from 'node:fs/promises';
import { ExperienceLease, ReversibleChanges, authorizedApplication } from '../../../desktop/gnome/xboks-experience@slaveitgr.github.io/state.js';
import { SWITCH_ACTIONS, boundedLabel } from '../../../desktop/gnome/xboks-experience@slaveitgr.github.io/switcher-state.js';
import {NATIVE_INTERFACE, NATIVE_OBJECT, NATIVE_ERRORS, NativeRevision, nativeWindowForProcess} from '../../../desktop/gnome/xboks-experience@slaveitgr.github.io/native-state.js';

class Signals {
  static $gtype=51;
  constructor() { this.signals = new Map(); this.next = 1; this.emissions=[]; }
  connect(signal, callback) { const id = this.next++; this.signals.set(id, { signal, callback, blocked:0 }); return id; }
  disconnect(id) { this.signals.delete(id); }
  emit(signal, ...args) { const emission={signal,stopped:false};this.emissions.push(emission);try{
    for (const [id,item] of [...this.signals]) if (!emission.stopped&&this.signals.get(id)===item&&item.signal === signal&&!item.blocked) item.callback(this, ...args);
  }finally{this.emissions.pop();} }
}
class Actor extends Signals {
  constructor(visible = true, name = '') { super(); this._visible = visible; this.name = name; this.children = []; this.height = 32; }
  get visible() { return this._visible; }
  set visible(value) { this._visible = value; this.emit('notify::visible'); }
  hide() { this.visible = false; }
  get_children() { return this.children; }
}
class Corner extends Signals {
  constructor() { super(); this.sizes = []; }
  setBarrierSize(size) { this.sizes.push(size); }
}

export async function shellFixture({ emergencyAvailable = true, failApply = false } = {}) {
  const output = [], watches = new Map(), objects = new Map(); let nextWatch = 1, nameLost;
  const native = {credentials: new Map(), records: new Map(), monitors: new Map(), calls: [], current: true, failWatch: false, failStop: false, beforeVerify: null,
    installedParents: new Set(), parents: new Map(), processUsers: new Map(), installedOwnerUid: 0, installedMode: 0o100755, beforeCredential: null, stickyKeys:false};
  const connection = { get_unique_name: () => ':1.99', call(_bus, _path, _iface, _method, params, _reply, _flags, _timeout, _cancel, callback) {
    const sender = params.deepUnpack()[0];
    const credentials = native.credentials.get(sender) ?? {pid: sender === ':1.1' ? 101 : 102, uid: 1000};
    queueMicrotask(async () => {
      await native.beforeCredential?.(_method, sender);
      callback({ call_finish: () => new Variant('(u)', [_method === 'GetConnectionUnixUser' ? credentials.uid : credentials.pid]) }, {});
    });
  } };
  class Variant {
    constructor(type, value) { this.type = type; this.value = value; }
    deepUnpack() { return this.value; }
  }
  const GLib = { Variant, VariantType: class {},
    file_read_link(file) { const pid=Number(file.match(/^\/proc\/(\d+)\/exe$/)?.[1]); return native.installedParents.has(pid)?'/opt/xboks/xboks.bin':'/development/xboks'; },
    file_get_contents(file) { const pid=Number(file.match(/^\/proc\/(\d+)\/status$/)?.[1]),uid=native.processUsers.get(pid)??1000;
      return [true, new TextEncoder().encode(`PPid:\t${native.parents.get(pid)??100}\nUid:\t${uid}\t${uid}\t${uid}\t${uid}\n`)]; } };
  const Gio = { DBus: { session: connection }, DBusCallFlags: { NONE: 0 }, BusNameOwnerFlags: { NONE: 0 }, BusNameWatcherFlags: { NONE: 0 },
    Settings:class {constructor({schema_id}){if(schema_id!=='org.gnome.desktop.a11y.keyboard')throw Error('Unexpected settings schema');}
      get_boolean(name){if(name!=='stickykeys-enable')throw Error('Unexpected settings key');return native.stickyKeys;}},
    FileType:{REGULAR:1},FileQueryInfoFlags:{NOFOLLOW_SYMLINKS:1},File:{new_for_path(file){return{query_info(){if(file!=='/opt/xboks/xboks.bin')throw Error('Unexpected fixture file');
      return{get_file_type:()=>1,get_attribute_uint32:name=>name==='unix::uid'?native.installedOwnerUid:native.installedMode};}};}},
    DBusExportedObject: { wrapJSObject(xml, methods) { return { xml, methods, export(_connection, object) { this.object=object; objects.set(object,this); },
      unexport() { objects.delete(this.object); }, emit_signal(name, value) { output.push({ name, state: value.deepUnpack(), object: this.object }); } }; } },
    bus_own_name_on_connection(_connection, _name, _flags, acquired, lost) { nameLost = lost; acquired?.(); return 1; },
    bus_unown_name() {},
    bus_watch_name_on_connection(_connection, sender, _flags, _appeared, vanished) { const id = nextWatch++; watches.set(id, { sender, vanished }); return id; },
    bus_unwatch_name(id) { watches.delete(id); },
  };
  const Meta = { KeyBindingAction: { NONE: 0 }, KeyBindingFlags: { NONE: 0 }, external_binding_name_for_action: id => `external-${id}` };
  const GObject={SignalMatchType:{ID:1,UNBLOCKED:2},signal_lookup:(name,gtype)=>name==='overlay-key'&&gtype===51?1:0,
    signal_handler_find(object,mask,id,detail,closure,func,data){
      if(mask!==3||id!==1||detail!==0||closure!==null||func!==null||data!==null)throw Error('Unexpected signal handler lookup');
      return [...object.signals].find(([,entry])=>entry.signal==='overlay-key'&&!entry.blocked)?.[0]??0;
    },
    signal_handler_block(object,id){const entry=object.signals.get(id);if(!entry)throw Error('Disconnected signal');entry.blocked++;},
    signal_handler_unblock(object,id){const entry=object.signals.get(id);if(!entry||!entry.blocked)throw Error('Unowned block');entry.blocked--;},
    signal_handler_is_connected:(object,id)=>object.signals.has(id),
    signal_stop_emission_by_name(object,name){const emission=object.emissions.findLast(item=>item.signal===name);if(emission)emission.stopped=true;},
  };
  const tracker = new Signals(); tracker.get_window_app = window => ({ get_id: () => window.appId ?? 'xboks.desktop', get_name: () => window.appName ?? 'XBOKS' });
  const Shell = { ActionMode: { NONE: 0, ALL: 0xffff }, WindowTracker: { get_default: () => tracker } };
  const panel = new Actor(true), dash = new Actor(false), dock = new Actor(true, 'dashtodockContainer'), uiGroup = new Actor();
  uiGroup.children = [dock];
  if (failApply) uiGroup.connect = () => { throw new Error('Synthetic actor connection failure'); };
  const corner = new Corner(), layout = new Signals();
  Object.assign(layout, { panelBox: panel, uiGroup, hotCorners: [corner] });
  const session = new Signals(); Object.assign(session, { isLocked: false, isGreeter: false, currentMode: 'user', parentMode: null });
  const originalShow = () => 'original overview';
  const Main = { activateWindow: window => { display.focus_window = window; }, layoutManager: layout, overview: { show: originalShow, toggle: () => 'original toggle', shouldToggleByCornerOrButton: () => true, visible: false, animationInProgress: false, dash, _swipeTracker: { enabled: true } },
    sessionMode: session, wm: { allowed: [], allowKeybinding(name, mode) { this.allowed.push([name, mode]); } } };
  class StockPopup { show(backward, binding, mask) { this.stock = {backward, binding, mask}; return 'stock-popup'; } }
  const AltTab = {AppSwitcherPopup: class extends StockPopup {}, WindowSwitcherPopup: class extends StockPopup {}};
  const display = new Signals(); Object.assign(display, { focus_window: { get_pid: () => 100, get_wm_class: () => 'xboks', get_title: () => 'XBOKS' },
    grabbed: [], ungrabbed: [], grab_accelerator(accelerator) { this.grabbed.push(accelerator); return emergencyAvailable ? 42 : 0; },
    ungrab_accelerator(action) { this.ungrabbed.push(action); } });
  class XboksSwitcher {
    constructor(options) { this.options = options; this.visible = false; this.actions = []; }
    keyboardSwitch(backward, mask) { this.actions.push({backward, mask}); if(!this.visible){this.visible = true;this.options.changed(true);} return true; }
    toggle() { this.visible = !this.visible; this.options.changed(this.visible); return this.visible; }
    action(action) { this.actions.push(action); if (action === 'toggle') return this.toggle(); if (action === 'open'&&!this.visible){this.visible = true;this.options.changed(true);}
      if (action === 'desktop') this.options.leave(); if (action === 'cancel') this.hide(); if (action === 'xbox') { this.hide(); this.options.xbox(); } return this.visible; }
    hide() { if (this.visible) { this.visible = false; this.options.changed(false); } }
    destroy() { this.hide(); }
  }
  const windows = [display.focus_window];
  const policySource = (await fs.readFile('desktop/gnome/xboks-experience@slaveitgr.github.io/window-policy.js', 'utf8')).replace(/^import .*;\r?\n/gm, '').replace('export class ExperienceWindowPolicy', 'class ExperienceWindowPolicy');
  const nativeGlobal = {display, window_manager: new Signals(), get_window_actors: () => windows.map(meta_window => ({meta_window})), get_current_time: () => 1000};
  const ExperienceWindowPolicy = new Function('GLib','Meta','Shell','Main','global',policySource+'\nreturn ExperienceWindowPolicy;')(GLib,Meta,Shell,Main,nativeGlobal);
  class NativeEnrollmentVerifier {
    constructor(uid) { this.uid=uid; }
    async verify(pid) { native.calls.push(pid); await native.beforeVerify?.(); return native.records.get(pid) ?? null; }
    current(record) { const current=native.records.get(record.pid);return native.current&&current&&
      ['pid','startTime','executable','pePath','peSHA256','desktopId'].every(key=>current[key]===record[key]); }
    watch(record, revoked) {
      if(native.failWatch) throw Error('not-authorized');
      native.monitors.set(record.pid,revoked);return()=>{native.monitors.delete(record.pid);if(native.failStop)throw Error('Disposed monitor');};
    }
  }
  class GamingHome {
    constructor(options) { this.options=options;this.session=null;this.state={selected:'none',active:false,loading:false,performance:{state:'disabled'}}; }
    scheduleStartup() {}
    syncPerformance() {}
    launch() { this.session={id:'steam',ready:false};this.options.enter(); }
    matches(window) { return Boolean(this.session&&window.homeMatch); }
    focus() { this.focused=true; }
    stop() { this.session=null; }
    cancelStartup() { this.options.leave();this.stop(); }
    destroy() { this.stop(); }
  }
  const HOME_INTERFACE='org.slaveitgr.Xboks.Experience.Home1',HOME_OBJECT='/org/slaveitgr/Xboks/Experience/Home1';
  const source = (await fs.readFile('desktop/gnome/xboks-experience@slaveitgr.github.io/extension.js', 'utf8'))
    .replace(/^import .*;\r?\n/gm, '').replace('export default class XboksExperience', 'class XboksExperience');
  // Only GI/Shell dependencies are supplied; the actual production extension
  // class and its real pure state module execute unchanged.
  const Class = new Function('Gio', 'GLib', 'GObject', 'Meta', 'Shell', 'Extension', 'Main', 'AltTab', 'ExperienceLease', 'ReversibleChanges', 'authorizedApplication', 'XboksSwitcher', 'ExperienceWindowPolicy', 'SWITCH_ACTIONS', 'boundedLabel', 'NATIVE_INTERFACE', 'NATIVE_OBJECT', 'NATIVE_ERRORS', 'NativeRevision', 'nativeWindowForProcess', 'NativeEnrollmentVerifier', 'GamingHome','HOME_INTERFACE','HOME_OBJECT','global',
    source + '\nreturn XboksExperience;')(Gio, GLib, GObject, Meta, Shell, class {getSettings(){return{};}}, Main, AltTab, ExperienceLease, ReversibleChanges, authorizedApplication, XboksSwitcher, ExperienceWindowPolicy, SWITCH_ACTIONS, boundedLabel,
    NATIVE_INTERFACE, NATIVE_OBJECT, NATIVE_ERRORS, NativeRevision, nativeWindowForProcess, NativeEnrollmentVerifier,GamingHome,HOME_INTERFACE,HOME_OBJECT,nativeGlobal);
  const extension = new Class(); extension.enable();
  const invoke = async (method, sender = ':1.1', parameters = []) => {
    const result = {};
    await extension[method + 'Async'](parameters, { get_sender: () => sender,
      return_value(value) { result.value = value.deepUnpack(); }, return_dbus_error(name, error) { result.error = error; result.errorName = name; } });
    return result;
  };
  const invokeNative = async(method,sender=':1.40',parameters=[])=>{
    const result={};await objects.get(NATIVE_OBJECT).methods[method+'Async'](parameters,{get_sender:()=>sender,
      return_value(value){result.value=value.deepUnpack();},return_dbus_error(name,error){result.error=error;result.errorName=name;}});return result;
  };
  return { extension, Main, AltTab, GLib, GObject, panel, dash, dock, corner, display, windows, output, watches, invoke, invokeNative, native, objects, Actor, Corner,
    nameLost: () => nameLost(), ownerLost: sender => { for (const watch of [...watches.values()]) if (watch.sender === sender) watch.vanished(); } };
}
