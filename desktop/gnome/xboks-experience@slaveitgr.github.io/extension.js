// SPDX-License-Identifier: MIT
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as AltTab from 'resource:///org/gnome/shell/ui/altTab.js';
import {ExperienceLease, ReversibleChanges, authorizedApplication} from './state.js';
import {XboksSwitcher} from './switcher.js';
import {ExperienceWindowPolicy} from './window-policy.js';
import {SWITCH_ACTIONS, boundedLabel} from './switcher-state.js';

const BUS = 'org.slaveitgr.Xboks.Experience';
const OBJECT = '/org/slaveitgr/Xboks/Experience';
const INTERFACE = `<node><interface name="${BUS}">
  <method name="GetState"><arg type="b" direction="out" name="active"/><arg type="b" direction="out" name="owned"/></method>
  <method name="Enter"/><method name="Leave"/>
  <method name="GetCapabilities"><arg type="u" direction="out" name="version"/></method>
  <method name="GetForegroundApp"><arg type="s" direction="out" name="json"/></method>
  <method name="FocusGuide"/>
  <method name="Switch"><arg type="s" direction="in" name="action"/><arg type="b" direction="out" name="visible"/></method>
  <signal name="StateChanged"><arg type="b" name="active"/></signal>
  <signal name="SwitcherChanged"><arg type="b" name="visible"/></signal>
</interface></node>`;

function processId(connection, sender) {
    return new Promise((resolve, reject) => connection.call(
        'org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'GetConnectionUnixProcessID',
        new GLib.Variant('(s)', [sender]), new GLib.VariantType('(u)'), Gio.DBusCallFlags.NONE, 2000, null,
        (bus, result) => {
            try { resolve(bus.call_finish(result).deepUnpack()[0]); } catch (error) { reject(error); }
        }));
}

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
        this._ownerWatch = 0;
        this._connections = [];
        this._changes = null;
        this._switcher = null;
        this._windowPolicy = null;
        this._foregroundWindow = null;
        this._applicationPid = 0;
        this._emergencyAction = Meta.KeyBindingAction.NONE;
        this._lease = new ExperienceLease(() => this._apply(), () => this._restore(), active => {
            this._dbus?.emit_signal('StateChanged', new GLib.Variant('(b)', [active]));
        });
        this._dbus = Gio.DBusExportedObject.wrapJSObject(INTERFACE, this);
        this._dbus.export(this._connection, OBJECT);
        this._busOwner = Gio.bus_own_name_on_connection(this._connection, BUS, Gio.BusNameOwnerFlags.NONE,
            null, () => this._lease?.forceLeave());
        this._sessionSignal = Main.sessionMode.connect('updated', () => {
            if (!this._userSession())
                this._lease.forceLeave();
        });
    }

    _userSession() {
        return !Main.sessionMode.isLocked && !Main.sessionMode.isGreeter &&
            (Main.sessionMode.currentMode === 'user' || Main.sessionMode.parentMode === 'user');
    }

    GetStateAsync(_parameters, invocation) {
        const state = this._lease.state(invocation.get_sender());
        invocation.return_value(new GLib.Variant('(bb)', [state.active, state.owned]));
    }

    GetCapabilitiesAsync(_parameters, invocation) {
        invocation.return_value(new GLib.Variant('(u)', [3]));
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

    async EnterAsync(_parameters, invocation) {
        const sender = invocation.get_sender(), epoch = this._epoch;
        try {
            if (this._lease.active) {
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
                this._lease.enter(sender, true);
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
            allowed: () => this._lease?.active && this._userSession(),
            changed: visible => this._dbus?.emit_signal('SwitcherChanged', new GLib.Variant('(b)', [visible]))});
        this._windowPolicy = new ExperienceWindowPolicy({allowed: () => this._lease?.active && this._userSession()});
        this._windowPolicy.start();
        this._leaseKeyboardSwitcher();
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
        const window = global.get_window_actors().map(actor => actor.meta_window).find(candidate => {
            try { return candidate.get_pid() === this._applicationPid && !['XBOKS Game Bar', 'xboks Game Bar'].includes(candidate.get_title()) && xboksWindow(candidate); } catch { return false; }
        });
        if (window) Main.activateWindow(window, global.get_current_time());
    }

    _restore() {
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
            console.warn(`XBOKS Experience restoration: ${error.message}`);
        this._changes = null;
        if (this._emergencyAction !== Meta.KeyBindingAction.NONE) {
            Main.wm.allowKeybinding(Meta.external_binding_name_for_action(this._emergencyAction), Shell.ActionMode.NONE);
            global.display.ungrab_accelerator(this._emergencyAction);
            this._emergencyAction = Meta.KeyBindingAction.NONE;
        }
    }

    disable() {
        this._enabled = false;
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
        this._dbus = null;
        this._lease = null;
        this._connection = null;
    }
}
