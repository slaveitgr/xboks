import fs from 'node:fs/promises';
import { ExperienceLease, ReversibleChanges, authorizedApplication } from '../../../desktop/gnome/xboks-experience@slaveitgr.github.io/state.js';

class Signals {
  constructor() { this.signals = new Map(); this.next = 1; }
  connect(signal, callback) { const id = this.next++; this.signals.set(id, { signal, callback }); return id; }
  disconnect(id) { this.signals.delete(id); }
  emit(signal, ...args) { for (const item of [...this.signals.values()]) if (item.signal === signal) item.callback(this, ...args); }
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
  const output = [], watches = new Map(); let nextWatch = 1, nameLost;
  const connection = { call(_bus, _path, _iface, _method, params, _reply, _flags, _timeout, _cancel, callback) {
    const sender = params.deepUnpack()[0];
    queueMicrotask(() => callback({ call_finish: () => new Variant('(u)', [sender === ':1.1' ? 101 : 102]) }, {}));
  } };
  class Variant {
    constructor(type, value) { this.type = type; this.value = value; }
    deepUnpack() { return this.value; }
  }
  const GLib = { Variant, VariantType: class {}, file_get_contents() { return [true, new TextEncoder().encode('PPid:\t100\n')]; } };
  const Gio = { DBus: { session: connection }, DBusCallFlags: { NONE: 0 }, BusNameOwnerFlags: { NONE: 0 }, BusNameWatcherFlags: { NONE: 0 },
    DBusExportedObject: { wrapJSObject(xml) { return { xml, export() {}, unexport() {}, emit_signal(name, value) { output.push({ name, state: value.deepUnpack() }); } }; } },
    bus_own_name_on_connection(_connection, _name, _flags, _acquired, lost) { nameLost = lost; return 1; },
    bus_unown_name() {},
    bus_watch_name_on_connection(_connection, sender, _flags, _appeared, vanished) { const id = nextWatch++; watches.set(id, { sender, vanished }); return id; },
    bus_unwatch_name(id) { watches.delete(id); },
  };
  const Meta = { KeyBindingAction: { NONE: 0 }, KeyBindingFlags: { NONE: 0 }, external_binding_name_for_action: id => `external-${id}` };
  const Shell = { ActionMode: { NONE: 0, ALL: 0xffff }, WindowTracker: { get_default: () => ({ get_window_app: () => ({ get_id: () => 'xboks.desktop' }) }) } };
  const panel = new Actor(true), dash = new Actor(false), dock = new Actor(true, 'dashtodockContainer'), uiGroup = new Actor();
  uiGroup.children = [dock];
  if (failApply) uiGroup.connect = () => { throw new Error('Synthetic actor connection failure'); };
  const corner = new Corner(), layout = new Signals();
  Object.assign(layout, { panelBox: panel, uiGroup, hotCorners: [corner] });
  const session = new Signals(); Object.assign(session, { isLocked: false, isGreeter: false, currentMode: 'user', parentMode: null });
  const originalShow = () => 'original overview';
  const Main = { layoutManager: layout, overview: { show: originalShow, shouldToggleByCornerOrButton: () => true, visible: false, animationInProgress: false, dash, _swipeTracker: { enabled: true } },
    sessionMode: session, wm: { allowed: [], allowKeybinding(name, mode) { this.allowed.push([name, mode]); } } };
  const display = new Signals(); Object.assign(display, { focus_window: { get_pid: () => 100, get_wm_class: () => 'xboks' },
    grabbed: [], ungrabbed: [], grab_accelerator(accelerator) { this.grabbed.push(accelerator); return emergencyAvailable ? 42 : 0; },
    ungrab_accelerator(action) { this.ungrabbed.push(action); } });
  const source = (await fs.readFile('desktop/gnome/xboks-experience@slaveitgr.github.io/extension.js', 'utf8'))
    .replace(/^import .*;\r?\n/gm, '').replace('export default class XboksExperience', 'class XboksExperience');
  // Only GI/Shell dependencies are supplied; the actual production extension
  // class and its real pure state module execute unchanged.
  const Class = new Function('Gio', 'GLib', 'Meta', 'Shell', 'Extension', 'Main', 'ExperienceLease', 'ReversibleChanges', 'authorizedApplication', 'global',
    source + '\nreturn XboksExperience;')(Gio, GLib, Meta, Shell, class {}, Main, ExperienceLease, ReversibleChanges, authorizedApplication, { display });
  const extension = new Class(); extension.enable();
  const invoke = async (method, sender = ':1.1') => {
    const result = {};
    await extension[method + 'Async']([], { get_sender: () => sender,
      return_value(value) { result.value = value.deepUnpack(); }, return_dbus_error(name, error) { result.error = error; result.errorName = name; } });
    return result;
  };
  return { extension, Main, panel, dash, dock, corner, display, output, watches, invoke, Actor, Corner,
    nameLost: () => nameLost(), ownerLost: sender => { for (const watch of [...watches.values()]) if (watch.sender === sender) watch.vanished(); } };
}
