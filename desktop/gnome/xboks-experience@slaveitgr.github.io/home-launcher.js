// SPDX-License-Identifier: MIT
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {HOME_APPS, normalizeHomeApp, homeLaunchSpec} from './home-apps.js';
import {FeralGameMode} from './feral-gamemode.js';

export const HOME_INTERFACE = 'org.slaveitgr.Xboks.Experience.Home1';
export const HOME_OBJECT = '/org/slaveitgr/Xboks/Experience/Home1';
export const HOME_START_TIMEOUT_MS = 300000;

// Gio interprets the installed desktop entry; no shell or user-supplied command
// is constructed. Only the fixed XBOKS launch flag is added to its Exec field.
export function launchHomeDesktop(spec, context) {
    const app = GioUnix.DesktopAppInfo.new(spec.desktopId);
    if (!app) throw Error('home-not-installed');
    if (spec.uris?.length) {
        if (!app.launch_uris(spec.uris, context)) throw Error('home-launch-failed');
    } else if (spec.args?.length) {
        if (spec.id !== 'xboks' || spec.args.length !== 1 || spec.args[0] !== '--fullscreen-experience')
            throw Error('invalid-home-adapter');
        const keyfile = new GLib.KeyFile();
        keyfile.load_from_file(app.get_filename(), GLib.KeyFileFlags.NONE);
        const command = keyfile.get_string('Desktop Entry', 'Exec');
        if (!command || command.length > 16384) throw Error('invalid-home-adapter');
        keyfile.set_string('Desktop Entry', 'Exec', command + ' --fullscreen-experience');
        const adapter = GioUnix.DesktopAppInfo.new_from_keyfile(keyfile);
        if (!adapter?.launch([], context)) throw Error('home-launch-failed');
    } else if (!app.launch([], context)) throw Error('home-launch-failed');
}

export class GamingHome {
    constructor({settings, enter, leave, active, guardCover, changed = () => {}, notify = message => Main.notify('Linux Gaming Mode', message)}) {
        this._settings = settings; this._enter = enter; this._leave = leave; this._active = active;
        this._changed = changed; this._notify = notify;
        this._guardCover = guardCover; this._coverGuard = null;
        this.session = null; this._sources = new Set(); this._signals = []; this._cover = null;
        this._startupDone = false; this._destroyed = false;
        this._performance = new FeralGameMode({changed: () => this._changed()});
        this._settingsSignal = settings.connect('changed::use-feral-gamemode', () => this._syncPerformance());
    }

    get state() {
        return {selected: normalizeHomeApp(this._settings.get_string('home-app')), active: Boolean(this._active()),
            loading: Boolean(this.session && !this.session.ready), performance: this._performance.state};
    }

    scheduleStartup() {
        if (this._startupDone || this._destroyed) return;
        if (!Main.layoutManager._startingUp) { this._startup(); return; }
        // Cover the desktop while Shell completes login; launch once its user
        // session is ready. Never acquire a modal grab over the lock screen.
        if (this._settings.get_boolean('enter-on-login') && normalizeHomeApp(this._settings.get_string('home-app')) !== 'none') {
            try { this._showCover(); } catch (error) { this._startupDone = true; this._hideCover(); this._notify(this._errorText(error)); return; }
        }
        const id = Main.layoutManager.connect('startup-complete', () => {
            Main.layoutManager.disconnect(id);
            this._signals = this._signals.filter(entry => entry[1] !== id || entry[0] !== Main.layoutManager);
            this._startup();
        });
        this._signals.push([Main.layoutManager, id]);
    }

    _startup() {
        if (this._startupDone || this._destroyed) return;
        this._startupDone = true;
        if (!this._settings.get_boolean('enter-on-login') || normalizeHomeApp(this._settings.get_string('home-app')) === 'none') {
            this._hideCover(); return;
        }
        const start = () => { try { this.launch(); } catch (error) { this._hideCover(); this._notify(this._errorText(error)); } };
        if (Main.overview.visible || Main.overview.animationInProgress) {
            // GNOME may initially open Overview. Close it behind the guarded
            // cover and wait for its animation before acquiring the mode lease.
            try { this._showCover(); Main.overview.hide(); }
            catch (error) { this._hideCover(); this._notify(this._errorText(error)); return; }
            let attempts = 0;
            const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                if (!Main.overview.visible && !Main.overview.animationInProgress) {
                    this._sources.delete(id); start(); return GLib.SOURCE_REMOVE;
                }
                if (++attempts >= 100) {
                    this._sources.delete(id); this._hideCover(); this._notify(this._errorText(Error('unavailable'))); return GLib.SOURCE_REMOVE;
                }
                return GLib.SOURCE_CONTINUE;
            });
            this._sources.add(id);
        } else start();
    }

    _errorText(error) {
        const el = (GLib.get_language_names()[0] ?? '').startsWith('el');
        const reasons = {
            'home-not-installed': el ? 'Η επιλεγμένη αρχική εφαρμογή δεν είναι εγκατεστημένη.' : 'The selected gaming home app is not installed.',
            'home-not-selected': el ? 'Επίλεξε πρώτα μια αρχική εφαρμογή στις ρυθμίσεις.' : 'Choose a gaming home app in Preferences first.',
            'home-start-timeout': el ? 'Η αρχική εφαρμογή δεν εμφάνισε παράθυρο. Επιστροφή στην επιφάνεια εργασίας.' : 'The home app did not display a window. The desktop has been restored.',
        };
        return reasons[error.message] ?? (el ? 'Η λειτουργία παιχνιδιών δεν ξεκίνησε. Η επιφάνεια εργασίας αποκαταστάθηκε.' : 'Gaming mode could not start. The desktop has been restored.');
    }

    launch() {
        if (this._destroyed) throw Error('unavailable');
        if (this._active()) {
            if (this.session?.ready) { this.focus(); return; }
            throw Error('busy');
        }
        const selected = normalizeHomeApp(this._settings.get_string('home-app'));
        if (selected === 'none') throw Error('home-not-selected');
        const ids = HOME_APPS.flatMap(home => home.desktopIds).filter(id => GioUnix.DesktopAppInfo.new(id));
        const spec = homeLaunchSpec(selected, ids);
        if (!spec) throw Error('home-not-installed');
        const app = Shell.AppSystem.get_default().lookup_app(spec.desktopId);
        if (!app) throw Error('home-not-installed');
        const session = {id: selected, desktopId: spec.desktopId, app, ready: false, window: null};
        this.session = session;
        try {
            this._releaseCoverGuard();
            this._enter();
            this._showCover();
            this._syncPerformance();
            launchHomeDesktop(spec, global.create_app_launch_context(global.get_current_time(), -1));
            const scan = () => { if (this.session === session) this._scan(); };
            for (const [object, signal] of [[Shell.WindowTracker.get_default(), 'tracked-windows-changed'],
                [global.window_manager, 'map'], [global.display, 'window-created']])
                this._signals.push([object, object.connect(signal, scan)]);
            this._timer(250, () => { this._scan(); return this.session === session; }, true);
            this._timer(HOME_START_TIMEOUT_MS, () => {
                if (this.session === session && !session.ready) this._fail(Error('home-start-timeout'));
            });
            this._scan(); this._changed();
        } catch (error) { this._leave(); this.stop(); throw error; }
    }

    _timer(delay, callback, repeat = false) {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            if (this._destroyed || !this.session || !repeat) this._sources.delete(id);
            const keep = !this._destroyed && this.session && callback();
            if (!repeat || !keep) this._sources.delete(id);
            return repeat && keep ? GLib.SOURCE_CONTINUE : GLib.SOURCE_REMOVE;
        });
        this._sources.add(id);
    }

    matches(window) {
        try {
            return Boolean(this.session && window && Shell.WindowTracker.get_default().get_window_app(window)?.get_id() === this.session.desktopId);
        } catch { return false; }
    }

    _windows() {
        try {
            return this.session?.app.get_windows().filter(window => this.matches(window) && window.get_window_type() === Meta.WindowType.NORMAL &&
                !window.skip_taskbar && !window.get_transient_for?.() && window.mapped &&
                !['XBOKS Game Bar', 'xboks Game Bar'].includes(window.get_title()) &&
                (this.session.id !== 'steam' || /\bbig\s*picture\b|\bgamepadui\b/i.test(window.get_title()))) ?? [];
        } catch { return []; }
    }

    _scan() {
        const session = this.session;
        if (!session) return;
        const windows = this._windows();
        if (windows.length) {
            const window = windows.find(candidate => candidate === session.window) ?? windows[0];
            session.window = window;
            if (!session.ready) {
                // The native policy has already requested fullscreen. Reveal
                // only a mapped selected home, never a background desktop app.
                window.unminimize(); window.make_fullscreen();
                Main.activateWindow(window, global.get_current_time());
                session.ready = true; this._hideCover(); this._changed();
            }
            this._syncPerformance();
        } else if (session.ready) this._leave();
    }

    _syncPerformance() {
        this._performance.setEnabled(Boolean(this._active() && this._settings.get_boolean('use-feral-gamemode')));
        if (!this._active() || (this.session && !this.session.ready)) { this._performance.setProcesses([]); return; }
        const pids = global.get_window_actors().flatMap(({meta_window: window}) => {
            try {
                if (window.get_window_type() !== Meta.WindowType.NORMAL || window.skip_taskbar ||
                    ['XBOKS Game Bar', 'xboks Game Bar'].includes(window.get_title())) return [];
                return [window.get_pid()];
            } catch { return []; }
        });
        const homePids = this._windows().map(window => window.get_pid());
        this._performance.setProcesses([...new Set([...homePids, ...pids])]);
    }

    syncPerformance() { this._syncPerformance(); }

    focus() {
        const window = this._windows().find(candidate => candidate === this.session?.window) ?? this._windows()[0];
        if (window) Main.activateWindow(window, global.get_current_time());
    }

    _showCover() {
        if (this._cover || this._destroyed) return;
        if (!this._active()) {
            if (!this._guardCover) throw Error('emergency-unavailable');
            this._coverGuard = this._guardCover();
        }
        const cover = new St.Widget({style_class: 'linux-gaming-mode-loading', reactive: true,
            layout_manager: new Clutter.BinLayout(), x: 0, y: 0, width: global.stage.width, height: global.stage.height,
            style: 'background-color: #080b09;'});
        this._cover = cover;
        const el = (GLib.get_language_names()[0] ?? '').startsWith('el');
        const box = new St.BoxLayout({vertical: true, x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
        box.add_child(new St.Label({text: 'Linux Gaming Mode', style: 'font-size: 28px; color: white; padding: 16px;'}));
        box.add_child(new St.Label({text: el ? 'Φόρτωση αρχικής εφαρμογής…' : 'Starting your gaming home…', style: 'color: #d1d8d3; padding: 12px;'}));
        const escape = new St.Button({label: el ? 'Επιστροφή στην επιφάνεια εργασίας' : 'Return to desktop',
            can_focus: true, style_class: 'button', x_align: Clutter.ActorAlign.CENTER});
        escape.connect('clicked', () => this.cancelStartup());
        box.add_child(escape); cover.add_child(box); Main.layoutManager.addTopChrome(cover);
    }

    _releaseCoverGuard() { const release = this._coverGuard; this._coverGuard = null; release?.(); }
    _hideCover() { this._cover?.destroy(); this._cover = null; this._releaseCoverGuard(); }
    cancelStartup() { this._startupDone = true; this._leave(); this.stop(); }
    _fail(error) { this._leave(); this.stop(); this._notify(this._errorText(error)); }
    stop() {
        this.session = null;
        for (const id of this._sources) GLib.Source.remove(id);
        this._sources.clear();
        for (const [object, id] of this._signals.splice(0)) { try { object.disconnect(id); } catch { /* App or startup actor ended. */ } }
        this._hideCover(); this._performance.stop(); this._changed();
    }
    destroy() {
        this._destroyed = true; this.stop();
        this._settings.disconnect(this._settingsSignal); this._performance.destroy();
    }
}
