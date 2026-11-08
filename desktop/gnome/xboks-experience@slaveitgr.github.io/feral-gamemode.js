// SPDX-License-Identifier: MIT
// Optional session-bus client; all policy changes belong to the installed daemon.
// Protocol: FeralInteractive/gamemode daemon/gamemode-dbus.c and gamemode-context.c.
// The legacy PID interface has no atomic ownership token: start-time, UID,
// Requester and Timestamp checks bound our requests but cannot remove its
// daemon-side PID/registration race. No FPS or complete optimization claim.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const BUS = 'com.feralinteractive.GameMode';
const PATH = '/com/feralinteractive/GameMode';
const GAME = `${BUS}.Game`;

function processIdentity(pid) {
    try {
        const text = name => {
            const [ok, bytes] = GLib.file_get_contents(`/proc/${pid}/${name}`);
            if (!ok || bytes.length > 65536) throw Error('process-unavailable');
            return new TextDecoder().decode(bytes);
        };
        const stat = text('stat'), end = stat.lastIndexOf(')'), fields = stat.slice(end + 2).trim().split(/\s+/);
        const uid = text('status').match(/^Uid:\s+(\d+)\s+(\d+)/m);
        const actualPid = Number(stat.slice(0, stat.indexOf(' ')));
        if (end < 1 || !Number.isInteger(actualPid) || actualPid < 1 || !/^\d+$/.test(fields[19] ?? '') ||
            !uid || uid[1] !== uid[2] || Number(uid[1]) < 1) return null;
        return {pid: actualPid, uid: Number(uid[1]), startTime: fields[19]};
    } catch { return null; }
}

function sameProcess(left, right) {
    return Boolean(left && right && left.pid === right.pid && left.uid === right.uid && left.startTime === right.startTime);
}

function unavailable(error) {
    return /ServiceUnknown|NameHasNoOwner|ServiceNotFound|Spawn\.|NoReply|Timeout|timed out/i.test(String(error?.message ?? error));
}

export class FeralGameMode {
    constructor({changed = () => {}, inspectProcess = processIdentity} = {}) {
        this._changed = changed;
        this._identity = inspectProcess;
        this._connection = Gio.DBus.session;
        this._self = this._identity('self');
        this._enabled = false;
        this._destroyed = false;
        this._desired = new Map();
        this._owned = new Map();
        this._owner = null;
        this._epoch = 0;
        this._watch = 0;
        this._poll = 0;
        this._signal = 0;
        this._dirty = false;
        this._pending = null;
        this._state = {state: 'disabled'};
    }

    get state() { return {...this._state}; }

    _publish(state, reason) {
        const next = reason ? {state, reason} : {state};
        if (JSON.stringify(next) === JSON.stringify(this._state)) return;
        this._state = next;
        try { this._changed(this.state); } catch { /* Presentation cannot prevent cleanup. */ }
    }

    setEnabled(enabled) {
        if (typeof enabled !== 'boolean') throw Error('GameMode setting must be a boolean.');
        if (this._destroyed) return Promise.resolve();
        const changed = this._enabled !== enabled;
        if (!changed) return this._pending ?? Promise.resolve();
        this._enabled = enabled;
        if (enabled) this._monitor();
        else this._unmonitor();
        if (changed || !enabled)
            this._publish(enabled ? 'requesting' : 'disabled', enabled ? 'Waiting for a gaming application.' : undefined);
        return this._schedule();
    }

    setProcesses(pids) {
        if (this._destroyed) return Promise.resolve();
        const desired = new Map();
        for (const pid of Array.isArray(pids) ? pids.slice(0, 32) : []) {
            if (!Number.isInteger(pid) || pid < 1 || pid > 0x7fffffff || pid === this._self?.pid) continue;
            const identity = this._identity(pid);
            if (identity && identity.uid === this._self?.uid) desired.set(pid, identity);
        }
        const changed = desired.size !== this._desired.size || [...desired.values()].some(record => !sameProcess(record, this._desired.get(record.pid)));
        if (!changed) return this._pending ?? Promise.resolve();
        this._desired = desired;
        if (changed && this._enabled) this._publish('requesting');
        return this._schedule();
    }

    stop() {
        this._enabled = false;
        this._desired.clear();
        this._unmonitor();
        this._publish('disabled');
        return this._schedule();
    }

    destroy() {
        this._destroyed = true;
        return this.stop();
    }

    _monitor() {
        if (!this._watch) this._watch = Gio.bus_watch_name_on_connection(this._connection, BUS, Gio.BusNameWatcherFlags.NONE,
            (_connection, _name, owner) => this._ownerChanged(owner), () => this._ownerChanged(null));
        if (!this._signal) this._signal = this._connection.signal_subscribe(BUS, BUS, null, PATH, null,
            Gio.DBusSignalFlags.NONE, () => { if (this._enabled) void this._schedule(); });
        if (!this._poll) this._poll = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => {
            if (!this._enabled || this._destroyed) { this._poll = 0; return GLib.SOURCE_REMOVE; }
            void this._schedule();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _unmonitor() {
        if (this._watch) { Gio.bus_unwatch_name(this._watch); this._watch = 0; }
        if (this._signal) { this._connection.signal_unsubscribe(this._signal); this._signal = 0; }
        if (this._poll) { GLib.Source.remove(this._poll); this._poll = 0; }
    }

    _ownerChanged(owner) {
        if (this._owner === owner) return;
        this._owner = owner;
        this._epoch++;
        // Registrations never transfer to a new daemon process.
        this._owned.clear();
        if (!this._enabled || this._destroyed) return;
        if (!owner) this._publish('unavailable', 'The GameMode daemon disconnected.');
        void this._schedule();
    }

    _call(destination, path, iface, method, parameters, signature) {
        return new Promise((resolve, reject) => this._connection.call(destination, path, iface, method, parameters,
            new GLib.VariantType(signature), Gio.DBusCallFlags.NONE, 1500, null, (connection, result) => {
                try { resolve(connection.call_finish(result).deepUnpack()); } catch (error) { reject(error); }
            }));
    }

    async _ensureOwner() {
        if (this._owner) return this._owner;
        await this._call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus',
            'StartServiceByName', new GLib.Variant('(su)', [BUS, 0]), '(u)');
        const [owner] = await this._call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus',
            'GetNameOwner', new GLib.Variant('(s)', [BUS]), '(s)');
        if (typeof owner !== 'string' || !owner.startsWith(':')) throw Error('daemon-unavailable');
        this._ownerChanged(owner);
        return owner;
    }

    async _method(owner, method, pid) {
        const [status] = await this._call(owner, PATH, BUS, method,
            new GLib.Variant('(ii)', [this._self.pid, pid]), '(i)');
        if (!Number.isInteger(status)) throw Error('invalid-status');
        return status;
    }

    async _registration(owner, pid) {
        const [properties] = await this._call(owner, `${PATH}/Games/${pid}`, 'org.freedesktop.DBus.Properties',
            'GetAll', new GLib.Variant('(s)', [GAME]), '(a{sv})');
        const value = name => properties?.[name]?.deepUnpack();
        const requester = value('Requester'), timestamp = value('Timestamp'), process = value('ProcessId');
        if (process !== pid || !Number.isInteger(requester) || requester < 1 ||
            !/^[0-9]+$/.test(String(timestamp))) throw Error('invalid-registration');
        return {requester, timestamp: String(timestamp)};
    }

    _wanted(identity) {
        return this._enabled && !this._destroyed && sameProcess(identity, this._desired.get(identity.pid)) &&
            sameProcess(identity, this._identity(identity.pid));
    }

    async _release(record) {
        const forget = () => { if (this._owned.get(record.pid) === record) this._owned.delete(record.pid); };
        if (!sameProcess(record, this._identity(record.pid))) { forget(); return; }
        if (record.owner !== this._owner) { forget(); return; }
        let current;
        try { current = await this._registration(record.owner, record.pid); }
        catch (error) {
            if (/UnknownObject/.test(String(error?.message))) { forget(); return; }
            throw error;
        }
        if (current.requester !== this._self.pid || (record.timestamp !== null && current.timestamp !== record.timestamp)) { forget(); return; }
        if (!sameProcess(record, this._identity(record.pid)) || record.owner !== this._owner) { forget(); return; }
        const status = await this._method(record.owner, 'UnregisterGameByPID', record.pid);
        if (status !== 0) throw Error('unregister-rejected');
        forget();
    }

    _schedule() {
        this._dirty = true;
        if (!this._pending) this._pending = (async () => {
            while (this._dirty) {
                this._dirty = false;
                try { await this._sync(); }
                catch (error) { this._publish(unavailable(error) ? 'unavailable' : 'error', unavailable(error)
                    ? 'Feral GameMode is unavailable in this session.' : 'GameMode could not confirm or restore the requested process state.'); }
            }
        })().finally(() => { this._pending = null; });
        return this._pending;
    }

    async _sync() {
        if (!this._self) throw Error('requester-unavailable');
        let cleanupError = null;
        for (const record of [...this._owned.values()]) {
            if (this._wanted(record)) continue;
            try { await this._release(record); } catch (error) { cleanupError ??= error; }
        }
        if (cleanupError) throw cleanupError;
        if (!this._enabled || this._destroyed) { this._publish('disabled'); return; }
        const desired = [...this._desired.values()].filter(identity => this._wanted(identity));
        if (!desired.length) { this._publish('requesting', 'Waiting for a gaming application.'); return; }
        if (this._state.state !== 'active') this._publish('requesting');
        const owner = await this._ensureOwner(), epoch = this._epoch;
        let confirmed = 0;
        for (const identity of desired) {
            if (!this._wanted(identity) || this._owner !== owner || this._epoch !== epoch) continue;
            let status = await this._method(owner, 'QueryStatusByPID', identity.pid);
            if (!this._wanted(identity) || this._owner !== owner || this._epoch !== epoch) continue;
            if (status < 0 || status > 2) throw Error('query-rejected');
            if (status !== 2) {
                this._owned.delete(identity.pid);
                const registered = await this._method(owner, 'RegisterGameByPID', identity.pid);
                if (registered !== 0) throw Error('register-rejected');
                const record = {...identity, owner, timestamp: null};
                // Record a successful request before any further await, so a
                // stop racing its reply still releases only that request.
                this._owned.set(identity.pid, record);
                const registration = await this._registration(owner, identity.pid);
                if (registration.requester !== this._self.pid) {
                    this._owned.delete(identity.pid);
                    throw Error('registration-replaced');
                }
                record.timestamp = registration.timestamp;
                if (!this._wanted(identity) || this._owner !== owner || this._epoch !== epoch) {
                    await this._release(record); continue;
                }
                status = await this._method(owner, 'QueryStatusByPID', identity.pid);
            }
            if (this._wanted(identity) && this._owner === owner && this._epoch === epoch && status === 2) confirmed++;
            else if (this._wanted(identity) && this._owner === owner && this._epoch === epoch) throw Error('not-active');
        }
        if (!this._enabled || this._destroyed) { this._publish('disabled'); return; }
        if (this._owner === owner && this._epoch === epoch && confirmed === desired.length)
            this._publish('active');
    }
}
