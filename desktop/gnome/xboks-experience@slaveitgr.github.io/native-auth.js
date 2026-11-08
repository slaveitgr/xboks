// SPDX-License-Identifier: MIT
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {canonicalAbsolutePath, processStartTime, sameProcessUser, secureMetadata, validateEnrollment, commandLineNamesPe, NATIVE_PE_SHA256} from './native-state.js';

const ATTRIBUTES = 'standard::type,standard::size,unix::uid,unix::mode,unix::inode,unix::device,time::modified,time::modified-usec,time::modified-nsec,time::changed,time::changed-usec,time::changed-nsec';
const NOFOLLOW = Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS;
const MAX_PE_BYTES = 256 * 1024 * 1024;

function metadata(info) {
    return {
        kind: info.get_file_type() === Gio.FileType.REGULAR ? 'regular' : info.get_file_type() === Gio.FileType.DIRECTORY ? 'directory' : 'other',
        uid: info.get_attribute_uint32('unix::uid'), mode: info.get_attribute_uint32('unix::mode'), size: info.get_size(),
        stamp: ['unix::inode', 'unix::device', 'time::modified', 'time::modified-usec', 'time::modified-nsec', 'time::changed', 'time::changed-usec', 'time::changed-nsec']
            .map(name => info.get_attribute_as_string(name)).join(':'),
    };
}

function fingerprint(info) { return JSON.stringify(info); }
function infoFor(path) { return metadata(Gio.File.new_for_path(path).query_info(ATTRIBUTES, NOFOLLOW, null)); }
function readProc(path) {
    const [ok, bytes] = GLib.file_get_contents(path);
    if (!ok || bytes.length > 65536) throw Error('not-authorized');
    return new TextDecoder('utf-8', {fatal: true}).decode(bytes);
}
function snapshot(pid, uid) {
    const root = `/proc/${pid}`;
    if (!sameProcessUser(readProc(`${root}/status`), uid)) throw Error('not-authorized');
    const startTime = processStartTime(readProc(`${root}/stat`));
    const executable = GLib.file_read_link(`${root}/exe`);
    const commandLine = readProc(`${root}/cmdline`).split('\0').filter(Boolean);
    if (!startTime || !canonicalAbsolutePath(executable)) throw Error('not-authorized');
    return {pid, uid, startTime, executable, commandLine};
}

function openFile(file) {
    return new Promise((resolve, reject) => file.read_async(GLib.PRIORITY_DEFAULT, null, (source, result) => {
        try { resolve(source.read_finish(result)); } catch (error) { reject(error); }
    }));
}
function readBytes(stream, count) {
    return new Promise((resolve, reject) => stream.read_bytes_async(count, GLib.PRIORITY_DEFAULT, null, (source, result) => {
        try { resolve(source.read_bytes_finish(result).get_data() ?? new Uint8Array()); } catch (error) { reject(error); }
    }));
}

async function checkedRead(path, uid, privateMode, maxSize, hashOnly = false) {
    const file = Gio.File.new_for_path(path), before = infoFor(path);
    if (!secureMetadata(before, uid, 'regular', privateMode) || before.size > maxSize) throw Error('not-authorized');
    const stream = await openFile(file);
    try {
        const opened = metadata(stream.query_info(ATTRIBUTES, null));
        if (fingerprint(before) !== fingerprint(opened)) throw Error('not-authorized');
        const checksum = hashOnly ? GLib.Checksum.new(GLib.ChecksumType.SHA256) : null;
        const chunks = []; let size = 0;
        for (;;) {
            const bytes = await readBytes(stream, Math.min(256 * 1024, maxSize + 1 - size));
            if (!bytes.length) break;
            size += bytes.length;
            if (size > maxSize) throw Error('not-authorized');
            if (checksum) checksum.update(bytes);
            else chunks.push(bytes);
        }
        if (size !== before.size || fingerprint(before) !== fingerprint(infoFor(path)) ||
            fingerprint(before) !== fingerprint(metadata(stream.query_info(ATTRIBUTES, null)))) throw Error('not-authorized');
        if (checksum) return {stamp: before, sha256: checksum.get_string()};
        const content = new Uint8Array(size); let offset = 0;
        for (const bytes of chunks) { content.set(bytes, offset); offset += bytes.length; }
        return {stamp: before, text: new TextDecoder('utf-8', {fatal: true}).decode(content)};
    } finally { stream.close(null); }
}

export class NativeEnrollmentVerifier {
    constructor(uid) { this.uid = uid; this.cache = new Map(); }
    _directories() {
        const runtime = GLib.get_user_runtime_dir();
        if (runtime !== `/run/user/${this.uid}`) throw Error('not-authorized');
        return [runtime, `${runtime}/xboks`, `${runtime}/xboks/original-clients`].map(path => {
            const info = infoFor(path);
            if (!secureMetadata(info, this.uid, 'directory', true)) throw Error('not-authorized');
            return {path, info};
        });
    }
    _noSymlinkPath(path) {
        if (!canonicalAbsolutePath(path)) throw Error('not-authorized');
        let current = '';
        const parts = path.split('/').slice(1);
        for (let i = 0; i < parts.length; i++) {
            current += '/' + parts[i];
            const info = infoFor(current);
            if (i < parts.length - 1 && info.kind !== 'directory' || i === parts.length - 1 &&
                !secureMetadata(info, this.uid, 'regular')) throw Error('not-authorized');
        }
    }
    async verify(pid) {
        if (!Number.isInteger(pid) || pid < 1 || pid > 2147483647 || !Number.isInteger(this.uid) || this.uid < 1) return null;
        try {
            const before = snapshot(pid, this.uid), directories = this._directories();
            const enrollmentPath = `${directories[2].path}/${pid}.json`;
            const enrollment = await checkedRead(enrollmentPath, this.uid, true, 16384);
            const record = JSON.parse(enrollment.text);
            if (!validateEnrollment(record, before)) return null;
            this._noSymlinkPath(record.executable);
            this._noSymlinkPath(record.pePath);
            const peInfo = infoFor(record.pePath), executableInfo = infoFor(record.executable);
            const cacheKey = JSON.stringify([before, enrollment.stamp, peInfo, executableInfo]);
            if (this.cache.get(pid)?.key !== cacheKey) {
                const pe = await checkedRead(record.pePath, this.uid, false, MAX_PE_BYTES, true);
                if (pe.sha256 !== NATIVE_PE_SHA256) return null;
                this.cache.set(pid, {key: cacheKey});
            }
            if (JSON.stringify(before) !== JSON.stringify(snapshot(pid, this.uid)) ||
                fingerprint(enrollment.stamp) !== fingerprint(infoFor(enrollmentPath)) ||
                fingerprint(peInfo) !== fingerprint(infoFor(record.pePath)) ||
                fingerprint(executableInfo) !== fingerprint(infoFor(record.executable)) ||
                directories.some(entry => fingerprint(entry.info) !== fingerprint(infoFor(entry.path)))) return null;
            if (this.cache.size > 16) this.cache.delete(this.cache.keys().next().value);
            return Object.freeze({...record, enrollmentPath, enrollmentFingerprint: fingerprint(enrollment.stamp),
                peFingerprint: fingerprint(peInfo), executableFingerprint: fingerprint(executableInfo)});
        } catch { this.cache.delete(pid); return null; }
    }
    current(record) {
        try {
            const directories = this._directories();
            if (record.enrollmentPath !== `${directories[2].path}/${record.pid}.json`) return false;
            this._noSymlinkPath(record.executable);
            this._noSymlinkPath(record.pePath);
            const process = snapshot(record.pid, this.uid);
            return process.startTime === record.startTime && process.executable === record.executable &&
                commandLineNamesPe(process.commandLine, record.pePath, record.executable) &&
                fingerprint(infoFor(record.enrollmentPath)) === record.enrollmentFingerprint &&
                fingerprint(infoFor(record.pePath)) === record.peFingerprint &&
                fingerprint(infoFor(record.executable)) === record.executableFingerprint;
        } catch { return false; }
    }
    watch(record, revoked) {
        if (!this.current(record)) throw Error('not-authorized');
        const monitor = Gio.File.new_for_path(record.enrollmentPath).monitor_file(Gio.FileMonitorFlags.NONE, null);
        const id = monitor.connect('changed', revoked);
        const stop = () => {
            try { monitor.disconnect(id); } catch { /* A disposed monitor still needs cancellation. */ }
            try { monitor.cancel(); } finally { this.cache.delete(record.pid); }
        };
        if (!this.current(record)) { stop(); throw Error('not-authorized'); }
        return stop;
    }
}
