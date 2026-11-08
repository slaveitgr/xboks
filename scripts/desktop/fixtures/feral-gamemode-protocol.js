// Synthetic daemon on a private test bus; never starts the host GameMode daemon.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {FeralGameMode} from '../../../desktop/gnome/xboks-experience@slaveitgr.github.io/feral-gamemode.js';

if (GLib.getenv('XBOKS_PRIVATE_GAMEMODE_TEST') !== '1' ||
    (GLib.getenv('DBUS_SESSION_BUS_ADDRESS') ?? '').includes('/run/user/'))
    throw Error('A private dbus-run-session bus is required.');
const BUS = 'com.feralinteractive.GameMode', PATH = '/com/feralinteractive/GameMode';
const connection = Gio.DBus.session, loop = new GLib.MainLoop(null, false);
const children = [], controllers = [], games = new Map(), calls = [];
let busOwner = 0, registerReply = 0, unregisterReply = 0, queryOverride = null, holdNext = false, held = null, timestamp = 100, failed = false;
const check = (value, message) => { if (!value) throw Error(message); };
const wait = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => { resolve(); return GLib.SOURCE_REMOVE; }));
async function until(predicate) {
    for (let i = 0; i < 500; i++) { if (predicate()) return; await wait(2); }
    throw Error('Fixture timed out.');
}
function sleepProcess() {
    const process = Gio.Subprocess.new(['/bin/sleep', '60'], Gio.SubprocessFlags.NONE);
    children.push(process); return Number(process.get_identifier());
}
function identity(pid) {
    const text = name => new TextDecoder().decode(GLib.file_get_contents(`/proc/${pid}/${name}`)[1]);
    const stat = text('stat'), fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
    return {pid: Number(stat.slice(0, stat.indexOf(' '))), uid: Number(text('status').match(/^Uid:\s+(\d+)/m)[1]), startTime: fields[19]};
}
function addGame(pid, requester) {
    removeGame(pid);
    const record = {pid, requester, timestamp: ++timestamp, object: null};
    record.object = Gio.DBusExportedObject.wrapJSObject(`<node><interface name="${BUS}.Game">
      <property name="ProcessId" type="i" access="read"/><property name="Requester" type="i" access="read"/>
      <property name="Timestamp" type="t" access="read"/></interface></node>`, {
        get ProcessId() { return record.pid; }, get Requester() { return record.requester; }, get Timestamp() { return record.timestamp; },
    });
    record.object.export(connection, `${PATH}/Games/${pid}`); games.set(pid, record);
}
function removeGame(pid) { const record = games.get(pid); record?.object.unexport(); games.delete(pid); }
const implementation = {
    QueryStatusByPID(requester, pid) { calls.push({method: 'query', requester, pid}); return queryOverride ?? (games.has(pid) ? 2 : games.size ? 1 : 0); },
    RegisterGameByPIDAsync([requester, pid], invocation) {
        calls.push({method: 'register', requester, pid});
        if (holdNext) { holdNext = false; held = {requester, pid, invocation}; return; }
        if (registerReply === 0) addGame(pid, requester);
        invocation.return_value(new GLib.Variant('(i)', [registerReply]));
    },
    UnregisterGameByPID(requester, pid) {
        calls.push({method: 'unregister', requester, pid});
        if (unregisterReply === 0) removeGame(pid);
        return unregisterReply;
    },
};
const object = Gio.DBusExportedObject.wrapJSObject(`<node><interface name="${BUS}">
  <method name="QueryStatusByPID"><arg direction="in" type="i"/><arg direction="in" type="i"/><arg direction="out" type="i"/></method>
  <method name="RegisterGameByPID"><arg direction="in" type="i"/><arg direction="in" type="i"/><arg direction="out" type="i"/></method>
  <method name="UnregisterGameByPID"><arg direction="in" type="i"/><arg direction="in" type="i"/><arg direction="out" type="i"/></method>
  <signal name="GameRegistered"><arg type="i"/><arg type="o"/></signal>
</interface></node>`, implementation);
object.export(connection, PATH);
const claim = () => new Promise(resolve => { busOwner = Gio.bus_own_name_on_connection(connection, BUS, Gio.BusNameOwnerFlags.NONE, resolve, null); });
const create = options => { const controller = new FeralGameMode(options); controllers.push(controller); return controller; };
const writes = method => calls.filter(call => call.method === method);
function reset() { calls.length = 0; registerReply = 0; unregisterReply = 0; queryOverride = null; for (const pid of [...games.keys()]) removeGame(pid); }

async function run() {
    const activatable = await new Promise((resolve, reject) => connection.call('org.freedesktop.DBus', '/org/freedesktop/DBus',
        'org.freedesktop.DBus', 'ListActivatableNames', null, new GLib.VariantType('(as)'), Gio.DBusCallFlags.NONE, 1000, null,
        (bus, result) => { try { resolve(bus.call_finish(result).deepUnpack()[0]); } catch (error) { reject(error); } }));
    check(!activatable.includes(BUS), 'Test bus must not contain the host daemon activation service.');
    await claim();
    const pid = sleepProcess(), otherPid = sleepProcess(), self = identity('self');
    let checks = 0;
    {
        const controller = create(); await controller.setProcesses([pid]);
        check(controller.state.state === 'disabled' && !writes('register').length, 'Disabled feature mutated the daemon.'); checks++;
        await controller.setEnabled(true);
        check(controller.state.state === 'active', 'A confirmed registration was not active.');
        check(writes('register').length === 1 && writes('register')[0].requester === self.pid && writes('register')[0].pid === pid,
            'ByPID order must be requester, target.'); checks += 2;
        check(writes('query').length >= 2, 'Registration was not confirmed with a real query.'); checks++;
        const count = calls.length;
        await controller.setEnabled(true); check(calls.length === count, 'Unchanged enabled input repeated daemon queries.'); checks++;
        await controller.setProcesses([pid]); check(calls.length === count, 'Unchanged process input repeated daemon queries.'); checks++;
        await controller.stop(); check(writes('unregister').length === 1 && !games.has(pid), 'Owned request was not removed.'); checks++;
    }
    reset();
    {
        addGame(pid, otherPid); const controller = create(); await controller.setProcesses([pid]); await controller.setEnabled(true);
        check(controller.state.state === 'active' && !writes('register').length, 'Existing registration should be observed.'); checks++;
        await controller.stop(); check(games.get(pid)?.requester === otherPid && !writes('unregister').length, 'Another client was unregistered.'); checks++;
    }
    reset();
    {
        registerReply = -2; const controller = create(); await controller.setProcesses([pid]); await controller.setEnabled(true);
        check(controller.state.state === 'error', 'Rejected registration claimed active.'); checks++;
        await controller.stop(); check(!writes('unregister').length, 'Rejected request was unregistered.'); checks++;
    }
    reset();
    {
        queryOverride = 1; const controller = create(); await controller.setProcesses([pid]); await controller.setEnabled(true);
        check(controller.state.state === 'error', 'Successful reply without QueryStatus 2 claimed active.'); checks++;
        await controller.stop(); check(writes('unregister').length === 1, 'Unconfirmed successful registration was not cleaned.'); checks++;
    }
    reset();
    {
        holdNext = true; const controller = create(); await controller.setProcesses([pid]); const start = controller.setEnabled(true);
        await until(() => held !== null); const stop = controller.stop();
        const pending = held; held = null; addGame(pending.pid, pending.requester); pending.invocation.return_value(new GLib.Variant('(i)', [0]));
        await Promise.all([start, stop]);
        check(controller.state.state === 'disabled' && !games.has(pid) && writes('unregister').length === 1, 'Late successful registration survived stop.'); checks++;
    }
    reset();
    {
        const controller = create(); await controller.setProcesses([pid]); await controller.setEnabled(true);
        games.get(pid).requester = otherPid; await controller.stop();
        check(!writes('unregister').length && games.has(pid), 'Replaced requester was not preserved.'); checks++;
    }
    reset();
    {
        const controller = create(); await controller.setProcesses([pid]); await controller.setEnabled(true);
        games.get(pid).timestamp++; await controller.stop();
        check(!writes('unregister').length && games.has(pid), 'Replaced registration timestamp was not preserved.'); checks++;
    }
    reset();
    {
        const controller = create(); await controller.setProcesses([pid, otherPid]); await controller.setEnabled(true);
        unregisterReply = -2; await controller.stop();
        check(controller.state.state === 'error' && games.has(pid) && writes('unregister').length === 2, 'Cleanup failure prevented another cleanup attempt.'); checks++;
        unregisterReply = 0; await controller.stop();
        check(controller.state.state === 'disabled' && !games.size && writes('unregister').length === 4, 'Owned cleanup could not be retried.'); checks++;
    }
    reset();
    {
        let changed = false; const original = identity(pid);
        const controller = create({inspectProcess: candidate => candidate === 'self' ? self : candidate === pid
            ? {...original, startTime: changed ? original.startTime + '1' : original.startTime} : null});
        await controller.setProcesses([pid]); await controller.setEnabled(true); changed = true; await controller.stop();
        check(!writes('unregister').length, 'Reused PID was unregistered.'); checks++;
    }
    reset();
    {
        let foreign = false; const original = identity(pid);
        const controller = create({inspectProcess: candidate => candidate === 'self' ? self : candidate === pid
            ? {...original, uid: foreign ? self.uid + 1 : self.uid} : null});
        await controller.setProcesses([pid]); await controller.setEnabled(true); foreign = true; await controller.stop();
        check(!writes('unregister').length, 'Changed UID was unregistered.'); checks++;
    }
    reset();
    {
        const controller = create(); await controller.setProcesses([self.pid, 0, -1, 0x80000000, NaN, 1]); await controller.setEnabled(true);
        check(controller.state.state === 'requesting' && !writes('register').length, 'Shell, invalid or foreign process was registered.'); checks++;
        await controller.destroy(); await controller.setEnabled(true); check(controller.state.state === 'disabled', 'Destroyed controller restarted.'); checks++;
    }
    reset();
    {
        const controller = create(); await controller.setProcesses([pid]); await controller.setEnabled(true);
        Gio.bus_unown_name(busOwner); busOwner = 0; await until(() => controller.state.state === 'unavailable');
        check(controller.state.state === 'unavailable', 'Daemon loss left an active claim.'); checks++;
        check(!writes('unregister').length, 'Old registration was sent to a lost daemon.'); checks++;
        for (const game of [...games.keys()]) removeGame(game);
        await claim(); await until(() => controller.state.state === 'active');
        check(writes('register').length === 2 && !writes('unregister').length, 'Daemon recovery reused a stale registration.'); checks++;
        await controller.stop(); check(writes('unregister').length === 1, 'Recovered daemon request was not cleaned.'); checks++;
    }
    print(JSON.stringify({status: 'passed', checks, hostDaemonTouched: false, requesterBeforeTarget: true, pidReuseProtected: true}));
}
run().catch(error => { printerr(error.stack ?? error); failed = true; }).finally(async () => {
    for (const controller of controllers) await controller.destroy();
    for (const pid of [...games.keys()]) removeGame(pid);
    for (const process of children) { try { process.force_exit(); } catch { /* Fixture child already exited. */ } }
    if (busOwner) Gio.bus_unown_name(busOwner);
    object.unexport(); loop.quit();
});
loop.run();
if (failed) imports.system.exit(1);
