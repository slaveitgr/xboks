// Synthetic permission-denied Spotify bus. Run ONLY inside dbus-run-session.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
const loop = new GLib.MainLoop(null, false), connection = Gio.DBus.session;
const service = Gio.DBusExportedObject.wrapJSObject(`<node><interface name="org.freedesktop.DBus.Properties">
<method name="GetAll"><arg type="s" direction="in"/><arg type="a{sv}" direction="out"/></method>
</interface></node>`, {
    GetAllAsync(params, invocation) {
        print(JSON.stringify({event: 'denied', interface: params[0]}));
        invocation.return_dbus_error('org.freedesktop.DBus.Error.AccessDenied', 'Synthetic security policy denied the read.');
    },
});
service.export(connection, '/org/mpris/MediaPlayer2');
Gio.bus_own_name_on_connection(connection, 'org.mpris.MediaPlayer2.spotify', Gio.BusNameOwnerFlags.NONE,
    () => print(JSON.stringify({event: 'ready'})), () => loop.quit());
loop.run();
