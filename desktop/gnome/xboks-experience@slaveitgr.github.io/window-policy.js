// SPDX-License-Identifier: MIT
// GNOME51 native window state, owned only for the Experience lease lifetime.
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export class ExperienceWindowPolicy {
    constructor({allowed = () => true, warn = message => console.warn(message)} = {}) {
        this._allowed = allowed; this._warn = warn;
        this._active = false; this._windows = new Map(); this._pending = new Map(); this._signals = []; this._scanSource = 0;
    }

    _connect(object, signal, callback, subscriptions = this._signals) {
        subscriptions.push([object, object.connect(signal, callback)]);
    }

    _disconnect(subscriptions) {
        for (const [object, id] of subscriptions.splice(0)) {
            try { object.disconnect(id); } catch { /* A native window may already be gone. */ }
        }
    }

    _eligible(window) {
        try {
            return window.get_window_type() === Meta.WindowType.NORMAL && !window.skip_taskbar &&
                !window.is_attached_dialog() && !window.get_transient_for() && !window.is_override_redirect() &&
                !['XBOKS Game Bar', 'xboks Game Bar'].includes(window.get_title()) &&
                Boolean(Shell.WindowTracker.get_default().get_window_app(window));
        } catch { return false; }
    }

    start() {
        if (this._active) return;
        if (!this._allowed()) throw Error('window-policy-unavailable');
        this._active = true;
        const focused = global.display.focus_window;
        // window-created may precede the actor, mapping and app tracker. A map
        // signal plus a deferred inventory catches it after native setup.
        try {
            this._connect(global.display, 'window-created', () => this._scheduleScan());
            this._connect(global.window_manager, 'map', () => this._scheduleScan());
            this._connect(Shell.WindowTracker.get_default(), 'tracked-windows-changed', () => this._scheduleScan());
            this._scan();
            // Explicit entry owns this activation. Mutter fullscreen raises
            // windows even when focus itself has not changed.
            if (focused && this._windows.has(focused))
                Main.activateWindow(focused, global.get_current_time());
        } catch (error) {
            this.stop();
            throw error;
        }
    }

    _scheduleScan() {
        if (!this._active || !this._allowed() || this._scanSource) return;
        this._scanSource = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._scanSource = 0;
            if (this._active && this._allowed()) this._scan();
            return GLib.SOURCE_REMOVE;
        });
    }

    _scan() {
        if (!this._active || !this._allowed()) return;
        for (const actor of global.get_window_actors()) {
            const window = actor.meta_window;
            if (!this._eligible(window)) continue;
            // Previously minimized windows are legitimate entry inventory even
            // when native mapping has become false because they were hidden.
            if (!window.mapped && !window.minimized) { this._waitForMap(window); continue; }
            this._clearPending(window);
            if (!this._windows.has(window)) this._track(window);
            this._enforce(this._windows.get(window));
        }
    }

    _clearPending(window) {
        const subscriptions = this._pending.get(window);
        if (!subscriptions) return;
        this._pending.delete(window); this._disconnect(subscriptions);
    }

    _waitForMap(window) {
        if (this._pending.has(window)) return;
        const subscriptions = [];
        this._pending.set(window, subscriptions);
        try {
            this._connect(window, 'notify::mapped', () => this._scheduleScan(), subscriptions);
            this._connect(window, 'unmanaged', () => this._clearPending(window), subscriptions);
        } catch (error) {
            this._clearPending(window);
            throw error;
        }
    }

    _track(window) {
        const record = {window, signals: [], changing: false, alive: true, attempted: false, supported: false,
            fullscreen: window.is_fullscreen(), maximized: window.get_maximize_flags(), minimized: Boolean(window.minimized)};
        this._windows.set(window, record);
        const enforce = () => this._enforce(record);
        try {
            for (const property of ['fullscreen', 'minimized', 'mapped', 'maximized-horizontally', 'maximized-vertically'])
                this._connect(window, `notify::${property}`, enforce, record.signals);
            for (const property of ['title', 'window-type', 'skip-taskbar'])
                this._connect(window, `notify::${property}`, () => {
                    if (!this._eligible(window)) this._forget(record, true);
                }, record.signals);
            this._connect(window, 'unmanaging', () => this._forget(record), record.signals);
            this._connect(window, 'unmanaged', () => this._forget(record), record.signals);
        } catch (error) {
            this._forget(record, true);
            throw error;
        }
    }

    _enforce(record) {
        if (!record || !record.alive || record.changing || !this._active || !this._allowed()) return;
        if (!this._eligible(record.window)) { this._forget(record, true); return; }
        const {window} = record, focused = global.display.focus_window;
        let changed = false;
        record.changing = true;
        try {
            if (window.minimized) { changed = true; window.unminimize(); }
            if (!window.mapped) return;
            if (!window.is_fullscreen() && (!record.attempted || record.supported)) {
                record.attempted = true; changed = true;
                // Meta51 exposes no can_fullscreen() method. Ask Mutter and
                // inspect the actual state; never claim success for a refusal.
                try { window.make_fullscreen(); }
                catch (error) { this._warn(`XBOKS Experience native fullscreen request: ${error.message}`); }
                record.supported = window.is_fullscreen();
                if (!record.supported) this._warn('XBOKS Experience: native fullscreen refused; using available maximize state.');
            }
            if (!window.is_fullscreen() && window.can_maximize() && window.get_maximize_flags() !== Meta.MaximizeFlags.BOTH) {
                changed = true; window.maximize();
            }
        } catch (error) {
            // Closure races and a client refusing a state request must not stop
            // restoration for other windows or leave a recursive notify loop.
            this._warn(`XBOKS Experience window policy: ${error.message}`);
        } finally {
            record.changing = false;
            // Mutter51 set_fullscreen_state raises even an unfocused window.
            // Retain the visible current app without activating a newly found
            // background app. An auxiliary dialog can also be the focus owner.
            if (changed && focused && focused !== window && this._active && this._allowed()) {
                try {
                    if (global.display.focus_window === focused) focused.raise();
                    else Main.activateWindow(focused, global.get_current_time());
                } catch { /* The focused window may have closed concurrently. */ }
            }
        }
    }

    _restore(record) {
        const {window} = record;
        const attempt = callback => { try { callback(); } catch (error) { this._warn(`XBOKS Experience window restoration: ${error.message}`); } };
        // Meta51 flag setters process a real geometry config; set adds axes
        // and unset removes axes. They do not merely mark local state bits.
        // Disconnect first, so restoration cannot be interpreted as a request
        // to reapply Xbox state. Restore independent maximize axes faithfully.
        if (!record.fullscreen) attempt(() => { if (window.is_fullscreen()) window.unmake_fullscreen(); });
        attempt(() => {
            const remove = window.get_maximize_flags() & ~record.maximized;
            if (remove) window.set_unmaximize_flags(remove);
        });
        attempt(() => {
            const add = record.maximized & ~window.get_maximize_flags();
            if (add) window.set_maximize_flags(add);
        });
        if (record.fullscreen) attempt(() => { if (!window.is_fullscreen()) window.make_fullscreen(); });
        attempt(() => {
            if (record.minimized && !window.minimized) window.minimize();
            else if (!record.minimized && window.minimized) window.unminimize();
        });
    }

    _forget(record, restore = false) {
        if (!record.alive) return;
        record.alive = false;
        this._windows.delete(record.window); this._disconnect(record.signals);
        if (restore) this._restore(record);
    }

    stop() {
        this._active = false;
        if (this._scanSource) { GLib.Source.remove(this._scanSource); this._scanSource = 0; }
        this._disconnect(this._signals);
        for (const window of [...this._pending.keys()]) this._clearPending(window);
        for (const record of [...this._windows.values()]) this._forget(record, true);
        // Restoring a window that was originally fullscreen may raise it too.
        // Keep the current surviving app visible without activating anything.
        const focused = global.display.focus_window;
        try {
            if (focused && !focused.minimized && global.get_window_actors().some(actor => actor.meta_window === focused))
                focused.raise();
        } catch { /* Focus may have closed during native restoration. */ }
    }
}
