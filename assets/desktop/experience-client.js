// SPDX-License-Identifier: MIT
// Persistent GJS transport. It does not install/enable an extension or request a
// mode change until the parent explicitly sends an enter/leave JSONL command.
import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix';
import GLib from 'gi://GLib';
import GLibUnix from 'gi://GLibUnix';

const BUS = 'org.slaveitgr.Xboks.Experience';
const OBJECT = '/org/slaveitgr/Xboks/Experience';
const loop = new GLib.MainLoop(null, false);
const connection = Gio.bus_get_sync(Gio.BusType.SESSION, null);
const input = new GioUnix.InputStream({fd: 0, close_fd: false});
const cancellation = new Gio.Cancellable();
let active = false, owned = false, canControlSwitcher = false, visible = false;
let controlEpoch, controlProtocol = null, refreshSerial = 0, appliedRefreshSerial = 0;
let stopping = false, epoch = 0;
let available = false, pending = new Uint8Array(), queued = 0, chain = Promise.resolve();
const output = value => print(JSON.stringify(value));
let initiallyReady;
const initialWatch = new Promise(resolve => { initiallyReady = resolve; });

function stateFields() {
    return {active, owned, canControlSwitcher, visible, ...(controlEpoch === undefined ? {} : {controlEpoch})};
}

function clearState() {
    active = false; owned = false; canControlSwitcher = false; visible = false;
    controlEpoch = undefined; controlProtocol = null;
}

function remote(method, expected = '()', parameters = null) {
    const generation = epoch;
    return new Promise((resolve, reject) => {
        connection.call(BUS, OBJECT, BUS, method, parameters, new GLib.VariantType(expected),
            Gio.DBusCallFlags.NO_AUTO_START, 3000, null, (bus, result) => {
                try {
                    const value = bus.call_finish(result).deepUnpack();
                    if (generation !== epoch)
                        throw new Error('unavailable');
                    resolve(value);
                } catch (error) {
                    reject(error);
                }
            });
    });
}

async function refresh(event = null, legacyVisible) {
    const generation = epoch, serial = ++refreshSerial;
    let snapshot;
    if (controlProtocol !== false) {
        try {
            const [token, nextActive, nextOwned, nextVisible, canControl] = await remote('GetSwitcherControl', '(tbbbb)');
            if (!Number.isSafeInteger(token) || token < 1 ||
                [nextActive, nextOwned, nextVisible, canControl].some(value => typeof value !== 'boolean'))
                throw new Error('invalid-response');
            snapshot = {active: nextActive, owned: nextOwned, visible: nextVisible, canControlSwitcher: canControl, controlEpoch: token};
        } catch (error) {
            if (errorCode(error) !== 'unsupported')
                throw error;
        }
    }
    if (!snapshot) {
        const [nextActive, nextOwned] = await remote('GetState', '(bb)');
        if (typeof nextActive !== 'boolean' || typeof nextOwned !== 'boolean')
            throw new Error('invalid-response');
        snapshot = {active: nextActive, owned: nextOwned, canControlSwitcher: false,
            visible: nextOwned && (legacyVisible ?? visible), controlEpoch: undefined};
    }
    // Signals and command replies can trigger overlapping queries. Order them
    // by query serial, and never let a delayed older control snapshot undo a newer
    // observation from this service owner.
    if (generation !== epoch || serial < appliedRefreshSerial ||
        (controlEpoch !== undefined && snapshot.controlEpoch !== undefined && snapshot.controlEpoch < controlEpoch))
        return;
    appliedRefreshSerial = serial;
    ({active, owned, canControlSwitcher, visible, controlEpoch} = snapshot);
    controlProtocol = controlEpoch !== undefined;
    if (event)
        output({event, ...stateFields()});
}

function errorCode(error) {
    const message = String(error?.message ?? '');
    if (message.includes('UnknownMethod'))
        return 'unsupported';
    for (const code of ['not-authorized', 'emergency-unavailable', 'overview-open', 'shell-error', 'busy', 'stale-control', 'unavailable', 'invalid-action']) {
        if (message.endsWith(code))
            return code;
    }
    return available ? 'transport-error' : 'unavailable';
}

async function command(line) {
    let request;
    try {
        request = JSON.parse(line);
        if (!request || !Number.isInteger(request.id) || request.id < 1 || request.id > 2147483647 ||
            !['state', 'enter', 'leave', 'foreground', 'focus-guide', 'capabilities', 'switcher'].includes(request.method) ||
            Object.keys(request).some(key => !['id', 'method', 'action', 'controlEpoch'].includes(key)) ||
            (request.method === 'switcher' ?
                !['toggle', 'open', 'next', 'previous', 'accept', 'cancel', 'desktop', 'xbox', 'up', 'down', 'left', 'right', 'close-window'].includes(request.action) ||
                (Object.hasOwn(request, 'controlEpoch') && (!Number.isSafeInteger(request.controlEpoch) || request.controlEpoch < 1)) :
                request.action !== undefined || Object.hasOwn(request, 'controlEpoch')))
            throw new Error('invalid-command');
    } catch {
        output({id: Number.isInteger(request?.id) ? request.id : 0, ok: false, ...stateFields(), error: 'invalid-command'});
        return;
    }
    try {
        await initialWatch;
        const extra = {};
        if (request.method === 'enter')
            await remote('Enter');
        else if (request.method === 'leave')
            await remote('Leave');
        else if (request.method === 'foreground') {
            const [json] = await remote('GetForegroundApp', '(s)');
            if (typeof json !== 'string' || json.length > 4096)
                throw new Error('invalid-response');
            extra.app = JSON.parse(json);
        } else if (request.method === 'focus-guide')
            await remote('FocusGuide');
        else if (request.method === 'capabilities') {
            try { [extra.version] = await remote('GetCapabilities', '(u)'); }
            catch (error) { if (errorCode(error) === 'unsupported') extra.version = 1; else throw error; }
        } else if (request.method === 'switcher') {
            // The token belongs to the role observed when the parent queued this
            // action. Never replace it or upgrade an old owner-only command.
            [extra.visible] = Object.hasOwn(request, 'controlEpoch') ?
                await remote('ControlSwitcher', '(b)', new GLib.Variant('(st)', [request.action, request.controlEpoch])) :
                await remote('Switch', '(b)', new GLib.Variant('(s)', [request.action]));
            if (typeof extra.visible !== 'boolean')
                throw new Error('invalid-response');
        }
        await refresh(null, extra.visible);
        delete extra.visible;
        output({id: request.id, ok: true, ...stateFields(), ...extra});
    } catch (error) {
        const code = errorCode(error);
        if (available)
            await refresh().catch(() => {});
        output({id: request.id, ok: false, ...stateFields(), error: code});
    }
}

function enqueue(line) {
    if (++queued > 16) {
        void stop();
        return;
    }
    chain = chain.then(() => stopping ? undefined : command(line)).finally(() => { queued--; });
}

async function readInput() {
    const decoder = new TextDecoder('utf-8', {fatal: true});
    try {
        while (!stopping) {
            const bytes = await new Promise((resolve, reject) => input.read_bytes_async(4096, GLib.PRIORITY_DEFAULT, cancellation,
                (stream, result) => {
                    try { resolve(stream.read_bytes_finish(result).get_data() ?? new Uint8Array()); } catch (error) { reject(error); }
                }));
            if (bytes.length === 0)
                break;
            const combined = new Uint8Array(pending.length + bytes.length);
            combined.set(pending); combined.set(bytes, pending.length);
            pending = combined;
            if (pending.length > 8192)
                throw new Error('Input exceeds the protocol limit.');
            let newline;
            while ((newline = pending.indexOf(10)) !== -1) {
                const lineBytes = pending.slice(0, newline);
                pending = pending.slice(newline + 1);
                if (lineBytes.length > 4096)
                    throw new Error('Input line exceeds the protocol limit.');
                const line = decoder.decode(lineBytes);
                if (line.trim())
                    enqueue(line);
            }
        }
        if (!stopping)
            await chain; // Complete commands already received before normal EOF.
    } catch {
        // Invalid/oversized input closes the owned connection and its lease.
    }
    await stop();
}

async function stop() {
    if (stopping)
        return;
    stopping = true;
    cancellation.cancel();
    try {
        // Never leave another client's mode. Closing this connection is the
        // authoritative fail-safe even if a final Leave request cannot finish.
        if (owned && available)
            await remote('Leave');
    } catch { /* Owner disappearance restores the shell. */ }
    finally {
        try { connection.close_sync(null); } catch { /* Already disconnected. */ }
        loop.quit();
    }
}

const nameWatch = Gio.bus_watch_name_on_connection(connection, BUS, Gio.BusNameWatcherFlags.NONE,
    () => {
        available = true;
        epoch++;
        clearState();
        initiallyReady();
        const generation = epoch, serial = refreshSerial + 1;
        void refresh('state').catch(() => {
            if (generation !== epoch || serial < appliedRefreshSerial)
                return;
            clearState();
            output({event: 'unavailable', ...stateFields()});
        });
    },
    () => {
        available = false;
        epoch++;
        initiallyReady();
        clearState();
        output({event: 'unavailable', ...stateFields()});
    });
const stateSignal = connection.signal_subscribe(BUS, BUS, 'StateChanged', OBJECT, null, Gio.DBusSignalFlags.NONE,
    () => void refresh('state').catch(() => {}));
const switcherSignal = connection.signal_subscribe(BUS, BUS, 'SwitcherChanged', OBJECT, null, Gio.DBusSignalFlags.NONE,
    (_bus, _sender, _path, _iface, _signal, parameters) => {
        const [visible] = parameters.deepUnpack();
        if (typeof visible === 'boolean')
            void refresh('switcher', visible).catch(() => {});
    });
const closed = connection.connect('closed', () => {
    epoch++;
    clearState(); available = false;
    output({event: 'unavailable', ...stateFields()});
    void stop();
});
// Older GLib typelibs expose Unix signal watches through GLib itself.
const signalAdd = typeof GLibUnix.signal_add === 'function' ? GLibUnix.signal_add : GLib.unix_signal_add;
const signals = [2, 15].map(signal => signalAdd(GLib.PRIORITY_DEFAULT, signal, () => {
    void stop();
    return GLib.SOURCE_REMOVE;
}));
void readInput();
loop.run();
Gio.bus_unwatch_name(nameWatch);
connection.signal_unsubscribe(stateSignal);
connection.signal_unsubscribe(switcherSignal);
connection.disconnect(closed);
for (const signal of signals) {
    if (GLib.MainContext.default().find_source_by_id(signal))
        GLib.Source.remove(signal);
}
