// SPDX-License-Identifier: MIT
// No GI or live Shell calls: policy shared with the source tests.
export const NATIVE_INTERFACE = 'org.slaveitgr.Xboks.Experience.Native1';
export const NATIVE_OBJECT = '/org/slaveitgr/Xboks/Experience/Native1';
export const NATIVE_DESKTOP_ID = 'original-xbox-ce-wineuwp.desktop';
export const NATIVE_PE_SHA256 = 'dc50e62227838178c6f8b1e42463cd2b4a7f4b4f55dfc4b0e672d71a8fed0d89';
export const NATIVE_ERRORS = Object.freeze({
    'not-authorized': `${NATIVE_INTERFACE}.Error.AccessDenied`,
    busy: `${NATIVE_INTERFACE}.Error.Busy`,
    'stale-epoch': `${NATIVE_INTERFACE}.Error.StaleEpoch`,
    'not-supported': `${NATIVE_INTERFACE}.Error.NotSupported`,
    unavailable: `${NATIVE_INTERFACE}.Error.Unavailable`,
    'overview-open': `${NATIVE_INTERFACE}.Error.OverviewOpen`,
    'emergency-unavailable': `${NATIVE_INTERFACE}.Error.EmergencyUnavailable`,
    'shell-error': `${NATIVE_INTERFACE}.Error.ShellError`,
    'invalid-request': 'org.freedesktop.DBus.Error.InvalidArgs',
});

export function canonicalAbsolutePath(value) {
    return typeof value === 'string' && value.startsWith('/') && value.length < 4096 &&
        !/[\u0000-\u001f\u007f]/.test(value) && value.split('/').slice(1).every(part => part && part !== '.' && part !== '..');
}

export function processStartTime(stat) {
    if (typeof stat !== 'string' || stat.length > 65536) return null;
    const end = stat.lastIndexOf(')');
    if (end < 1) return null;
    const value = stat.slice(end + 1).trim().split(/\s+/)[19]; // /proc/PID/stat field 22.
    return /^[1-9][0-9]*$/.test(value ?? '') ? value : null;
}

export function sameProcessUser(status, uid) {
    const match = typeof status === 'string' && status.match(/^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$/m);
    return Number.isInteger(uid) && uid > 0 && Boolean(match) && match.slice(1).every(value => Number(value) === uid);
}

export function secureMetadata(info, uid, kind, privateMode = false) {
    if (!info || info.kind !== kind || info.uid !== uid || !Number.isInteger(info.mode)) return false;
    if (privateMode) return (info.mode & 0o7777) === (kind === 'directory' ? 0o700 : 0o600);
    return (info.mode & 0o022) === 0;
}

function peArgument(value) {
    if (typeof value !== 'string') return null;
    const candidate = /^[zZ]:[\\/]/.test(value) ? value.slice(2).replaceAll('\\', '/').replace(/\/+/g, '/') : value;
    return canonicalAbsolutePath(candidate) ? candidate : null;
}

export function commandLineNamesPe(commandLine, pePath, executable) {
    if (!Array.isArray(commandLine) || commandLine.length === 0 || commandLine.length > 256) return false;
    const matches = value => {
        const candidate = peArgument(value);
        return Boolean(candidate && candidate.slice(0, candidate.lastIndexOf('/') + 1) === pePath.slice(0, pePath.lastIndexOf('/') + 1) &&
            candidate.slice(candidate.lastIndexOf('/') + 1).toLowerCase() === pePath.slice(pePath.lastIndexOf('/') + 1).toLowerCase());
    };
    if (matches(commandLine[0])) return true;
    // Some Wine versions retain the loader as argv[0]. No later arbitrary
    // argument may stand in for the actual selected PE executable.
    const first = commandLine[0];
    return (first === executable || /(?:^|\/)wine(?:64)?(?:-preloader)?$/.test(first)) && matches(commandLine[1]);
}

export function validateEnrollment(record, {pid, uid, startTime, executable, commandLine}) {
    const keys = ['schema', 'pid', 'startTime', 'executable', 'pePath', 'peSHA256', 'desktopId'];
    return record && typeof record === 'object' && !Array.isArray(record) &&
        Object.keys(record).length === keys.length && keys.every(key => Object.hasOwn(record, key)) &&
        record.schema === 1 && Number.isInteger(pid) && pid > 0 && pid <= 2147483647 && record.pid === pid &&
        Number.isInteger(uid) && uid > 0 && typeof record.startTime === 'string' &&
        /^[1-9][0-9]*$/.test(record.startTime) && record.startTime === startTime &&
        canonicalAbsolutePath(record.executable) && record.executable === executable &&
        canonicalAbsolutePath(record.pePath) && /\/XboxPcAppCE\.exe$/.test(record.pePath) &&
        record.peSHA256 === NATIVE_PE_SHA256 && record.desktopId === NATIVE_DESKTOP_ID &&
        commandLineNamesPe(commandLine, record.pePath, executable);
}

export function nativeWindowForProcess(window, pid) {
    const seen = new Set();
    for (let current = window, depth = 0; current && depth < 16 && !seen.has(current); depth++) {
        seen.add(current);
        try {
            if (current.get_pid() === pid) return true;
            current = current.get_transient_for?.();
        } catch { return false; }
    }
    return false;
}

export class NativeRevision {
    constructor(seed) {
        if (!Number.isSafeInteger(seed) || seed < 1 || seed >= Number.MAX_SAFE_INTEGER - 1) throw Error('invalid-epoch');
        this.epoch = seed;
    }
    bump() {
        if (this.epoch >= Number.MAX_SAFE_INTEGER - 1) throw Error('epoch-exhausted');
        return ++this.epoch;
    }
    assert(expected) {
        if (typeof expected === 'bigint' && expected <= BigInt(Number.MAX_SAFE_INTEGER) && expected >= 0n) expected = Number(expected);
        if (!Number.isSafeInteger(expected) || expected !== this.epoch) throw Error('stale-epoch');
    }
}
