// Synthetic service used only under dbus-run-session by tests. No Shell imports.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
const BUS = 'org.slaveitgr.Xboks.Experience', OBJECT = '/org/slaveitgr/Xboks/Experience';
const loop = new GLib.MainLoop(null, false), connection = Gio.DBus.session;
let owner = null, watch = 0;
const event = (reason, active) => {
    print(JSON.stringify({event: reason, active}));
    exported.emit_signal('StateChanged', new GLib.Variant('(b)', [active]));
};
const service = {
    GetStateAsync(_params, invocation) {
        invocation.return_value(new GLib.Variant('(bb)', [owner !== null, owner === invocation.get_sender()]));
    },
    EnterAsync(_params, invocation) {
        const sender = invocation.get_sender();
        if (owner && owner !== sender) {
            invocation.return_dbus_error(`${BUS}.Error`, 'busy');
            return;
        }
        owner = sender;
        watch = Gio.bus_watch_name_on_connection(connection, sender, Gio.BusNameWatcherFlags.NONE, null, () => {
            if (owner === sender) {
                owner = null;
                Gio.bus_unwatch_name(watch); watch = 0;
                event('owner-lost', false);
            }
        });
        event('entered', true);
        invocation.return_value(new GLib.Variant('()', []));
    },
    LeaveAsync(_params, invocation) {
        if (owner && owner !== invocation.get_sender()) {
            invocation.return_dbus_error(`${BUS}.Error`, 'not-authorized');
            return;
        }
        owner = null;
        if (watch) { Gio.bus_unwatch_name(watch); watch = 0; }
        event('left', false);
        invocation.return_value(new GLib.Variant('()', []));
    },
};
const exported = Gio.DBusExportedObject.wrapJSObject(`<node><interface name="${BUS}">
<method name="GetState"><arg type="b" direction="out"/><arg type="b" direction="out"/></method>
<method name="Enter"/><method name="Leave"/><signal name="StateChanged"><arg type="b"/></signal>
</interface></node>`, service);
exported.export(connection, OBJECT);
Gio.bus_own_name_on_connection(connection, BUS, Gio.BusNameOwnerFlags.NONE,
    () => print(JSON.stringify({event: 'ready'})), () => loop.quit());
loop.run();
