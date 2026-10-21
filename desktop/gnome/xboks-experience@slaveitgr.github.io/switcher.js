// SPDX-License-Identifier: MIT
// GNOME Shell51 native actors, never screenshots or an Electron modal.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {SwitcherSelection, boundedLabel, primaryModifier, cardGeometry} from './switcher-state.js';
import {SwitcherTheme} from './switcher-theme.js';

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
        this._root = null; this._grab = null; this._theme = null; this._modifierMask = 0; this._signals = []; this._refreshSource = 0; this._clockSource = 0;
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
        this.selection = new SwitcherSelection();
        this.selection.update(windowEntries(), focus ? String(focus.get_stable_sequence()) : undefined);
        this.selection.area = 'windows'; this.selection.mode = 'xbox';
        const root = this._root = new St.Widget({name: 'xboks-os-switcher', style_class: 'xboks-os-switcher', reactive: true, can_focus: true, clip_to_allocation: true,
            layout_manager: new Clutter.FixedLayout()});
        try {
            this._theme = new SwitcherTheme(root);
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
                // Emergency Ctrl+Super+Escape, Super+G and unrelated
                // compositor shortcuts must continue to propagate.
                if (modifiers & Clutter.ModifierType.CONTROL_MASK) return Clutter.EVENT_PROPAGATE;
                const tab = key === Clutter.KEY_Tab || key === Clutter.KEY_ISO_Left_Tab;
                const shortcutModifiers = modifiers & (Clutter.ModifierType.SUPER_MASK | Clutter.ModifierType.MOD1_MASK);
                if (shortcutModifiers && !(this._modifierMask & shortcutModifiers) && !tab) return Clutter.EVENT_PROPAGATE;
                let action = new Map([[Clutter.KEY_Left, 'left'], [Clutter.KEY_Right, 'right'], [Clutter.KEY_Up, 'up'], [Clutter.KEY_Down, 'down'],
                    [Clutter.KEY_Escape, 'cancel'], [Clutter.KEY_Return, 'accept'], [Clutter.KEY_space, 'accept']]).get(key);
                if (tab) {
                    // The modal owns repeated Tab presses after the existing
                    // WM binding has opened it. Alt+Shift+Tab may arrive as
                    // either Tab+Shift or the translated ISO_Left_Tab keysym.
                    if (shortcutModifiers && !this._modifierMask) this._modifierMask = primaryModifier(shortcutModifiers);
                    action = key === Clutter.KEY_ISO_Left_Tab || modifiers & Clutter.ModifierType.SHIFT_MASK ? 'previous' : 'next';
                }
                if (!action) return Clutter.EVENT_PROPAGATE;
                this.action(action); return Clutter.EVENT_STOP;
            });
            keys.connect('modifier-change', controller => {
                if (!this._modifierMask) return Clutter.EVENT_PROPAGATE;
                const [, pressed, latched, locked] = controller.get_state();
                if (!((pressed | latched | locked) & this._modifierMask)) this.action('accept');
                return Clutter.EVENT_STOP;
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
    keyboardSwitch(backward = false, mask = Clutter.ModifierType.MOD1_MASK) {
        if (!this._allowed()) { this.hide(); return false; }
        if (!this.visible && !this.open()) return false;
        this._modifierMask = primaryModifier(mask);
        this.action(backward ? 'previous' : 'next');
        // Like Shell51's stock switcher, account for Alt being released before
        // the modal grab finished. No subsequent modifier event would arrive.
        if (this._modifierMask && !(global.get_pointer()[2] & this._modifierMask)) this.action('accept');
        return this.visible;
    }
    _source(entry) {
        try {
            const source = entry.window.get_compositor_private();
            const [width, height] = source?.get_size() ?? [0, 0];
            if (width > 0 && height > 0) return {source, width, height, aspect: width / height};
        } catch { /* A native window may disappear between inventory/render. */ }
        return {source: null, width: 0, height: 0, aspect: 16 / 9};
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
    _card(entry, x, y, geometry, selected) {
        const {width, height, inset, header: headerHeight, scale} = geometry;
        const box = new St.Widget({style_class: `xboks-window-card${selected ? ' selected' : ''}`, reactive: true,
            clip_to_allocation: true, layout_manager: new Clutter.FixedLayout()});
        this._root.add_child(this._place(box, x, y, width, height));
        const header = new St.BoxLayout({style_class: `xboks-window-heading${selected ? '' : ' neighbor'}`});
        header.add_child(this._icon(entry, Math.round((selected ? 32 : 18) * scale)));
        header.add_child(new St.Label({text: entry.title || entry.name, y_align: Clutter.ActorAlign.CENTER, x_expand: true}));
        if (selected && entry.window.can_close?.() !== false)
            header.add_child(this._button('×', () => this.action('close-window'), 'close'));
        box.add_child(this._place(header, inset * 2, inset, width - inset * 4, headerHeight - inset));
        const previewHeight = height - headerHeight - inset;
        const content = new St.Widget({layout_manager: new Clutter.FixedLayout(), clip_to_allocation: true});
        box.add_child(this._place(content, inset, headerHeight, width - inset * 2, previewHeight));
        const {source, width: sourceWidth, height: sourceHeight} = this._source(entry);
        if (source) {
            const factor = Math.min((width - inset * 2) / sourceWidth, previewHeight / sourceHeight);
            const clone = new Clutter.Clone({source, width: sourceWidth * factor, height: sourceHeight * factor});
            content.add_child(this._place(clone, (width - inset * 2 - sourceWidth * factor) / 2,
                (previewHeight - sourceHeight * factor) / 2, sourceWidth * factor, sourceHeight * factor));
        } else content.add_child(new St.Label({text: this._text('Preview unavailable', 'Η προεπισκόπηση δεν είναι διαθέσιμη')}));
        const select = this._windowSelect(selected ? this._text('Select window', 'Επιλογή παραθύρου') : entry.name,
            () => { if (selected) this.action('accept'); else { this.selection.select(this.selection.entries.indexOf(entry)); this._render(); } });
        box.add_child(this._place(select, inset, selected ? headerHeight : 0, width - inset * 2, selected ? previewHeight : height));
        if (selected) {
            // Reference controls fade over the preview; reserving footer space
            // would distort the live window's measured aspect ratio.
            const footer = new St.Label({text: this._text('Ⓐ Select    Ⓧ Close', 'Ⓐ Επιλογή    Ⓧ Κλείσιμο'), style_class: 'xboks-card-actions'});
            box.add_child(this._place(footer, inset, height - 76 * scale, width - inset * 2, 66 * scale));
        }
    }
    _modeButton(id, label, scale) {
        const selected = this.selection.area === 'modes' && this.selection.mode === id;
        const content = new St.BoxLayout({style_class: 'xboks-mode-content'});
        const xbox = this.selection.entries.find(entry => ['xboks.desktop', 'gr.slave.xboks.desktop', 'gr.slave.xboks'].includes(entry.desktopId.toLowerCase()));
        content.add_child(id === 'xbox' && xbox ? this._icon(xbox, Math.round(20 * scale)) :
            new St.Icon({icon_name: id === 'desktop' ? 'computer-symbolic' : 'input-gaming-symbolic', icon_size: Math.round(20 * scale)}));
        content.add_child(new St.Label({text: label, y_align: Clutter.ActorAlign.CENTER}));
        const button = this._button(label, () => this.action(id), `mode${id === 'xbox' ? ' active-mode' : ''}${selected ? ' current' : ''}`, content);
        button.set_size((id === 'xbox' ? 166 : 268) * scale, 46 * scale);
        const slot = new St.Widget({layout_manager: new Clutter.FixedLayout()});
        slot.set_size((id === 'xbox' ? 166 : 268) * scale, 46 * scale); slot.add_child(button);
        if (id === 'xbox') {
            const underline = new St.Widget({style_class: 'xboks-mode-underline'});
            slot.add_child(this._place(underline, 75 * scale, 38 * scale, 20 * scale, 3 * scale));
        }
        return slot;
    }
    _render() {
        if (!this._root) return;
        for (const child of this._root.get_children()) child.destroy();
        const monitor = Main.layoutManager.focusMonitor ?? Main.layoutManager.primaryMonitor;
        const width = monitor.width, height = monitor.height;
        this._root.set_position(monitor.x, monitor.y); this._root.set_size(width, height);
        const selected = this.selection.entries[this.selection.index];
        const geometry = cardGeometry(width, height, this._source(selected).aspect), {scale, left, top} = geometry;
        const bar = new St.BoxLayout({style_class: 'xboks-app-bar', x_align: Clutter.ActorAlign.CENTER});
        const bumper = text => {
            const slot = new St.Widget({layout_manager: new Clutter.FixedLayout()}); slot.set_size(48 * scale, 72 * scale);
            slot.add_child(this._place(new St.Label({text, style_class: 'xboks-bumper'}), 12 * scale, 30 * scale, 24 * scale, 16 * scale));
            return slot;
        };
        bar.add_child(bumper('LB'));
        const first = Math.max(0, Math.min(this.selection.index - 4, this.selection.entries.length - 10));
        const shown = this.selection.entries.slice(first, first + 10);
        for (const entry of shown) {
            const index = this.selection.entries.indexOf(entry), button = this._button(entry.name,
                () => { this.selection.select(index); this._render(); }, `app${index === this.selection.index && this.selection.area === 'windows' ? ' current' : ''}`,
                this._icon(entry, Math.round(32 * scale)));
            button.set_size(72 * scale, 72 * scale); bar.add_child(button);
        }
        bar.add_child(bumper('RB'));
        const barWidth = (shown.length * 72 + 96) * scale;
        this._root.add_child(this._place(bar, (width - barWidth) / 2, 10 * scale, barWidth, 74 * scale));
        // A real local clock is the only status source here. Network/audio
        // glyphs must not imply device state that this extension cannot read.
        const now = GLib.DateTime.new_now_local(), clock = new St.Label({text: now.format('%X').replace(/:\d\d(?=\s|$)/, ''), style_class: 'xboks-switcher-clock'});
        this._root.add_child(this._place(clock, width - 160 * scale, 26 * scale, 150 * scale, 42 * scale));
        if (selected) {
            const before = this.selection.entries[this.selection.index - 1], after = this.selection.entries[this.selection.index + 1];
            if (before) {
                const previous = cardGeometry(width, height, this._source(before).aspect, false);
                this._card(before, left - 257 * scale - previous.width, previous.top, previous, false);
            }
            if (after) {
                const next = cardGeometry(width, height, this._source(after).aspect, false);
                this._card(after, left + geometry.width + 257 * scale, next.top, next, false);
            }
            this._card(selected, left, top, geometry, true);
        } else this._root.add_child(this._place(new St.Label({text: this._text('No open application windows', 'Δεν υπάρχουν ανοιχτά παράθυρα εφαρμογών')}), width * 0.35, height / 2, width * 0.5, 50));
        const bottom = new St.BoxLayout({style_class: 'xboks-mode-bar'});
        bottom.add_child(new St.Widget({x_expand: true}));
        bottom.add_child(this._modeButton('xbox', this._text('Xbox mode', 'Λειτουργία XBOX'), scale));
        bottom.add_child(this._modeButton('desktop', this._text('Linux desktop', 'Επιφάνεια εργασίας Linux'), scale));
        bottom.add_child(new St.Widget({x_expand: true}));
        this._root.add_child(this._place(bottom, 8 * scale, height - 62 * scale, width - 16 * scale, 54 * scale));
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
        this._root = null; this._modifierMask = 0;
        this._theme?.destroy(); this._theme = null;
        if (this._refreshSource) { GLib.Source.remove(this._refreshSource); this._refreshSource = 0; }
        if (this._clockSource) { GLib.Source.remove(this._clockSource); this._clockSource = 0; }
        for (const [object, id] of this._signals.splice(0)) { try { object.disconnect(id); } catch { /* Native window disappeared. */ } }
        if (this._grab) { Main.popModal(this._grab); this._grab = null; }
        Main.layoutManager.removeChrome(root); root.destroy(); this._changed(false);
    }
    destroy() { this.hide(); }
}
