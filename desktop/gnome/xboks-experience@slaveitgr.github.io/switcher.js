// SPDX-License-Identifier: MIT
// GNOME Shell51 native actors, never screenshots or an Electron modal.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {SwitcherSelection, boundedLabel} from './switcher-state.js';

export function windowEntries() {
    const tracker = Shell.WindowTracker.get_default(), seen = new Set();
    return global.display.get_tab_list(Meta.TabList.NORMAL_ALL, null).flatMap(candidate => {
        try {
            const window = candidate.is_attached_dialog() ? candidate.get_transient_for() : candidate;
            if (!window || window.skip_taskbar || seen.has(window)) return [];
            seen.add(window);
            const app = tracker.get_window_app(window);
            return [{id: String(window.get_stable_sequence()), window, app,
                desktopId: boundedLabel(app?.get_id()), name: boundedLabel(app?.get_name()) || boundedLabel(window.get_wm_class()) || 'Application',
                title: boundedLabel(window.get_title())}];
        } catch { return []; }
    }).slice(0, 32);
}

export class XboksSwitcher {
    constructor({leave, xbox, changed, allowed = () => true}) {
        this._leave = leave; this._xbox = xbox; this._changed = changed; this._allowed = allowed;
        this._root = null; this._grab = null; this._signals = []; this._refreshSource = 0; this._clockSource = 0;
        this.selection = new SwitcherSelection();
        const locale = GLib.get_language_names?.()[0] ?? 'en';
        this._el = locale.toLowerCase().startsWith('el');
    }
    get visible() { return this._root !== null; }
    _text(en, el) { return this._el ? el : en; }
    _connect(object, name, callback) { const id = object.connect(name, callback); this._signals.push([object, id]); }
    toggle() { if (this.visible) this.hide(); else this.open(); return this.visible; }
    open() {
        if (this.visible || !this._allowed()) return this.visible;
        const focus = global.display.focus_window;
        this.selection.update(windowEntries(), focus ? String(focus.get_stable_sequence()) : undefined);
        this.selection.area = 'windows'; this.selection.mode = 'xbox';
        const root = this._root = new St.Widget({name: 'xboks-os-switcher', style_class: 'xboks-os-switcher', reactive: true, can_focus: true, clip_to_allocation: true,
            layout_manager: new Clutter.FixedLayout()});
        try {
            Main.layoutManager.addTopChrome(root, {affectsStruts: false, trackFullscreen: false});
            this._grab = Main.pushModal(root, {actionMode: Shell.ActionMode.ALL});
            // Shell51 uses revocable Clutter.Grab objects (the older
            // get_seat_state()/GrabState API was removed from this typelib).
            if (!this._grab || this._grab.is_revoked()) throw Error('modal-unavailable');
            this._connect(this._grab, 'notify::revoked', grab => {
                if (grab.is_revoked()) this.hide();
            });
            const keys = new Clutter.KeyController();
            keys.connect('key-press', controller => {
                const [, key] = controller.get_key();
                const [, pressed, latched, locked] = controller.get_state(), modifiers = pressed | latched | locked;
                // Do not consume emergency Ctrl+Super+Escape, Super+G, or
                // other modified compositor shortcuts inside the switcher.
                if (modifiers & (Clutter.ModifierType.CONTROL_MASK | Clutter.ModifierType.SUPER_MASK | Clutter.ModifierType.MOD1_MASK)) return Clutter.EVENT_PROPAGATE;
                let action = new Map([[Clutter.KEY_Left, 'left'], [Clutter.KEY_Right, 'right'], [Clutter.KEY_Up, 'up'], [Clutter.KEY_Down, 'down'],
                    [Clutter.KEY_Escape, 'cancel'], [Clutter.KEY_Return, 'accept'], [Clutter.KEY_space, 'accept'], [Clutter.KEY_Tab, 'next']]).get(key);
                if (key === Clutter.KEY_Tab && modifiers & Clutter.ModifierType.SHIFT_MASK) action = 'previous';
                if (!action) return Clutter.EVENT_PROPAGATE;
                this.action(action); return Clutter.EVENT_STOP;
            });
            root.add_action(keys);
            this._connect(Main.layoutManager, 'monitors-changed', () => this.hide());
            this._connect(Main.layoutManager, 'system-modal-opened', () => this.hide());
            this._connect(global.display, 'window-created', () => this._scheduleRefresh());
            this._connect(global.window_manager, 'destroy', () => this._scheduleRefresh());
            this._clockSource = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 30, () => { this._render(); return GLib.SOURCE_CONTINUE; });
            this._render(); root.grab_key_focus(); this._changed(true);
        } catch (error) { this.hide(); throw error; }
        return true;
    }
    _scheduleRefresh() {
        if (!this.visible || this._refreshSource) return;
        this._refreshSource = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._refreshSource = 0;
            if (this.visible) { this.selection.update(windowEntries()); this._render(); }
            return GLib.SOURCE_REMOVE;
        });
    }
    _icon(entry, size) {
        try { return entry?.app?.create_icon_texture(size) ?? new St.Icon({icon_name: 'application-x-executable', icon_size: size}); }
        catch { return new St.Icon({icon_name: 'application-x-executable', icon_size: size}); }
    }
    _button(label, callback, styleClass = '', icon = null) {
        const button = new St.Button({style_class: `xboks-switcher-button ${styleClass}`, reactive: true, can_focus: true,
            accessible_name: label});
        if (icon) button.set_child(icon); else button.set_label(label);
        button.connect('clicked', callback); return button;
    }
    _windowSelect(label, callback) {
        // Keep the native preview unobstructed; the name is for accessibility.
        const button = new St.Button({style_class: 'xboks-switcher-button window-select', reactive: true, can_focus: true,
            accessible_name: label});
        button.connect('clicked', callback); return button;
    }
    _place(actor, x, y, width, height) { actor.set_position(Math.round(x), Math.round(y)); actor.set_size(Math.round(width), Math.round(height)); return actor; }
    _card(entry, x, y, width, height, selected) {
        const box = new St.Widget({style_class: `xboks-window-card${selected ? ' selected' : ''}`, reactive: true,
            layout_manager: new Clutter.FixedLayout()});
        this._root.add_child(this._place(box, x, y, width, height));
        const header = new St.BoxLayout({style_class: 'xboks-window-heading'});
        header.add_child(this._icon(entry, selected ? 32 : 22));
        header.add_child(new St.Label({text: entry.title || entry.name, y_align: Clutter.ActorAlign.CENTER, x_expand: true}));
        if (selected) header.add_child(this._button('×', () => this.action('close-window'), 'close'));
        box.add_child(this._place(header, 8, 0, width - 16, selected ? 64 : 40));
        const top = selected ? 64 : 40, footer = selected ? 56 : 0, content = new St.Widget({layout_manager: new Clutter.FixedLayout(), clip_to_allocation: true});
        box.add_child(this._place(content, 6, top, width - 12, height - top - footer));
        let source = null;
        try { source = entry.window.get_compositor_private(); } catch { /* Window closed during inventory. */ }
        let sourceWidth = 0, sourceHeight = 0;
        try { [sourceWidth, sourceHeight] = source?.get_size() ?? [0, 0]; } catch { source = null; }
        if (sourceWidth > 0 && sourceHeight > 0) {
            const scale = Math.min((width - 12) / sourceWidth, (height - top - footer) / sourceHeight);
            const clone = new Clutter.Clone({source, width: sourceWidth * scale, height: sourceHeight * scale});
            content.add_child(this._place(clone, (width - 12 - sourceWidth * scale) / 2, (height - top - footer - sourceHeight * scale) / 2, sourceWidth * scale, sourceHeight * scale));
        } else content.add_child(new St.Label({text: this._text('Preview unavailable', 'Η προεπισκόπηση δεν είναι διαθέσιμη')}));
        if (selected) {
            const actions = new St.Label({text: this._text('Ⓐ Select    Ⓧ Close', 'Ⓐ Επιλογή    Ⓧ Κλείσιμο'), style_class: 'xboks-card-actions'});
            box.add_child(this._place(actions, 20, height - footer, width - 40, footer));
            const select = this._windowSelect(this._text('Select window', 'Επιλογή παραθύρου'), () => this.action('accept'));
            box.add_child(this._place(select, 6, top, width - 12, Math.max(0, height - top - footer)));
        } else {
            const select = this._windowSelect(entry.name, () => { this.selection.select(this.selection.entries.indexOf(entry)); this._render(); });
            box.add_child(this._place(select, 0, 0, width, height));
        }
    }
    _render() {
        if (!this._root) return;
        for (const child of this._root.get_children()) child.destroy();
        const monitor = Main.layoutManager.focusMonitor ?? Main.layoutManager.primaryMonitor;
        const width = monitor.width, height = monitor.height;
        this._root.set_position(monitor.x, monitor.y); this._root.set_size(width, height);
        const scale = Math.max(0.65, Math.min(1.5, width / 1920)), iconSize = Math.round(40 * scale);
        const bar = new St.BoxLayout({style_class: 'xboks-app-bar', x_align: Clutter.ActorAlign.CENTER});
        bar.add_child(new St.Label({text: 'LB', y_align: Clutter.ActorAlign.CENTER, style_class: 'xboks-bumper'}));
        const shown = this.selection.entries.slice(Math.max(0, this.selection.index - 5), Math.max(10, this.selection.index + 5));
        for (const entry of shown) {
            const index = this.selection.entries.indexOf(entry), button = this._button(entry.name,
                () => { this.selection.select(index); this._render(); }, index === this.selection.index && this.selection.area === 'windows' ? 'current' : '', this._icon(entry, iconSize));
            button.set_size(72 * scale, 72 * scale); bar.add_child(button);
        }
        bar.add_child(new St.Label({text: 'RB', y_align: Clutter.ActorAlign.CENTER, style_class: 'xboks-bumper'}));
        const barWidth = (shown.length * 72 + 72) * scale;
        this._root.add_child(this._place(bar, (width - barWidth) / 2, 10 * scale, barWidth, 74 * scale));
        const now = GLib.DateTime.new_now_local(), clock = new St.Label({text: now.format('%H:%M'), style_class: 'xboks-switcher-clock'});
        this._root.add_child(this._place(clock, width - 140 * scale, 26 * scale, 130 * scale, 42 * scale));
        const cardWidth = Math.min(width * 0.48, 1000), cardHeight = Math.min(height * 0.54, height - 200 * scale), left = (width - cardWidth) / 2, top = (height - cardHeight) / 2;
        const selected = this.selection.entries[this.selection.index];
        if (selected) {
            const before = this.selection.entries[this.selection.index - 1], after = this.selection.entries[this.selection.index + 1];
            if (before) this._card(before, left - cardWidth * 0.6 - width * 0.13, (height - cardHeight * 0.6) / 2, cardWidth * 0.6, cardHeight * 0.6, false);
            if (after) this._card(after, left + cardWidth + width * 0.13, (height - cardHeight * 0.6) / 2, cardWidth * 0.6, cardHeight * 0.6, false);
            this._card(selected, left, top, cardWidth, cardHeight, true);
        } else this._root.add_child(this._place(new St.Label({text: this._text('No open application windows', 'Δεν υπάρχουν ανοιχτά παράθυρα εφαρμογών')}), width * 0.35, height / 2, width * 0.5, 50));
        const bottom = new St.BoxLayout({style_class: 'xboks-mode-bar'});
        bottom.add_child(new St.Widget({x_expand: true}));
        for (const [id, label] of [['xbox', this._text('Xbox mode', 'Λειτουργία Xbox')], ['desktop', this._text('Desktop', 'Επιφάνεια εργασίας')]])
            bottom.add_child(this._button(label, () => this.action(id), this.selection.area === 'modes' && this.selection.mode === id ? 'current' : ''));
        bottom.add_child(new St.Widget({x_expand: true}));
        this._root.add_child(this._place(bottom, 8, height - 62 * scale, width - 16, 54 * scale));
        const hint = new St.Label({text: this._text('LB / RB  Switch apps     A  Select     B  Back', 'LB / RB  Αλλαγή εφαρμογής     A  Επιλογή     B  Πίσω'), style_class: 'xboks-switcher-hint'});
        this._root.add_child(this._place(hint, width * 0.28, height - 118 * scale, width * 0.6, 40 * scale));
    }
    action(action) {
        if (!this._allowed()) { this.hide(); return false; }
        if (action === 'toggle') return this.toggle();
        if (action === 'open') return this.open();
        if (!this.visible) return false;
        const outcome = this.selection.action(action), entry = this.selection.entries[this.selection.index];
        if (outcome === 'desktop') { this.hide(); this._leave(); }
        else if (outcome === 'xbox') { this.hide(); this._xbox(); }
        else if (outcome === 'cancel') this.hide();
        else if (outcome === 'activate') {
            const live = windowEntries().find(candidate => candidate.window === entry?.window);
            this.hide(); if (live) Main.activateWindow(live.window, global.get_current_time());
        } else if (outcome === 'close-window') {
            const live = windowEntries().find(candidate => candidate.window === entry?.window);
            if (live) live.window.delete(global.get_current_time());
            this._scheduleRefresh();
        } else this._render();
        return this.visible;
    }
    hide() {
        const root = this._root; if (!root) return;
        this._root = null;
        if (this._refreshSource) { GLib.Source.remove(this._refreshSource); this._refreshSource = 0; }
        if (this._clockSource) { GLib.Source.remove(this._clockSource); this._clockSource = 0; }
        for (const [object, id] of this._signals.splice(0)) { try { object.disconnect(id); } catch { /* Native window disappeared. */ } }
        if (this._grab) { Main.popModal(this._grab); this._grab = null; }
        Main.layoutManager.removeChrome(root); root.destroy(); this._changed(false);
    }
    destroy() { this.hide(); }
}
