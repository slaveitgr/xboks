// SPDX-License-Identifier: MIT
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as AltTab from 'resource:///org/gnome/shell/ui/altTab.js';
import {ExperienceLease, ReversibleChanges, authorizedApplication} from './state.js';
import {XboksSwitcher} from './switcher.js';
import {ExperienceWindowPolicy} from './window-policy.js';
import {SWITCH_ACTIONS, boundedLabel} from './switcher-state.js';
import {NATIVE_INTERFACE, NATIVE_OBJECT, NATIVE_ERRORS, NativeRevision, nativeWindowForProcess} from './native-state.js';
import {NativeEnrollmentVerifier} from './native-auth.js';
import {GamingHome, HOME_INTERFACE, HOME_OBJECT} from './home-launcher.js';

const BUS = 'org.slaveitgr.Xboks.Experience';
const OBJECT = '/org/slaveitgr/Xboks/Experience';
const INTERFACE = `<node><interface name="${BUS}">
  <method name="GetState"><arg type="b" direction="out" name="active"/><arg type="b" direction="out" name="owned"/></method>
  <method name="Enter"/><method name="Leave"/>
  <method name="GetCapabilities"><arg type="u" direction="out" name="version"/></method>
  <method name="GetForegroundApp"><arg type="s" direction="out" name="json"/></method>
  <method name="FocusGuide"/>
  <method name="Switch"><arg type="s" direction="in" name="action"/><arg type="b" direction="out" name="visible"/></method>
  <method name="GetSwitcherControl"><arg type="t" direction="out" name="epoch"/><arg type="b" direction="out" name="active"/><arg type="b" direction="out" name="owned"/><arg type="b" direction="out" name="visible"/><arg type="b" direction="out" name="canControl"/></method>
  <method name="ControlSwitcher"><arg type="s" direction="in" name="action"/><arg type="t" direction="in" name="expectedEpoch"/><arg type="b" direction="out" name="visible"/></method>
  <signal name="StateChanged"><arg type="b" name="active"/></signal>
  <signal name="SwitcherChanged"><arg type="b" name="visible"/></signal>
</interface></node>`;
const CONTROL_ERRORS = Object.freeze({
    'not-authorized': `${BUS}.Control.Error.AccessDenied`,
    'stale-control': `${BUS}.Control.Error.StaleEpoch`,
    unavailable: `${BUS}.Control.Error.Unavailable`,
    'invalid-action': 'org.freedesktop.DBus.Error.InvalidArgs',
    'shell-error': `${BUS}.Control.Error.ShellError`,
});
const NATIVE_XML = `<node><interface name="${NATIVE_INTERFACE}">
  <method name="GetState"><arg type="u" direction="out" name="version"/><arg type="t" direction="out" name="epoch"/><arg type="b" direction="out" name="supported"/><arg type="b" direction="out" name="active"/><arg type="b" direction="out" name="canSet"/><arg type="b" direction="out" name="owned"/></method>
  <method name="SetMode"><arg type="b" direction="in" name="active"/><arg type="t" direction="in" name="expectedEpoch"/><arg type="t" direction="out" name="epoch"/><arg type="b" direction="out" name="active"/><arg type="b" direction="out" name="owned"/></method>
  <signal name="StateChanged"><arg type="t" name="epoch"/><arg type="b" name="active"/></signal>
</interface></node>`;
const HOME_XML = `<node><interface name="${HOME_INTERFACE}">
  <method name="GetState"><arg type="s" direction="out" name="json"/></method>
  <method name="LaunchHome"/><method name="LeaveMode"/>
</interface></node>`;

function processCredential(connection, sender, method) {
    return new Promise((resolve, reject) => connection.call(
        'org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', method,
        new GLib.Variant('(s)', [sender]), new GLib.VariantType('(u)'), Gio.DBusCallFlags.NONE, 2000, null,
        (bus, result) => {
            try { resolve(bus.call_finish(result).deepUnpack()[0]); } catch (error) { reject(error); }
        }));
}
function processId(connection, sender) { return processCredential(connection, sender, 'GetConnectionUnixProcessID'); }

function parentProcess(pid) {
    try {
        const [ok, bytes] = GLib.file_get_contents(`/proc/${pid}/status`);
        if (!ok || bytes.length > 65536)
            return 0;
        return Number(new TextDecoder().decode(bytes).match(/^PPid:\s+(\d+)$/m)?.[1] ?? 0);
    } catch {
        return 0;
    }
}

function processUser(pid) {
    try {
        const [ok, bytes] = GLib.file_get_contents(`/proc/${pid}/status`);
        if (!ok || bytes.length > 65536) return -1;
        const uid = new TextDecoder().decode(bytes).match(/^Uid:\s+(\d+)\s+(\d+)/m);
        return uid && uid[1] === uid[2] ? Number(uid[1]) : -1;
    } catch { return -1; }
}

function installedMain(pid) {
    try {
        if (GLib.file_read_link(`/proc/${pid}/exe`) !== '/opt/xboks/xboks.bin') return false;
        const info = Gio.File.new_for_path('/opt/xboks/xboks.bin').query_info('standard::type,unix::uid,unix::mode', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        return info.get_file_type() === Gio.FileType.REGULAR && info.get_attribute_uint32('unix::uid') === 0 &&
            (info.get_attribute_uint32('unix::mode') & 0o022) === 0;
    } catch { return false; }
}

function xboksWindow(window) {
    if (!window) return false;
    const app = Shell.WindowTracker.get_default().get_window_app(window);
    return authorizedApplication({senderPid: window.get_pid(), focusedPid: window.get_pid(),
        applicationId: app?.get_id(), wmClass: window.get_wm_class(), userSession: true});
}

export default class XboksExperience extends Extension {
    enable() {
        this._enabled = true;
        this._epoch = (this._epoch ?? 0) + 1;
        this._connection = Gio.DBus.session;
        this._nativeBusAvailable = false;
        this._nativeRevision = new NativeRevision(Math.floor(GLib.get_monotonic_time?.() ?? Date.now() * 1000));
        this._controlRevision = new NativeRevision(Math.floor(GLib.get_monotonic_time?.() ?? Date.now() * 1000));
        this._nativeAuth = new NativeEnrollmentVerifier(processUser('self'));
        this._nativeOwner = null;
        this._nativeEnrollmentStop = null;
        this._ownerWatch = 0;
        this._connections = [];
        this._changes = null;
        this._switcher = null;
        this._windowPolicy = null;
        this._foregroundWindow = null;
        this._applicationPid = 0;
        this._emergencyAction = Meta.KeyBindingAction.NONE;
        this._lease = new ExperienceLease(() => this._apply(), () => this._restore(), active => {
            this._controlRevision.bump();
            this._home?.syncPerformance();
            this._dbus?.emit_signal('StateChanged', new GLib.Variant('(b)', [active]));
            this._nativeChanged(active);
        });
        this._dbus = Gio.DBusExportedObject.wrapJSObject(INTERFACE, this);
        this._dbus.export(this._connection, OBJECT);
        this._nativeDbus = Gio.DBusExportedObject.wrapJSObject(NATIVE_XML, {
            GetStateAsync: (parameters, invocation) => this._nativeGetState(parameters, invocation),
            SetModeAsync: (parameters, invocation) => this._nativeSetMode(parameters, invocation),
        });
        this._nativeDbus.export(this._connection, NATIVE_OBJECT);
        this._homeSender = this._connection.get_unique_name();
        this._home = new GamingHome({settings: this.getSettings(),
            enter: () => {
                if (!this._userSession() || Main.overview.visible || Main.overview.animationInProgress) throw Error('unavailable');
                this._lease.enter(this._homeSender, true);
            },
            leave: () => this._lease?.forceLeave(), active: () => this._lease?.active,
            guardCover: () => this._guardStartupCover(),
            changed: () => { this._controlRevision.bump(); }});
        this._homeDbus = Gio.DBusExportedObject.wrapJSObject(HOME_XML, {
            GetStateAsync: (parameters, invocation) => this._homeRequest('state', parameters, invocation),
            LaunchHomeAsync: (parameters, invocation) => this._homeRequest('launch', parameters, invocation),
            LeaveModeAsync: (parameters, invocation) => this._homeRequest('leave', parameters, invocation),
        });
        this._homeDbus.export(this._connection, HOME_OBJECT);
        this._busOwner = Gio.bus_own_name_on_connection(this._connection, BUS, Gio.BusNameOwnerFlags.NONE,
            () => {
                if (!this._enabled) return;
                this._nativeBusAvailable = true;
                this._nativeChanged(Boolean(this._lease?.active));
            }, () => {
                if (!this._enabled) return;
                this._nativeBusAvailable = false;
                const active = this._lease?.active;
                this._lease?.forceLeave();
                if (!active) this._nativeChanged(false);
            });
        this._sessionSignal = Main.sessionMode.connect('updated', () => {
            if (!this._userSession()) {
                this._lease.forceLeave();
                this._home?.cancelStartup();
            }
        });
        this._home.scheduleStartup();
    }

    _guardStartupCover() {
        if (!this._userSession()) throw Error('unavailable');
        const action = global.display.grab_accelerator('<Control><Super>Escape', Meta.KeyBindingFlags.NONE);
        if (action === Meta.KeyBindingAction.NONE) throw Error('emergency-unavailable');
        let signal = 0, released = false;
        const release = () => {
            if (released) return;
            released = true;
            if (signal) global.display.disconnect(signal);
            Main.wm.allowKeybinding(Meta.external_binding_name_for_action(action), Shell.ActionMode.NONE);
            global.display.ungrab_accelerator(action);
        };
        try {
            Main.wm.allowKeybinding(Meta.external_binding_name_for_action(action), Shell.ActionMode.ALL);
            signal = global.display.connect('accelerator-activated', (_display, activated) => {
                if (activated === action) this._home?.cancelStartup();
            });
        } catch (error) { release(); throw error; }
        return release;
    }

    async _homeRequest(action, _parameters, invocation) {
        try {
            const epoch = this._epoch;
            const uid = await processCredential(this._connection, invocation.get_sender(), 'GetConnectionUnixUser');
            if (!this._enabled || this._epoch !== epoch || !this._userSession() || uid !== processUser('self')) throw Error('not-authorized');
            if (action === 'state') invocation.return_value(new GLib.Variant('(s)', [JSON.stringify(this._home.state)]));
            else {
                if (action === 'launch') this._home.launch();
                else this._home.cancelStartup();
                invocation.return_value(new GLib.Variant('()', []));
            }
        } catch (error) {
            const code = ['not-authorized', 'home-not-selected', 'home-not-installed', 'busy', 'unavailable'].includes(error.message) ? error.message : 'home-launch-failed';
            invocation.return_dbus_error(`${HOME_INTERFACE}.Error`, code);
        }
    }

    _homeOwns(id) {
        return Boolean(this._home?.session && (!id || this._home.session.id === id) && this._lease?.state(this._homeSender).owned);
    }

    _userSession() {
        return !Main.sessionMode.isLocked && !Main.sessionMode.isGreeter &&
            (Main.sessionMode.currentMode === 'user' || Main.sessionMode.parentMode === 'user');
    }

    _nativeChanged(active) {
        const epoch = this._nativeRevision.bump();
        this._nativeDbus?.emit_signal('StateChanged', new GLib.Variant('(tb)', [epoch, active]));
    }

    _clearNativeOwner() {
        const stop = this._nativeEnrollmentStop;
        this._nativeEnrollmentStop = null;
        this._nativeOwner = null;
        try { stop?.(); } catch { /* Native monitor cleanup must not prevent desktop restoration. */ }
    }

    async _nativePeer(invocation) {
        const epoch = this._epoch, auth = this._nativeAuth, sender = invocation.get_sender();
        if (!this._enabled || !this._nativeBusAvailable || !auth) throw Error('unavailable');
        const [pid, uid] = await Promise.all([processId(this._connection, sender),
            processCredential(this._connection, sender, 'GetConnectionUnixUser')]);
        if (!this._enabled || this._epoch !== epoch || !this._nativeBusAvailable) throw Error('unavailable');
        if (!Number.isInteger(pid) || pid < 1 || uid < 1 || uid !== auth.uid) throw Error('not-authorized');
        return {pid, uid, epoch, auth};
    }

    async _nativeCaller(invocation) {
        const {pid, uid, epoch, auth} = await this._nativePeer(invocation);
        const record = await auth.verify(pid);
        if (!record) throw Error('not-authorized');
        if (!this._enabled || this._epoch !== epoch || !this._nativeBusAvailable) throw Error('unavailable');
        // A unique bus name may disappear while the asynchronous PE hash is
        // being checked. Recheck its kernel credentials before any transition.
        const current = await this._nativePeer(invocation);
        if (current.epoch !== epoch) throw Error('unavailable');
        if (current.pid !== pid || current.uid !== uid || !auth.current(record)) throw Error('not-authorized');
        return record;
    }

    _nativeCanSet(record, sender) {
        if (!record || !this._enabled || !this._nativeBusAvailable || !this._userSession()) return false;
        const state = this._lease.state(sender);
        if (state.active) return (state.owned && this._nativeOwner?.sender === sender && this._nativeOwner.pid === record.pid &&
            this._nativeOwner.startTime === record.startTime) || (this._homeOwns('original-xbox') &&
            nativeWindowForProcess(global.display.focus_window, record.pid) && this._home.matches(global.display.focus_window));
        return !Main.overview.visible && !Main.overview.animationInProgress && nativeWindowForProcess(global.display.focus_window, record.pid);
    }

    async _nativeGetState(_parameters, invocation) {
        let record = null, supported = false;
        try {
            const peer = await this._nativePeer(invocation);
            record = await peer.auth.verify(peer.pid);
            const current = await this._nativePeer(invocation);
            if (current.epoch !== peer.epoch || current.pid !== peer.pid || current.uid !== peer.uid) throw Error('unavailable');
            // Global support/active status is readable before enrollment, just
            // like the existing API. Permission and ownership are not inferred.
            supported = true;
            if (record && !peer.auth.current(record)) record = null;
        } catch { /* A disconnected or wrong-user caller receives no state. */ }
        const state = supported ? this._lease.state(invocation.get_sender()) : {active: false, owned: false};
        const owned = Boolean(record && state.owned && this._nativeOwner?.sender === invocation.get_sender() &&
            this._nativeOwner.pid === record.pid && this._nativeOwner.startTime === record.startTime);
        invocation.return_value(new GLib.Variant('(utbbbb)', [1, this._nativeRevision.epoch, supported, state.active,
            supported && this._nativeCanSet(record, invocation.get_sender()), owned]));
    }

    async _nativeSetMode(parameters, invocation) {
        const sender = invocation.get_sender();
        try {
            if (typeof parameters[0] !== 'boolean') throw Error('invalid-request');
            const record = await this._nativeCaller(invocation);
            this._nativeRevision.assert(parameters[1]);
            const state = this._lease.state(sender);
            if (parameters[0]) {
                if (!this._nativeCanSet(record, sender)) throw Error(state.active ? 'busy' :
                    Main.overview.visible || Main.overview.animationInProgress ? 'overview-open' : 'not-authorized');
                if (!state.active || this._homeOwns('original-xbox')) {
                    const adoptingHome = state.active;
                    this._nativeOwner = {...record, sender};
                    this._applicationPid = record.pid;
                    try {
                        this._nativeEnrollmentStop = this._nativeAuth.watch(record, () => {
                            if (this._nativeOwner?.sender === sender) this._lease?.forceLeave();
                        });
                        if (adoptingHome) this._lease.transfer(this._homeSender, sender, true);
                        else this._lease.enter(sender, true);
                        this._ownerWatch = Gio.bus_watch_name_on_connection(this._connection, sender,
                            Gio.BusNameWatcherFlags.NONE, null, () => this._lease?.ownerVanished(sender));
                    } catch (error) {
                        if (this._lease.state(sender).owned) this._lease.forceLeave();
                        else this._clearNativeOwner();
                        throw error;
                    }
                }
            } else if (state.active) {
                if (this._homeOwns('original-xbox') && this._nativeCanSet(record, sender)) this._lease.forceLeave();
                else {
                    if (!state.owned || this._nativeOwner?.sender !== sender) throw Error('not-authorized');
                    this._lease.leave(sender);
                }
            }
            const result = this._lease.state(sender);
            invocation.return_value(new GLib.Variant('(tbb)', [this._nativeRevision.epoch, result.active, result.owned]));
        } catch (error) {
            const code = Object.hasOwn(NATIVE_ERRORS, error.message) ? error.message : 'shell-error';
            invocation.return_dbus_error(NATIVE_ERRORS[code], code);
        }
    }

    GetStateAsync(_parameters, invocation) {
        const state = this._lease.state(invocation.get_sender());
        invocation.return_value(new GLib.Variant('(bb)', [state.active, state.owned]));
    }

    GetCapabilitiesAsync(_parameters, invocation) {
        invocation.return_value(new GLib.Variant('(u)', [4]));
    }

    async _callerMain(invocation) {
        const epoch = this._epoch, senderPid = await processId(this._connection, invocation.get_sender());
        if (!this._enabled || this._epoch !== epoch || !this._userSession()) throw Error('not-authorized');
        const parent = parentProcess(senderPid), ownUid = processUser('self');
        if (ownUid < 1 || processUser(senderPid) !== ownUid || processUser(parent) !== ownUid) throw Error('not-authorized');
        // Installed background service may not have any window yet. Portable
        // and development clients must already have an identifiable XBOKS
        // native window owned by the helper's actual parent process.
        const observed = global.get_window_actors().some(actor => {
            try { return actor.meta_window.get_pid() === parent && xboksWindow(actor.meta_window); } catch { return false; }
        });
        if (!installedMain(parent) && !observed) throw Error('not-authorized');
        return parent;
    }

    async GetForegroundAppAsync(_parameters, invocation) {
        try {
            this._applicationPid = await this._callerMain(invocation);
            const focused = global.display.focus_window;
            if (focused && !['XBOKS Game Bar', 'xboks Game Bar'].includes(focused.get_title())) this._foregroundWindow = focused;
            const window = this._foregroundWindow;
            let data = null;
            try {
                if (window) {
                    const app = Shell.WindowTracker.get_default().get_window_app(window);
                    data = {desktopId: boundedLabel(app?.get_id()), name: boundedLabel(app?.get_name()) || boundedLabel(window.get_wm_class()) || 'Application',
                        title: boundedLabel(window.get_title())};
                }
            } catch { /* The foreground window may have closed. */ }
            invocation.return_value(new GLib.Variant('(s)', [JSON.stringify(data)]));
        } catch { invocation.return_dbus_error(`${BUS}.Error`, 'not-authorized'); }
    }

    async FocusGuideAsync(_parameters, invocation) {
        try {
            const pid = await this._callerMain(invocation);
            const window = global.get_window_actors().map(actor => actor.meta_window).find(candidate => {
                try { return candidate.get_pid() === pid && ['XBOKS Game Bar', 'xboks Game Bar'].includes(candidate.get_title()) && xboksWindow(candidate); } catch { return false; }
            });
            if (!window) throw Error('guide-unavailable');
            this._switcher?.hide();
            Main.activateWindow(window, global.get_current_time());
            invocation.return_value(new GLib.Variant('()', []));
        } catch { invocation.return_dbus_error(`${BUS}.Error`, 'guide-unavailable'); }
    }

    SwitchAsync(parameters, invocation) {
        try {
            if (!this._enabled || !this._userSession() || !this._lease.state(invocation.get_sender()).owned || !SWITCH_ACTIONS.includes(parameters[0]))
                throw Error('not-authorized');
            invocation.return_value(new GLib.Variant('(b)', [this._switcher.action(parameters[0])]));
        } catch { invocation.return_dbus_error(`${BUS}.Error`, 'not-authorized'); }
    }

    _currentControlOwner() {
        if (this._homeOwns() && this._home.session.ready) return this._home.session;
        const owner = this._nativeOwner;
        return owner && this._enabled && this._nativeBusAvailable && this._userSession() &&
            this._lease?.state(owner.sender).owned && this._nativeAuth?.current(owner) ? owner : null;
    }

    async _trustedSwitcherController(invocation) {
        const epoch = this._epoch;
        if (!this._enabled || !this._userSession()) throw Error('unavailable');
        const parent = await this._callerMain(invocation);
        if (!this._enabled || this._epoch !== epoch || !this._connection || !this._userSession()) throw Error('unavailable');
        if (!installedMain(parent)) throw Error('not-authorized');
        const pid = await processId(this._connection, invocation.get_sender());
        if (!this._enabled || this._epoch !== epoch || !this._userSession()) throw Error('unavailable');
        if (parentProcess(pid) !== parent || !installedMain(parent) || processUser(pid) !== processUser('self'))
            throw Error('not-authorized');
        const owner = this._currentControlOwner();
        if (!owner) throw Error('not-authorized');
        return owner;
    }

    async GetSwitcherControlAsync(_parameters, invocation) {
        let owner = null;
        try { owner = await this._trustedSwitcherController(invocation); } catch { /* Permission is distinct from the lease. */ }
        const state = this._lease?.state(invocation.get_sender()) ?? {active: false, owned: false};
        const canControl = Boolean(owner && this._currentControlOwner() === owner);
        const visible = Boolean(this._userSession() && state.active && (state.owned || canControl) && this._switcher?.visible);
        invocation.return_value(new GLib.Variant('(tbbbb)', [this._controlRevision.epoch, state.active, state.owned, visible, canControl]));
    }

    async ControlSwitcherAsync(parameters, invocation) {
        try {
            if (!SWITCH_ACTIONS.includes(parameters[0])) throw Error('invalid-action');
            const owner = await this._trustedSwitcherController(invocation);
            try { this._controlRevision.assert(parameters[1]); } catch { throw Error('stale-control'); }
            if (this._currentControlOwner() !== owner || !this._switcher) throw Error('not-authorized');
            invocation.return_value(new GLib.Variant('(b)', [this._switcher.action(parameters[0])]));
        } catch (error) {
            const code = Object.hasOwn(CONTROL_ERRORS, error.message) ? error.message : 'shell-error';
            invocation.return_dbus_error(CONTROL_ERRORS[code], code);
        }
    }

    async EnterAsync(_parameters, invocation) {
        const sender = invocation.get_sender(), epoch = this._epoch;
        try {
            if (this._lease.active && !this._homeOwns('xboks')) {
                this._lease.enter(sender, false); // Existing owner is idempotent; all others fail.
            } else {
                const senderPid = await processId(this._connection, sender);
                if (!this._enabled || this._epoch !== epoch)
                    throw new Error('unavailable');
                const window = global.display.focus_window;
                const application = window && Shell.WindowTracker.get_default().get_window_app(window);
                const authorized = authorizedApplication({senderPid, parentPid: parentProcess(senderPid),
                    focusedPid: window?.get_pid(), applicationId: application?.get_id(),
                    wmClass: window?.get_wm_class(), userSession: this._userSession()});
                if (!authorized)
                    throw new Error('not-authorized');
                if (Main.overview.visible || Main.overview.animationInProgress)
                    throw new Error('overview-open');
                this._applicationPid = window.get_pid();
                if (this._homeOwns('xboks') && this._home.matches(window))
                    this._lease.transfer(this._homeSender, sender, true);
                else this._lease.enter(sender, true);
                if (!this._ownerWatch) {
                    this._ownerWatch = Gio.bus_watch_name_on_connection(this._connection, sender,
                        Gio.BusNameWatcherFlags.NONE, null, () => this._lease?.ownerVanished(sender));
                }
            }
            invocation.return_value(new GLib.Variant('()', []));
        } catch (error) {
            const code = ['busy', 'not-authorized', 'unavailable', 'overview-open', 'emergency-unavailable'].includes(error.message) ? error.message : 'shell-error';
            invocation.return_dbus_error(`${BUS}.Error`, code);
        }
    }

    LeaveAsync(_parameters, invocation) {
        try {
            this._lease.leave(invocation.get_sender());
            invocation.return_value(new GLib.Variant('()', []));
        } catch {
            invocation.return_dbus_error(`${BUS}.Error`, 'not-authorized');
        }
    }

    _connect(object, signal, callback) {
        const id = object.connect(signal, callback);
        this._connections.push([object, id]);
    }

    _apply() {
        // A guaranteed Shell-side escape is required before hiding anything.
        const action = global.display.grab_accelerator('<Control><Super>Escape', Meta.KeyBindingFlags.NONE);
        if (action === Meta.KeyBindingAction.NONE)
            throw new Error('emergency-unavailable');
        this._emergencyAction = action;
        Main.wm.allowKeybinding(Meta.external_binding_name_for_action(action), Shell.ActionMode.ALL);
        this._connect(global.display, 'accelerator-activated', (_display, activated) => {
            if (activated === this._emergencyAction)
                this._lease.forceLeave();
        });
        this._changes = new ReversibleChanges();
        this._switcher = new XboksSwitcher({leave: () => this._lease.forceLeave(), xbox: () => this._focusXbox(),
            homeLabel: this._home?.session?.id === 'steam' ? 'Steam Big Picture' : 'Linux Gaming Mode',
            allowed: () => this._lease?.active && this._userSession(),
            changed: visible => {
                this._controlRevision.bump();
                this._dbus?.emit_signal('SwitcherChanged', new GLib.Variant('(b)', [visible]));
            }});
        this._windowPolicy = new ExperienceWindowPolicy({allowed: () => this._lease?.active && this._userSession()});
        this._windowPolicy.start();
        this._connect(global.window_manager, 'map', () => this._home?.syncPerformance());
        this._leaseKeyboardSwitcher();
        this._leaseOverlayKey();
        this._changes.method(Main.overview, 'show', () => {});
        // Shell51's bare-Super overlay-key handler calls overview.toggle().
        // Lease this method, rather than modifying the user's overlay binding.
        this._changes.method(Main.overview, 'toggle', () => this._switcher?.toggle());
        // HotCorner._toggleOverview consults this method at activation time.
        // Preserve every existing barrier, including an originally zero size.
        this._changes.method(Main.overview, 'shouldToggleByCornerOrButton', () => false);
        if (Main.overview._swipeTracker)
            this._changes.property(Main.overview._swipeTracker, 'enabled', false);
        this._changes.hideActor(Main.layoutManager.panelBox);
        this._changes.hideActor(Main.overview.dash);
        this._hideDocks();
        this._connect(Main.layoutManager.uiGroup, 'child-added', (_group, child) => {
            if (child.name === 'dashtodockContainer')
                this._changes.hideActor(child);
        });
    }

    _leaseOverlayKey() {
        const display = global.display;
        const signal = GObject.signal_lookup('overlay-key', display.constructor.$gtype);
        if (!signal) throw Error('overlay-unavailable');
        const settings = new Gio.Settings({schema_id: 'org.gnome.desktop.a11y.keyboard'});
        const blocked = [];
        let own = 0, restored = false;
        const restore = () => {
            if (restored) return;
            restored = true;
            let failure = null;
            const attempt = action => { try { action(); } catch (error) { failure ??= error; } };
            attempt(() => {
                if (own && GObject.signal_handler_is_connected(display, own))
                    display.disconnect(own);
            });
            for (const id of blocked)
                attempt(() => {
                    if (GObject.signal_handler_is_connected(display, id))
                        GObject.signal_handler_unblock(display, id);
                });
            if (failure) throw failure;
        };
        try {
            const find = () => GObject.signal_handler_find(display,
                GObject.SignalMatchType.ID | GObject.SignalMatchType.UNBLOCKED,
                signal, 0, null, null, null);
            for (let count = 0; count < 64; count++) {
                const id = find();
                if (!id) break;
                if (!Number.isSafeInteger(id) || id < 1 || blocked.includes(id)) throw Error('overlay-unavailable');
                GObject.signal_handler_block(display, id);
                blocked.push(id);
            }
            if (find()) throw Error('overlay-unavailable');
            own = display.connect('overlay-key', () => {
                if (!this._lease?.active || !this._userSession()) return;
                // This handler owns the key only for the active mode. Stopping
                // emission also keeps later extension handlers from opening a
                // different surface while our switcher is in control.
                GObject.signal_stop_emission_by_name(display, 'overlay-key');
                try {
                    if (!settings.get_boolean('stickykeys-enable')) this._switcher?.toggle();
                } catch { /* Uncertain accessibility state must not consume it as navigation. */ }
            });
            if (!Number.isSafeInteger(own) || own < 1) throw Error('overlay-unavailable');
            this._changes.add(restore);
        } catch (error) {
            try { restore(); } catch { /* Each previously acquired block was attempted. */ }
            throw error;
        }
    }

    _leaseKeyboardSwitcher() {
        // Shell51's existing WM handlers construct one of these popups, call
        // show(backward, binding, mask), and destroy it when show returns false.
        // Lease that dispatch point so the user's keybindings and any custom
        // WM handlers remain intact. Restoring an unreadable native callback
        // to a guessed default would overwrite other extensions' handlers.
        const extension = this;
        const bindings = new Set(['switch-applications', 'switch-applications-backward',
            'switch-windows', 'switch-windows-backward']);
        for (const Popup of [AltTab.AppSwitcherPopup, AltTab.WindowSwitcherPopup]) {
            const original = Popup.prototype.show;
            this._changes.method(Popup.prototype, 'show', function (backward, binding, mask) {
                if (!extension._lease?.active || !extension._userSession() || !bindings.has(binding))
                    return original.call(this, backward, binding, mask);
                extension._switcher.keyboardSwitch(backward || binding.endsWith('-backward'), mask);
                // This unused stock popup has never grabbed the seat; its
                // normal destroy path cannot pop our independently owned grab.
                return false;
            });
        }
    }

    _hideDocks() {
        // Observed in the installed Ubuntu Dock source. No other extension's
        // settings, enablement or methods are modified.
        for (const actor of Main.layoutManager.uiGroup.get_children()) {
            if (actor.name === 'dashtodockContainer')
                this._changes.hideActor(actor);
        }
    }

    _focusXbox() {
        if (this._home?.session?.ready) { this._home.focus(); return; }
        if (this._nativeOwner) {
            const owner = this._nativeOwner;
            void this._nativeAuth.verify(owner.pid).then(record => {
                if (this._nativeOwner !== owner) return;
                if (!record || record.startTime !== owner.startTime) { this._lease.forceLeave(); return; }
                const windows = global.get_window_actors().map(actor => actor.meta_window).filter(candidate => {
                    try { return candidate.get_pid() === record.pid; } catch { return false; }
                });
                const window = windows.find(candidate => !candidate.get_transient_for?.()) ?? windows[0];
                if (window) Main.activateWindow(window, global.get_current_time());
            });
            return;
        }
        const window = global.get_window_actors().map(actor => actor.meta_window).find(candidate => {
            try { return candidate.get_pid() === this._applicationPid && !['XBOKS Game Bar', 'xboks Game Bar'].includes(candidate.get_title()) && xboksWindow(candidate); } catch { return false; }
        });
        if (window) Main.activateWindow(window, global.get_current_time());
    }

    _restore() {
        this._home?.stop();
        this._clearNativeOwner();
        this._switcher?.destroy();
        this._switcher = null;
        this._windowPolicy?.stop();
        this._windowPolicy = null;
        if (this._ownerWatch) {
            Gio.bus_unwatch_name(this._ownerWatch);
            this._ownerWatch = 0;
        }
        for (const [object, signal] of this._connections.splice(0)) {
            try { object.disconnect(signal); } catch { /* Actor may already be gone. */ }
        }
        for (const error of this._changes?.restore() ?? [])
            console.warn(`Linux Gaming Mode restoration: ${error.message}`);
        this._changes = null;
        if (this._emergencyAction !== Meta.KeyBindingAction.NONE) {
            Main.wm.allowKeybinding(Meta.external_binding_name_for_action(this._emergencyAction), Shell.ActionMode.NONE);
            global.display.ungrab_accelerator(this._emergencyAction);
            this._emergencyAction = Meta.KeyBindingAction.NONE;
        }
    }

    disable() {
        this._enabled = false;
        this._nativeBusAvailable = false;
        this._epoch = (this._epoch ?? 0) + 1;
        if (this._lease?.active)
            this._lease.forceLeave();
        else
            this._restore();
        if (this._sessionSignal) {
            Main.sessionMode.disconnect(this._sessionSignal);
            this._sessionSignal = 0;
        }
        if (this._busOwner) {
            Gio.bus_unown_name(this._busOwner);
            this._busOwner = 0;
        }
        this._dbus?.unexport();
        this._home?.destroy();
        this._home = null;
        this._homeDbus?.unexport();
        this._homeDbus = null;
        this._nativeDbus?.unexport();
        this._nativeDbus = null;
        this._nativeAuth = null;
        this._dbus = null;
        this._lease = null;
        this._connection = null;
    }
}
