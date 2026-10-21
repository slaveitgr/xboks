// SPDX-License-Identifier: MIT
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {ExperienceLease, ReversibleChanges, authorizedApplication} from './state.js';

const BUS = 'org.slaveitgr.Xboks.Experience';
const OBJECT = '/org/slaveitgr/Xboks/Experience';
const INTERFACE = `<node><interface name="${BUS}">
  <method name="GetState"><arg type="b" direction="out" name="active"/><arg type="b" direction="out" name="owned"/></method>
  <method name="Enter"/><method name="Leave"/>
  <signal name="StateChanged"><arg type="b" name="active"/></signal>
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

export default class XboksExperience extends Extension {
    enable() {
        this._enabled = true;
        this._epoch = (this._epoch ?? 0) + 1;
        this._connection = Gio.DBus.session;
        this._ownerWatch = 0;
        this._connections = [];
        this._changes = null;
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
        this._changes.method(Main.overview, 'show', () => {});
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

    _hideDocks() {
        // Observed in the installed Ubuntu Dock source. No other extension's
        // settings, enablement or methods are modified.
        for (const actor of Main.layoutManager.uiGroup.get_children()) {
            if (actor.name === 'dashtodockContainer')
                this._changes.hideActor(actor);
        }
    }

    _restore() {
        if (this._ownerWatch) {
            Gio.bus_unwatch_name(this._ownerWatch);
            this._ownerWatch = 0;
        }
        for (const [object, signal] of this._connections.splice(0)) {
            try { object.disconnect(signal); } catch { /* Actor may already be gone. */ }
        }
        for (const error of this._changes?.restore() ?? [])
            console.warn(`xboks Experience restoration: ${error.message}`);
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
