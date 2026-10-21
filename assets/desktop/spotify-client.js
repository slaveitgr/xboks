// SPDX-License-Identifier: MIT
// Local MPRIS only. This helper never authenticates or contacts Spotify Web API.
// References: https://specifications.freedesktop.org/mpris/latest/
import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix';
import GLib from 'gi://GLib';
import GLibUnix from 'gi://GLibUnix';

const PLAYER = 'org.mpris.MediaPlayer2.Player', ROOT = 'org.mpris.MediaPlayer2';
const OBJECT = '/org/mpris/MediaPlayer2', PROPERTIES = 'org.freedesktop.DBus.Properties';
const MAX_TIME_MS = 604800000, MAX_US = MAX_TIME_MS * 1000;
const loop = new GLib.MainLoop(null, false), connection = Gio.bus_get_sync(Gio.BusType.SESSION, null);
const input = new GioUnix.InputStream({fd: 0, close_fd: false}), cancellation = new Gio.Cancellable();
let stopping = false, pending = new Uint8Array(), queued = 0, chain = Promise.resolve(), epoch = 0, refreshTimer = 0;
let owner = null, playerBus = null, trackId = null;
const disabled = () => ({playPause: false, previous: false, next: false, seek: false, open: false});
// Fixed native, Flatpak and Snap desktop IDs. Never accept a renderer command,
// arbitrary desktop filename or URI as an executable launch target.
const desktopInfo = () => GioUnix.DesktopAppInfo.new('spotify.desktop') ?? GioUnix.DesktopAppInfo.new('com.spotify.Client.desktop') ??
    GioUnix.DesktopAppInfo.new('spotify_spotify.desktop');
const absent = reason => ({status: 'not-running', source: 'linux-mpris', playbackStatus: 'unknown',
    capabilities: {...disabled(), open: !!desktopInfo()}, reason: reason ?? (desktopInfo() ? 'not-running' : 'not-installed')});
let state = absent();
const output = value => print(JSON.stringify(value));
const spotifyName = name => name === 'org.mpris.MediaPlayer2.spotify' || /^org\.mpris\.MediaPlayer2\.spotify\.instance[0-9]+$/.test(name);
const text = (value, limit) => typeof value === 'string' && value.trim() ? value.trim().slice(0, limit) : undefined;
const micros = value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_US ? Math.floor(value / 1000) : undefined;
function unpack(value) {
    if (value instanceof GLib.Variant) return unpack(value.deepUnpack());
    if (Array.isArray(value)) return value.map(unpack);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, unpack(entry)]));
    return value;
}
function call(destination, iface, method, params, signature) {
    return new Promise((resolve, reject) => connection.call(destination, OBJECT, iface, method, params,
        new GLib.VariantType(signature), Gio.DBusCallFlags.NO_AUTO_START, 2000, cancellation, (bus, result) => {
            try { resolve(unpack(bus.call_finish(result))); } catch (error) { reject(error); }
        }));
}
function busCall(method, params, signature) {
    return new Promise((resolve, reject) => connection.call('org.freedesktop.DBus', '/org/freedesktop/DBus',
        'org.freedesktop.DBus', method, params, new GLib.VariantType(signature), Gio.DBusCallFlags.NO_AUTO_START,
        2000, cancellation, (bus, result) => { try { resolve(unpack(bus.call_finish(result))); } catch (error) { reject(error); } }));
}
// Preserve only an allowlisted failure stage and error code. Raw error messages
// can contain service data and are never written to the JSON protocol or logs.
async function atStage(stage, promise) {
    try { return await promise; } catch (cause) { throw {stage, cause}; }
}
function readFailure(failure) {
    const stage = ['discovery', 'identity', 'player-properties'].includes(failure?.stage) ? failure.stage : 'identity';
    const cause = failure?.cause ?? failure;
    let remote = null;
    try { remote = Gio.DBusError.get_remote_error(cause); } catch { /* Non-GIO validation failure. */ }
    const denied = remote === 'org.freedesktop.DBus.Error.AccessDenied';
    return {reason: denied ? 'permission-denied' : 'transport-error', diagnostic: {code: denied ? 'access-denied' : 'read-failed', stage}};
}
async function refresh(emit = false) {
    const generation = ++epoch;
    try {
        const [names] = await atStage('discovery', busCall('ListNames', null, '(as)'));
        const players = names.filter(spotifyName);
        if (players.length === 0) {
            if (generation === epoch) { owner = null; playerBus = null; trackId = null; state = absent(); }
        } else if (players.length > 1) {
            if (generation === epoch) { owner = null; playerBus = null; trackId = null; state = absent('ambiguous-player'); }
        } else {
            const name = players[0], [unique] = await atStage('discovery', busCall('GetNameOwner', new GLib.Variant('(s)', [name]), '(s)'));
            const [[props], [root]] = await Promise.all([
                atStage('player-properties', call(unique, PROPERTIES, 'GetAll', new GLib.Variant('(s)', [PLAYER]), '(a{sv})')),
                atStage('identity', call(unique, PROPERTIES, 'GetAll', new GLib.Variant('(s)', [ROOT]), '(a{sv})')),
            ]);
            if (generation !== epoch) return state;
            // Restrict discovery to Spotify's bus namespace and expected desktop identity.
            if (root.Identity !== 'Spotify' || !['spotify', 'com.spotify.Client', 'spotify_spotify'].includes(root.DesktopEntry)) throw Error('unavailable');
            const playbackStatus = {Playing: 'playing', Paused: 'paused', Stopped: 'stopped'}[props.PlaybackStatus] ?? 'unknown';
            const metadata = props.Metadata && typeof props.Metadata === 'object' && !Array.isArray(props.Metadata) ? props.Metadata : {};
            const title = text(metadata['xesam:title'], 512), artists = Array.isArray(metadata['xesam:artist'])
                ? metadata['xesam:artist'].slice(0, 10).map(value => text(value, 256)).filter(Boolean) : [];
            const durationMs = micros(metadata['mpris:length']), positionMs = micros(props.Position);
            const candidateId = metadata['mpris:trackid'];
            trackId = typeof candidateId === 'string' && candidateId.length <= 1024 && /^\/(?:[A-Za-z0-9_]+\/?)*$/.test(candidateId) &&
                candidateId !== '/org/mpris/MediaPlayer2/TrackList/NoTrack' ? candidateId : null;
            const controlled = props.CanControl === true;
            const capabilities = {playPause: controlled && (playbackStatus === 'playing' ? props.CanPause === true : props.CanPlay === true),
                next: controlled && props.CanGoNext === true, previous: controlled && props.CanGoPrevious === true,
                seek: controlled && props.CanSeek === true && !!trackId && durationMs > 0 && !!(title || artists.length), open: root.CanRaise === true || !!desktopInfo()};
            const next = {status: 'available', source: 'linux-mpris', playbackStatus, capabilities};
            if (title || artists.length) {
                next.track = {title: title ?? '', artists};
                const album = text(metadata['xesam:album'], 512), artUrl = text(metadata['mpris:artUrl'], 2048);
                if (album) next.track.album = album;
                if (durationMs !== undefined) next.track.durationMs = durationMs;
                if (artUrl && /^https:\/\/i\.scdn\.co\/[A-Za-z0-9/_?&=.%+-]+$/.test(artUrl)) next.track.artUrl = artUrl;
            }
            if (positionMs !== undefined) next.positionMs = durationMs === undefined ? positionMs : Math.min(positionMs, durationMs);
            owner = unique; playerBus = name; state = next;
        }
    } catch (error) {
        if (generation === epoch) { owner = null; playerBus = null; trackId = null;
            state = {status: 'error', source: 'linux-mpris', playbackStatus: 'unknown', capabilities: {...disabled(), open: !!desktopInfo()}, ...readFailure(error)}; }
    }
    if (emit && generation === epoch && !stopping) output({event: 'state', state});
    return state;
}
function scheduleRefresh() {
    if (stopping || refreshTimer) return;
    refreshTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => { refreshTimer = 0; void refresh(true); return GLib.SOURCE_REMOVE; });
}
function commandValid(command) {
    return command && typeof command === 'object' && !Array.isArray(command) &&
        ['play-pause', 'next', 'previous', 'seek', 'open'].includes(command.action) &&
        Object.keys(command).every(key => key === 'action' || command.action === 'seek' && key === 'positionMs') &&
        (command.action !== 'seek' || Number.isSafeInteger(command.positionMs) && command.positionMs >= 0 && command.positionMs <= MAX_TIME_MS);
}
async function control(command) {
    await refresh();
    if (command.action === 'open') {
        if (owner && state.capabilities.open) {
            try { const [root] = await call(owner, PROPERTIES, 'GetAll', new GLib.Variant('(s)', [ROOT]), '(a{sv})');
                if (root.CanRaise === true) { await call(owner, ROOT, 'Raise', null, '()'); return; } } catch { throw Error('command-unconfirmed'); }
        }
        const info = desktopInfo();
        if (!info) throw Error('unavailable');
        // Explicit user command only; fixed desktop IDs, no URI/shell text input.
        if (!info.launch([], null)) throw Error('command-unconfirmed');
        return;
    }
    if (!owner || !playerBus || state.status !== 'available') throw Error('unavailable');
    const cap = {'play-pause': 'playPause', next: 'next', previous: 'previous', seek: 'seek'}[command.action];
    if (!state.capabilities[cap]) throw Error('unsupported-control');
    const target = owner, [currentOwner] = await busCall('GetNameOwner', new GLib.Variant('(s)', [playerBus]), '(s)');
    if (currentOwner !== target) throw Error('unavailable');
    // Separate Play/Pause respects CanPlay and CanPause independently, including
    // a player that can resume but cannot implement the PlayPause method.
    let method = {'play-pause': state.playbackStatus === 'playing' ? 'Pause' : 'Play', next: 'Next', previous: 'Previous', seek: 'SetPosition'}[command.action], params = null;
    if (command.action === 'seek') {
        if (!trackId || command.positionMs > state.track.durationMs) throw Error('unsupported-control');
        params = new GLib.Variant('(ox)', [trackId, command.positionMs * 1000]);
    }
    // Address the observed unique owner. Never retry an unconfirmed mutation.
    try { await call(target, PLAYER, method, params, '()'); } catch { throw Error('command-unconfirmed'); }
}
async function processLine(line) {
    let request;
    try {
        request = JSON.parse(line);
        if (!request || !Number.isInteger(request.id) || request.id < 1 || request.id > 2147483647 ||
            !['state', 'control'].includes(request.method) ||
            Object.keys(request).some(key => !['id', 'method', ...(request.method === 'control' ? ['command'] : [])].includes(key)) ||
            request.method === 'control' && !commandValid(request.command)) throw Error('invalid-command');
    } catch { output({id: Number.isInteger(request?.id) ? request.id : 0, ok: false, state, error: 'invalid-command'}); return; }
    try {
        if (request.method === 'control') await control(request.command);
        await refresh(); output({id: request.id, ok: true, state});
    } catch (error) {
        await refresh();
        output({id: request.id, ok: false, state, error: ['unavailable', 'unsupported-control'].includes(error.message) ? error.message : 'command-unconfirmed'});
    }
}
function enqueue(line) {
    if (++queued > 8) { void stop(); return; }
    chain = chain.then(() => stopping ? undefined : processLine(line)).finally(() => { queued--; });
}
async function readInput() {
    const decoder = new TextDecoder('utf-8', {fatal: true});
    try {
        while (!stopping) {
            const bytes = await new Promise((resolve, reject) => input.read_bytes_async(4096, GLib.PRIORITY_DEFAULT, cancellation,
                (stream, result) => { try { resolve(stream.read_bytes_finish(result).get_data() ?? new Uint8Array()); } catch (error) { reject(error); } }));
            if (!bytes.length) break;
            const combined = new Uint8Array(pending.length + bytes.length); combined.set(pending); combined.set(bytes, pending.length); pending = combined;
            if (pending.length > 8192) throw Error('input-too-large');
            let newline;
            while ((newline = pending.indexOf(10)) !== -1) {
                const part = pending.slice(0, newline); pending = pending.slice(newline + 1);
                if (part.length > 4096) throw Error('input-too-large');
                const line = decoder.decode(part); if (line.trim()) enqueue(line);
            }
        }
        if (!stopping) await chain;
    } catch { /* Invalid/oversized input shuts down without player commands. */ }
    await stop();
}
async function stop() {
    if (stopping) return;
    stopping = true; cancellation.cancel();
    try { connection.close_sync(null); } catch { /* No player/session state to restore. */ }
    loop.quit();
}
const nameSignal = connection.signal_subscribe('org.freedesktop.DBus', 'org.freedesktop.DBus', 'NameOwnerChanged', '/org/freedesktop/DBus', null,
    Gio.DBusSignalFlags.NONE, (_bus, _sender, _path, _iface, _signal, params) => { if (spotifyName(params.deepUnpack()[0])) scheduleRefresh(); });
const propertySignal = connection.signal_subscribe(null, PROPERTIES, 'PropertiesChanged', OBJECT, null, Gio.DBusSignalFlags.NONE,
    (_bus, sender) => { if (sender === owner) scheduleRefresh(); });
const seekSignal = connection.signal_subscribe(null, PLAYER, 'Seeked', OBJECT, null, Gio.DBusSignalFlags.NONE,
    (_bus, sender) => { if (sender === owner) scheduleRefresh(); });
const closed = connection.connect('closed', () => { void stop(); });
// Older GLib typelibs expose Unix signal watches through GLib itself.
const signalAdd = typeof GLibUnix.signal_add === 'function' ? GLibUnix.signal_add : GLib.unix_signal_add;
const signals = [2, 15].map(signal => signalAdd(GLib.PRIORITY_DEFAULT, signal, () => { void stop(); return GLib.SOURCE_REMOVE; }));
void refresh(true); void readInput(); loop.run();
connection.signal_unsubscribe(nameSignal); connection.signal_unsubscribe(propertySignal); connection.signal_unsubscribe(seekSignal); connection.disconnect(closed);
if (refreshTimer) GLib.Source.remove(refreshTimer);
for (const signal of signals) if (GLib.MainContext.default().find_source_by_id(signal)) GLib.Source.remove(signal);
