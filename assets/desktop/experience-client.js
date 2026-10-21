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
let active = false, owned = false, stopping = false, epoch = 0;
let available = false, pending = new Uint8Array(), queued = 0, chain = Promise.resolve();
const output = value => print(JSON.stringify(value));
let initiallyReady;
const initialWatch = new Promise(resolve => { initiallyReady = resolve; });

function remote(method, expected = '()') {
    const generation = epoch;
    return new Promise((resolve, reject) => {
        connection.call(BUS, OBJECT, BUS, method, null, new GLib.VariantType(expected),
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

async function refresh(emit = false) {
    const state = await remote('GetState', '(bb)');
    [active, owned] = state;
    if (emit)
        output({event: 'state', active, owned});
}

function errorCode(error) {
    const message = String(error?.message ?? '');
    for (const code of ['not-authorized', 'emergency-unavailable', 'overview-open', 'shell-error', 'busy']) {
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
            !['state', 'enter', 'leave'].includes(request.method) || Object.keys(request).some(key => !['id', 'method'].includes(key)))
            throw new Error('invalid-command');
    } catch {
        output({id: Number.isInteger(request?.id) ? request.id : 0, ok: false, active, owned, error: 'invalid-command'});
        return;
    }
    try {
        await initialWatch;
        if (request.method === 'enter')
            await remote('Enter');
        else if (request.method === 'leave')
            await remote('Leave');
        await refresh();
        output({id: request.id, ok: true, active, owned});
    } catch (error) {
        output({id: request.id, ok: false, active, owned, error: errorCode(error)});
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
        initiallyReady();
        void refresh(true).catch(() => {
            active = false; owned = false;
            output({event: 'unavailable', active, owned});
        });
    },
    () => {
        available = false;
        epoch++;
        initiallyReady();
        active = false; owned = false;
        output({event: 'unavailable', active, owned});
    });
const stateSignal = connection.signal_subscribe(BUS, BUS, 'StateChanged', OBJECT, null, Gio.DBusSignalFlags.NONE,
    () => void refresh(true).catch(() => {}));
const closed = connection.connect('closed', () => {
    active = false; owned = false; available = false;
    output({event: 'unavailable', active, owned});
    void stop();
});
const signals = [2, 15].map(signal => GLibUnix.signal_add(GLib.PRIORITY_DEFAULT, signal, () => {
    void stop();
    return GLib.SOURCE_REMOVE;
}));
void readInput();
loop.run();
Gio.bus_unwatch_name(nameWatch);
connection.signal_unsubscribe(stateSignal);
connection.disconnect(closed);
for (const signal of signals) {
    if (GLib.MainContext.default().find_source_by_id(signal))
        GLib.Source.remove(signal);
}
