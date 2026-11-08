// Synthetic protocol service. Launched only on a test-owned dbus-run-session bus.
// It neither imports Shell nor changes a desktop session.
import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix';
import GLib from 'gi://GLib';

const BUS = 'org.slaveitgr.Xboks.Experience', OBJECT = '/org/slaveitgr/Xboks/Experience';
if (GLib.getenv('XBOKS_PRIVATE_PROTOCOL_TEST') !== '1')
    throw new Error('This fixture requires its private protocol test runner.');
const loop = new GLib.MainLoop(null, false), connection = Gio.DBus.session;
const legacy = ARGV.includes('--v3');
const nativeOwner = connection.get_unique_name();
let owner = nativeOwner, visible = false, delegated = true, controlEpoch = 1, watch = 0;
let holdNext = false, held = null;
const output = value => print(JSON.stringify(value));
const snapshot = sender => {
    const owned = owner === sender;
    const canControl = !owned && owner === nativeOwner && delegated;
    return [controlEpoch, owner !== null, owned, visible && (owned || canControl), canControl];
};
function stateChanged() {
    controlEpoch++;
    exported.emit_signal('StateChanged', new GLib.Variant('(b)', [owner !== null]));
}
function setVisible(next) {
    if (visible === next)
        return;
    visible = next; controlEpoch++;
    exported.emit_signal('SwitcherChanged', new GLib.Variant('(b)', [visible]));
}
function setOwner(next) {
    if (watch) { Gio.bus_unwatch_name(watch); watch = 0; }
    owner = next;
    setVisible(false);
    stateChanged();
    if (owner && owner !== nativeOwner) {
        const sender = owner;
        watch = Gio.bus_watch_name_on_connection(connection, sender, Gio.BusNameWatcherFlags.NONE, null, () => {
            if (owner === sender) {
                setOwner(null);
                output({event: 'owner-lost'});
            }
        });
    }
}
const fail = (invocation, error) => invocation.return_dbus_error(`${BUS}.Error`, error);
function switchAction(action, invocation) {
    const actions = ['toggle', 'open', 'next', 'previous', 'accept', 'cancel', 'desktop', 'xbox', 'up', 'down', 'left', 'right', 'close-window'];
    if (!actions.includes(action)) {
        fail(invocation, 'invalid-action'); return;
    }
    if (action === 'toggle') setVisible(!visible);
    else if (action === 'open') setVisible(true);
    else if (['accept', 'cancel', 'desktop', 'xbox'].includes(action)) setVisible(false);
    invocation.return_value(new GLib.Variant('(b)', [visible]));
}
const service = {
    GetCapabilities() { return legacy ? 3 : 4; },
    GetStateAsync(_parameters, invocation) {
        output({method: 'GetState'});
        invocation.return_value(new GLib.Variant('(bb)', [owner !== null, owner === invocation.get_sender()]));
    },
    GetSwitcherControlAsync(_parameters, invocation) {
        const value = snapshot(invocation.get_sender());
        output({method: 'GetSwitcherControl', controlEpoch: value[0], held: holdNext});
        if (holdNext) { holdNext = false; held = {invocation, value}; }
        else invocation.return_value(new GLib.Variant('(tbbbb)', value));
    },
    ControlSwitcherAsync([action, expectedControlEpoch], invocation) {
        output({method: 'ControlSwitcher', action, expectedControlEpoch});
        if (!snapshot(invocation.get_sender())[4]) {
            fail(invocation, 'not-authorized'); return;
        }
        if (expectedControlEpoch !== controlEpoch) {
            fail(invocation, 'stale-control'); return;
        }
        switchAction(action, invocation);
    },
    SwitchAsync([action], invocation) {
        output({method: 'Switch', action});
        if (!owner || owner !== invocation.get_sender()) {
            fail(invocation, 'not-authorized'); return;
        }
        switchAction(action, invocation);
    },
    EnterAsync(_parameters, invocation) {
        output({method: 'Enter'});
        const sender = invocation.get_sender();
        if (owner && owner !== sender) { fail(invocation, 'busy'); return; }
        if (owner !== sender) setOwner(sender);
        invocation.return_value(new GLib.Variant('()', []));
    },
    LeaveAsync(_parameters, invocation) {
        output({method: 'Leave', nativeOwned: owner === nativeOwner});
        if (owner && owner !== invocation.get_sender()) { fail(invocation, 'not-authorized'); return; }
        if (owner !== null) setOwner(null);
        invocation.return_value(new GLib.Variant('()', []));
    },
};
const exported = Gio.DBusExportedObject.wrapJSObject(`<node><interface name="${BUS}">
<method name="GetCapabilities"><arg type="u" direction="out"/></method>
<method name="GetState"><arg type="b" direction="out"/><arg type="b" direction="out"/></method>
${legacy ? '' : `<method name="GetSwitcherControl"><arg type="t" direction="out"/><arg type="b" direction="out"/><arg type="b" direction="out"/><arg type="b" direction="out"/><arg type="b" direction="out"/></method>
<method name="ControlSwitcher"><arg type="s" direction="in"/><arg type="t" direction="in"/><arg type="b" direction="out"/></method>`}
<method name="Switch"><arg type="s" direction="in"/><arg type="b" direction="out"/></method>
<method name="Enter"/><method name="Leave"/>
<signal name="StateChanged"><arg type="b"/></signal><signal name="SwitcherChanged"><arg type="b"/></signal>
</interface></node>`, service);
exported.export(connection, OBJECT);
const name = Gio.bus_own_name_on_connection(connection, BUS, Gio.BusNameOwnerFlags.NONE,
    () => output({event: 'ready', legacy}), () => loop.quit());
const input = new Gio.DataInputStream({base_stream: new GioUnix.InputStream({fd: 0, close_fd: false})});
function readCommand() {
    input.read_line_async(GLib.PRIORITY_DEFAULT, null, (stream, result) => {
        const [line] = stream.read_line_finish_utf8(result);
        if (line === null) { loop.quit(); return; }
        const request = JSON.parse(line);
        if (request.command === 'native') setOwner(request.active ? nativeOwner : null);
        else if (request.command === 'delegation') { delegated = request.allowed; stateChanged(); }
        else if (request.command === 'visibility') setVisible(request.visible);
        else if (request.command === 'hold-next-query') holdNext = true;
        else if (request.command === 'release-query') {
            held.invocation.return_value(new GLib.Variant('(tbbbb)', held.value)); held = null;
        } else if (request.command === 'drop-name') Gio.bus_unown_name(name);
        else if (request.command === 'inspect') { /* Read the fixture acknowledgment below. */ }
        else throw new Error(`Unknown fixture command: ${request.command}`);
        output({event: 'fixture', id: request.id, controlEpoch, nativeOwned: owner === nativeOwner, visible});
        readCommand();
    });
}
readCommand();
loop.run();
