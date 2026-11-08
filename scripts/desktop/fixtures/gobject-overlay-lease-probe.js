// Exercise installed GJS/GObject on our own emitter only. No Shell, display,
// session bus, extensions, or desktop settings are imported or accessed.
import GObject from 'gi://GObject';

const MAX_HANDLERS = 8;
const SyntheticOverlay = GObject.registerClass({
    GTypeName: 'XboksSyntheticOverlayLeaseProbe',
    Signals: {'overlay-key': {}, 'unrelated': {}},
}, class SyntheticOverlay extends GObject.Object {});
function check(condition, message) {
    if (!condition) throw new Error(message);
}
const connected = (emitter, id) => GObject.signal_handler_is_connected(emitter, id);
function lease(emitter, callback, observed = {}) {
    const signal = GObject.signal_lookup('overlay-key', emitter.constructor.$gtype);
    check(signal > 0, 'Synthetic overlay-key signal must exist on the emitter GType');
    const next = () => GObject.signal_handler_find(emitter,
        GObject.SignalMatchType.ID | GObject.SignalMatchType.UNBLOCKED,
        signal, 0, null, null, null);
    const blocked = [];
    let ours = 0;
    const restore = () => {
        if (ours && connected(emitter, ours)) emitter.disconnect(ours);
        ours = 0;
        for (const id of blocked.splice(0)) {
            if (connected(emitter, id)) GObject.signal_handler_unblock(emitter, id);
        }
    };
    try {
        for (let index = 0; index < MAX_HANDLERS; index++) {
            const id = next();
            if (!id) break;
            check(!blocked.includes(id), 'UNBLOCKED must exclude each handler just blocked');
            GObject.signal_handler_block(emitter, id);
            blocked.push(id);
        }
        observed.blocked = [...blocked];
        // Probe once after the bounded loop. Never block a ninth handler.
        observed.overflow = Boolean(next());
        if (observed.overflow) throw new Error('handler-limit');
        ours = emitter.connect('overlay-key', () => {
            callback();
            GObject.signal_stop_emission_by_name(emitter, 'overlay-key');
        });
        observed.ours = ours;
        return restore;
    } catch (error) {
        restore();
        throw error;
    }
}

check(typeof GObject.signal_handler_is_connected === 'function', 'Static is_connected API missing');
const emitter = new SyntheticOverlay();
check(emitter.signal_handler_is_connected === undefined, 'Do not depend on an instance is_connected method');
const signal = GObject.signal_lookup('overlay-key', emitter.constructor.$gtype);
check(signal === GObject.signal_lookup('overlay-key', SyntheticOverlay.$gtype), 'Constructor and class GType lookup mismatch');
check(GObject.signal_lookup('missing-overlay-key', SyntheticOverlay.$gtype) === 0, 'Unknown signals must return zero');
check(GObject.signal_lookup('unrelated', SyntheticOverlay.$gtype) !== signal, 'Signals must have distinct IDs');

const calls = [];
const preblocked = emitter.connect('overlay-key', () => calls.push('preblocked'));
GObject.signal_handler_block(emitter, preblocked);
GObject.signal_handler_block(emitter, preblocked);
const first = emitter.connect('overlay-key', () => calls.push('first'));
const second = emitter.connect('overlay-key', () => calls.push('second'));
const removed = emitter.connect('overlay-key', () => calls.push('removed'));
emitter.connect('unrelated', () => calls.push('unrelated'));
const observation = {};
const restore = lease(emitter, () => calls.push('ours'), observation);
check(observation.blocked.length === 3 && [first, second, removed].every(id => observation.blocked.includes(id)),
    'Lease must block exactly the previously unblocked matching handlers');
check(!observation.blocked.includes(preblocked), 'Preblocked handler must never belong to the lease');
emitter.connect('overlay-key', () => calls.push('later'));
emitter.emit('overlay-key');
check(JSON.stringify(calls) === JSON.stringify(['ours']), 'Stopping our emission must prevent later handlers');
emitter.emit('unrelated');
check(calls.at(-1) === 'unrelated', 'Different signals must remain unblocked');

emitter.disconnect(removed);
check(!connected(emitter, removed), 'Disconnected recorded handler must be detected');
restore(); restore();
check(!connected(emitter, observation.ours), 'Restoration must disconnect our handler');
calls.length = 0;
emitter.emit('overlay-key');
check(JSON.stringify(calls) === JSON.stringify(['first', 'second', 'later']), 'Restoration must unblock only surviving leased IDs');
GObject.signal_handler_unblock(emitter, preblocked);
calls.length = 0; emitter.emit('overlay-key');
check(!calls.includes('preblocked'), 'Original nested block count must survive one unblock');
GObject.signal_handler_unblock(emitter, preblocked);
calls.length = 0; emitter.emit('overlay-key');
check(calls.includes('preblocked'), 'Original nested block count must survive exactly');

// Our own connection may also disappear before restoration.
const ownRemoved = new SyntheticOverlay(), removedObservation = {};
const restoreRemoved = lease(ownRemoved, () => {}, removedObservation);
ownRemoved.disconnect(removedObservation.ours);
restoreRemoved();

// Eight handlers are supported; the next probe detects a ninth without blocking
// it, and acquisition failure restores the eight handlers already recorded.
for (const count of [MAX_HANDLERS, MAX_HANDLERS + 1]) {
    const bounded = new SyntheticOverlay(), observed = {};
    let originalCalls = 0, ourCalls = 0, preblockedCalls = 0;
    const originalBlocked = bounded.connect('overlay-key', () => preblockedCalls++);
    GObject.signal_handler_block(bounded, originalBlocked);
    for (let index = 0; index < count; index++) bounded.connect('overlay-key', () => originalCalls++);
    if (count === MAX_HANDLERS) {
        const release = lease(bounded, () => ourCalls++, observed);
        bounded.emit('overlay-key');
        check(ourCalls === 1 && originalCalls === 0 && !observed.overflow, 'Eight-handler lease must acquire successfully');
        release();
    } else {
        let error = null;
        try { lease(bounded, () => ourCalls++, observed); } catch (caught) { error = caught; }
        check(error?.message === 'handler-limit' && observed.overflow, 'Ninth-handler probe must reject acquisition');
        check(observed.ours === undefined, 'Overflow must not connect our handler');
    }
    check(observed.blocked.length === MAX_HANDLERS && !observed.blocked.includes(originalBlocked), 'Block loop must stay bounded at eight');
    bounded.emit('overlay-key');
    check(originalCalls === count && preblockedCalls === 0, 'Every original unblocked handler must restore after release or overflow');
    GObject.signal_handler_unblock(bounded, originalBlocked);
    bounded.emit('overlay-key');
    check(preblockedCalls === 1, 'Bounded acquisition must preserve the preblocked handler');
}

print(JSON.stringify({status: 'passed', nativeSessionChanged: false, emitter: 'synthetic-GObject',
    legacyFindArguments: 7, maxHandlers: MAX_HANDLERS, staticIsConnected: true,
    preblockedCountPreserved: true, laterHandlerStopped: true, disconnectedIdsSkipped: true, overflowRestored: true}));
